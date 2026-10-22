"""Keep optional local interview timings without exporting periodic Logfire noise.

Durations use one process's monotonic clock. Fenced attempt IDs distinguish retries;
debug records contain no prompts, audio capabilities, provider errors or user details.
Operation and model tracing are owned separately by the real executor.
"""

import asyncio
import logging
import time
from contextlib import contextmanager

logger = logging.getLogger(__name__)


@contextmanager
def stage_timing(claim, stage):
    """Observe one stage; discovery/claim pass None before a fenced claim exists."""
    started = time.monotonic()
    outcome = "completed"
    try:
        yield
    except asyncio.CancelledError:
        outcome = "cancelled"
        raise
    except BaseException:
        outcome = "failed"
        raise
    finally:
        try:
            logger.debug("Interview stage completed", extra={
                "stage": stage, "operation_id": getattr(claim, "operation_id", None),
                "attempt_id": getattr(claim, "attempt_id", None),
                "claim_generation": getattr(claim, "claim_generation", None),
                "elapsed_ms": round((time.monotonic() - started) * 1000, 3), "outcome": outcome,
            })
        except Exception:  # noqa: BLE001, S110 - do not log sensitive telemetry errors
            pass
