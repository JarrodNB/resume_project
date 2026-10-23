# Shared delivery loop protocol

Read the selected skill's candidate and verification rules alongside this protocol.

## Run setup

Require a positive integer count for a standalone loop; never infer an unlimited run. Honor scope, exclusions, repository, and base. Invocation authorizes scoped worktrees, branches, implementation, commits, pushes, and PRs. Do not merge, deploy, enable auto-merge, or perform unrelated external mutations. Creating skills does not invoke their workflows.

Read applicable repository instructions and verification guidance. Inspect Git status, remotes, worktrees, and open PRs; preserve existing work. Resolve and fetch the remote default branch unless the user selects another base. Resolve ambiguous destinations before publishing.

Keep a resumable ledger outside tracked product files, preferably in a unique directory under the Git common directory. Record run ID, scope, requested/completed counts per category, evidence, candidate status, base/head commits, branches, worktrees, checks, reviews, PR URLs, and next action. Reconcile Git and remote state before retrying mutations. Count each PR once.

## One iteration

1. Inspect the selected base and open PRs, including earlier iterations. Select one bounded improvement meeting the category's evidence rules. Record the trigger or friction, supporting evidence, intended outcome, and narrow verification plan. Do not invent requirements or use preferences to fill a quota.
2. Skip implementation of candidates requiring unresolved product decisions or unmerged earlier fixes. Architecture-loop still prepares and presents its concrete proposal, then waits at its decision gate. Do not stack PRs or duplicate overlapping work.
3. Fetch and record the base commit. Create a unique `codex/<skill>-<run-id>-<iteration>-<slug>` branch and fresh worktree outside other worktrees. Read local instructions and perform all edits and checks there, preserving the active checkout.
4. Establish the baseline. Demonstrate defects with a failing regression test when testable; for improvements collect the category's baseline and acceptance evidence. Make one coherent change, inspect callers and failure paths, update affected documentation, and regenerate artifacts through established tools.
5. Follow repository verification requirements. In Careergrind run application commands in Docker from the target worktree using `docker compose run` and a unique project name. Isolate source mounts, dependencies, and test databases; never reset another checkout's data or copy production credentials.
6. Run focused and required checks and inspect the full diff for regressions, unrelated edits, and secrets. If required verification is blocked or failing, retain work and stop the run with the exact blocker. Report unrun checks honestly.
7. Commit intended changes, push without force, and open one PR against the selected base. Check for an existing head/base PR before creation or retry. Describe the problem, resulting behavior, baseline, actual verification, and remaining manual checks. Attach created PRs through the app artifact tool when available.

## Fresh independent review

Spawn a new reviewer with `fork_turns: "none"` for each review pass. Supply only repository access, applicable instructions, fixed base/head IDs, and a review assignment covering the full diff and surrounding callers for correctness, security, reliability, maintainability, and meaningful verification. Do not supply candidate notes, ledger, implementation rationale, commit messages, PR discussion, or earlier findings. The reviewer may read technical documents and run isolated checks but must not edit implementation or post external comments.

Require findings with severity, file/line evidence and repair direction; reviewed IDs; actual checks and limits; and an explicit statement when no actionable findings remain. Evaluate findings against code evidence, repair supported in-scope issues, and record reasons for dismissed findings. After any code or test changes, rerun affected checks, commit and push without force, then obtain another blank review of the full original-base-to-current-head diff.

Count completion only when the final head has no unresolved actionable findings and the remote PR head matches the reviewed commit. Record the reviewed head and outcome in the ledger and PR description. If fresh review is unavailable or repair cannot converge, retain partial work and stop.

## Stop and handoff

One independently reviewed PR earns one iteration in exactly one category. Necessary tests and documentation stay with their improvement and earn no extra credit.

Report progress after each completion. Retain worktrees and unmerged branches for review. Stop only temporary processes and containers created for this run; preserve shared resources and other users' data.

Stop at the requested count, user cancellation, or required access/setup/check/review blockers. After reasonable inspection exhausts justified candidates, stop that category; stop the run when standalone or when no category remains eligible. Do not fabricate work, widen scope, or repeatedly retry blocked external actions. Report completed/requested counts, improvements and PRs, reviewed heads and outcomes, actual checks and limits, retained worktrees, and unfinished work with next actions. Leave merge and deployment to the human.
