# Remote Terraform state in DigitalOcean Spaces (S3-compatible). Remote state is
# required so CI runs and local runs share one source of truth instead of each
# creating duplicate infrastructure.
#
# One-time prerequisite: create a PRIVATE Space named `pos-platform-tfstate` in the
# same region. Keep it separate from the backups Space so a backup lifecycle rule
# can never delete your state.
#
# Credentials come from the environment (never a file):
#   export AWS_ACCESS_KEY_ID=<spaces access key>
#   export AWS_SECRET_ACCESS_KEY=<spaces secret key>
#
# Requires Terraform >= 1.6 (endpoints block + skip_s3_checksum for non-AWS S3).
terraform {
  backend "s3" {
    bucket                      = "pos-platform-tfstate"
    key                         = "pos-platform.tfstate"
    region                      = "us-east-1" # ignored by Spaces but required by the backend
    endpoints                   = { s3 = "https://fra1.digitaloceanspaces.com" }
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
}
