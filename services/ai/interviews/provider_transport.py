"""Route fixed HTTPS provider calls through the host's configured proxy.

Keep retries disabled for per-request accounting. TLS verification and the
environment's certificate trust remain enabled; injected test transports bypass
this factory. Local Rails and private storage clients keep their own routing.
"""

from urllib.request import getproxies


def provider_transport(transport_type):
    """Build an HTTP transport for the interview's fixed HTTPS providers."""
    proxies = getproxies()
    return transport_type(retries=0, proxy=proxies.get("https") or proxies.get("all"))
