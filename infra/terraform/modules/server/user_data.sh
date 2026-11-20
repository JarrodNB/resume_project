#!/bin/bash
# First-boot setup: install Docker and the AWS CLI. The Postgres volume is formatted and
# mounted by hand the first time (see infra/terraform/README.md) so it can never be
# reformatted by accident.
set -euxo pipefail

apt-get update
apt-get install -y ca-certificates curl docker.io docker-compose-v2 unzip
systemctl enable --now docker

curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscli.zip
unzip -q /tmp/awscli.zip -d /tmp
/tmp/aws/install
