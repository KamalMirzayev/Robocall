#!/usr/bin/env bash
# Robocall update: pulls the deploy branch into /opt/robocall, builds and restarts.
# Usage (on the server): cd ~/robocall && git fetch -q origin claude/project-thread-psbeww && git show origin/claude/project-thread-psbeww:deploy/update.sh | sudo bash
set -euo pipefail
BRANCH="claude/project-thread-psbeww"
SRC="${ROBOCALL_SRC:-$(getent passwd "${SUDO_USER:-toor}" | cut -d: -f6)/robocall}"
APP=/opt/robocall

echo "==> Kod: $SRC -> $APP"
sudo -u "${SUDO_USER:-toor}" git -C "$SRC" fetch -q origin "$BRANCH"
git -C "$APP" -c safe.directory='*' pull -q --ff-only "$SRC" "refs/remotes/origin/$BRANCH"
git -C "$APP" -c safe.directory='*' log --oneline -1
chown -R callbot:callbot "$APP"

echo "==> Frontend build"
(cd "$APP/apps/frontend" && sudo -u callbot -H npm ci --no-audit --no-fund --loglevel=error && sudo -u callbot -H npm run build >/tmp/robocall-frontend-build.log 2>&1) \
  || { echo "Frontend build alınmadı, son sətirlər:"; tail -30 /tmp/robocall-frontend-build.log; exit 1; }

echo "==> Backend build"
(cd "$APP/apps/callbot-backend" && sudo -u callbot -H npm ci --no-audit --no-fund --loglevel=error && sudo -u callbot -H npm run build >/tmp/robocall-backend-build.log 2>&1) \
  || { echo "Backend build alınmadı, son sətirlər:"; tail -30 /tmp/robocall-backend-build.log; exit 1; }

echo "==> Restart"
systemctl restart robocall-api robocall-frontend
for i in $(seq 1 20); do
  sleep 2
  if curl -fs localhost:4000/health >/dev/null; then
    echo "API: $(systemctl is-active robocall-api), frontend: $(systemctl is-active robocall-frontend)"
    echo HAZIR
    exit 0
  fi
done
echo "API cavab vermir. Son loq:"; journalctl -u robocall-api -n 30 --no-pager | grep -viE "token|secret|password|key="
exit 1
