#!/bin/sh
# install-profile.sh — Phase 3 of the PHANTOM containerization rollout.
#
# Resolves a profile name (base | offensive | blue | full) to a static list
# of apt / pipx / go tools and installs them in a single Dockerfile RUN
# layer. Phase 6 will swap this for a dynamic resolver driven by the
# profile table that Phase 4 shipped; the case statement below is the
# canonical install set until then.
#
# Usage: install-profile.sh [profile]   (defaults to "base")
#
# Exits non-zero on unknown profile (2) or any apt/pipx/go failure (set -e).

set -eu

PROFILE="${1:-base}"

# Per-profile tool lists. Keep apt-only for now — every tool below is
# available in debian:stable-slim's repos, so we get one cache-friendly
# install layer per profile. pipx/go pipelines are wired up but stay
# empty until Phase 4's profile table starts driving the script.
APT_TOOLS=""
PIPX_TOOLS=""
GO_TOOLS=""

case "$PROFILE" in
  base)
    APT_TOOLS="curl git nmap jq dnsutils"
    ;;
  offensive)
    APT_TOOLS="curl git nmap jq dnsutils nikto whatweb gobuster hydra"
    ;;
  blue)
    APT_TOOLS="curl git nmap jq dnsutils tshark tcpdump chkrootkit rkhunter"
    ;;
  full)
    APT_TOOLS="curl git nmap jq dnsutils nikto whatweb gobuster hydra tshark tcpdump chkrootkit rkhunter"
    ;;
  *)
    echo "install-profile.sh: unknown profile '$PROFILE' (expected base | offensive | blue | full)" >&2
    exit 2
    ;;
esac

echo "install-profile.sh: installing profile '$PROFILE'" >&2

# ── apt section ──────────────────────────────────────────────────────────
# Single apt-get call to minimize layer churn; --no-install-recommends
# keeps the image lean. tshark is preseeded to skip its interactive
# "should non-root capture?" prompt — without this it hangs the build.
if [ -n "$APT_TOOLS" ]; then
  apt-get update
  if echo "$APT_TOOLS" | grep -qw tshark; then
    echo "wireshark-common wireshark-common/install-setuid boolean false" | debconf-set-selections
  fi
  # shellcheck disable=SC2086
  apt-get install -y --no-install-recommends $APT_TOOLS
  rm -rf /var/lib/apt/lists/*
fi

# ── pipx section ─────────────────────────────────────────────────────────
if [ -n "$PIPX_TOOLS" ]; then
  for pkg in $PIPX_TOOLS; do
    pipx install "$pkg"
  done
fi

# ── go section ───────────────────────────────────────────────────────────
if [ -n "$GO_TOOLS" ]; then
  for pkg in $GO_TOOLS; do
    go install "$pkg@latest"
  done
fi

echo "install-profile.sh: profile '$PROFILE' done" >&2
