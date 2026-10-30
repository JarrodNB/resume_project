"""Honor environment proxies while verifying a pinned IP against its original hostname.

HTTPcore's proxy tunnel ignores the per-request SNI extension. A request-scoped
TLS context preserves hostname verification for that tunnel without re-resolving
the destination. Each delegated client inherits normal proxy and CA settings;
no connection, cookie or authentication state is shared between websites.
"""

import ssl

import httpx


class PinnedJobTLSContext(ssl.SSLContext):
    """Verify a public IP connection using the original job website's DNS identity."""

    def __new__(cls, address, hostname):
        return super().__new__(cls, ssl.PROTOCOL_TLS_CLIENT)

    def __init__(self, address, hostname):
        self.address = address
        self.hostname = hostname
        trusted = httpx.create_ssl_context()
        self.load_verify_locations(cadata="\n".join(
            ssl.DER_cert_to_PEM_cert(cert) for cert in trusted.get_ca_certs(binary_form=True)
        ))
        self.check_hostname = True
        self.verify_mode = ssl.CERT_REQUIRED

    def wrap_socket(self, *args, server_hostname=None, **kwargs):
        if server_hostname == self.address:
            server_hostname = self.hostname
        return super().wrap_socket(*args, server_hostname=server_hostname, **kwargs)

    def wrap_bio(self, *args, server_hostname=None, **kwargs):
        if server_hostname == self.address:
            server_hostname = self.hostname
        return super().wrap_bio(*args, server_hostname=server_hostname, **kwargs)


class _OwnedResponseStream(httpx.SyncByteStream):
    def __init__(self, response, client):
        self.response, self.client = response, client

    def __iter__(self):
        yield from self.response.iter_raw()

    def close(self):
        try:
            self.response.close()
        finally:
            self.client.close()


class PublicJobTransport(httpx.BaseTransport):
    """Delegate through a fresh environment-aware client for each job-page request."""

    def handle_request(self, request):
        hostname = request.extensions.get("job_origin_hostname")
        context = PinnedJobTLSContext(request.url.host, hostname) if hostname else True
        client = httpx.Client(verify=context, follow_redirects=False)
        try:
            response = client.send(request, stream=True, auth=None)
        except BaseException:
            client.close()
            raise
        return httpx.Response(
            response.status_code, headers=response.headers,
            stream=_OwnedResponseStream(response, client), extensions=response.extensions,
        )
