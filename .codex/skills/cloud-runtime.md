# Execution environment

## Managed cloud

Run Careergrind natively, without Docker or Compose. Read the target checkout's
`docs/native-development.md` and applicable cloud runtime guidance. Install with
`bash script/install-native-cloud.sh`; start with `bash script/start-native-cloud.sh`.
Use `python3 script/native.py doctor`, `check`, and `stop` for diagnosis, health,
and checkout-scoped shutdown. Do not assume root, sudo, or writable system paths.
Preserve inherited proxy/CA trust and configured credentials without printing secrets.

Run focused checks natively using the installed runtimes and isolated test settings.
Consult `script/native.py` for runtime paths and environment configuration; its
installation does not export settings into later shells. Follow `docs/testing.md`
for check selection, translating container commands to native equivalents.
Never reset the development database to run tests.

For human QA, start the native stack and configure documented web/API/storage
origins using supported cloud forwarding. Hand off only verified reachable URLs
and absolute start/log/stop commands. Report missing services, credentials,
forwarding access, and Moto's in-memory queue/upload limits. Development preview
startup does not authorize production deployment or merging. Do not assume the
local computer's database/files exist in cloud or import them without authorization.

Use the isolated cloud task workspace instead of a redundant integration worktree.
Keep branches and PRs. Concurrent agents sharing a filesystem still need isolated
checkouts/worktrees and test artifacts. Native helpers use fixed ports; do not run
multiple stacks on the same host without isolating ports and service state.

## Local computer

Keep Docker Compose and worktree isolation, with unique Compose project names.
Follow `docs/testing.md`. Cloud instructions do not change local defaults.
