"""Check the public API host does not serve Rails' private /internal callbacks.

The AI service calls /internal/* on the private network, guarded only by a shared secret, so
Caddy must answer those paths itself before the request reaches the reverse proxy.
"""

import re
import unittest
from pathlib import Path

CADDYFILE = Path(__file__).resolve().parents[1] / "infra/compose/Caddyfile"


def site_block(name_prefix):
    text = CADDYFILE.read_text()
    match = re.search(rf"^{re.escape(name_prefix)}[^\n]*\{{\n(.*?)^\}}", text, re.S | re.M)
    assert match, f"no site block starting with {name_prefix}"
    return match.group(1)


class CaddyfileRoutesTest(unittest.TestCase):
    def test_api_host_refuses_internal_paths_before_proxying(self):
        block = site_block("api.")
        matcher = re.search(r"@(\w+)\s+path\s+([^\n]+)", block)
        self.assertIsNotNone(matcher, "api host needs a path matcher for /internal")
        name, paths = matcher.group(1), matcher.group(2).split()
        self.assertIn("/internal/*", paths)
        self.assertIn("/internal", paths)
        refusal = re.search(rf"respond\s+@{name}\s+404", block)
        self.assertIsNotNone(refusal, "internal paths must get a 404")
        self.assertLess(refusal.start(), block.index("reverse_proxy"))

    def test_other_hosts_do_not_proxy_to_rails(self):
        for prefix in ("app.", "www."):
            self.assertNotIn("api:3000", site_block(prefix))


if __name__ == "__main__":
    unittest.main()
