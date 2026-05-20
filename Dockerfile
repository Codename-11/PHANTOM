# syntax=docker/dockerfile:1.6
#
# PHANTOM container substrate — Phase 1.
#
# Layer order (cache-friendly): system deps → tool layer (none yet) → source
# copy → build. Phase 3 inserts the toolpack install step between the system
# deps and the source copy via the PROFILE build arg.
#
# Base is debian:stable-slim. Production targets amd64 Linux. Multi-stage is
# intentionally avoided in Phase 1 — the size cost of leaving build-essential
# in the final image (needed by better-sqlite3) is acceptable here; trimming
# moves to a later phase if image size becomes a constraint.

FROM debian:stable-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PATH=/root/.local/bin:/usr/local/go/bin:$PATH

# ─── System deps (rarely change) ──────────────────────────────────────────────
# Install the small bootstrap set first (curl/ca-certificates/gnupg) so the
# NodeSource setup script can run, then add Node 20 via NodeSource (matches
# the version the repo runs in dev), and finally the Python + Go toolchain.
#
# build-essential is required for `npm ci` because better-sqlite3 compiles
# native bindings from source on debian-slim (no prebuilt for this base).
# We keep it in the image — pruning it later would mean a second apt cycle
# that costs more cache invalidations than it saves in size for Phase 1.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        gnupg \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        pipx \
        golang \
        build-essential \
 && rm -rf /var/lib/apt/lists/*

# Put pipx-managed bins on PATH for subsequent RUN/CMD layers and for any
# operator shells dropped into the running container.
RUN pipx ensurepath

# ─── App workspace ────────────────────────────────────────────────────────────
WORKDIR /app

# ─── Dependency layer (changes when lockfiles change) ─────────────────────────
# Copy package manifests first so `npm ci` is cached as long as the lockfiles
# don't change. Root deps and user-docs deps are installed separately because
# user-docs is its own npm project (VitePress + its transitive tree).
COPY package.json package-lock.json ./
RUN npm ci

COPY user-docs/package.json user-docs/package-lock.json ./user-docs/
RUN npm --prefix user-docs ci

# ─── Source layer (changes frequently) ────────────────────────────────────────
COPY . .

# Build the SPA (vite build frontend) and the VitePress docs site. Both must
# succeed — server/index.js mounts /docs from user-docs/.vitepress/dist when
# the docs_enabled setting is on (default).
RUN npm run build

# ─── Runtime ──────────────────────────────────────────────────────────────────
# Persist SQLite + WAL/SHM on the phantom-db named volume mounted at /app/data
# (see docker-compose.yml). server/config.js honors PHANTOM_DB_PATH when set,
# so the running server writes to the volume instead of the per-container
# /app/phantom.db that disappears on `docker compose down`. The mkdir runs
# at image-build time so SQLite never races the mount on first boot.
RUN mkdir -p /app/data
ENV PHANTOM_DB_PATH=/app/data/phantom.db

EXPOSE 1337

CMD ["node", "server/index.js"]
