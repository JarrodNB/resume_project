---
name: change-ai-behavior
description: Change Careergrind prompts, agents, models, or model-facing inputs while preserving grounding, screening provenance, privacy, and usage accounting. Use for AI behavior changes; use evaluate-ai-quality for standalone quality investigations and comparisons.
---

# Change AI behavior

Make the requested behavior observable before changing instructions. Follow the target
checkout's applicable `AGENTS.md` files and [execution environment guidance](../cloud-runtime.md).
This skill supplies AI-specific implementation guidance; it does not require the full
orchestrator workflow or authorize unrelated provider runs, retries, publication, or deployment.

## Understand the behavior

- State the concrete input, current output, desired output, and facts the model may use.
  Distinguish invented personal experience from allowed subject knowledge in knowledge feedback.
- Trace the relevant path: Rails-owned input/snapshot → handler → screening and rendering →
  agent and prompt → structured output/validators → Rails result application. Inspect only
  the layers the change can affect. Read [AI task contracts](../../../docs/architecture/ai-tasks.md)
  before changing queue messages, lifecycle, or ownership.
- Identify whether the failure comes from missing evidence, rendering, instructions,
  retrieval, validation, or result handling. Fix the responsible layer rather than adding
  prompt rules to compensate for missing or incorrectly selected data.

## Preserve the input boundary

Read [model input guidance](../../../services/ai/model_inputs/README.md) and the applicable
worker, agent, screening, and prompt instructions before editing those areas.

- Select only workflow-relevant source fields, retain provenance, and render readable labeled
  text with clear data boundaries. Do not dump domain objects or JSON into prompts.
  Queue transport and structured model outputs may still use JSON.
- Keep renderers deterministic: callers select records and decide screening; renderers
  format approved sources without database access or model calls. Reuse domain builders
  when they own labels and validation maps.
- Preserve exact-source coverage through the established screening session APIs. Reuse
  recorded approvals only for matching values; changed or unknown user input needs screening.
  Trust generated text only through the existing server-owned provenance path, never merely
  because a browser or arbitrary input claims it was generated. Do not rescreen generated
  text or unchanged approved sources.
- Preserve required-versus-optional rejection behavior and the official generative agent
  input guardrail. Safety classifiers remain exempt from recursive screening.
- Keep contact masking active through provider requests, tracing, exceptions, and parent-span
  completion; restore source text only at the established output boundary.

## Make a bounded change

- Keep instructions, source selection, rendering, and business rules in their established
  owners. Preserve evidence labels, quote checks, and structured-output validators.
  Do not weaken a validator merely to make a new prompt pass.
- Bump the affected prompt version when instructions or model-facing rendering changes,
  and preserve prompt-version recording. Use configured models, deadlines, request/token
  limits, and the feature's existing fallback policy.
- Preserve Logfire instrumentation and conversation logging. Account for actual provider
  requests, including screening, retries, fallback, and failures; missing usage is unknown,
  not zero. Follow existing worker attempt accounting instead of adding a second billing path.
- Spoken interview execution has a separate claimed-operation HTTP boundary and provider
  accounting policy. Read [interview sessions](../../../docs/architecture/interview-sessions.md)
  and [provider accounting](../../../docs/architecture/interview-provider-accounting.md)
  when touching it; do not substitute the queued worker policy.

## Verify and report

- Add focused offline regressions through observable interfaces for the changed behavior:
  input selection/rendering, source validation, screening reuse or rejection, and failure
  accounting as relevant. Use fakes and synthetic data; keep real provider calls out of unit tests.
- Use [evaluate-ai-quality](../evaluate-ai-quality/SKILL.md) to select and interpret the
  affected quality evaluations. A passing fake-model test does not establish writing quality.
  Respect the documented spoken-interview quality-eval exception.
- Follow [testing guidance](../../../docs/testing.md) for focused checks and regenerate
  GraphQL artifacts only if their contracts changed. Update affected maintained guidance
  when behavior or boundaries change.
- Report the resulting behavior, prompt versions, actual checks and eval configuration,
  relevant quality/cost observations, and unrun checks or remaining limits. Keep claims
  proportional to the cases observed.
