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

## 6. Nightly off-droplet backup (DO Spaces)

1. Create a Spaces bucket (e.g. `pos-backups`) in the same region.
2. Create `/root/pos-platform/backup.env` (chmod 600, gitignored):

   ```
   SPACES_BUCKET=pos-backups
   SPACES_ENDPOINT=https://fra1.digitaloceanspaces.com
   AWS_ACCESS_KEY_ID=<spaces access key>
   AWS_SECRET_ACCESS_KEY=<spaces secret key>
   ```

3. Test it, then schedule it:

   ```bash
   set -a; . ./backup.env; set +a; bash scripts/backup.sh      # one manual run
   crontab -e
   # 0 3 * * * cd /root/pos-platform && set -a && . ./backup.env && set +a && bash scripts/backup.sh >> /var/log/pos-backup.log 2>&1
   ```

4. **Restore drill (do this once):** download a `.gz` from Spaces, `gunzip` it, and
   open it with `sqlite3 <file> '.tables'` to confirm the data is intact.

## 7. Updates and app wiring (later)

- Redeploy after a code change: `git pull && docker compose up -d --build`.
- The `/updates/*` static feed for app auto-update (POS-software #24) will be added to
  the `Caddyfile` when that slice ships.
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
