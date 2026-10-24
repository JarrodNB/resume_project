# Model input rendering

A model input is a view of screened domain data for one workflow. Saved career records
and queue messages remain the canonical data; rendering does not change or approve them.

1. The caller chooses the fields and source records the workflow needs.
2. Screening approves the exact user-authored values. Optional rejected values are
   omitted; required rejected values stop the call.
3. A deterministic renderer assembles the approved values, trusted headings, labels,
   and boundaries into the provider's user message. Renderers do not call models,
   access the database, or decide screening outcomes.
4. The caller binds the rendered text to those approvals, runs the agent, and validates
   its structured output against the original sources and label maps.

Keep one renderer per workflow input, as functions unless it needs state. Shared helpers
should handle mechanics only; they must not silently choose fields for multiple
workflows. `interview.py` assembles question and feedback inputs from the shared career
evidence projection in `model_inputs/interview_evidence.py`. `tailoring.py` renders the
section from values selected by `tailoring/build_section_prompt.py`; that domain builder
still owns source labels, provenance, screening, and expiry context. `safety.py` quotes
fallback classifier input. `judge.py` renders rubrics and case data for evals.

Gap analysis already has a domain-specific builder at
`gap_analysis/build_gap_analysis_prompt.py` that returns text together with the label
maps needed for validation. Parsing and job extraction use simple fenced source text;
their existing agents own that one-line wrapper. JSON used for queue transport,
screening reconstruction, reports, and structured model outputs is outside this layer.
