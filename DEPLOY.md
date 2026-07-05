# Deploying POS-platform (issue #11)

Runbook for standing up the license server on a DigitalOcean droplet with automatic
TLS and nightly backups. The subdomain used throughout is **`pos.nadimjebali.engineer`**
— change it if you pick another.

> **Secrets never go in git or in chat.** They live in `.env` / `backup.env` on the
> droplet (both gitignored) or in GitHub Actions secrets. See "GitHub variables vs
> secrets" at the bottom.

## 0. Rotate the leaked credentials first

The DO API token, DO Spaces keys, Name.com token, and SSH key were exposed. Rotate
them before use: regenerate the DO tokens/keys in the DO console, the Name.com token
in Name.com API settings, and create a **new** SSH keypair (`ssh-keygen -t ed25519`).
The production `LICENSE_PRIVATE_KEY` is generated fresh on the droplet in step 4, so
the exposed one is never used.

## 1. Provision the droplet

- **Image:** Ubuntu 24.04 LTS
- **Size:** Basic → Regular → **1 vCPU / 1 GB / 25 GB SSD ($6/mo)** — ample for Node +
  Caddy + SQLite; the 30-day renewal window means brief downtime is harmless.
- **Region:** **FRA1 (Frankfurt)** or LON1 — lowest latency to Tunisia.
- Add your (rotated) SSH public key during creation.

## 2. Point DNS at it

In Name.com DNS for `nadimjebali.engineer`, add an **A record**: host `pos` →
`<droplet IP>`, TTL 300. Verify: `dig +short pos.nadimjebali.engineer` returns the IP.

## 3. Base setup on the droplet

```bash
ssh root@<droplet-ip>
apt update && apt -y upgrade
apt -y install docker.io docker-compose-v2 sqlite3 awscli ufw unattended-upgrades
systemctl enable --now docker

# Firewall: only SSH + HTTP/HTTPS
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 4. Get the code and create secrets (on the droplet)

```bash
git clone https://github.com/NadimJebali/POS-platform.git /root/pos-platform
cd /root/pos-platform

# Generate the signing keypair and admin hash using the repo's own scripts, run in a
# throwaway Node container (they use only node:crypto, so no npm install is needed).
docker run --rm -v "$PWD":/app -w /app node:24-slim node scripts/keygen.mjs
docker run --rm -v "$PWD":/app -w /app node:24-slim node scripts/hash-password.mjs 'A-LONG-UNIQUE-PASSWORD'
```

Create `.env` (chmod 600) with the outputs plus the domain:

```
DOMAIN=pos.nadimjebali.engineer
LICENSE_PRIVATE_KEY="***REMOVED***\n"
ADMIN_PASSWORD_HASH=scrypt$32768$8$1$...
```

**Save the PUBLIC key** printed by keygen — it gets embedded in the POS app later
(issue #18) so the app can verify licenses offline.

```bash
chmod 600 .env
```

## 5. Bring it up

```bash
docker compose up -d --build
```

Caddy fetches a TLS cert for the domain automatically (needs DNS live + ports 80/443
open). Verify:

```bash
curl https://pos.nadimjebali.engineer/health          # -> {"ok":true}
```

Then log in at `https://pos.nadimjebali.engineer/admin/login` with the password you
hashed. Create a customer, issue a license, and confirm the activation code works.

## 6. Nightly off-droplet backup (DO Spaces) — automated

The whole business (customers, licenses, payments) is one SQLite file at
`/root/pos-platform/data/pos-platform.db`. Backups are **automated** — no droplet cron to
maintain:

- **`.github/workflows/backup.yml`** runs nightly (03:00 UTC, plus a manual "Run workflow"
  button). Each run SSHes in, takes a consistent snapshot (SQLite online backup, safe
  while the server writes), **encrypts it (AES-256)**, uploads it to Spaces, and then
  **restore-drills it in CI**: it decrypts, opens the snapshot, runs `PRAGMA
  integrity_check`, and counts the core tables — the run goes **red** if a backup can't be
  restored. A backup you never restore is only a hope; this tests every one.
- **`deploy.yml`** also takes a quick *local* on-droplet snapshot into `data/backups/`
  right before each restart, as an instant rollback point for a bad deploy/migration
  (the last few are kept).

### One-time setup

**1 — create the Spaces bucket.** DO console → Spaces → create `pos-platform-backups` in
the droplet's region (fra1). Add a lifecycle rule to expire objects after e.g. 90 days.
Create a Spaces key pair in DO → API → Spaces Keys.

**2 — add the GitHub config** (repo → Settings → Secrets and variables → Actions):

| Kind | Name | Value |
|------|------|-------|
| secret | `BACKUP_PASSPHRASE` | a long random passphrase — **store it in your password manager; without it the backups are unrecoverable** |
| secret | `AWS_ACCESS_KEY_ID` | Spaces access key |
| secret | `AWS_SECRET_ACCESS_KEY` | Spaces secret key |
| variable | `SPACES_BUCKET` | `pos-platform-backups` |

`SSH_PRIVATE_KEY`, `DOMAIN`, and `DROPLET_REGION` are already set (used by deploy/infra).
The Spaces endpoint is **derived** from `DROPLET_REGION` (e.g. `fra1` →
`https://fra1.digitaloceanspaces.com`), so there's nothing else to set — and it doesn't
reuse the Terraform-state `SPACES_ENDPOINT` variable, which points at a different bucket.

