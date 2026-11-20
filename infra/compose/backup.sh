#!/bin/bash
# Nightly pg_dump of every database to the S3 backups bucket. Uses the instance role.
# The bucket deletes objects after 30 days, which the privacy policy depends on.
set -euo pipefail

apt-get update -qq && apt-get install -y -qq awscli >/dev/null

while true; do
  # Sleep until 03:00 server time.
  now=$(date +%s)
  next=$(date -d "03:00 tomorrow" +%s)
  [ "$(date +%H)" -lt 3 ] && next=$(date -d "03:00 today" +%s)
  sleep $((next - now))

  stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
  pg_dumpall --clean --if-exists | gzip | aws s3 cp - "s3://${BACKUPS_BUCKET}/pg_dumpall-${stamp}.sql.gz"
  echo "backup ${stamp} uploaded"
done
