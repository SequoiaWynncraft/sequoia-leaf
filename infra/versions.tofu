terraform {
  required_version = "~> 1.13"

  # The state is in R2, in a bucket this configuration also manages
  # (state.tofu). Credentials come from AWS_ACCESS_KEY_ID and
  # AWS_SECRET_ACCESS_KEY: for R2 they are a Cloudflare API token's id and the
  # SHA-256 of its value.
  backend "s3" {
    bucket = "sequoia-opentofu-state"
    key    = "sequoia-leaf/terraform.tfstate"
    region = "auto"
    endpoints = {
      s3 = "https://0641c96244af5c3212601f04a36e66ae.r2.cloudflarestorage.com"
    }
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
    # A lock file next to the state, so two runs never write it at once.
    use_lockfile = true
  }

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
# COOLIFY_ENDPOINT with COOLIFY_TOKEN. The Coolify token must not have `root`
# or `read:sensitive`: with either, Coolify returns secret values, and they
# would be written into the state.
provider "cloudflare" {}

provider "coolify" {}
