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
evidence projection in `model_inputs/interview_evidence.py`. Its question builder returns
prompt text, evidence IDs, and quote coverage together for both workers and offline evals.
`screening/interview_question_inputs.py` reconstructs that context from checked sources
inside exact prompt binding; the worker verifies generated history provenance first.
`tailoring.py` renders a cohesive section input assembled from values selected by
`tailoring/build_section_prompt.py`; that domain builder
still owns source labels, provenance, screening, and expiry context. `blocks.py` owns
collision-free source delimiters. `safety.py` quotes fallback classifier input. `judge.py` renders rubrics and case data for evals.

Gap analysis already has a domain-specific builder at
`gap_analysis/build_gap_analysis_prompt.py` that shares a job-field projection with
screening and returns text together with the label maps needed for validation. Parsing and job extraction use simple fenced source text;
their existing agents own those wrappers. The scraped-ad parser is a narrow source-only
exception: it checks one bounded fenced ad without injection classification and grants no
screening approval for reuse. Pasted ads and later saved-job consumers remain screened.
JSON used for queue transport,
screening reconstruction, reports, and structured model outputs is outside this layer.

Interview career context requirements are separately labeled context for interpreting the response.
They receive no evidence IDs or quote coverage; only the candidate's response supplies personal
evidence. Callers screen both fields or reuse their saved approvals before rendering them.

## Source boundaries at model calls

Use `blocks.source_block` for new source sections. It preserves source text and
chooses a suffixed tag if a pasted tag would collide with the outer delimiter.
Keep application instructions outside source blocks. Delimiters help the model
recognize data; they do not replace screening or output validation.

The call-site audit covers every production reasoning agent and evaluation judge:

| Model input | Boundary |
| --- | --- |
| Resume extraction | `<resume>`; embedded resume tags are neutralized |
| Pasted job ad | Collision-free `job_ad` block |
| Requirement sorting | Collision-free `job_bullets` block |
| Gap analysis | Separate `job` and `career_library` blocks; label maps stay unchanged |
| Resume tailoring | Separate `job`, `gap_analysis`, and labeled `career_source` blocks |
| Library review | `career_records` block containing target labels |
| Library editing | Career records plus separate feedback, generated question, and answer blocks, including deferred tool answers |
| Written interview questions/feedback | Matching boundary lines chosen outside all source text |
| Study guide | `job_description` and numbered trusted `previous_study_questions` blocks |
| Question clarification | `interview_question` block |
| Spoken preparation/turns | Escaped XML blocks for frozen context, candidate answers, and earlier utterances; reconstructed public dialogue retains model message roles |
| Screening LLM fallback | `<user_text>` with every source line quoted by a pipe prefix |
| Interview eval judge | Separate collision-free `rubrics`, `inputs`, and `output` blocks |
| Other evaluation judges | Pydantic Evals supplies `<Output>` and `<Rubric>` sections |

Jev is a decision classifier: Pydantic AI sends the message to classify in its
separate data state and the classification questions in `questions`. Local Llama
Prompt Guard likewise classifies raw input rather than receiving a reasoning
prompt. Keep that classifier input unchanged. Embeddings and exact-text speech
have no instruction/source prompt to delimit. The offline interview executor and
fake provider use internal JSON fixtures and never call a real reasoning model.

Saved editing history retains its original screened provider messages. New turns
and deferred answers use source blocks; do not rewrite old history and invalidate
its exact screening coverage. Tool results use the provider's tool-message
boundary and typed return values.
