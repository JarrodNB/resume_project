#!/bin/bash
# Rewrites the secret lines of .env from Parameter Store (/jobapp/prod/*), using the instance role.
# Use it on a rebuilt server after copying .env.example to .env and filling in the lines that are not in Parameter Store.
set -euo pipefail

cd "$(dirname "$0")"
touch .env
chmod 600 .env

aws ssm get-parameters-by-path --region "${AWS_REGION:-us-east-2}" --path /jobapp/prod/ \
  --with-decryption --query 'Parameters[].[Name,Value]' --output text |
while IFS=$'\t' read -r name value; do
  key="${name##*/}"
  grep -v "^${key}=" .env > .env.tmp || true
  printf '%s=%s\n' "$key" "$value" >> .env.tmp
  mv .env.tmp .env
done
chmod 600 .env
echo "Restored secrets into $(pwd)/.env"
