# Study guides

Study guides turn a saved job description into readable learning material. They are separate
from career-library interview practice and fictional-role interview preparation.

`generateStudyGuide(jobId)` authorizes through the current user's jobs and queues
`generate_study_guide`. Enqueueing serializes on the owner and locks/reloads the job before
capturing `{job_id, description}`. The Python worker uses that exact description; it never
loads the career library, gaps, or separate job requirement fields. An empty description
cannot start generation. One queued generation per job prevents overlapping requests.

The worker screens the frozen description afresh. Existing saved-job approvals cover other
fields and are not reused. Unavailable screening and rejected input both fail closed, with
distinct diagnostics. The versioned Pydantic AI agent uses the official input guard, contact
masking, tracing, bounded run limits, and configured model/fallback policy. It returns
`result.study_guide` with a title and 1–8 ordered topics. Each topic contains a title,
`why_it_matters`, an explanation, 1–5 exercises, and 1–5 self-check questions. The model
teaches relevant subject knowledge without inventing candidate experience or employer facts.
Irrelevant source text receives a brief request for a meaningful description, not an invented role.

Rails validates the result shape and existing owned job under owner/task/job locks before
accepting completion. Each successful output remains on its own AI task. The newest attempt
and newest successful guide are separate fields (`latestStudyGuideTask` and
`latestStudyGuide`) so pending/failed work leaves saved material readable. Finished-task
and attempt-accounting guards retain the shared duplicate-delivery behavior.

Job deletion takes the same owner/job locking order, nullifies task subjects, and retains
usage records. Late completions fail. Direct task reads and subscriptions hide a deleted
job's guide result and source snapshot; historical usage remains available.

The job page's Study guides section starts collapsed and remembers disclosure per job.
It loads guide bodies only when opened, follows task subscriptions instead of polling,
and shows generation errors beside retained successful material. It offers readable
exercises and questions without answer persistence, grading, or progress tracking.

Quality checks: `python -m evals.run_study_guide_evals` uses five synthetic descriptions
covering inventory, backend engineering, a sparse bakery role, irrelevant text, and an
injected instruction. Deterministic checks verify outcomes; a separate judge assesses
relevance, subject accuracy, and useful exercises. Screening outages fail evaluation rather
than counting as attack rejection. Offline contracts live in handler and evaluator tests;
finite model evaluations do not prove universal subject correctness.
