# The bucket that holds this configuration's state. It was made by hand
# before the first apply, since the state needs somewhere to live first.
resource "cloudflare_r2_bucket" "state" {
  account_id = local.account_id
  name       = "sequoia-opentofu-state"
  location   = "weur"

  lifecycle {
    prevent_destroy = true
  }
}
