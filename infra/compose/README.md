# Production compose

Runs on the single EC2 server created by `../terraform`. Reach the server with
`aws ssm start-session --target <server_instance_id>`; no SSH port is open.

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
3. Log in to ECR and start the stack:

   ```bash
   aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin "$REGISTRY"
   docker compose --env-file .env up -d
   ```

## Still needed before a real launch

- Fill the blank values in `.env`: `OPENAI_API_KEY`, `TURNSTILE_SECRET_KEY` and the `SMTP_*`
  settings. The passwords and shared secrets are generated on the server, not stored in git.
- Test a restore from the S3 backups.
