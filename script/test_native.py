"""Exercise native setup isolation and process lifecycle without installing runtimes."""

import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("native", Path(__file__).with_name("native.py"))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class NativeSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / ".native"
        self.patches = [patch.object(native, "ROOT", self.root),
                        patch.object(native, "STATE", self.state)]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def test_generated_credentials_are_private_and_reused(self):
        first = native.config()
        self.assertEqual(native.config(), first)
        self.assertEqual((self.state / "config.json").stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o700)
        self.assertEqual(len(first["interview_secret"]), 64)

    def test_cloud_credentials_survive_and_native_database_is_isolated(self):
        supplied = {"OPENAI_API_KEY": "test-only", "HTTP_PROXY": "http://session-proxy",
                    "NO_PROXY": "internal.example", "DATABASE_URL": "postgres://other-db",
                    "CABLE_DATABASE_URL": "postgres://other-cable",
                    "NATIVE_WEB_ORIGIN": "https://web.example"}
        with patch.dict(os.environ, supplied, clear=True):
            api = native.app_env("api")
            ai = native.app_env("ai")
        self.assertEqual(api["OPENAI_API_KEY"], "test-only")
        self.assertEqual(api["HTTP_PROXY"], "http://session-proxy")
        self.assertIn("internal.example", api["NO_PROXY"])
        self.assertIn("127.0.0.1", api["NO_PROXY"])
        self.assertIn("@127.0.0.1:55432/api_development", api["DATABASE_URL"])
        self.assertIn("@127.0.0.1:55432/api_development_cable", api["CABLE_DATABASE_URL"])
        self.assertEqual(api["WEB_APP_URL"], "https://web.example")
        self.assertEqual(api["__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS"], "web.example")
        self.assertEqual(api["PGPORT"], "55432")
        self.assertEqual(api["AWS_DEFAULT_REGION"], "us-east-1")
        self.assertEqual(api["UV_CACHE_DIR"], str(self.state / "cache/uv"))
        self.assertEqual(api["npm_config_cache"], str(self.state / "cache/npm"))
        self.assertEqual(ai["DB_USERNAME"], "ai_reader")
        self.assertTrue(ai["DATABASE_URL"].startswith("postgresql://ai_reader:"))
        self.assertEqual(ai["PGPASSWORD"], ai["DB_PASSWORD"])
        self.assertNotIn("CABLE_DATABASE_URL", ai)
        self.assertEqual(api["INTERVIEW_SERVICE_SECRET"], ai["INTERVIEW_SERVICE_SECRET"])
        self.assertEqual(api["INTERVIEW_REAL_ADMISSION_ENABLED"], "true")
        self.assertEqual(api["INTERVIEW_REAL_RUNTIME_ORIGIN"], "http://127.0.0.1:8000")
        self.assertNotEqual(api["DB_PASSWORD"], ai["DB_PASSWORD"])

    def test_local_services_do_not_inherit_cloud_aws_profiles(self):
        supplied = {"AWS_PROFILE": "missing-cloud-profile",
                    "AWS_DEFAULT_PROFILE": "another-missing-profile"}
        with patch.dict(os.environ, supplied):
            for service in ("api", "ai"):
                env = native.app_env(service)
                self.assertNotIn("AWS_PROFILE", env)
                self.assertNotIn("AWS_DEFAULT_PROFILE", env)
                self.assertEqual(env["AWS_ACCESS_KEY_ID"], "local")
                self.assertEqual(env["SQS_ENDPOINT_URL"], "http://127.0.0.1:9090")
                self.assertEqual(env["S3_ENDPOINT_URL"], "http://127.0.0.1:9090")
            self.assertEqual(os.environ["AWS_PROFILE"], supplied["AWS_PROFILE"])
            self.assertEqual(os.environ["AWS_DEFAULT_PROFILE"], supplied["AWS_DEFAULT_PROFILE"])

    def test_install_creates_templates_once_without_starting_services(self):
        for service in ("api", "ai"):
            folder = self.root / "services" / service
            folder.mkdir(parents=True)
            (folder / ".env.example").write_text("OPENAI_API_KEY=\n")
        existing = self.root / "services/api/.env"
        existing.write_text("OPENAI_API_KEY=keep-me\n")
        (self.root / "services/api/Gemfile.lock").write_text("BUNDLED WITH\n   2.6.9\n")
        (self.state / "ruby/bin").mkdir(parents=True)
        (self.state / "ruby/bin/ruby").touch()
        (self.root / "extension").mkdir()
        (self.root / "extension/vector.control").touch()

        def output(args, **kwargs):
            return {"postgres": "postgres (PostgreSQL) 17.6\n", "node": "v24.0.0\n",
                    "pg_config": str(self.root) + "\n"}[args[0]]

        with patch.object(native, "require_tools"), patch.object(native.os, "geteuid", return_value=1000), \
                patch.object(native.subprocess, "check_output", side_effect=output), \
                patch.object(native.subprocess, "run", return_value=type("Result", (), {"returncode": 0})()), \
                patch.object(native, "run") as run:
            native.install()
        self.assertEqual(existing.read_text(), "OPENAI_API_KEY=keep-me\n")
        ai = self.root / "services/ai/.env"
        self.assertEqual(ai.read_text(), "OPENAI_API_KEY=\n")
        self.assertEqual(ai.stat().st_mode & 0o777, 0o600)
        commands = [call.args[0] for call in run.call_args_list]
        self.assertTrue(any(command[:3] == ["uv", "sync", "--frozen"] for command in commands))
        self.assertFalse(any("db:prepare" in command for command in commands))
        self.assertFalse(list(self.state.glob("*.pid")))

    def test_missing_dependencies_fail_before_creating_state(self):
        with patch.object(native.shutil, "which", return_value=None), \
                patch.object(native.os, "geteuid", return_value=1000):
            with self.assertRaisesRegex(RuntimeError, "Missing tools"):
                native.install()
        self.assertFalse(self.state.exists())

    def test_start_requires_installation(self):
        with self.assertRaisesRegex(RuntimeError, "install first"):
            native.start()
        self.assertFalse(self.state.exists())

    def test_start_rejects_existing_stack_without_stopping_it(self):
        (self.state / "emulators/bin").mkdir(parents=True)
        (self.state / "emulators/bin/moto_server").touch()
        (self.state / "api.pid").write_text("existing")
        with patch.object(native, "stop") as stop:
            with self.assertRaisesRegex(RuntimeError, "Run stop first"):
                native.start()
            stop.assert_not_called()

    def test_start_runs_a_durable_jobs_worker_after_database_preparation(self):
        (self.state / "emulators/bin").mkdir(parents=True)
        (self.state / "emulators/bin/moto_server").touch()
        events = []

        def spawn(name, args, cwd, env):
            events.append((name, args))
            return type("Process", (), {"poll": lambda self: None})()

        with patch.object(native, "spawn", side_effect=spawn), \
                patch.object(native, "prepare_database", side_effect=lambda env: events.append(("prepared", []))), \
                patch.object(native, "run"), patch.object(native, "wait_port"), \
                patch.object(native, "check"), patch.object(native.time, "sleep"), \
                patch("socket.socket"):
            native.start()

        names = [name for name, _ in events]
        self.assertIn("jobs", names)
        self.assertLess(names.index("prepared"), names.index("jobs"))
        self.assertEqual(dict(events)["jobs"], ["bundle", "exec", "ruby", "bin/jobs"])

    def test_check_rejects_a_missing_or_stale_jobs_supervisor(self):
        self.state.mkdir()
        with patch.object(native.urllib.request, "build_opener"), patch.object(native, "wait_port"):
            with self.assertRaisesRegex(RuntimeError, "Durable jobs worker is not running"):
                native.check()
            (self.state / "jobs.pid").write_text(json.dumps({"pid": os.getpid(), "started": "stale"}))
            with self.assertRaisesRegex(RuntimeError, "Durable jobs worker is not running"):
                native.check()
            (self.state / "jobs.pid").write_text(json.dumps({"pid": os.getpid(), "started": None}))
            with patch.object(native, "process_start", return_value=None):
                with self.assertRaisesRegex(RuntimeError, "Durable jobs worker is not running"):
                    native.check()

    def test_check_accepts_the_recorded_jobs_process_identity(self):
        self.state.mkdir()
        (self.state / "jobs.pid").write_text(json.dumps({
            "pid": os.getpid(), "started": native.process_start(os.getpid())}))
        with patch.object(native.urllib.request, "build_opener"), patch.object(native, "wait_port"):
            native.check()

    def test_background_process_starts_and_stops(self):
        self.state.mkdir()
        proc = native.spawn("probe", [sys.executable, "-c", "import time; time.sleep(60)"],
                            self.root, os.environ.copy())
        self.addCleanup(lambda: proc.poll() is None and proc.kill())
        native.stop()
        self.assertEqual(proc.wait(timeout=5), -15)
        self.assertFalse((self.state / "probe.pid").exists())

    def test_reused_pid_is_not_killed(self):
        self.state.mkdir()
        path = self.state / "probe.pid"
        path.write_text(json.dumps({"pid": os.getpid(), "started": "old-process"}))
        with patch.object(native.os, "killpg") as kill:
            native.stop()
            kill.assert_not_called()
        self.assertFalse(path.exists())

    def test_stop_uses_start_ticks_when_proc_cwd_is_hidden(self):
        self.state.mkdir()
        proc = native.spawn("probe", [sys.executable, "-c", "import time; time.sleep(60)"],
                            self.root, os.environ.copy())
        self.addCleanup(lambda: proc.poll() is None and proc.kill())
        with patch.object(native.os, "readlink", side_effect=PermissionError):
            native.stop()
        self.assertEqual(proc.wait(timeout=5), -15)


if __name__ == "__main__":
    unittest.main()
