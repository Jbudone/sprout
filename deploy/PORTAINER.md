# Setting up Sprout as a Portainer stack

This is written so it can be handed to an agent (or followed by hand). It deploys
`deploy/docker-compose.yml` from the public repo as a Portainer stack.

## What you are deploying
- `api`: `ghcr.io/jbudone/sprout` (Mastra API). No published ports; only `web` reaches it.
- `web`: `ghcr.io/jbudone/sprout-web` (Caddy + the web app). Does HTTPS, a username/password login,
  and forwards only `/quiz/*` to `api`.
- Database: an external MySQL (DreamHost). There is no database container in this stack.
- Volumes: `sprout-data`, `caddy-data`, `caddy-config` (created by the stack).

## Before starting, check
1. **Ports 80/443 on the host.** If another reverse proxy (Traefik, Nginx Proxy Manager, Caddy...) already
   uses them, do not fight it: set `HTTP_PORT=8080`, `HTTPS_PORT=8443` and `SITE_ADDRESS=:80`, and have the
   existing proxy forward the domain to `web` (port 80 inside the container). Otherwise leave the defaults.
2. **Image access.** Try `docker pull ghcr.io/jbudone/sprout:latest` on the host. If it says denied, the
   packages are private: in Portainer go to **Registries → Add registry → Custom**, URL `ghcr.io`, username
   `Jbudone`, password a GitHub token with only `read:packages`, and use it for this stack.
3. **Outbound IP.** DreamHost must allow this server's public IP. Find it with `curl -s https://ifconfig.me`
   (from the host) and tell the owner to add it under DreamHost → MySQL → Allowable Hosts.
4. **Domain.** A DNS `A` record for the site's domain must point at this server (only when Caddy does HTTPS itself).

## Values only the owner can supply (ask; never invent or print them)
| Variable | Notes |
|---|---|
| `MYSQL_URL` | `mysql://USER:PASSWORD@HOST:3306/DATABASE`, URL-encode special characters in the password |
| `MYSQL_SSL` | `true` if the DreamHost MySQL host supports TLS, else `false` (then the link is unencrypted: tell the owner) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | optional |
| `OPENROUTER_API_KEY` | optional |
| `SITE_ADDRESS` | the domain (e.g. `quiz.example.com`), or `:80` when another proxy terminates TLS |
| `BASIC_AUTH_USER` | login name |
| `BASIC_AUTH_HASH` | bcrypt hash, made with `docker run --rm caddy:2-alpine caddy hash-password --plaintext 'PASSWORD'` |

## Create the stack
1. Portainer → **Stacks → Add stack**, name `sprout`.
2. Build method **Repository**: URL `https://github.com/Jbudone/sprout`, reference `refs/heads/main`,
   compose path `deploy/docker-compose.yml`. (Public repo, so no authentication.)
3. Environment variables: use **Advanced mode** and paste them as `.env` lines. Wrap `BASIC_AUTH_HASH` in
   **single quotes** so the `$` characters are not expanded:
   ```
   MYSQL_URL=mysql://USER:PASSWORD@HOST:3306/DATABASE
   MYSQL_SSL=true
   GOOGLE_GENERATIVE_AI_API_KEY=...
   OPENROUTER_API_KEY=...
   SITE_ADDRESS=quiz.example.com
   BASIC_AUTH_USER=josh
   BASIC_AUTH_HASH='$2a$14$...'
   ```
4. Turn on **Re-pull image** when updating, then **Deploy the stack**.

## Verify (all of these)
- Both containers are running (`docker ps`); `api` logs show no `ER_ACCESS_DENIED`, `ECONNREFUSED`, or `ETIMEDOUT`.
- The hash survived: `docker exec <web container> printenv BASIC_AUTH_HASH` starts with `$2a$` (or `$2y$`).
  If it is mangled, change each `$` to `$$` in the Portainer value and redeploy.
- Without a login: `curl -s -o /dev/null -w '%{http_code}\n' https://DOMAIN/` prints `401`.
- With the login: `curl -s -u USER:PASSWORD https://DOMAIN/quiz/trivia/decks` returns JSON containing decks
  (the first start seeds the starter cards into an empty database).
- `https://DOMAIN/api/agents` returns the web page, not JSON (the API is not exposed).
- The API container has no published ports.

## Do not
- Publish the `api` container's port 4111, or add any route to it that bypasses the login.
- Put secrets in the repo, in image names, or in logs/chat output.
- Delete the named volumes or the stack's database.

## Updating
Portainer → the stack → **Pull and redeploy** (with **Re-pull image**). Every push to `main` publishes a new
`latest`; each build is also tagged with its short commit hash, so `SPROUT_TAG=<hash>` pins or rolls back.

## After it is running
The owner loads existing content from a PC (needs the login):
```bash
curl -u USER:PASSWORD -X POST https://DOMAIN/quiz/admin/import \
  -H 'content-type: application/json' --data-binary @sprout-export.json
```
Backups: `deploy/backup.sh` dumps the database (see `deploy/README.md`).

## Report back
Reply with: stack status, the image tags that were pulled, whether MySQL TLS is on, the outcome of each
verification step, and anything that needed a deviation from these steps.
