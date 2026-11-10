# syntax=docker/dockerfile:1
#
# wish API image (apps/server) — multi-stage pnpm build, non-root runtime.
#
# Pins:
# - node:24-alpine matches `engines.node = ">=24 <25"` in package.json and the
#   Node 24 runtime the team CI uses. The tag is pinned to the major line the
#   repository declares; the digest is recorded by the verification step that
#   actually builds this image.
# - pnpm@12.18.0 is the exact `packageManager` pin in the root package.json and
#   the version team CI installs, so the lockfile is installed by the same
#   package manager here.
#
# No database, no native build toolchain: every runtime dependency of
# @wish/server is pure JavaScript (NestJS, bcryptjs, image-size, rxjs).

# ---------------------------------------------------------------------------
# Stage 1 — install the workspace and compile @wish/server with tsc
# ---------------------------------------------------------------------------
FROM node:24-alpine AS build

ARG PNPM_VERSION=12.18.0
RUN npm install -g "pnpm@${PNPM_VERSION}"

WORKDIR /app

# Only the workspace manifests are needed to resolve the lockfile; both
# workspace importers must be present or `--frozen-lockfile` rejects the tree.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json

# Dev dependencies are required here: @wish/server builds with `tsc`.
RUN pnpm install --frozen-lockfile --filter @wish/server

COPY apps/server/tsconfig.json apps/server/tsconfig.build.json apps/server/
COPY apps/server/src apps/server/src

# tsconfig.build.json compiles src/**/*.ts with no rootDir override, so the
# common source root is apps/server/src and the entrypoint lands at
# apps/server/dist/main.js.
RUN pnpm --filter @wish/server build

# ---------------------------------------------------------------------------
# Stage 2 — production dependencies only, unprivileged runtime
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime

ARG PNPM_VERSION=12.18.0
RUN npm install -g "pnpm@${PNPM_VERSION}" && rm -rf /root/.npm

WORKDIR /app

ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --prod --filter @wish/server \
 && pnpm store prune

COPY --from=build /app/apps/server/dist apps/server/dist

# Fixed uid/gid so a bind-mounted upload directory has a stable owner.
# UPLOAD_DIR defaults to ./data/uploads relative to the working directory, so
# the runtime user must own that path for POST /api/uploads to succeed.
RUN addgroup -S -g 10001 wish \
 && adduser -S -u 10001 -G wish -h /app -s /sbin/nologin wish \
 && mkdir -p /app/apps/server/data/uploads \
 && chown -R wish:wish /app/apps/server/data

USER wish

WORKDIR /app/apps/server
ENV PORT=3000
ENV UPLOAD_DIR=/app/apps/server/data/uploads

# The API listens on PORT (default 3000) — main.ts reads process.env.PORT.
EXPOSE 3000

# HEALTHCHECK is owned by docker-compose.yml (HTTP 200 poll on
# /api/categories) so the definition stays visible next to the port mapping.
CMD ["node", "dist/main.js"]
