#!/bin/bash
# Rewrites .env (secrets, from /jobapp/prod/) and settings.env (settings that are not secret, from
# /jobapp/prod/settings/) from Parameter Store, using the instance role. Run it again after changing a parameter.
# Use it on a rebuilt server after copying .env.example to .env and filling in the lines that are not in Parameter Store.
set -euo pipefail

cd "$(dirname "$0")"

# restore <parameter path> <file>: sets each parameter directly under the path as a line of the file.
restore() {
  touch "$2"
  chmod 600 "$2"
  aws ssm get-parameters-by-path --region "${AWS_REGION:-us-east-2}" --path "$1" \
    --with-decryption --query 'Parameters[].[Name,Value]' --output text |
  while IFS=$'\t' read -r name value; do
    key="${name##*/}"
    grep -v "^${key}=" "$2" > "$2.tmp" || true
    printf '%s=%s\n' "$key" "$value" >> "$2.tmp"
    mv "$2.tmp" "$2"
  done
  chmod 600 "$2"
}

restore /jobapp/prod/ .env
restore /jobapp/prod/settings/ settings.env
echo "Restored .env and settings.env in $(pwd)"
