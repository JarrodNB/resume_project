"""Verify interview clients reach a local proxy without contacting providers."""

import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest

from interviews.audio_providers import AudioProviders
from interviews.models import InterviewModels


@pytest.mark.parametrize("provider", ["openai", "typesafe", "audio"])
def test_provider_clients_use_https_proxy_without_retrying(monkeypatch, provider):
    requests = []

    class Proxy(BaseHTTPRequestHandler):
        def do_CONNECT(self):
            requests.append(self.path)
            self.send_error(502)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Proxy)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr("interviews.provider_transport.getproxies", lambda: {
        "https": f"http://127.0.0.1:{server.server_port}"})

    async def request():
        if provider == "audio":
            async with AudioProviders(None, api_key="synthetic") as audio:
                await audio._http.get("https://api.openai.com/v1/models")
        else:
            async with InterviewModels(openai_key="synthetic", typesafe_key="synthetic") as models:
                sdk = getattr(models, provider)
                host = "api.openai.com" if provider == "openai" else "api.typesafe.ai"
                client = sdk._client if provider == "openai" else sdk._http_client
                await client.get(f"https://{host}/")

    try:
        with pytest.raises(Exception, match="502"):
            asyncio.run(request())
        host = "api.typesafe.ai" if provider == "typesafe" else "api.openai.com"
        assert requests == [f"{host}:443"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
