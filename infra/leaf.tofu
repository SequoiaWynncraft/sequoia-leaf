# Leaf in production: a DNS record, and a Coolify project with one
# application, its volume and its settings.

resource "cloudflare_dns_record" "leaf" {
  zone_id = local.zone_id
  name    = "leaf.seqwawa.com"
  type    = "A"
  content = local.server_ipv4
  # Not proxied, like api.seqwawa.com: the server's proxy gets its certificate
  # from Let's Encrypt over HTTP, and event streams stay open for minutes.
  proxied = false
  ttl     = 1
  comment = "Leaf service on the Sequoia server (Coolify)"
}

resource "coolify_project" "leaf" {
  name        = "sequoia-leaf"
  description = "Leaf, the guild currency and the game built on it"
}

resource "coolify_application_github_app" "leaf" {
  name        = "sequoia-leaf-prod"
  description = "Leaf, the guild currency service (Bun + SQLite)"

  project_uuid     = coolify_project.leaf.uuid
  environment_name = "production"
  server_uuid      = local.coolify.server_uuid
  destination_uuid = local.coolify.destination_uuid

  # Coolify builds the repository's Dockerfile and deploys every push to main,
  # which the repository's webhook tells it about (see the README).
  github_app_uuid        = local.coolify.github_app_uuid
  git_repository         = "https://github.com/notes-supply/leaf"
  git_branch             = "main"
  build_pack             = "dockerfile"
  is_auto_deploy_enabled = true

  ports_exposes          = "3000"
  domains                = "https://${cloudflare_dns_record.leaf.name}"
  is_force_https_enabled = true

  # The name other containers on the network reach Leaf by.
  custom_network_aliases = "sequoia-leaf"

  # The image has its own HEALTHCHECK on /healthz, which Coolify uses. The
  # numbers are Coolify's defaults for its own check, which stays off.
  health_check_enabled  = false
  health_check_interval = 10
  health_check_retries  = 3
  health_check_timeout  = 3

  lifecycle {
    # Destroying the application destroys its volume, and so the database.
    prevent_destroy = true
    # Coolify only takes these two when it creates an application and does
    # not report them afterwards, so an adopted application has neither in
    # the state. A difference in the source would replace the application.
    ignore_changes = [github_app_uuid, destination_uuid]
  }
}

# The SQLite database and its snapshots. Coolify names the Docker volume
# `<application uuid>-leaf-data`.
resource "coolify_storage" "data" {
  application_uuid = coolify_application_github_app.leaf.uuid
  name             = "leaf-data"
  mount_path       = "/data"

  lifecycle {
    # Destroying this destroys the database.
    prevent_destroy = true
    # Coolify stores the name with the application's uuid in front.
    ignore_changes = [name]
  }
}

# Leaf reaches the backend over the server's private Docker network.
resource "coolify_environment_variable" "backend_url" {
  application_uuid = coolify_application_github_app.leaf.uuid
  key              = "BACKEND_URL"
  value            = "http://sequoia-backend:8081"
}

# Sierra's internal API, which lists achievement awards for Leaf to pay. It
# takes the same internal token as the backend.
resource "coolify_environment_variable" "sierra_url" {
  application_uuid = coolify_application_github_app.leaf.uuid
  key              = "SIERRA_URL"
  value            = "http://sequoia-sierra:8082"
}

# BACKEND_INTERNAL_TOKEN is set by hand in Coolify and not managed here. The
# backend owns the value, and managing the variable would put it in the state.
