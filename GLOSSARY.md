# Careergrind

Terms used when discussing job search and interview practice.
Index: language and shared domain terms.

## Language

**Next-job preference**:
A condition the user wants from their next job, marked as a must-have or a nice-to-have.
It describes the job they want, not their qualifications.

**Preference profile**:
The user's reusable set of confirmed next-job preferences. An editable draft stays separate
until the user confirms it.

**Preference assessment**:
Independent model-estimated probabilities that one job posting satisfies each confirmed
preference. These estimates are not verified facts, confidence margins, or a distribution
that must sum to one.

**Summary inclusion**:
Whether a summary appears on a resume. The library preference supplies the default for new
resumes; each resume has its own choice. Hiding a summary retains its text for later use.

**Summary proposal**:
A suggested draft for a missing career profile or resume summary. It changes saved content
only when the user accepts it, and can be edited or discarded during review.

**Library proposal**:
A suggested replacement for one career-library narrative detail, such as a summary, achievement,
project description, or saved career context response. It changes the saved detail only
when the user accepts it; feedback and follow-up answers can refine it first.

**Avoided question**:
A question the candidate has asked future interview practice to avoid, including close rewordings.
Saving this preference leaves the current question and answer in place.

**Interview Q&A vector**:
A derived embedding of one saved interview question and its current nonblank user-written answer.
It excludes feedback and example answers, stays separate from career-library evidence, and is not searched yet.

**AI usage**:
The model work consumed while handling a user's AI tasks, including unsuccessful attempts. Its cost is an estimate from known token usage; missing usage or pricing leaves part of the cost unknown.

**Conversation transcript**:
A readable record of the AI exchanges for one AI task, stored separately from other tasks even when they share a job or interview question set. It includes instructions, messages, tool calls and results, and repeated attempts as seen by the model. Local development transcripts also highlight observed validation/provider failures, actual fallback execution and task redeliveries; production uses tracing only.

**Question bank**:
Every written practice question a user has, shown together with each answer's progress
(not answered, no feedback yet, feedback ready, or out of date). Questions still arrive in
practice sets of five; the bank is how the user browses and returns to them.

**Retired question**:
A read-only copy of an answered practice question that was replaced. It keeps the old
question, answer, and feedback in the question bank but no longer fills one of its set's five slots.

**Interview session**:
One practice interview with its own questions, accepted dialogue, and progress. It is separate
from a written interview practice set.
_Avoid_: Basic Interview when referring to the shared session concept

**Interview type**:
The format of an interview session. Basic is the only supported type today.

**Question format**:
The kinds of questions chosen for a practice interview: Mixed, Behavioural, Technical / Role,
or HR Screening. It is separate from the session's interview type.

**Basic Interview**:
The initial turn-based interview type, using prepared questions and limited
follow-ups without coaching.

**Interview preparation**:
The preparation of questions and role context from the user's saved career details,
using a saved job or a fictional role, ready for review before beginning an interview.

**Fictional interview role**:
An imagined job used to frame interview practice. Its responsibilities and requirements
describe that job, not experience or qualifications the user claims to have.

**Accepted answer**:
An answer included in an interview session's saved dialogue and answer allowance. Failed or
rejected attempts do not count as accepted answers. Acceptance means the response was saved,
not that it was correct or good; responses to follow-ups and brief detours count too.

**Interview turn**:
One submitted answer and its resulting interviewer response within an interview session.

**Answer transcription mode**:
The candidate's choice of how spoken answers become text: browser recognition, streaming
transcription, or transcription of the complete recording. It is independent of how the
interviewer's voice is played.

**Transcription capture**:
One attempt to turn a candidate's speech or complete recording into text before they submit an answer.
It does not count as an accepted answer or advance the interview.


**Interview answer draft**:
The candidate's editable answer before submission, written by typing or from a reviewed
transcription. It becomes an accepted answer only after submission and acceptance.

**Interviewer acknowledgement**:
A brief factual response to a detail in the candidate's previous answer, before the
interviewer asks a follow-up, moves to the next question, or closes the interview.

**Question clarification**:
A short explanation of what the current interviewer prompt is asking. It does not answer
the question for the candidate or count toward their answer allowance.

**Core question**:
A prepared question in a spoken interview. Follow-up questions belong to that core question
and do not increase the chosen number of core questions.

**Skipped question cycle**:
A core question whose remaining prompts the user chose to skip. Previous accepted answers
stay saved; the skip itself is not an answer and does not use the answer allowance or count
in answer-quality scoring. Skipping a follow-up moves directly to the next core question.

**Library assessment**:
A red, yellow, or green indication of how clearly a saved piece captures useful career evidence,
with a short reason and an optional question about useful missing detail. It evaluates the
description, not the person's employability.

**Study guide**:
A saved collection of learning questions derived from a job description, with explained answers
and worked examples. It teaches subject knowledge, not claims about the job seeker's experience.

**Study question**:
One focused learning question with its supplied explanation and worked example, separate from
a candidate's own interview-practice answer.

**Career reference**:
A saved career-library piece shown during interview practice to help the candidate recall
relevant experience. It is optional guidance, separate from a generated answer, question
clarification, assessment, or accepted answer.

**Career context**:
Reusable context about the user’s career, stored as a requirement or topic and their response.
A `CareerContext` belongs to the user’s career library; a job-specific answer may link to it.
The requirement explains the response and is not itself evidence of the user’s experience.

**Job-title search suggestion**:
A suggested role title to help start a job search. It is a search aid based on career evidence,
not a claim that the person holds that title or meets every qualification for it.
