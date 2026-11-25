#!/usr/bin/env bash
# PreToolUse hook (Bash): blocks committing on, or pushing to, develop or master.
# Both branches take changes only through a reviewed PR (see AGENTS.md, "Branches and releases").
# Reads the hook JSON on stdin; prints a deny decision, or nothing to let the command run.
set -u

cmd=$(jq -r '.tool_input.command // empty')
[ -z "$cmd" ] && exit 0

protected='develop|master'
current=$(git branch --show-current 2>/dev/null || true)

deny() {
  jq -n --arg reason "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
  exit 0
}

git_word='(^|[[:space:];&|(])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+'

if echo "$cmd" | grep -Eq "${git_word}commit([[:space:]]|$)"; then
  if echo "$current" | grep -Eqx "$protected"; then
    deny "Blocked: you are on '$current'. Never commit to develop or master. Create a branch from develop (git switch -c claude/<topic>), commit there, push that branch and open a PR into develop."
  fi
fi

if echo "$cmd" | grep -Eq "${git_word}push([[:space:]]|$)"; then
  push_args=$(echo "$cmd" | grep -Eo "${git_word}push[^;&|]*" | head -1)
  if echo "$push_args" | grep -Eq "([[:space:]:]|refs/heads/)($protected)([[:space:]]|$)"; then
    deny "Blocked: this push targets develop or master. Never push to those branches; push your feature branch and open a PR into develop."
  fi
  if echo "$current" | grep -Eqx "$protected"; then
    deny "Blocked: you are on '$current', so this push would update it. Never push to develop or master; move your commits to a feature branch and open a PR into develop."
  fi
fi

exit 0
