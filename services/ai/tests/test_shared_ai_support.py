"""Keep reusable AI execution independent from queue-process configuration.

Use a fresh interpreter so pytest's worker fixtures cannot hide import coupling.
No provider, database or telemetry connection is made by these checks.
"""

import os
import subprocess
import sys
import textwrap
from pathlib import Path


def run_isolated(source: str, **settings: str) -> subprocess.CompletedProcess:
    environment = {**os.environ, **settings}
    environment.pop("LOGFIRE_TOKEN", None)
    return subprocess.run(
        [sys.executable, "-c", textwrap.dedent(source)],
        cwd=Path(__file__).resolve().parents[1],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
        timeout=20,
    )


def test_http_execution_helpers_do_not_import_queue_modules():
    result = run_isolated("""
        import sys
        import interviews.real
        import memory.embed_search_query
        import screening.prompt_guardrail
        from telemetry.tracing import configure_tracing

        configure_tracing()
        loaded = sorted(name for name in sys.modules
                        if name == "worker" or name.startswith("worker."))
        assert not loaded, loaded
    """)
    assert result.returncode == 0, result.stderr


def test_standalone_screening_ignores_invalid_queue_transport_settings():
    result = run_isolated("""
        from screening.session import remaining_timeout, within_screening_session

        @within_screening_session
        def inspect_deadline():
            return remaining_timeout(1)

        assert 0 < inspect_deadline() <= 1
    """, RECEIVE_WAIT_SECONDS="invalid-queue-setting")
    assert result.returncode == 0, result.stderr
