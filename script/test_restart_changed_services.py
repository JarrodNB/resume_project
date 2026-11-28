"""Check the deploy's restart script against a fake `docker` (no Docker, no server needed).

infra/compose/restart-changed-services.sh restarts changed services and swaps ai-live without
cutting off running live interviews. These tests put a fake `docker` (and a no-op `sleep`) first
on PATH, give it the containers a server might have, and check which docker commands the script
runs. The fake keeps its containers in a JSON file and records every call. Run with
`python3 -m unittest discover -s script -p test_restart_changed_services.py -v` (or pytest).
"""

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "infra/compose/restart-changed-services.sh"
WANT = "newhash"

FAKE_DOCKER = textwrap.dedent('''\
    #!{python}
    """A tiny stand-in for the docker CLI: answers from state.json and records each call."""
    import json, sys
    from pathlib import Path

    STATE = Path(__file__).with_name("state.json")
    state = json.loads(STATE.read_text())
    args = sys.argv[1:]
    state["calls"].append(args)
    containers = state["containers"]
    by_id = {{c["id"]: c for c in containers}}
    out = ""
    if args[:3] == ["compose", "config", "--services"]:
        out = "\\n".join(state["services"]) + "\\n"
    elif args[:3] == ["compose", "config", "--hash"]:
        out = f"{{args[3]}} {{state['want']}}\\n"
    elif args[:3] == ["compose", "ps", "-a"]:
        out = "".join(c["id"] + "\\n" for c in containers)
    elif args[:2] == ["compose", "up"] and "--no-start" in args:
        new = {{"id": f"c{{len(state['calls'])}}", "name": f"/app-ai-live-{{len(containers) + 1}}",
               "hash": state["want"], "state": "created", "logs": state["new_logs"]}}
        containers.append(new)
    elif args[0] == "inspect":
        c = by_id[args[-1]]
        out = f"{{c['name']}} {{c['hash']}} {{c['state']}}\\n" if "config-hash" in args[2] else c["name"] + "\\n"
    elif args[0] == "logs":
        out = by_id[args[-1]]["logs"]
    elif args[0] == "start":
        by_id[args[1]]["state"] = "running"
    elif args[0] == "rm":
        state["containers"] = [c for c in containers if c["id"] != args[-1]]
    elif args[0] == "rename":
        by_id[args[1]]["name"] = "/" + args[2]
    STATE.write_text(json.dumps(state))
    sys.stdout.write(out)
''')


def container(id, number, hash, state="running", name=None):
    return {"id": id, "name": name or f"/app-ai-live-{number}", "hash": hash, "state": state, "logs": ""}


class RestartChangedServicesTest(unittest.TestCase):
    def run_script(self, containers, *, new_logs="INFO registered worker\n", register_seconds=3):
        """Run the script against a server with these ai-live containers; returns (exit code, calls, containers)."""
        with tempfile.TemporaryDirectory() as temp:
            bin_dir = Path(temp)
            state = {"services": ["api", "ai-live", "web"], "want": WANT, "containers": containers,
                     "new_logs": new_logs, "calls": []}
            (bin_dir / "state.json").write_text(json.dumps(state))
            docker = bin_dir / "docker"
            docker.write_text(FAKE_DOCKER.format(python=sys.executable))
            sleep = bin_dir / "sleep"
            sleep.write_text("#!/bin/sh\nexit 0\n")
            for path in (docker, sleep):
                path.chmod(0o755)
            env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}",
                   "LIVE_REGISTER_SECONDS": str(register_seconds)}
            result = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60)
            final = json.loads((bin_dir / "state.json").read_text())
            return result.returncode, final["calls"], {c["id"]: c for c in final["containers"]}

    def started(self, calls):
        return [call[1] for call in calls if call[0] == "start"]

    def drained(self, calls):
        return [call[-1] for call in calls if call[:3] == ["kill", "-s", "TERM"]]

    def test_every_other_service_goes_through_a_plain_compose_up(self):
        _code, calls, _containers = self.run_script([container("old", 1, WANT)])
        self.assertIn(["compose", "up", "-d", "--remove-orphans", "api", "web"], calls)

    def test_a_first_deploy_creates_and_starts_one_ai_live_and_drains_nothing(self):
        code, calls, containers = self.run_script([])
        self.assertEqual(code, 0)
        [new] = containers.values()
        self.assertEqual((new["state"], self.started(calls)), ("running", [new["id"]]))
        self.assertIn("--scale", next(call for call in calls if "--no-start" in call))
        self.assertIn("ai-live=1", next(call for call in calls if "--no-start" in call))
        self.assertEqual(self.drained(calls), [])

    def test_an_unchanged_ai_live_is_left_running_as_it_is(self):
        code, calls, containers = self.run_script([container("old", 1, WANT)])
        self.assertEqual(code, 0)
        self.assertEqual(list(containers), ["old"])
        self.assertFalse([call for call in calls if "--no-start" in call or call[0] in ("start", "kill", "rename", "rm")])

    def test_a_changed_ai_live_starts_the_new_one_then_drains_the_old_one_once(self):
        code, calls, containers = self.run_script([container("old", 1, "oldhash")])
        self.assertEqual(code, 0)
        new = next(c for c in containers.values() if c["id"] != "old")
        self.assertIn("ai-live=2", next(call for call in calls if "--no-start" in call))
        self.assertEqual(self.started(calls), [new["id"]])  # never the old one
        self.assertRegex(containers["old"]["name"], r"^/app-ai-live-1-draining-\d+$")
        self.assertIn(["update", "--restart=no", "old"], calls)
        self.assertEqual(self.drained(calls), ["old"])
        start = calls.index(["start", new["id"]])
        self.assertLess(start, calls.index(["kill", "-s", "TERM", "old"]))

    def test_a_draining_container_that_has_exited_is_removed_and_never_started(self):
        done = container("done", 1, "oldhash", state="exited", name="/app-ai-live-1-draining-100")
        code, calls, containers = self.run_script([done, container("old", 2, "oldhash")])
        self.assertEqual(code, 0)
        self.assertNotIn("done", containers)
        self.assertIn(["rm", "-f", "done"], calls)
        self.assertNotIn("done", self.started(calls))
        self.assertEqual(self.drained(calls), ["old"])

    def test_a_container_still_draining_is_left_alone(self):
        draining = container("draining", 1, "oldhash", name="/app-ai-live-1-draining-100")
        code, calls, containers = self.run_script([draining, container("current", 2, WANT)])
        self.assertEqual(code, 0)
        self.assertEqual(containers["draining"]["name"], "/app-ai-live-1-draining-100")
        self.assertFalse([call for call in calls if "draining" in call and call[0] != "inspect"])

    def test_a_new_ai_live_that_never_registers_fails_the_deploy_and_leaves_the_old_one_running(self):
        code, calls, containers = self.run_script([container("old", 1, "oldhash")], new_logs="INFO starting\n")
        self.assertEqual(code, 1)
        self.assertEqual(containers["old"]["name"], "/app-ai-live-1")
        self.assertFalse([call for call in calls if "old" in call and call[0] in ("rename", "update", "kill", "rm")])
        self.assertEqual(sum(call[0] == "logs" for call in calls), 4)  # three checks, then the tail for the log


if __name__ == "__main__":
    unittest.main()
