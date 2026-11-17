# Production was set up by hand on 2026-11-16, before this configuration
# existed. These adopt what is there; they do nothing once it is in the state.

import {
  to = cloudflare_dns_record.leaf
  id = "${local.zone_id}/95a56306f9529886676b0a5f15ecf960"
}

import {
  to = coolify_project.leaf
  id = "kp2y68zwijlr1x7mq54kck2c"
}

import {
  to = coolify_application_github_app.leaf
  id = "kp2y68zwijlr1x7mq54kck2c:${local.coolify.server_uuid}:production:0lb6odu6pvqxsftlnc0aqg0s"
}

import {
  to = coolify_storage.data
  id = "application:0lb6odu6pvqxsftlnc0aqg0s:ukvl1o2bf5ssvnxw4lss9so8"
}

import {
  to = coolify_environment_variable.backend_url
  id = "application:0lb6odu6pvqxsftlnc0aqg0s:unfbr7slqwrtbomuiobfwt2x"
}
