"""Measure synthetic handler screening with deterministic provider delays, never network."""
import json
import time
from unittest.mock import patch
from pydantic_ai import models
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage
from agents.gap_analysis_agent import gap_analysis_agent
from agents.user_text_screen_agent import UserTextScreenRun
from schemas.user_text_screen import UserTextScreen
from schemas.gap_analysis_context import LibrarySkill
from tests.fakes import FakeFileStorage, FakeGapAnalysisContextReader, FakeJobSite, build_gap_analysis_context
from tests.test_analyze_gaps_handler import USER_ID, JOB_ID, VALID_OUTPUT, build_analyze_gaps_task
from worker.analyze_gaps_handler import handle_analyze_gaps_task
from worker.settings import WorkerSettings
from worker.task_dependencies import TaskDependencies
models.ALLOW_MODEL_REQUESTS = False
reports = []
for name, count, width in [('small', 12, 10), ('many-short', 80, 10), ('multi-chunk', 80, 100)]:
    context = build_gap_analysis_context()
    context.career_library.skills += [LibrarySkill(id=f'extra-{i}', name=f'Example skill {i} ' + 'x' * width) for i in range(count)]
    reader = FakeGapAnalysisContextReader()
    reader.contexts[(USER_ID, JOB_ID)] = context
    deps = TaskDependencies(settings=WorkerSettings(), file_storage=FakeFileStorage(), http_client=FakeJobSite().build_client(), read_gap_analysis_context=reader)
    calls = []
    def classify(text, **kwargs):
        calls.append(len(text))
        time.sleep(.005)
        return UserTextScreenRun(UserTextScreen(prompt_injection=False, harmful_request=False), 'jev-1.13.0', {'prompt_injection': 1., 'harmful_request': 1.}, RunUsage(input_tokens=100, output_tokens=1))
    start = time.monotonic()
    with patch('screening.screen_user_text.screen_user_message', classify), gap_analysis_agent.override(model=TestModel(custom_output_args=VALID_OUTPUT)):
        result = handle_analyze_gaps_task(build_analyze_gaps_task(), deps)
    reports.append({'case': name, 'status': result.status, 'screen_calls': len(calls), 'chunk_lengths': calls, 'total_seconds': round(time.monotonic() - start, 4), 'injected_delay_seconds_per_call': .005})
print(json.dumps(reports, indent=2))
