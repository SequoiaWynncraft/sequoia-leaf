# The game's pages, built from the three apps, the kit they share, the core
# rules the kit shares with Leaf (the live wire), the games' rules
# (packages/raid, packages/factory and packages/town, which the pages share with
# Leaf's play service), and the raid's figures, which the raid's page and the
# town's draw (packages/figures). Each build is plain files, so only
# /app/public goes on to the image, with the pages' guard (packages/kit/tools/build-pages.ts).
FROM docker.io/oven/bun:1.4.5-slim AS pages

WORKDIR /app

COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY packages/kit/package.json packages/kit/
COPY packages/core/package.json packages/core/
COPY packages/raid/package.json packages/raid/
COPY packages/factory/package.json packages/factory/
COPY packages/town/package.json packages/town/
COPY packages/pulls/package.json packages/pulls/
COPY packages/figures/package.json packages/figures/
COPY apps/town/package.json apps/town/
COPY apps/works/package.json apps/works/
COPY apps/battler/package.json apps/battler/
RUN bun install --frozen-lockfile --production

COPY packages/kit packages/kit
COPY packages/core packages/core
COPY packages/raid packages/raid
COPY packages/factory packages/factory
COPY packages/town packages/town
COPY packages/pulls packages/pulls
COPY packages/figures packages/figures
COPY apps/town apps/town
COPY apps/works apps/works
COPY apps/battler apps/battler
RUN bun packages/kit/tools/build-pages.ts /app/public

FROM docker.io/oven/bun:1.4.5-slim

WORKDIR /app

# Dependencies first, so a change to the source reuses this layer.
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/
COPY packages/raid/package.json packages/raid/
COPY packages/factory/package.json packages/factory/
COPY packages/town/package.json packages/town/
COPY packages/pulls/package.json packages/pulls/
RUN bun install --frozen-lockfile --production

COPY apps/api apps/api
COPY packages/core packages/core
COPY packages/raid packages/raid
COPY packages/factory packages/factory
COPY packages/town packages/town
COPY packages/pulls packages/pulls
COPY --from=pages /app/public /app/public

# The database lives in /data, which production mounts as a volume. Creating
# it here, owned by the unprivileged user, makes a new volume writable.
RUN mkdir /data && chown bun:bun /data
ENV DATABASE_PATH=/data/leaf.db PORT=3000 NODE_ENV=production PUBLIC_DIR=/app/public
USER bun
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["bun", "-e", "const r = await fetch('http://127.0.0.1:3000/healthz'); process.exit(r.ok ? 0 : 1)"]

CMD ["bun", "apps/api/src/main.ts"]
