output "droplet_ip" {
  description = "Stable public IP of the license server (point/verify DNS here)."
  value       = digitalocean_reserved_ip.pos.ip_address
}

output "fqdn" {
  description = "Full hostname the server is reachable at once DNS propagates."
  value       = "${var.subdomain}.${var.domain}"
}

output "ssh" {
  description = "Convenience SSH command."
  value       = "ssh root@${digitalocean_reserved_ip.pos.ip_address}"
}
