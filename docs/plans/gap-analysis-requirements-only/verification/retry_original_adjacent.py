"""Retry the original adjacent-skills eval case through its unchanged runner pipeline."""
from unittest.mock import patch
from evals import run_gap_analysis_evals as suite
from evals.run_report import main
load = suite.load_gap_analysis_dataset
def one_case():
    dataset = load()
    dataset.cases = [case for case in dataset.cases if case.name == 'adjacent_skills_are_partial']
    return dataset
with patch.object(suite, 'load_gap_analysis_dataset', one_case):
    raise SystemExit(main(['gap_analysis', '--output-dir', '/verification']))
