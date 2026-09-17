# Runs the Bun server, which bundles the web app itself at startup (see apps/server/src/index.ts).
FROM oven/bun:1.4 AS base
WORKDIR /app

# Install with the lockfile only, so the layer is cached until dependencies change.
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --production

COPY apps apps
COPY packages packages
COPY lexicons lexicons
COPY tsconfig.json ./

ENV NODE_ENV=production
ENV PORT=8080
# SQLite lives on the Fly volume mounted at /data (see fly.toml).
ENV DB_PATH=/data/manalath.sqlite
EXPOSE 8080

CMD ["bun", "apps/server/src/index.ts"]
