---
name: security-loop
description: Find and fix demonstrated security weaknesses in a bounded loop of independent reviewed PRs. Use when the user requests an autonomous security loop with a specified number of iterations.
---

# Security Loop

Read and follow the [shared protocol](../super-loop/references/iteration-protocol.md) for count selection, isolation, verification, fresh review, publication, and stopping. Follow the [execution environment guidance](../cloud-runtime.md): native in managed cloud, Docker locally.

Each completed iteration is one security weakness, fixed and verified, reviewed by a fresh subagent, committed and pushed on its own branch, with its own pull request into the selected base. A standalone run needs a positive integer count; never choose an unlimited loop.

## Choose one weakness

Pick a weakness an attacker can actually reach, with evidence. Record who the attacker is (anonymous visitor, signed-in user, another tenant, a malicious uploaded file, a compromised model output), the exact request or input, what they gain, and the repository evidence that the behavior is unintended. Trace it through every caller to the sink; read the code, do not rely on a pattern match.

Good candidates:

- **Authorization:** one user reading or changing another user's records through GraphQL ids, subscriptions, internal endpoints, file keys, or the AI service's read-only database and tool server.
- **Authentication and sessions:** missing or timing-unsafe checks on internal or webhook endpoints, token expiry, audience or user scoping, cookie flags, CSRF, password-reset or email flows that allow enumeration or abuse.
- **Injection and unsafe output:** SQL or pattern injection, unsafe URLs or redirects, cross-site scripting, header or log injection, and links or files that carry attacker text into exports.
- **Untrusted content:** uploaded files, scraped pages, imported resumes, and model output that reach a prompt, a fetch, a path, or a rendered page without the repository's screening and limits. User text must be screened before it enters a prompt; do not screen text we generated or already screened.
- **Secrets and privacy:** keys, tokens, or personal data in logs, traces, URLs, client storage, error messages, or committed files. Never print secret values in notes or PRs; name where they are.
- **Server-side requests and resources:** fetches that can reach private addresses, and requests that can force unbounded work, memory, or spend.
- **Configuration:** over-broad CORS, missing security headers, over-permissive workflow permissions, untrusted input in workflow commands, containers exposing admin or debug ports.

Do not count generic hardening with no trigger, missing "best practice" items, dependency version bumps (use dependency-loop), style, or a scanner finding you cannot trace to a reachable path. If the fix needs an unresolved product or policy decision, or a change to the authentication model, record it for the human and look for another candidate. Do not stack on an unmerged earlier PR.

## Reproduce, fix, verify

Reproduce the weakness safely: a failing automated test that performs the attack through the public interface (the request, mutation, tool call, or rendered output) and shows the wrong result. Never probe production, real accounts, or third-party systems, and never run an exploit against anything but the isolated test environment. Use synthetic users and data.

Fix the root cause at the layer that owns the rule, not one symptom: scope the query to the owner, check the signature in constant time, allow-list instead of block-list, validate on the server rather than only in the browser. Cover sibling paths that share the cause. Preserve the repository rules: Rails owns domain writes, long-running AI work goes through queues, handlers stay safe under duplicate delivery, and no feature switches. Keep secrets out of code, tests, and commit messages. Add the test that proves the attack now fails, plus one that shows the legitimate path still works.

Run the focused and area checks from `docs/testing.md`, and inspect the full diff for unrelated changes and secrets.

## Publish and review

Follow the shared protocol for the branch name, commit, push, and PR. In the PR, describe the weakness, who can trigger it and how, the impact, the fix, and the verification actually run, without publishing a working exploit beyond what the regression test needs. For a serious weakness that may already be exploited in production, say so at the top of the PR and in the handoff so the human can decide on release and any follow-up such as rotating a key or auditing logs.

Every PR gets a fresh blind reviewer as the shared protocol describes, applying [review-correctness](../review-correctness/SKILL.md) with the security checks above and [review-design](../review-design/SKILL.md) for code changes, plus the Review section of the [Ponytail guidance](../orchestrator/references/ponytail.md). Give the reviewer only the base and head commits and the repository. Repair supported findings, rerun checks, and obtain another blank review of the full diff until the final head has no unresolved actionable findings.

## Boundaries

Report exhaustion or blockers rather than substituting another category. When coordinated by another loop, use its quota, base, scope, and ledger. Do not merge, deploy, rotate credentials, or change production settings. Leave those to the human.
