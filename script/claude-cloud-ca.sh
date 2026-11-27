# Keeps a copy of the Claude cloud session's proxy CA bundle where the `claude` user can read it.
# Sourced by install-claude-cloud.sh and start-claude-cloud.sh; it defines a function and runs
# nothing. The session proxy can issue a new CA when a container resumes, and services started
# with the old copy then fail every HTTPS call, so the start script refreshes it each time.

# Copies the session CA bundle to "$1/ca-bundle.crt" (mode 0644). Uses $CCR_CA_BUNDLE, else
# /root/.ccr/ca-bundle.crt, else the system bundle. Returns 0 when the copy was created or its
# contents changed, 1 when it was already current or no source bundle exists, and 2 when the copy
# failed. Run it as root: /root is private, so another user would silently get the system bundle.
refresh_proxy_ca_bundle() {
  local copy="$1/ca-bundle.crt" source
  for source in "${CCR_CA_BUNDLE:-/root/.ccr/ca-bundle.crt}" /etc/ssl/certs/ca-certificates.crt; do
    [[ -f $source ]] || continue
    if [[ -f $copy ]] && cmp -s "$source" "$copy"; then
      return 1
    fi
    install -m 0644 "$source" "$copy" || return 2
    return 0
  done
  return 1
}
