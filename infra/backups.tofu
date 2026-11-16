# Leaf copies each new database snapshot here, every six hours. The bucket
# deletes copies after 30 days; Leaf deletes nothing in it.
resource "cloudflare_r2_bucket" "backups" {
  account_id = local.account_id
  name       = "sequoia-leaf-backups"
  # Western Europe, near the server.
  location = "weur"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket_lifecycle" "backups" {
  account_id  = local.account_id
  bucket_name = cloudflare_r2_bucket.backups.name
  rules = [{
    id         = "Delete copies after 30 days"
    enabled    = true
    conditions = { prefix = "" }
    delete_objects_transition = {
      condition = { type = "Age", max_age = 30 * 24 * 60 * 60 }
    }
    abort_multipart_uploads_transition = {
      condition = { type = "Age", max_age = 24 * 60 * 60 }
    }
  }]
}

resource "coolify_environment_variable" "backup_endpoint" {
  application_uuid = coolify_application_github_app.leaf.uuid
  key              = "BACKUP_S3_ENDPOINT"
  value            = "https://${local.account_id}.r2.cloudflarestorage.com"
}

resource "coolify_environment_variable" "backup_bucket" {
  application_uuid = coolify_application_github_app.leaf.uuid
  key              = "BACKUP_S3_BUCKET"
  value            = cloudflare_r2_bucket.backups.name
}

# BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY are set by hand in
# Coolify and not managed here, so the secret never enters the state. They
# come from a Cloudflare API token that may only write to this bucket.
