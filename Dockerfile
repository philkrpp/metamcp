# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS node-runtime

# Base image: the official uv image, digest-pinned so the build is
# reproducible and the base layer cannot shift under us between builds. The
# :debian tag is kept for human context; the @sha256 index digest is what
# Docker resolves. Bumped by Dependabot's docker ecosystem (see
# .github/dependabot.yml), which opens a reviewable PR when the tag moves.
FROM ghcr.io/astral-sh/uv:debian@sha256:b2b767dc8bbe5b9f813ca4958a43cc8421ca8eab6c954c74e5b1e641fea7a6ad AS base

# Keep the existing tools and provide Node shared libraries from this base.
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    libstdc++6 libatomic1 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy the Node runtime without replacing Python/uv or importing Yarn symlinks.
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=node-runtime /usr/local/include/node /usr/local/include/node
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

RUN npm install -g pnpm@10.34.1

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED 1

# Copy root package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY turbo.json ./

# Copy package.json files from all workspaces
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/backend/package.json ./apps/backend/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/trpc/package.json ./packages/trpc/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/zod-types/package.json ./packages/zod-types/

# Install dependencies (pnpm store cached across builds so packages aren't re-downloaded)
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store

# Builder stage
FROM base AS builder
WORKDIR /app

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=deps /app/packages ./packages

# Copy source code
COPY . .

# Build all packages and apps (turbo cache persisted across builds so unchanged
# packages are restored instead of rebuilt)
RUN --mount=type=cache,target=/turbo \
    TURBO_CACHE_DIR=/turbo pnpm build

# Raise Next's proxy-request timeout 30s -> 600s (long-running MCP tool
# calls stream through the frontend's rewrite proxy). The pnpm store path
# encodes next's exact version + peer suffix, so it MUST be globbed — the
# hardcoded 15.5.12 path silently outlived a next bump and broke three
# consecutive image builds (2026-07-11). Fails the build loudly if the
# expected pair of files stops matching.
RUN set -e; \
    files=$(find node_modules/.pnpm -name proxy-request.js -path '*/next/dist/*' | sort); \
    count=$(printf '%s\n' "$files" | grep -c . || true); \
    if [ "$count" -lt 2 ]; then echo "ERROR: expected >=2 next proxy-request.js files (dist + dist/esm), found $count" >&2; exit 1; fi; \
    printf '%s\n' "$files" | while read -r f; do sed -i -e "s/30000/600000/" "$f"; done

# Production runner stage
FROM base AS runner
WORKDIR /app

# CompLeadly deployment: brand defaults. docker-entrypoint.sh promotes these
# BRANDING_* aliases to NEXT_PUBLIC_BRANDING_*; a runtime env var of the same
# name (Coolify, docker run -e) still overrides them. Kept here instead of
# editing lib/branding.ts so umbrella syncs stay conflict-free.
ENV BRANDING_PRODUCT_NAME="CompLeadly MCP Gateway" \
    BRANDING_ORG_NAME="CompLeadly" \
    BRANDING_LOGO_PATH="/compleadly-icon.png" \
    BRANDING_DESCRIPTION="CompLeadly's MCP gateway: aggregates MCP servers into curated namespaces for AI tooling."

# Commit the image was built from, shown in the sidebar footer tooltip. The
# build context excludes .git, so it has to come in as a build arg; Coolify
# passes SOURCE_COMMIT automatically.
ARG SOURCE_COMMIT=""
ENV NEXT_PUBLIC_APP_COMMIT=${SOURCE_COMMIT}

# OCI image labels
LABEL org.opencontainers.image.source="https://github.com/metatool-ai/metamcp"
LABEL org.opencontainers.image.description="MetaMCP - aggregates MCP servers into a unified MetaMCP"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.title="MetaMCP"
LABEL org.opencontainers.image.vendor="metatool-ai"

# Install curl for health checks
RUN apt-get update && apt-get install -y curl postgresql-client && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create non-root user with proper home directory
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 --home /home/nextjs nextjs && \
    mkdir -p /home/nextjs/.cache/node/corepack /home/nextjs/.cache/uv && \
    chown -R nextjs:nodejs /home/nextjs

# Copy built applications
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next ./apps/frontend/.next
# Umbrella fork: Next.js standalone mode does NOT auto-copy public/ into
# the runtime layer, so static assets in apps/frontend/public/ (including
# Umbrella branding PNGs) 404 unless we copy them here. Upstream gets
# away with this because they don't put anything in public/ that the
# runtime serves — favicon.ico lives in app/ as a Next 15 special file.
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/public ./apps/frontend/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/package.json ./apps/frontend/
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/package.json ./apps/backend/
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/drizzle ./apps/backend/drizzle
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/drizzle.config.ts ./apps/backend/

# Copy built packages
COPY --from=builder --chown=nextjs:nodejs /app/packages ./packages
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-workspace.yaml ./
# Lockfile is required here so the prod install below can run --frozen-lockfile:
# pin prod deps to the already-resolved graph instead of re-resolving
# package.json ranges (which can silently drift from the committed lockfile).
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-lock.yaml ./

# Install production dependencies only. drizzle-kit is a prod dependency of
# apps/backend (the entrypoint runs `drizzle-kit migrate` at start), so the
# frozen install provides it from the lockfile-resolved graph. It used to be
# fetched here with an ad-hoc `pnpm add` outside the lockfile, which pulled an
# unpinned, ungoverned dependency tree into the production image on every build.
#
# CI=1 so pnpm runs non-interactively: the copied node_modules was built with
# dev dependencies, so switching to --prod makes pnpm purge and reinstall the
# modules tree, and without CI that confirmation prompt stalls in the non-TTY
# build and leaves the per-workspace node_modules (and drizzle-kit's bin)
# unlinked. The old ad-hoc `pnpm add` masked this by triggering its own full
# reconcile; with that gone, the prod install has to complete on its own.
# Shared pnpm store cache mount so packages are not re-downloaded on every build.
RUN --mount=type=cache,target=/pnpm/store \
    CI=1 pnpm install --prod --frozen-lockfile --config.confirmModulesPurge=false --store-dir=/pnpm/store

# Copy startup script
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Helper scripts the entrypoint shells out to. Separate files rather than more
# functions inside docker-entrypoint.sh so the same artifact the image runs is
# the one the test suite executes against a real Postgres.
COPY --chown=nextjs:nodejs scripts ./scripts
RUN chmod +x scripts/*.sh

USER nextjs

# Expose frontend port (Next.js)
EXPOSE 12008

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:12008/health || exit 1

# Start both backend and frontend
CMD ["./docker-entrypoint.sh"] 