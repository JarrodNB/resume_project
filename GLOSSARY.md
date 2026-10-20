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

**Accepted answer**:
An answer included in an interview session's saved dialogue and answer allowance. Failed or
rejected attempts do not count as accepted answers.

**Interview turn**:
One submitted answer and its resulting interviewer response within an interview session.
