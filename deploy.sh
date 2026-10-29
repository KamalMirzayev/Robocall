#!/bin/bash
# ============================================================================
# deploy.sh — one-command deploy: pull → install → build → migrate → restart.
#
# Works on any customer server, by any admin user (kamal, elnur, ...).
# Builds run as the invoking admin (no ownership juggling); systemd restarts
# are the only step needing sudo, so you get exactly one password prompt.
# Only the apps that changed since the last deploy are rebuilt and restarted.
# The last-deployed revision is recorded in .deploy-state, so a manual
# `git pull` before running this script does NOT skip restarts.
#
# Usage:
#   sudo ./deploy.sh setup [user ...]   # one-time per server: shared 'deploy'
#                                       # group + ownership. Users default to
#                                       # the sudo caller; 'callbot' is always
#                                       # included. New users must re-login
#                                       # afterwards (or: newgrp deploy).
#   ./deploy.sh                         # pull + deploy only what changed
#   ./deploy.sh --force                 # full deploy (rebuild everything)
#   DEPLOY_USER=elnur ./deploy.sh       # when run as root, build as elnur
#
# On a server where the deploy group was never set up (repo still owned by
# the service user), builds automatically fall back to running as 'callbot'
# — same behavior as the old script.
# ============================================================================
set -euo pipefail

PROJECT_ROOT="/opt/robocall"
SERVICE_USER="${SERVICE_USER:-callbot}"
DEPLOY_USER="${DEPLOY_USER:-$USER}"
DEPLOY_GROUP="${DEPLOY_GROUP:-deploy}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log() { echo -e "\n${YELLOW}==> $1${NC}"; }
ok()  { echo -e "${GREEN}✓ $1${NC}"; }

