terraform {
  required_version = "~> 1.13"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.29.0"
    }
    coolify = {
      source  = "coolify-terraform/coolify"
      version = "0.1.32"
    }
  }
}

# Credentials come from the environment: CLOUDFLARE_API_TOKEN, and
# COOLIFY_ENDPOINT with COOLIFY_TOKEN.
provider "cloudflare" {}

provider "coolify" {}
