# Production compose

Runs on the single EC2 server created by `../terraform`. Reach the server with
`aws ssm start-session --target <server_instance_id>`; no SSH port is open.

## Deploys

Merging to master (a release PR from `develop`) runs `.github/workflows/deploy.yml`: it builds the four images, pushes them
to ECR tagged with the commit, copies these compose files to the server, restarts the stack
and checks the three public addresses. AWS access is a role GitHub assumes for runs on master
only (`../terraform/modules/github`), so no AWS keys are stored in GitHub.

## First-time setup on the server

1. Format and mount the Postgres volume once. Check the device name with `lsblk` first;
   formatting the wrong disk destroys it.

   ```bash
   sudo mkfs.ext4 /dev/nvme1n1
   sudo mkdir -p /srv/postgres
   echo "UUID=$(sudo blkid -s UUID -o value /dev/nvme1n1) /srv/postgres ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab
   sudo mount -a
   ```

2. Copy this folder to the server (`/opt/app`), then `cp .env.example .env` and fill it in.
   On a rebuilt server, fill in the non-secret lines, then run `./restore-secrets.sh` to pull every
   secret back from Parameter Store (`/jobapp/prod/*`).
3. Log in to ECR and start the stack:

   ```bash
   aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin "$REGISTRY"
   docker compose --env-file .env up -d
   ```

## Secrets

Production secrets are in `/opt/app/.env` on the server, and each one has a copy in Parameter Store
under `/jobapp/prod/` (the server can read it, not write it). When you change a secret, change
both. A container reads `.env` only when it starts, so recreate the services that use the
value. Restore tested from the S3 backups on 2026-11-20.
