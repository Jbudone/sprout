# Deploying Sprout to a droplet

Two images are built by GitHub Actions on every push to `main` and published to
GitHub Container Registry:

| Image | What it is |
|---|---|
| `ghcr.io/jbudone/sprout` | The Mastra API (quiz and content pipeline), production mode |
| `ghcr.io/jbudone/sprout-web` | The Svelte app behind Caddy: HTTPS, login, proxy to the API |

The droplet runs both with `docker-compose.yml`. The database is MySQL (DreamHost);
nothing but Caddy listens on the internet, and Caddy only forwards `/quiz/*`.

## What production mode changes
- `SPROUT_ENV=production` leaves out the shell-capable general agent and the git-worktree
  dev workflows (feature-dev, idea-experiment). Only the quiz and content pipeline remain.
- `MYSQL_URL` moves the app's tables (decks, cards, runs, usage log, progress, feedback)
  and Mastra's own storage into MySQL. Without it, local dev uses SQLite files as before.
- On an empty database the first start seeds the starter trivia cards and math problems from the image.

## One-time setup

### 1. DreamHost MySQL
1. Panel → **Websites → MySQL Databases**: create a database and a user.
2. Use a hostname like `mysql.yourdomain.com`.
3. Under **Allowable Hosts** add the droplet's public IP. Without this, connections are refused.
4. Check whether your DreamHost MySQL accepts TLS. If it does, set `MYSQL_SSL=true`.
   If it does not, the password and your data cross the internet unencrypted: prefer an SSH
   tunnel from the droplet, or switch to a DigitalOcean managed database.
5. URL-encode special characters in the password (`@` → `%40`, `/` → `%2F`, `#` → `%23`).

### 2. The droplet
```bash
# Ubuntu 24.04 droplet, as a sudo user
sudo apt-get update && sudo apt-get install -y ca-certificates curl ufw
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
```

### 3. DNS
Point an `A` record for your domain (e.g. `quiz.example.com`) at the droplet's IP.
Caddy then gets a Let's Encrypt certificate on first start.

### 4. Get the deploy folder onto the server
```bash
git clone https://github.com/Jbudone/sprout.git /opt/sprout   # public repo, no login needed
cd /opt/sprout/deploy
cp .env.example .env && chmod 600 .env && nano .env
```
Fill in `MYSQL_URL`, the two model keys, `SITE_ADDRESS`, and a login. Make the password hash with:
```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'your password'
```
and paste it into `BASIC_AUTH_HASH` inside single quotes.

### 5. Image access
New GHCR packages start **private**. Either:
- make both packages public: GitHub → your profile → **Packages** → each package →
  **Package settings → Change visibility**; or
- keep them private and log in once on the droplet with a classic token that has only
  `read:packages`: `echo TOKEN | docker login ghcr.io -u Jbudone --password-stdin`.

### 6. Start
```bash
docker compose pull
docker compose up -d
docker compose logs -f api
```
Open `https://your-domain`, sign in, and check the Trivia tab shows the 20 starter cards.

## Moving your existing content onto the droplet
Everything (decks, cards, math, runs, usage log, your progress and feedback) travels as one JSON file.
On your PC, with `npm run dev` running:
```bash
curl localhost:4111/quiz/admin/export -o sprout-export.json        # already gitignored
```
Then upload it to the droplet's site (it needs your login). Importing is safe to repeat: rows are
upserted by id and nothing is deleted:
```bash
curl -u josh:YOUR_PASSWORD -X POST https://your-domain/quiz/admin/import \
  -H 'content-type: application/json' --data-binary @sprout-export.json
```
The same two calls work in the other direction, so an export from the droplet also restores a PC.

## Day to day
- **Update:** `cd /opt/sprout/deploy && docker compose pull && docker compose up -d`
- **Roll back:** set `SPROUT_TAG=<commit sha tag>` in `.env` (tags are listed on the package page) and `docker compose up -d`
- **Logs:** `docker compose logs --tail 100 api`
- **Backups:** `./backup.sh` writes a gzipped dump to `~/sprout-backups` and keeps 14. Schedule it:
  `crontab -e` → `17 3 * * * cd /opt/sprout/deploy && ./backup.sh >> ~/sprout-backups/backup.log 2>&1`.
  Copy a dump off the droplet now and then (DigitalOcean Spaces, or `scp` to your PC).
- **Restore:** `gunzip -c dump.sql.gz | mysql -h HOST -u USER -p DATABASE`

## Things to know
- **Spend caps still apply** (set them in the Stats tab). The OpenRouter and Google keys live only in
  `deploy/.env` on the droplet, never in the image.
- **One login for everything.** Anyone with the password can start model runs that spend your balance.
  Use a long password and keep the caps low.
- **Math problems** now live in MySQL like the trivia, so server-made content survives updates.
- **DuckDB traces** (Mastra's observability) live on the `sprout-data` volume, not in MySQL.
- **Studio** (the Mastra dev UI) is not part of the production image. Develop locally with `npm run dev`.
