# Things Leaf uses but does not own. They belong to the Sequoia server and its
# Coolify, are shared with the backend and the site, and are not managed here.
locals {
  # The Sequoia Cloudflare account, which holds the zone and the R2 buckets.
  account_id = "0641c96244af5c3212601f04a36e66ae"

  # The seqwawa.com zone in Cloudflare.
  zone_id = "93eca720df561fc923ea214b551ee37f"

  # The Sequoia server's public address.
  server_ipv4 = "152.53.252.142"

  coolify = {
    # The server as Coolify knows it ("localhost": Coolify runs on it).
    server_uuid = "jwowk40kck8gswoc8o040c4c"
    # The `coolify` Docker network, which the backend is on too.
    destination_uuid = "a844s4gcss80kwsoc4s40wc8"
    # The `sequoia-coolify` GitHub App, installed on the organisation's repositories.
    github_app_uuid = "xkcgss0kc8sc04o8cw8g00og"
  }
}
