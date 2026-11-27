"""Check that the Claude cloud scripts keep their proxy CA copy current.

Runs the shell helper from claude-cloud-ca.sh against temporary files. It touches no real
certificate, service or network, so it runs anywhere bash and coreutils exist.
"""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

HELPER = Path(__file__).resolve().parent / "claude-cloud-ca.sh"
SYSTEM_BUNDLE = Path("/etc/ssl/certs/ca-certificates.crt")


def refresh(state: Path, source: Path) -> int:
    """Run refresh_proxy_ca_bundle and return its exit status (0 means the copy changed)."""
    env = {**os.environ, "CCR_CA_BUNDLE": str(source)}
    command = f'source "{HELPER}"; refresh_proxy_ca_bundle "{state}"'
    return subprocess.run(["bash", "-c", command], env=env, check=False).returncode


class RefreshProxyCaBundleTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.state = self.tmp / "state"
        self.state.mkdir()
        self.source = self.tmp / "session-ca.crt"
        self.copy = self.state / "ca-bundle.crt"

    def test_first_copy_is_reported_as_a_change_and_readable(self):
        self.source.write_text("first CA\n")
        self.assertEqual(refresh(self.state, self.source), 0)
        self.assertEqual(self.copy.read_text(), "first CA\n")
        self.assertEqual(self.copy.stat().st_mode & 0o777, 0o644)

    def test_unchanged_bundle_is_left_alone(self):
        self.source.write_text("first CA\n")
        refresh(self.state, self.source)
        self.assertEqual(refresh(self.state, self.source), 1)

    def test_rotated_bundle_replaces_the_stale_copy(self):
        self.source.write_text("first CA\n")
        refresh(self.state, self.source)
        self.source.write_text("rotated CA\n")
        self.assertEqual(refresh(self.state, self.source), 0)
        self.assertEqual(self.copy.read_text(), "rotated CA\n")

    @unittest.skipUnless(SYSTEM_BUNDLE.is_file(), "no system CA bundle on this machine")
    def test_missing_session_bundle_falls_back_to_the_system_bundle(self):
        self.assertEqual(refresh(self.state, self.tmp / "missing.crt"), 0)
        self.assertEqual(self.copy.read_bytes(), SYSTEM_BUNDLE.read_bytes())

    def test_failed_copy_is_reported_as_an_error(self):
        self.source.write_text("first CA\n")
        self.assertEqual(refresh(self.tmp / "no-such-dir", self.source), 2)


if __name__ == "__main__":
    unittest.main()
