"""Check every public site served by the front Caddy sends the browser safety headers.

The headers live in one shared snippet. Each site block must import it, or its pages could be
framed by another site or have their file types guessed by the browser.
"""

import re
import unittest
from pathlib import Path

CADDYFILE = Path(__file__).resolve().parents[1] / "infra/compose/Caddyfile"
TEXT = CADDYFILE.read_text()
# Sites that serve pages or API responses. The www host only redirects.
PUBLIC_SITES = ("{$DOMAIN:localhost} {", "app.{$DOMAIN:localhost} {", "api.{$DOMAIN:localhost} {")


def block_after(start):
    index = TEXT.index("\n" + start) + 1
    end = TEXT.index("\n}", index)
    return TEXT[index:end]


class CaddyfileHeadersTest(unittest.TestCase):
    def test_snippet_sets_the_safety_headers(self):
        snippet = block_after("(security_headers) {")
        self.assertIn("X-Content-Type-Options nosniff", snippet)
        self.assertIn("X-Frame-Options DENY", snippet)
        self.assertRegex(snippet, r"Content-Security-Policy\s+\"frame-ancestors 'none'\"")
        self.assertRegex(snippet, r"Referrer-Policy\s+strict-origin-when-cross-origin")

    def test_every_public_site_imports_the_snippet(self):
        for site in PUBLIC_SITES:
            with self.subTest(site=site):
                self.assertRegex(block_after(site), re.compile(r"^\s*import security_headers\s*$", re.M))

    def test_only_known_sites_exist(self):
        sites = re.findall(r"^(\S+) \{$", TEXT, re.M)
        self.assertEqual(
            sorted(s for s in sites if not s.startswith("(")),
            sorted(["{$DOMAIN:localhost}", "www.{$DOMAIN:localhost}", "app.{$DOMAIN:localhost}", "api.{$DOMAIN:localhost}"]),
        )


if __name__ == "__main__":
    unittest.main()
