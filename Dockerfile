FROM docker.io/oven/bun:1.4.4-slim

WORKDIR /app

# Dependencies first, so a change to the source reuses this layer.
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/
RUN bun install --frozen-lockfile --production

COPY apps/api apps/api
COPY packages/core packages/core

# The database lives in /data, which production mounts as a volume. Creating
# it here, owned by the unprivileged user, makes a new volume writable.
RUN mkdir /data && chown bun:bun /data
ENV DATABASE_PATH=/data/leaf.db PORT=3000 NODE_ENV=production
USER bun
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["bun", "-e", "const r = await fetch('http://127.0.0.1:3000/healthz'); process.exit(r.ok ? 0 : 1)"]

CMD ["bun", "apps/api/src/main.ts"]