**3 — verify.** Actions → **backup** → **Run workflow**. A green run means the snapshot
uploaded *and* the restore drill passed (the log prints the row counts). Confirm the
object landed: `aws --endpoint-url https://fra1.digitaloceanspaces.com s3 ls s3://pos-platform-backups/`.

### Real disaster recovery (restore for real)

```bash
# On any machine with aws + gpg + the Spaces keys + BACKUP_PASSPHRASE:
END=https://fra1.digitaloceanspaces.com; BUCKET=pos-platform-backups
LATEST=$(aws --endpoint-url "$END" s3 ls "s3://$BUCKET/" | sort | tail -1 | awk '{print $4}')
aws --endpoint-url "$END" s3 cp "s3://$BUCKET/$LATEST" ./restore.db.gz.gpg
gpg --batch --passphrase "$BACKUP_PASSPHRASE" -o restore.db.gz -d restore.db.gz.gpg
gunzip -f restore.db.gz   # -> restore.db

# Put it back on the droplet, with the stack stopped so nothing is mid-write:
scp restore.db root@pos.nadimjebali.engineer:/root/pos-platform/data/restore.db
ssh root@pos.nadimjebali.engineer 'cd /root/pos-platform && docker compose down \
  && mv data/pos-platform.db data/pos-platform.db.bak && mv data/restore.db data/pos-platform.db \
  && docker compose up -d'
```

The legacy droplet-side `scripts/backup.sh` (unencrypted, cron-style) is kept for manual
use, but the workflow above is the supported path.

## 7. CI/CD (GitHub Actions)

Two workflows in `.github/workflows/`:

- **`infra.yml`** (manual only) — `terraform plan`/`apply` for the droplet, reserved
  IP, firewall, and DNS record. State lives in a `pos-platform-tfstate` Space
  (create it first; see `terraform/backend.tf`).
- **`deploy.yml`** (on push to `main`, or manual) — builds the Docker image, pushes it
  to Docker Hub, then SSHes into the droplet to write `.env` from secrets, `docker
  compose pull`, and restart. No building on the droplet.

**Prerequisites (GitHub → repo → Settings):**

- Variables: `DOMAIN`, `DROPLET_REGION`, `DROPLET_SIZE`, `SPACES_BUCKET`,
  `SPACES_ENDPOINT`, `SSH_FINGERPRINT` (of the key already in your DO account),
  `DOCKERHUB_USERNAME`.
- Secrets: `DO_API_TOKEN`, `SPACES_ACCESS_KEY`, `SPACES_SECRET_KEY`,
  `SSH_PRIVATE_KEY`, `LICENSE_PRIVATE_KEY`, `ADMIN_PASSWORD` (or `ADMIN_PASSWORD_HASH`),
  `DOCKERHUB_TOKEN` (a Docker Hub access token).
- Make the `pos-platform` Docker Hub repo **public** (the image only contains code
  that's already public on GitHub), so the droplet pulls it without logging in.
- `LICENSE_PRIVATE_KEY` secret must be the **single-line, `\n`-escaped** private key
  (the value from keygen, without surrounding quotes).

First run order: **infra** (once) → the droplet boots and cloud-init clones the repo →
push to `main` fires **deploy**.

## 8. Manual redeploy (no CI)

`cd /root/pos-platform && git pull && docker compose up -d --build` builds locally
instead of pulling. Handy for a quick fix or if CI is unavailable.

## App wiring (later)

- The `/updates/*` static feed for app auto-update (POS-software #24) gets added to the
  `Caddyfile` when that slice ships.
- Rebuild the POS app with the public key from step 4 and the base URL
  `https://pos.nadimjebali.engineer` (POS-software #18).

## GitHub variables vs secrets

If you deploy via GitHub Actions, split config like this — anything that lets someone
impersonate you, mint licenses, reach your server, or spend money is a **secret**:

| Name | Kind | Why |
| --- | --- | --- |
| `LICENSE_PRIVATE_KEY` | **secret** | mints licenses — the crown jewel |
| `ADMIN_PASSWORD_HASH` | **secret** | crackable offline if leaked |
| `DO_API_TOKEN` | **secret** | full control of your DO account |
| `SPACES_ACCESS_KEY` / `SPACES_SECRET_KEY` | **secret** | read/write your backups |
| `NAMECOM_API_TOKEN` | **secret** | can change your DNS |
| `SSH_PRIVATE_KEY` | **secret** | shell access to the droplet |
| `DROPLET_IP` | secret (preferred) | avoids advertising the target |
| `DOMAIN` (`pos.nadimjebali.engineer`) | variable | public anyway |
| `SPACES_BUCKET`, `SPACES_ENDPOINT`/region | variable | non-sensitive naming |
| `DROPLET_REGION`, `DROPLET_SIZE` | variable | non-sensitive config |
| `LICENSE_PUBLIC_KEY` | variable | public by design (embedded in the app) |
| `SSH_PUBLIC_KEY`, key fingerprint | variable | public / non-sensitive |

Rule of thumb: **secret** = encrypted, never printed in logs; **variable** = plaintext,
fine to appear in build output. When unsure, make it a secret.
