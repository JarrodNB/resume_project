"""Keep one client address from tying up the public WebSocket endpoints before it signs in.

The two browser WebSockets (execution output and live transcription) accept a connection first
and only then read a token, which is checked with a call to Rails. Without a limit, one client
could open many sockets, or send many wrong tokens, and make this service call Rails for each.
This allows a limited number of not-yet-signed-in sockets per client, and refuses a client that
has had too many sockets end without signing in during the last minute. A socket that signs in
is no longer counted, so normal use is never slowed, even behind a shared address.

The client address is the first X-Forwarded-For value, which the front Caddy sets from the real
connection (it does not trust client-supplied values), or the direct peer address when there is
no proxy. Counts are kept in this process only.
"""
import time
from collections import defaultdict, deque

MAX_PENDING_PER_CLIENT = 20
MAX_FAILURES_PER_MINUTE = 20
WINDOW_SECONDS = 60
REFUSED_CLOSE_CODE = 1013  # "try again later"


def client_key(socket) -> str:
    """Return the address to count this socket against."""
    forwarded = socket.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if forwarded:
        return forwarded
    return socket.client.host if socket.client else "unknown"


class Ticket:
    """One admitted socket. Call authorized() when it signs in, and close() when it ends."""

    def __init__(self, limits, client):
        self._limits, self._client, self._pending = limits, client, True

    def authorized(self):
        if self._pending:
            self._pending = False
            self._limits._release_pending(self._client)

    def close(self):
        """Ends the ticket; a socket that never signed in counts as a failed attempt."""
        if self._pending:
            self._pending = False
            self._limits._release_pending(self._client)
            self._limits._record_failure(self._client)


class ClientLimits:
    def __init__(self, *, max_pending=MAX_PENDING_PER_CLIENT, max_failures=MAX_FAILURES_PER_MINUTE,
                 window_seconds=WINDOW_SECONDS, clock=time.monotonic):
        self.max_pending, self.max_failures = max_pending, max_failures
        self.window_seconds, self._clock = window_seconds, clock
        self._pending = defaultdict(int)
        self._failures = defaultdict(deque)

    def admit(self, client) -> Ticket | None:
        """Returns a ticket for a new socket, or None when this client is over a limit."""
        if self._pending[client] >= self.max_pending or self._recent_failures(client) >= self.max_failures:
            self._forget_if_idle(client)
            return None
        self._pending[client] += 1
        return Ticket(self, client)

    def _recent_failures(self, client) -> int:
        failures = self._failures[client]
        cutoff = self._clock() - self.window_seconds
        while failures and failures[0] <= cutoff:
            failures.popleft()
        return len(failures)

    def _record_failure(self, client):
        self._failures[client].append(self._clock())

    def _release_pending(self, client):
        self._pending[client] -= 1
        self._forget_if_idle(client)

    def _forget_if_idle(self, client):
        """Drops empty entries so the tables do not grow with every address ever seen."""
        if self._pending.get(client) == 0:
            del self._pending[client]
        if client in self._failures and not self._failures[client]:
            del self._failures[client]
