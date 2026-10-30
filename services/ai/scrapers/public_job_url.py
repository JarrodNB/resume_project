"""Validate public web destinations and resolve them once before a pinned request.

Every DNS answer must be public. The caller connects to a returned IP, never a
second hostname lookup. DNS work is bounded and cannot grow an unbounded queue.
"""

import ipaddress
import socket
from threading import BoundedSemaphore, Event, Thread
from time import monotonic
from urllib.parse import urlsplit, urlunsplit

from scrapers.job_page import JobPageUnreadableError, UnsupportedJobUrlError
from text_limits import MAX_JOB_URL

MAX_JOB_URL_LENGTH = MAX_JOB_URL
_dns_slots = BoundedSemaphore(4)
_transition_networks = tuple(ipaddress.ip_network(net) for net in (
    "64:ff9b::/96", "64:ff9b:1::/48", "2002::/16", "2001::/32",
))


def public_ip(value: str) -> bool:
    """Exclude private, special, multicast and IPv4-embedding/transition addresses."""
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    if "%" in value or not address.is_global or address.is_multicast or address.is_reserved:
        return False
    return not any(address in network for network in _transition_networks
                   if address.version == network.version)


def public_job_url(value: str) -> str:
    """Accept ordinary HTTP(S) URLs, without credentials or alternate service ports."""
    try:
        if not value or len(value) > MAX_JOB_URL_LENGTH or any(ord(c) < 33 for c in value):
            raise ValueError
        parts = urlsplit(value)
        host = parts.hostname or ""
        if (parts.scheme not in ("http", "https") or not host or parts.username is not None
                or parts.password is not None or "\\" in value or "%" in host
                or parts.port not in (None, 443 if parts.scheme == "https" else 80)):
            raise ValueError
        host = host.encode("idna").decode("ascii").lower().rstrip(".")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            if "." not in host or host.endswith((".localhost", ".local", ".internal", ".test", ".invalid")):
                raise ValueError
        else:
            if not public_ip(host):
                raise ValueError
        authority = f"[{host}]" if ":" in host else host
        return urlunsplit((parts.scheme, authority, parts.path or "/", parts.query, ""))
    except (ValueError, UnicodeError) as error:
        raise UnsupportedJobUrlError("Use a public HTTP or HTTPS job posting URL") from error


def resolve_public_job_host(host: str, port: int, deadline: float) -> str:
    """Bound DNS time and reject the whole answer set if any destination is non-public."""
    if monotonic() >= deadline:
        raise JobPageUnreadableError("Job lookup timed out")
    if not _dns_slots.acquire(blocking=False):
        raise JobPageUnreadableError("Job lookup is busy; try again")
    done = Event()
    answers, errors = [], []

    def resolve():
        try:
            answers.extend(socket.getaddrinfo(host, port, type=socket.SOCK_STREAM))
        except OSError as error:
            errors.append(error)
        finally:
            _dns_slots.release()
            done.set()

    Thread(target=resolve, daemon=True).start()
    if not done.wait(max(0, deadline - monotonic())):
        raise JobPageUnreadableError("Job lookup timed out")
    if errors or not answers:
        raise JobPageUnreadableError("The job website could not be resolved")
    addresses = [answer[4][0] for answer in answers]
    if not all(public_ip(address) for address in addresses):
        raise UnsupportedJobUrlError("Job URLs must resolve only to public addresses")
    return addresses[0]
