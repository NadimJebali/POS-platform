# Terraform — POS-platform infrastructure

Provisions the DigitalOcean droplet, a stable reserved IP, a firewall, and the
`pos` DNS A record. Secrets are **not** managed here — they're generated on the
droplet (see ../DEPLOY.md). Run this from CI (`.github/workflows/infra.yml`, manual)
or locally.

## One-time prerequisites

1. A **private Space** named `pos-platform-tfstate` (holds Terraform state —
   see `backend.tf`). Keep it separate from the backups Space.
2. Your DO API token and Spaces keys (rotated — the originals were exposed).

## Local usage

```bash
cd terraform
export TF_VAR_do_token=<rotated DO API token>
export AWS_ACCESS_KEY_ID=<spaces access key>       # for the state backend
export AWS_SECRET_ACCESS_KEY=<spaces secret key>

# ssh_public_key: pass your rotated public key (or put it in terraform.tfvars)
export TF_VAR_ssh_public_key="ssh-ed25519 AAAA... "

terraform init
terraform plan
terraform apply
terraform output droplet_ip     # the address DNS points at
```

## What it creates

| Resource | Purpose |
| --- | --- |
| `digitalocean_droplet.pos` | Ubuntu 24.04, `s-1vcpu-1gb`, `fra1`; cloud-init installs Docker + clones the repo |
| `digitalocean_reserved_ip.pos` | Stable IP that survives droplet rebuilds |
| `digitalocean_firewall.pos` | Inbound 22/80/443 only |
| `digitalocean_record.pos` | `pos` A record added to the existing DO zone (other records untouched) |

## After apply

SSH into the droplet, create `.env` (DEPLOY.md step 4), and either `docker compose
up -d` by hand or let the **deploy** workflow do it on the next push to `main`.
