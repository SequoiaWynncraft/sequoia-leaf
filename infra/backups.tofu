# Leaf copies each new database snapshot, every six hours, to the R2 bucket
# `sequoia-leaf-backups`. It is in the same Cloudflare account as the state
# bucket, and was made there by hand with a rule that deletes copies after 30
# days. It is not managed here, because that would take a token that can
# delete every bucket in that account.

variable "r2_endpoint" {
  description = "The S3 endpoint of the Cloudflare account that holds both buckets: https://<account id>.r2.cloudflarestorage.com."
  type        = string
  # Not a secret, but it names an account outside Sequoia, so plans do not show it.
  sensitive = true
}

resource "coolify_environment_variable" "backup_endpoint" {
  application_uuid = coolify_application_github_app.leaf.uuid
  key              = "BACKUP_S3_ENDPOINT"
  value            = var.r2_endpoint
}

resource "coolify_environment_variable" "backup_bucket" {
  application_uuid = coolify_application_github_app.leaf.uuid
  key              = "BACKUP_S3_BUCKET"
  value            = "sequoia-leaf-backups"
}

# BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY are set by hand in
# Coolify and not managed here, so the secret never enters the state. They are
# an R2 token that can only read and write objects in this one bucket.
