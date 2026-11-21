# The game's pages, built from the three apps and the kit they share. Each
# build is plain files, so only /app/public goes on to the image.
FROM docker.io/oven/bun:1.4.4-slim AS pages

WORKDIR /app

COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY packages/kit/package.json packages/kit/
COPY apps/town/package.json apps/town/
COPY apps/works/package.json apps/works/
COPY apps/battler/package.json apps/battler/
RUN bun install --frozen-lockfile --production

COPY packages/kit packages/kit
COPY apps/town apps/town
COPY apps/works apps/works
COPY apps/battler apps/battler
RUN for app in town works battler; do \
      (cd "apps/$app" && bun build index.html --outdir "/app/public/$app" --minify) || exit 1; \
    done

FROM docker.io/oven/bun:1.4.4-slim

WORKDIR /app

# Dependencies first, so a change to the source reuses this layer.
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/
RUN bun install --frozen-lockfile --production

COPY apps/api apps/api
COPY packages/core packages/core
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
