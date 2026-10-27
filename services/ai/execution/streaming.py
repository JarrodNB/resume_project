"""Buffer optional public output across replicas without owning durable execution.

Redis loss disables a sink and causes an observer reset. It never retries a model
or substitutes for Rails acceptance. Every stream is fenced by its saved attempt.
"""

import asyncio
import json
import re

from schemas.execution_stream import StreamEvent, StreamIdentity

CURSOR = re.compile(r"^(0|[1-9][0-9]{0,19})-(0|[1-9][0-9]{0,19})$")


class StreamGap(RuntimeError):
    """Replay history disappeared, was trimmed, or belongs to another attempt."""


class StreamUnavailable(RuntimeError):
    """The optional output buffer is unavailable; durable execution may continue."""


PUBLISH = """
local current = redis.call('GET', KEYS[1])
local original = redis.call('GET', KEYS[3])
local exists = redis.call('EXISTS', KEYS[2])
local wanted = ARGV[1] .. ':' .. ARGV[2]
if current and current ~= wanted then
  local generation = tonumber(string.match(current, '^(%d+):'))
  if generation >= tonumber(ARGV[1]) then return -2 end
end
if exists == 1 and (not current or not original) then return -1 end
if exists == 0 and original then return -1 end
if ARGV[3] == '0' and (not current or exists == 0 or not original) then return -1 end
redis.call('SET', KEYS[1], wanted, 'EX', ARGV[6])
local id = redis.call('XADD', KEYS[2], 'MAXLEN', '=', ARGV[5], '*', 'event', ARGV[4])
if not original then redis.call('SET', KEYS[3], id) end
redis.call('EXPIRE', KEYS[2], ARGV[6])
redis.call('EXPIRE', KEYS[3], ARGV[6])
return id
"""


def stream_keys(identity):
    scope = f"ai-output:{identity.feature}:{identity.operation_id}"
    return scope + ":current", f"{scope}:{identity.claim_generation}:{identity.attempt_id}"


class StreamBuffer:
    def __init__(self, url, *, max_events=512, retention_seconds=300):
        if not 2 <= max_events <= 10000 or not 30 <= retention_seconds <= 3600:
            raise ValueError("Stream retention must be bounded")
        from redis.asyncio import Redis
        from redis.exceptions import RedisError

        self.error_types = (RedisError, OSError, ValueError, KeyError, TimeoutError)
        self.client = Redis.from_url(url, decode_responses=True,
            socket_connect_timeout=0.5, socket_timeout=2, max_connections=64)
        self.max_events = max_events
        self.retention_seconds = retention_seconds
        self.closed = False

    def sink(self, **identity):
        return StreamSink(self, StreamIdentity.model_validate(identity))

    async def close(self):
        self.closed = True
        await self.client.aclose()

    async def _history(self, current_key, key):
        pipeline = self.client.pipeline(transaction=False)
        pipeline.get(current_key)
        pipeline.get(key + ":first")
        pipeline.xrange(key, count=1)
        pipeline.xrevrange(key, count=1)
        return await pipeline.execute()

    @staticmethod
    def _validate_history(identity, cursor, current, original, first, last):
        wanted = f"{identity.claim_generation}:{identity.attempt_id}"
        if current is not None and current != wanted:
            generation = int(current.split(":", 1)[0])
            if generation >= identity.claim_generation or first:
                raise StreamGap("Execution was superseded")
        if first:
            if current is None or original is None:
                raise StreamGap("Output generation state disappeared")
            if cursor == "0-0" and first[0][0] != original:
                raise StreamGap("Initial output was trimmed")
        elif original is not None:
            raise StreamGap("Output history disappeared")
        if cursor != "0-0":
            number = tuple(map(int, cursor.split("-")))
            if not first or number < tuple(map(int, first[0][0].split("-"))) or number > tuple(map(int, last[0][0].split("-"))):
                raise StreamGap("Replay history unavailable")

    async def read(self, identity, cursor, *, block_ms=1000):
        if self.closed:
            raise StreamUnavailable("Output buffer closed")
        identity = StreamIdentity.model_validate(identity)
        if not isinstance(cursor, str) or not CURSOR.fullmatch(cursor):
            raise StreamGap("Invalid replay cursor")
        current_key, key = stream_keys(identity)
        try:
            self._validate_history(identity, cursor, *await self._history(current_key, key))
            rows = await self.client.xread({key: cursor}, count=64, block=max(1, min(block_ms, 1000)))
            # Writes can trim or supersede history while XREAD is blocked.
            self._validate_history(identity, cursor, *await self._history(current_key, key))
            events = []
            for _, entries in rows:
                for event_id, fields in entries:
                    event = StreamEvent.model_validate_json(fields["event"])
                    if StreamIdentity.model_validate(event.model_dump(include=set(StreamIdentity.model_fields))) != identity:
                        raise StreamGap("Execution identity changed")
                    events.append((event_id, event.model_dump(mode="json", exclude_none=True)))
            return events
        except StreamGap:
            raise
        except self.error_types:
            raise StreamUnavailable("Output buffer unavailable") from None


class StreamSink:
    def __init__(self, buffer, identity):
        self.buffer = buffer
        self.identity = identity
        self.initialized = False
        self.available = True

    async def emit(self, kind, **payload):
        event = StreamEvent(**self.identity.model_dump(), type=kind, **payload)
        if not self.available or self.buffer.closed:
            return False
        current, key = stream_keys(self.identity)
        try:
            async with asyncio.timeout(0.25):
                result = await self.buffer.client.eval(PUBLISH, 3, current, key, key + ":first",
                    self.identity.claim_generation, str(self.identity.attempt_id), "0" if self.initialized else "1",
                    json.dumps(event.model_dump(mode="json", exclude_none=True), separators=(",", ":")),
                    self.buffer.max_events, self.buffer.retention_seconds)
            if result in (-1, -2):
                self.available = False
                return False
            self.initialized = True
            return True
        except self.buffer.error_types:
            # No Redis error/URL or provisional text enters logs or durable results.
            self.available = False
            return False


class StreamingOutputs:
    """A server-owned opt-in; interviews always keep their final-only output."""

    def __init__(self, buffer, features):
        self.buffer = buffer
        self.features = frozenset(features) - {"interviews"}

    def __call__(self, feature, claim):
        if feature not in self.features:
            return None
        return self.buffer.sink(feature=feature, operation_id=claim.operation_id,
            attempt_id=claim.attempt_id, claim_generation=claim.claim_generation)
