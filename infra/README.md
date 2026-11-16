# Leaf's infrastructure

Everything that exists for Leaf outside this repository, as
[OpenTofu](https://opentofu.org) configuration:

| What                        | Where      | Resource                                              |
| --------------------------- | ---------- | ----------------------------------------------------- |
| `leaf.seqwawa.com`          | Cloudflare | `cloudflare_dns_record.leaf`                          |
| The `sequoia-leaf` project  | Coolify    | `coolify_project.leaf`                                |
| The `sequoia-leaf-prod` app | Coolify    | `coolify_application_github_app.leaf`                 |
| Its `/data` volume          | Coolify    | `coolify_storage.data`                                |
| `BACKEND_URL`               | Coolify    | `coolify_environment_variable.backend_url`            |
| `BACKEND_INTERNAL_TOKEN`    | Coolify    | `coolify_environment_variable.backend_internal_token` |

The code itself is not deployed from here. Coolify builds and deploys every
push to `main`, as the top-level README describes.

## Status

**Nothing applies this configuration yet, and it has no state.** Production
was set up by hand on 2026-11-16. The configuration was then compared with it
using a read-only plan: it adopts all six objects and replaces or destroys
none. Until something applies it, a change made here changes nothing, and CI
only checks that the files are well-formed.

## What is not managed here

- **The server, Coolify itself, the `coolify` network and the GitHub App.**
  They are shared with the backend and the site. `shared.tofu` only names
  them.
- **The value of `BACKEND_INTERNAL_TOKEN`.** The backend owns it. It is set by
  hand in Coolify, so it is neither in this repository nor in the state. The
  configuration only says the variable exists.
- **The copies of both variables for preview deployments**, which Coolify
  makes by itself. Preview deployments are off.

## Comparing it with production

```sh
export CLOUDFLARE_API_TOKEN=...   # may read DNS records of seqwawa.com
export COOLIFY_ENDPOINT=https://coolify.seqwawa.com
export COOLIFY_TOKEN=...          # a Coolify API token with `read`
tofu -chdir=infra init
tofu -chdir=infra plan -lock=false
```

Without a state, the plan adopts production through `imports.tofu` and lists
what differs. With a token that only has `read`, expect this and nothing
more:

```
Plan: 6 to import, 0 to add, 2 to change, 0 to destroy.
```

The two changes are not real differences. Coolify hides the value of
`BACKEND_URL` from a `read` token, and the provider does not read the network
alias back when it adopts an application.

## Before applying, read the plan

- **A plan that replaces or destroys the application or the volume destroys
  the database.** Both have `prevent_destroy`, so OpenTofu refuses such a plan
  rather than carrying it out. Do not remove that to get a plan through.
- **Coolify does not report which GitHub App an application uses.** The
  provider would replace an application over a difference there, which is why
  `github_app_uuid` is ignored after creation.
