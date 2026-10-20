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
A readable record of the AI exchanges for a saved job, an interview question set, or an independent import task. It includes instructions, messages, tool calls and results, and repeated attempts as seen by the model.

**Basic Interview**:
A spoken interview demo using fictional context. It is separate from written InterviewPrep.
Rails stores its accepted dialogue; Python proposes results and produces speech.

**Accepted answer**:
A submitted recording whose screened transcript and interviewer result Rails committed
with history, answer count, and progress. Failed execution does not consume an answer.

**Interview operation**:
Durable work for one submitted turn or one saved message's speech. Repeating execution
can produce another attempt, but accepting the same result cannot duplicate dialogue.

**Claim generation**:
A monotonically increasing operation execution identity. A replaced or expired claim
cannot accept dialogue or replace saved speech.
