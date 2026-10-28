#!/usr/bin/env bash
# Clone the local main development DB into a distinct cg-pr-* Docker database.
# Reject shared storage and running app writers; preserve a backup before explicit refresh.
set -euo pipefail
umask 077

source_container= source_project=resume_project target_container= target_project= state_dir=
replace_review_db=false
while (($#)); do
  case "$1" in
    --source-container|--source-project|--target-container|--target-project|--state-dir)
      (($# >= 2)) || { echo "Missing value for $1" >&2; exit 2; }
      case "$1" in
        --source-container) source_container=$2 ;;
        --source-project) source_project=$2 ;;
        --target-container) target_container=$2 ;;
        --target-project) target_project=$2 ;;
        --state-dir) state_dir=$2 ;;
      esac
      shift 2 ;;
    --replace-review-db) replace_review_db=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
fail() { echo "$*" >&2; exit 1; }
[[ -n $source_container && -n $target_container && -n $state_dir ]] || fail "Supply source/target containers, target project, and ignored state directory."
[[ $target_project =~ ^cg-pr-[a-z0-9][a-z0-9-]*$ ]] || fail "Target project must start with cg-pr-."
[[ $source_project != "$target_project" ]] || fail "Source and review projects must differ."
[[ $source_container != -* && $target_container != -* ]] || fail "Invalid container name."
[[ $state_dir == /* ]] || fail "State directory must be absolute."
common_git_dir=$(git rev-parse --path-format=absolute --git-common-dir)
primary_checkout=
while IFS= read -r entry; do
  [[ $entry == 'worktree '* ]] || continue
  candidate=${entry#worktree }
  if [[ $(git -C "$candidate" rev-parse --path-format=absolute --git-dir) == "$common_git_dir" ]]; then
    primary_checkout=$candidate
    break
  fi
done < <(git worktree list --porcelain)
[[ -n $primary_checkout ]] || fail "Cannot resolve primary checkout."
# Resolve symlinks before checking ignore rules; dumps must not escape into tracked paths.
state_dir=$(realpath -m -- "$state_dir")
git -C "$primary_checkout" check-ignore -q -- "$state_dir/clone-state" || fail "State directory must be Git-ignored in this repository."

inspect() { docker inspect --format "$2" "$1"; }
source_id=$(inspect "$source_container" '{{.Id}}')
target_id=$(inspect "$target_container" '{{.Id}}')
[[ $source_id != "$target_id" ]] || fail "Source and destination are the same container."
[[ $(inspect "$source_container" '{{index .Config.Labels "com.docker.compose.project"}}') == "$source_project" ]] || fail "Source Compose project mismatch."
[[ $(inspect "$target_container" '{{index .Config.Labels "com.docker.compose.project"}}') == "$target_project" ]] || fail "Target Compose project mismatch."
for container in "$source_container" "$target_container"; do
  [[ $(inspect "$container" '{{index .Config.Labels "com.docker.compose.service"}}') == db ]] || fail "Container is not a Compose db service: $container"
  [[ $(inspect "$container" '{{.State.Running}}') == true ]] || fail "Database container is stopped: $container"
  docker exec "$container" pg_isready -U postgres -d postgres >/dev/null || fail "Database not ready: $container"
done
# Reject any shared volume/bind source, including a shared parent mount.
source_mounts=$(inspect "$source_container" '{{range .Mounts}}{{println .Source}}{{end}}')
target_mounts=$(inspect "$target_container" '{{range .Mounts}}{{println .Source}}{{end}}')
[[ -n $source_mounts && -n $target_mounts ]] || fail "Cannot verify database storage isolation."
while IFS= read -r source_mount; do
  [[ -n $source_mount ]] || continue
  while IFS= read -r target_mount; do
    [[ -n $target_mount ]] || continue
    [[ $source_mount != "$target_mount" && $source_mount != "$target_mount/"* && $target_mount != "$source_mount/"* ]] || fail "Source and target storage overlap."
  done <<< "$target_mounts"
done <<< "$source_mounts"
running_services=$(docker ps --filter "label=com.docker.compose.project=$target_project" --format '{{.Label "com.docker.compose.service"}}')
while IFS= read -r service; do
  case "$service" in
    api|api-results-worker|api-jobs-worker|ai-worker|ai-http) fail "Stop review app/worker services before copying ($service running)." ;;
  esac
done <<< "$running_services"

source_version=$(docker exec "$source_container" psql -U postgres -d postgres -Atqc 'SHOW server_version_num')
target_version=$(docker exec "$target_container" psql -U postgres -d postgres -Atqc 'SHOW server_version_num')
[[ $((source_version / 10000)) == $((target_version / 10000)) ]] || fail "Use matching PostgreSQL major versions."
database=api_development
exists=$(docker exec "$target_container" psql -U postgres -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = 'api_development'")
if [[ $exists == 1 ]]; then
  tables=$(docker exec "$target_container" psql -U postgres -d "$database" -Atqc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
  [[ $tables == 0 || $replace_review_db == true ]] || fail "Review DB already has tables; preserve it or explicitly pass --replace-review-db."
fi
mkdir -p -- "$state_dir"
copy_dir=$(mktemp -d "$state_dir/database-copy-XXXXXXXX")
source_dump=$copy_dir/source.dump
trap 'rm -f -- "$source_dump"' EXIT
docker exec "$source_container" pg_dump -U postgres -d "$database" -Fc --no-owner --no-acl > "$source_dump"
docker exec -i "$target_container" pg_restore --list < "$source_dump" > /dev/null
if [[ $exists == 1 ]]; then
  docker exec "$target_container" pg_dump -U postgres -d "$database" -Fc --no-owner --no-acl > "$copy_dir/previous-review.dump"
  echo "Previous review DB backup: $copy_dir/previous-review.dump"
  docker exec "$target_container" dropdb -U postgres --force "$database"
fi
docker exec "$target_container" createdb -U postgres "$database"
if ! docker exec -i "$target_container" pg_restore -U postgres -d "$database" --no-owner --no-acl --exit-on-error --single-transaction < "$source_dump"; then
  fail "Restore failed. Review API must stay stopped; any previous-review.dump backup is in $copy_dir. Main DB was not modified."
fi
printf 'source_project=%s\nsource_container=%s\ntarget_project=%s\ntarget_container=%s\nsnapshot_utc=%s\n' \
  "$source_project" "$source_container" "$target_project" "$target_container" "$(date -u +%FT%TZ)" > "$copy_dir/metadata.txt"
echo "Main development DB copied into $target_project. Run target branch db:prepare next; use existing account credentials."
