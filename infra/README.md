# Leaf's infrastructure

Everything that exists for Leaf outside this repository, as
[OpenTofu](https://opentofu.org) configuration. What is on `main` here is what
production is.

| What                                | Where      | Resource                                                |
| ----------------------------------- | ---------- | ------------------------------------------------------- |
| `leaf.seqwawa.com`                  | Cloudflare | `cloudflare_dns_record.leaf`                            |
| The `sequoia-leaf` project          | Coolify    | `coolify_project.leaf`                                  |
| The `sequoia-leaf-prod` app         | Coolify    | `coolify_application_github_app.leaf`                   |
| Its `/data` volume                  | Coolify    | `coolify_storage.data`                                  |
| `BACKEND_URL`                       | Coolify    | `coolify_environment_variable.backend_url`              |
| The `sequoia-leaf-backups` bucket   | R2         | `cloudflare_r2_bucket.backups`, `..._lifecycle.backups` |
| `BACKUP_S3_ENDPOINT`, `_BUCKET`     | Coolify    | `coolify_environment_variable.backup_*`                 |
| The `sequoia-opentofu-state` bucket | R2         | `cloudflare_r2_bucket.state`                            |

The code itself is not deployed from here. Coolify builds and deploys every
push to `main`, as the top-level README describes.

## How a change reaches production

The `Infrastructure` workflow (`.github/workflows/infra.yml`) runs OpenTofu:

- **On a pull request** that touches `infra/`, it plans and writes what
  applying would change in the run's summary. Read it before merging.
- **On a merge to `main`**, it plans again and applies that plan. Applies run
  one at a time.
- **Every day at 05:41 UTC**, it plans `main`. When production differs, for
  example after a change made by hand in Coolify, the run fails and the plan
  shows the difference. Either put the change into `infra/` through a pull
  request, or undo it by running the workflow by hand on `main`, which applies
  `main` again.

The state is in the R2 bucket `sequoia-opentofu-state`, under
`sequoia-leaf/terraform.tfstate`, with a lock file beside it while a run
writes.

## Credentials

The workflow uses four repository secrets:

| Secret                 | What it is                                                                       |
| ---------------------- | -------------------------------------------------------------------------------- |
| `COOLIFY_TOKEN`        | Coolify API token `sequoia-leaf-opentofu-ci`, with `read` and `write`.           |
| `CLOUDFLARE_API_TOKEN` | Cloudflare account token `sequoia-leaf-opentofu-ci`: DNS of seqwawa.com, and R2. |
| `R2_ACCESS_KEY_ID`     | That Cloudflare token's id, which R2 takes as an S3 access key.                  |
| `R2_SECRET_ACCESS_KEY` | The SHA-256 of that Cloudflare token's value, which R2 takes as the secret key.  |

None of them expire. The Coolify token can change anything in Coolify, which
amounts to root on the server, so anyone who can push to this repository can
reach the server. To replace a token, make a new one, update the secrets, run
the workflow by hand, then delete the old one.

The Coolify token has neither `root` nor `read:sensitive` on purpose. With
either, Coolify returns secret values, such as other variables' values and
webhook secrets, and they would be written into the state.

## What is not managed here

- **The server, Coolify itself, the `coolify` network and the GitHub App.**
  They are shared with the backend and the site. `shared.tofu` only names
  them.
- **Secret values**: `BACKEND_INTERNAL_TOKEN`, which the backend owns, and
  `BACKUP_S3_ACCESS_KEY_ID` with `BACKUP_S3_SECRET_ACCESS_KEY`, which come
  from a Cloudflare token that may only write to the backups bucket. They are
  set by hand in Coolify, so they are neither in this repository nor in the
  state.
- **The copies of the variables for preview deployments**, which Coolify makes
  by itself. Preview deployments are off.

## Running it by hand

Only to look. Changes go through pull requests.

```sh
export CLOUDFLARE_API_TOKEN=... COOLIFY_TOKEN=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
export COOLIFY_ENDPOINT=https://coolify.seqwawa.com
tofu -chdir=infra init
tofu -chdir=infra plan
```

## Before merging, read the plan

- **A plan that replaces or destroys the application or the volume destroys
  the database.** Both, and both buckets, have `prevent_destroy`, so OpenTofu
  refuses such a plan rather than carrying it out. Do not remove that to get a
  plan through.
- **Coolify does not report which GitHub App or network an application uses.**
  The provider would replace an application over a difference in either,
  which is why both are ignored after creation.
- **Changing a variable does not restart Leaf.** It takes effect at the next
  deploy, which is the next merge that changes the code, or a redeploy in
  Coolify.