# ---------------------------------------------------------------------------
# One-time per-server setup: a shared group so every admin can pull/build
# without sudo, while the callbot service user keeps runtime write access
# (Asterisk configs, recordings). .env secrets stay private to callbot;
# .env.production is group-readable because `next build` reads it.
# ---------------------------------------------------------------------------
setup() {
  [ "$EUID" -eq 0 ] || { echo "setup needs root: sudo $0 setup [user ...]" >&2; exit 1; }
  local users=("$@")
  [ ${#users[@]} -eq 0 ] && users=("${SUDO_USER:-$SERVICE_USER}")

  groupadd -f "$DEPLOY_GROUP"
  for u in "${users[@]}" "$SERVICE_USER"; do
    if id "$u" >/dev/null 2>&1; then
      usermod -aG "$DEPLOY_GROUP" "$u" && ok "$u added to group '$DEPLOY_GROUP'"
    else
      echo "  (skipping unknown user: $u)"
    fi
  done

  chgrp -R "$DEPLOY_GROUP" "$PROJECT_ROOT"
  find "$PROJECT_ROOT" -type d -exec chmod g+ws {} +
  find "$PROJECT_ROOT" -type f -exec chmod g+w {} +

  # Secrets: readable/writable only by the service user (and root).
  find "$PROJECT_ROOT" -name '.env*' \
    -exec chown "$SERVICE_USER:$SERVICE_USER" {} \; -exec chmod 600 {} \;
  # Frontend build (next build) must read .env.production.
  find "$PROJECT_ROOT" -name '.env.production' \
    -exec chgrp "$DEPLOY_GROUP" {} \; -exec chmod 640 {} \;

  ok "Setup complete. Group members: $(getent group "$DEPLOY_GROUP" | cut -d: -f4)"
  echo "NOTE: newly added users must re-login (or run 'newgrp $DEPLOY_GROUP') before the group applies."
}

# ---------------------------------------------------------------------------
# Deploy: pull, then build/restart only the apps whose files changed.
# ---------------------------------------------------------------------------
deploy() {
  local force=false
  [ "${1:-}" = "--force" ] && force=true

  cd "$PROJECT_ROOT"

  # Who runs npm? Root uses $DEPLOY_USER; a non-root user runs as themselves
  # when the repo is writable, else falls back to the service user.
  local npm=()
  if [ "$EUID" -eq 0 ] && [ "$DEPLOY_USER" != "root" ]; then
    npm=(sudo -u "$DEPLOY_USER" -H)
  elif [ ! -w "$PROJECT_ROOT" ]; then
    echo "Repo not writable by $USER — builds will run as $SERVICE_USER (run 'sudo ./deploy.sh setup' once to enable group deploys)"
    npm=(sudo -u "$SERVICE_USER" -H)
  fi

  log "Pulling latest changes"
  git pull --ff-only

  # Diff against the last DEPLOYED revision, not the pre-pull HEAD. If the
  # repo was pulled manually first, the services are still running the old
  # build, so comparing to HEAD would wrongly skip their restart.
  local state_file="$PROJECT_ROOT/.deploy-state"
  local changed="" base=""
  if [ -r "$state_file" ]; then
    read -r base < "$state_file"
  fi
  if [ -z "$base" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
    echo "  (no previous deploy recorded — deploying everything)"
    changed="$(git ls-files)"
  else
    changed="$(git diff --name-only "$base" HEAD || true)"
  fi

  local restarts=()
  local install_re='^apps/[a-z-]+/package(-lock)?\.json$'

  # --- frontend ----------------------------------------------------------
  if $force || echo "$changed" | grep -qE '^apps/frontend/'; then
    if $force || echo "$changed" | grep -qE "$install_re" || echo "$changed" | grep -qE '^apps/frontend/package'; then
      log "Installing frontend dependencies"
      (cd apps/frontend && "${npm[@]}" npm install --no-audit --no-fund)
    fi
    log "Building frontend"
    (cd apps/frontend && "${npm[@]}" npm run build)
    restarts+=(robocall-frontend)
  fi

  # --- callbot backend ---------------------------------------------------
  if $force || echo "$changed" | grep -qE '^apps/callbot-backend/'; then
    if $force || echo "$changed" | grep -qE '^apps/callbot-backend/package'; then
      log "Installing callbot-backend dependencies"
      (cd apps/callbot-backend && "${npm[@]}" npm install --no-audit --no-fund)
    fi
    log "Building callbot-backend"
    (cd apps/callbot-backend && "${npm[@]}" npm run build)
    log "Applying database migrations"
    (cd apps/callbot-backend && "${npm[@]}" npm run db:push) || echo "  (db:push skipped/failed — check manually)"
    restarts+=(robocall-api)
  fi

  # --- telephony (no build step) ----------------------------------------
  if $force || echo "$changed" | grep -qE '^apps/telephony/'; then
    if $force || echo "$changed" | grep -qE '^apps/telephony/package'; then
      log "Installing telephony dependencies"
      (cd apps/telephony && "${npm[@]}" npm install --no-audit --no-fund)
    fi
    restarts+=(robocall-telephony)
  fi

  # --- systemd units -----------------------------------------------------
  if $force || echo "$changed" | grep -qE '^infra/systemd/'; then
    log "Installing systemd units"
    sudo cp infra/systemd/*.service /etc/systemd/system/
    sudo systemctl daemon-reload
    restarts+=(robocall-api robocall-frontend robocall-telephony)
  fi

  # --- restart -----------------------------------------------------------
  if [ ${#restarts[@]} -gt 0 ]; then
    mapfile -t restarts < <(printf '%s\n' "${restarts[@]}" | sort -u)
    if printf '%s\n' "${restarts[@]}" | grep -q '^robocall-telephony$'; then
      echo "  NOTE: restarting robocall-telephony interrupts in-flight calls."
    fi
    log "Restarting: ${restarts[*]}"
    sudo systemctl restart "${restarts[@]}"
    for s in "${restarts[@]}"; do
      echo "  $s: $(systemctl is-active "$s")"
    done
  else
    ok "No app changes — nothing to restart"
  fi

  # Record the deployed revision (group-writable: deploys run as any admin).
  git rev-parse HEAD > "$state_file"
  chmod g+w "$state_file"

  ok "Deploy complete"
}

case "${1:-}" in
  setup) shift; setup "$@" ;;
  *) deploy "${1:-}" ;;
esac
