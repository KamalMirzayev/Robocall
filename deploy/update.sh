#!/usr/bin/env bash
# Robocall update without cutting live calls:
#   1. pull and build while calls go on (the running services keep their loaded code),
#   2. stop starting new calls and wait until the calls in progress end,
#   3. restart, then let dialing resume.
# Usage (on the server):
#   cd ~/robocall && git fetch -q origin claude/project-thread-psbeww && git show origin/claude/project-thread-psbeww:deploy/update.sh | sudo bash
# ROBOCALL_DRAIN_MINUTES (default 20): longest wait for live calls before restarting anyway.
set -euo pipefail
BRANCH="claude/project-thread-psbeww"
OWNER="${SUDO_USER:-toor}"
SRC="${ROBOCALL_SRC:-$(getent passwd "$OWNER" | cut -d: -f6)/robocall}"
APP=/opt/robocall
PAUSE="$APP/.dialing-paused"
DRAIN_MIN="${ROBOCALL_DRAIN_MINUTES:-20}"

echo "==> Kod: $SRC -> $APP"
sudo -u "$OWNER" git -C "$SRC" fetch -q origin "$BRANCH"
git -C "$APP" -c safe.directory='*' pull -q --ff-only "$SRC" "refs/remotes/origin/$BRANCH"
git -C "$APP" -c safe.directory='*' log --oneline -1
chown -R callbot:callbot "$APP"

# npm ci only when the lock file changed, so running services keep their node_modules.
deps() {
  local dir="$1" mark="$1/node_modules/.lock-sha" sha
  sha=$(sha256sum "$dir/package-lock.json" | cut -d' ' -f1)
  if [ "$(cat "$mark" 2>/dev/null)" != "$sha" ]; then
    (cd "$dir" && sudo -u callbot -H npm ci --no-audit --no-fund --loglevel=error)
    echo "$sha" | sudo -u callbot tee "$mark" >/dev/null
  fi
}

echo "==> Build (zənglər davam edir)"
deps "$APP/apps/callbot-backend"
(cd "$APP/apps/callbot-backend" && sudo -u callbot -H npm run build >/tmp/robocall-backend-build.log 2>&1) \
  || { echo "Backend build alınmadı:"; tail -30 /tmp/robocall-backend-build.log; exit 1; }
deps "$APP/apps/frontend"
(cd "$APP/apps/frontend" && sudo -u callbot -H npm run build >/tmp/robocall-frontend-build.log 2>&1) \
  || { echo "Frontend build alınmadı:"; tail -30 /tmp/robocall-frontend-build.log; exit 1; }

# A pause that was already there (a planned break) is left in place.
OWN_PAUSE=0
if [ ! -e "$PAUSE" ]; then
  sudo -u callbot touch "$PAUSE"
  OWN_PAUSE=1
fi
trap '[ "$OWN_PAUSE" = 1 ] && rm -f "$PAUSE"' EXIT

active() {
  sudo -u postgres psql -qtAX robocall_callbot -c "SELECT count(*) FROM telephony_jobs WHERE status IN ('pending','claimed','dialing','answered') AND created_at > now() - interval '3 hours'" 2>/dev/null || echo 0
}
echo "==> Yeni zənglər dayandırıldı, aktiv zənglərin bitməsi gözlənilir (ən çox $DRAIN_MIN dəq)"
deadline=$(( $(date +%s) + DRAIN_MIN * 60 ))
while :; do
  n=$(active)
  [ "$n" = 0 ] && break
  if [ "$(date +%s)" -ge "$deadline" ]; then echo "   $DRAIN_MIN dəqiqə keçdi, $n zəng hələ davam edir, yenə də restart edilir"; break; fi
  echo "   aktiv zəng: $n"
  sleep 10
done

echo "==> Restart"
systemctl restart robocall-api robocall-frontend
for i in $(seq 1 20); do
  sleep 2
  if curl -fs localhost:4000/health >/dev/null; then
    echo "API: $(systemctl is-active robocall-api), frontend: $(systemctl is-active robocall-frontend)"
    [ "$OWN_PAUSE" = 1 ] && echo "Zənglər davam edir." || echo "Diqqət: əvvəlcədən qoyulmuş fasilə qalır ($PAUSE)."
    echo HAZIR
    exit 0
  fi
done
echo "API cavab vermir. Son loq:"; journalctl -u robocall-api -n 30 --no-pager | grep -viE "token|secret|password|key="
exit 1
