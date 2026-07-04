# Infrastructure for the POS-platform license server on DigitalOcean.
#
# Terraform manages INFRA ONLY (droplet, stable IP, firewall, DNS record). Secrets
# (LICENSE_PRIVATE_KEY, ADMIN_PASSWORD_HASH) are generated on the droplet per
# DEPLOY.md and never touch Terraform state or DO metadata.
#
# Usage:
#   export TF_VAR_do_token=...        # your (rotated) DO API token
#   terraform init && terraform apply
# The droplet's public address is the reserved IP output — no hand-copying.

terraform {
  required_version = ">= 1.5"
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

provider "digitalocean" {
  token = var.do_token
}

# The domain already lives in DigitalOcean DNS (nameservers are ns[1-3].digitalocean.com).
# Referencing it as a DATA source means Terraform adds our record WITHOUT managing or
# deleting the existing website/email records.
data "digitalocean_domain" "root" {
  name = var.domain
}

resource "digitalocean_droplet" "pos" {
  name   = "pos-platform"
  image  = "ubuntu-24-04-x64"
  region = var.region
  size   = var.size
  # Reference the SSH key already in the DO account by fingerprint, so Terraform
  # doesn't try to re-upload it (which fails with "SSH Key is already in use").
  ssh_keys  = [var.ssh_key_fingerprint]
  user_data = file("${path.module}/cloud-init.yaml")

  # Recreating the droplet keeps the reserved IP (below), so DNS never changes.
  lifecycle {
    create_before_destroy = true
  }
}

# A stable address that survives droplet rebuilds; DNS points here.
resource "digitalocean_reserved_ip" "pos" {
  region = var.region
}

resource "digitalocean_reserved_ip_assignment" "pos" {
  ip_address = digitalocean_reserved_ip.pos.ip_address
  droplet_id = digitalocean_droplet.pos.id
}

# Only SSH + HTTP/HTTPS inbound; all outbound.
resource "digitalocean_firewall" "pos" {
  name        = "pos-platform"
  droplet_ids = [digitalocean_droplet.pos.id]

  dynamic "inbound_rule" {
    for_each = ["22", "80", "443"]
    content {
      protocol         = "tcp"
      port_range       = inbound_rule.value
      source_addresses = ["0.0.0.0/0", "::/0"]
    }
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

# The pos.<domain> A record, pointing at the reserved IP. Added into the existing
# DO zone; other records are untouched.
resource "digitalocean_record" "pos" {
  domain = data.digitalocean_domain.root.name
  type   = "A"
  name   = var.subdomain
  value  = digitalocean_reserved_ip.pos.ip_address
  ttl    = 300
}
