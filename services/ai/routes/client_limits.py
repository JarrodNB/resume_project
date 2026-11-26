"""Keep one client address from tying up the public WebSocket endpoints before it signs in.

The two browser WebSockets (execution output and live transcription) accept a connection first
and only then read a token, which is checked with a call to Rails. Without a limit, one client
could open many sockets, or send many wrong tokens, and make this service call Rails for each.
This allows a limited number of not-yet-signed-in sockets per client, and refuses a client that
has had too many sockets end without signing in during the last minute. A socket that signs in
is no longer counted, so normal use is never slowed, even behind a shared address.

The client address is the first X-Forwarded-For value, which the front Caddy sets from the real
connection (it does not trust client-supplied values), or the direct peer address when there is
no proxy. An IPv6 address counts as its whole /64 network, because one customer usually controls
a /64 (the Rails limits do the same), and a value that is not an address shares one bucket.
Counts are kept in this process only, so with more than one worker or replica each has its own
limits. A Rails outage makes sign-in checks fail, which counts against the client like a wrong token. Entries for addresses that have gone quiet are dropped, and the number of addresses
tracked is capped, so the tables cannot grow without bound.

A refused socket is closed before it is accepted, so a browser sees a failed connection (HTTP 403
on the handshake), not a WebSocket close code; the web clients already retry and then fall back.
"""
import ipaddress
import time
from collections import defaultdict, deque

MAX_PENDING_PER_CLIENT = 20
MAX_FAILURES_PER_MINUTE = 20
WINDOW_SECONDS = 60
MAX_TRACKED_CLIENTS = 10_000
SWEEP_EVERY_ADMITS = 256
INVALID_CLIENT = "invalid"
OVERFLOW_CLIENT = "overflow"
REFUSED_CLOSE_CODE = 1013  # "try again later"; seen by tests and non-browser clients only


def client_key(socket) -> str:
    """Return the address (or IPv6 /64 network) to count this socket against."""
    forwarded = socket.headers.get("x-forwarded-for", "").split(",")[0].strip()
    raw = forwarded or (socket.client.host if socket.client else "")
    try:
        address = ipaddress.ip_address(raw)
    except ValueError:
        return INVALID_CLIENT
    if address.version == 6 and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    if address.version == 6:
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return str(address)


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
                 window_seconds=WINDOW_SECONDS, max_tracked=MAX_TRACKED_CLIENTS, clock=time.monotonic):
        self.max_pending, self.max_failures = max_pending, max_failures
        self.window_seconds, self.max_tracked, self._clock = window_seconds, max_tracked, clock
        self._pending = defaultdict(int)
        self._failures = defaultdict(deque)
        self._admits = 0

    def admit(self, client) -> Ticket | None:
        """Returns a ticket for a new socket, or None when this client is over a limit."""
        self._admits += 1
        if self._admits % SWEEP_EVERY_ADMITS == 0:
            self._sweep()
        if client not in self._pending and client not in self._failures and self._at_tracking_limit():
            client = OVERFLOW_CLIENT  # too many different addresses: the rest share one budget
        if self._pending[client] >= self.max_pending or self._recent_failures(client) >= self.max_failures:
            self._forget_if_idle(client)
            return None
        self._pending[client] += 1
        return Ticket(self, client)

    def _at_tracking_limit(self) -> bool:
        """True when the tables are full even after dropping addresses that have gone quiet."""
        if len(self._pending) + len(self._failures) < self.max_tracked:  # cheap check; the sum over-counts at most
            return False
        self._sweep()
        return len(self._pending.keys() | self._failures.keys()) >= self.max_tracked

    def _sweep(self):
        """Drops every address whose failures are all older than the window."""
        cutoff = self._clock() - self.window_seconds
        for client in [client for client, failures in self._failures.items() if not failures or failures[-1] <= cutoff]:
            del self._failures[client]

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
