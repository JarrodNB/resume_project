# Careergrind

Terms used when discussing job search and interview practice.
Index: language and shared domain terms.

## Language

**Interview Q&A vector**:
A derived embedding of one saved interview question and its current nonblank user-written answer.
It excludes feedback and example answers, stays separate from career-library evidence, and is not searched yet.

**AI usage**:
The model work consumed while handling a user's AI tasks, including unsuccessful attempts. Its cost is an estimate from known token usage; missing usage or pricing leaves part of the cost unknown.

**Conversation transcript**:
A readable record of the AI exchanges for one AI task, stored separately from other tasks even when they share a job or interview question set. It includes instructions, messages, tool calls and results, and repeated attempts as seen by the model. Local development transcripts also highlight observed validation/provider failures, actual fallback execution and task redeliveries; production uses tracing only.

**Interview session**:
One spoken interview with its own questions, accepted dialogue, and progress. It is separate
from a written interview practice set.
_Avoid_: Basic Interview when referring to the shared session concept

**Interview type**:
The format of an interview session. Basic is the only supported type today.

**Basic Interview**:
The initial turn-based spoken interview type, using prepared questions and limited
follow-ups without coaching.

**Interview preparation**:
The creation of a fictional role and questions from the user's saved career details,
ready for the user to review before beginning a spoken interview.

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
One live attempt to turn a candidate's speech into text before they submit an answer.
It does not count as an accepted answer or advance the interview.
