# API image: the Mastra server (quiz + content pipeline routes).
# Build: docker build -t sprout .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# `mastra build` bundles the server into .mastra/output and installs its runtime
# dependencies there (including DuckDB's native binding).
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    SPROUT_ENV=production \
    SPROUT_ROOT=/app \
    DUCKDB_PATH=/data/mastra.duckdb
WORKDIR /app
COPY --from=build --chown=node:node /app/.mastra/output ./.mastra/output
# Math problems are still files, and the generators read the reference examples.
COPY --chown=node:node content ./content
COPY --chown=node:node reference ./reference
# Trivia content lives in MySQL, but the first start on an empty database
# seeds it from these legacy files.
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/.mastra/output
EXPOSE 4111
CMD ["node", "index.mjs"]
