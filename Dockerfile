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

# ─── Toolpack layer (Phase 3) ─────────────────────────────────────────────────
# Selects which sec-ops tools are baked into the image. The script lives
# at /tmp/install-profile.sh and is copied in *before* the source tree so
# changing app code does not bust the (potentially expensive) tool layer.
#
# PROFILE      — one of base | offensive | blue | full. base is the
#                default so the image always builds without explicit args.
# INCLUDE_MSF  — set to 1 to install Metasploit in a separate layer.
#                Held out of every profile because it pulls hundreds of
#                MB and most operators want to opt in.
#
# Override at build time:
#   docker build --build-arg PROFILE=offensive --build-arg INCLUDE_MSF=1 .
ARG PROFILE=base
ARG INCLUDE_MSF=0

COPY scripts/install-profile.sh /tmp/install-profile.sh
RUN chmod +x /tmp/install-profile.sh \
 && /tmp/install-profile.sh "$PROFILE"

# Metasploit is opt-in via INCLUDE_MSF=1. Kept in its own layer so the
# base/offensive/blue variants don't pay the install cost. Uses Rapid7's
# official msfinstall script.
RUN if [ "$INCLUDE_MSF" = "1" ]; then \
      curl https://raw.githubusercontent.com/rapid7/metasploit-omnibus/master/config/templates/metasploit-framework-wrappers/msfupdate.erb -o /tmp/msfinstall \
   && chmod +x /tmp/msfinstall \
   && /tmp/msfinstall; \
    fi

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

# Build the SPA (vite build frontend), the VitePress docs site, AND the
# React bundle (vite build --config vite.config.react.ts → dist/react/).
# All three must succeed — server/index.js mounts /docs from
# user-docs/.vitepress/dist when docs_enabled is on, and serves the
# React bundle for any REACT_PAGES prefix when dist/react/index.html
# exists. A8.5 cutover requires the React bundle to ship in the image.
RUN npm run build && npm run build:react

# ─── Runtime ──────────────────────────────────────────────────────────────────
# Persist SQLite + WAL/SHM on the phantom-db named volume mounted at /app/data
# (see docker-compose.yml). server/config.js honors PHANTOM_DB_PATH when set,
# so the running server writes to the volume instead of the per-container
# /app/phantom.db that disappears on `docker compose down`. The mkdir runs
# at image-build time so SQLite never races the mount on first boot.
RUN mkdir -p /app/data
ENV PHANTOM_DB_PATH=/app/data/phantom.db \
    NODE_ENV=production

EXPOSE 1337

CMD ["node", "server/index.js"]
