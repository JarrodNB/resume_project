"""Time one synthetic handler run with real provider calls and no database access."""
import json
import time
from unittest.mock import patch
from schemas.gap_analysis_context import LibrarySkill
from tests.fakes import FakeFileStorage, FakeGapAnalysisContextReader, FakeJobSite, build_gap_analysis_context
from tests.test_analyze_gaps_handler import USER_ID, JOB_ID, build_analyze_gaps_task
from worker import analyze_gaps_handler as handler
from agents.user_text_screen_agent import screen_user_message
from worker.settings import WorkerSettings
from worker.task_dependencies import TaskDependencies
from worker.task_usage import collect_task_usage
from worker.tracing import configure_tracing, flush_tracing
configure_tracing()
context = build_gap_analysis_context()
context.career_library.skills += [LibrarySkill(id=f'extra-{i}', name=f'Example skill {i}') for i in range(12)]
reader = FakeGapAnalysisContextReader()
reader.contexts[(USER_ID, JOB_ID)] = context
settings = WorkerSettings()
deps = TaskDependencies(settings=settings, file_storage=FakeFileStorage(), http_client=FakeJobSite().build_client(), read_gap_analysis_context=reader)
screen_calls = []
generation = []
original_generation = handler.analyze_gaps
def classify(*args, **kwargs):
    start = time.monotonic()
    try:
        return screen_user_message(*args, **kwargs)
    finally:
        screen_calls.append(time.monotonic() - start)
def generate(*args, **kwargs):
    start = time.monotonic()
    try:
        run = original_generation(*args, **kwargs)
        generation.append({'seconds': time.monotonic() - start, 'requests': run.usage.requests})
        return run
    except Exception:
        generation.append({'seconds': time.monotonic() - start, 'error': True})
        raise
started = time.monotonic()
with collect_task_usage() as usage, patch('screening.screen_user_text.screen_user_message', classify), patch.object(handler, 'analyze_gaps', generate):
    try:
        result = handler.handle_analyze_gaps_task(build_analyze_gaps_task(), deps)
        outcome = {'status': result.status, 'error': result.error_message}
    except Exception as error:
        outcome = {'error_type': type(error).__name__}
report = {**outcome, 'fixture': 'base career library plus 12 synthetic skills', 'screen_calls': len(screen_calls), 'screen_seconds': sum(screen_calls), 'generation': generation, 'total_seconds': time.monotonic() - started, 'model': settings.gap_analysis_model, 'thinking': settings.gap_analysis_thinking, 'cost_microdollars': sum(item.cost_microdollars or 0 for item in usage.entries)}
flush_tracing()
print(json.dumps(report, indent=2))
