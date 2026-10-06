# Web image: the built Svelte app behind Caddy, which also does HTTPS, the
# login, and proxies /quiz/* to the API container. Build from the repo root:
#   docker build -f deploy/web.Dockerfile -t sprout-web .
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM caddy:2-alpine
COPY --from=web /web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
