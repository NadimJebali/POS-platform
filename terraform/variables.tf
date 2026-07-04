variable "do_token" {
  description = "DigitalOcean API token. Provide via TF_VAR_do_token, never a committed file."
  type        = string
  sensitive   = true
}

variable "domain" {
  description = "Root domain already hosted in DigitalOcean DNS."
  type        = string
  default     = "nadimjebali.engineer"
}

variable "subdomain" {
  description = "Subdomain host for the license server (the record name added to the zone)."
  type        = string
  default     = "pos"
}

variable "region" {
  description = "DigitalOcean region slug."
  type        = string
  default     = "fra1"
}

variable "size" {
  description = "Droplet size slug."
  type        = string
  default     = "s-1vcpu-1gb"
}

variable "ssh_key_fingerprint" {
  description = "Fingerprint of the SSH key already uploaded to the DO account (e.g. 44:44:...)."
  type        = string
}
