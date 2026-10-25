"""Verify the synthetic dataset covers role variety and explicit injection rejection."""
from evals.run_study_guide_evals import load_study_guide_dataset


def test_synthetic_dataset_has_varied_roles_sparse_irrelevant_and_blocked_cases():
    cases = load_study_guide_dataset().cases
    assert len(cases) == 5
    assert sum(case.inputs.expects_block for case in cases) == 1
    assert {case.name for case in cases} >= {"inventory_clerk", "backend_engineer", "sparse_bakery_role", "irrelevant_description"}
