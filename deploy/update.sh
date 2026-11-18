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
# The running panel breaks as soon as its .next folder is rebuilt under it, and it carries
# no calls: stop it, build from a clean .next, start it (the panel is down 1-2 minutes).
systemctl stop robocall-frontend
rm -rf "$APP/apps/frontend/.next"
(cd "$APP/apps/frontend" && sudo -u callbot -H npm run build >/tmp/robocall-frontend-build.log 2>&1) \
  || { echo "Frontend build alınmadı:"; tail -30 /tmp/robocall-frontend-build.log; systemctl start robocall-frontend; exit 1; }
systemctl start robocall-frontend

# A pause that was already there (a planned break) is left in place.
OWN_PAUSE=0
if [ ! -e "$PAUSE" ]; then
  sudo -u callbot touch "$PAUSE"
  OWN_PAUSE=1
fi
# Older API builds do not read the pause file: also hold the active campaigns for the wait.
HELD=$(sudo -u postgres psql -qtAX robocall_callbot -c "UPDATE campaigns SET status='paused' WHERE status='active' RETURNING id" 2>/dev/null | paste -sd, - || true)
release() {
  [ "$OWN_PAUSE" = 1 ] && rm -f "$PAUSE"
  if [ -n "$HELD" ]; then
    sudo -u postgres psql -qtAX robocall_callbot -c "UPDATE campaigns SET status='active' WHERE id IN ($HELD) AND status='paused'" >/dev/null 2>&1 || true
    HELD=""
  fi
}
trap release EXIT

# A job left 'dialing' for minutes (lost by a restart) is not a live call and must not hold the deploy.
active() {
  sudo -u postgres psql -qtAX robocall_callbot -c "SELECT count(*) FROM telephony_jobs WHERE (status IN ('pending','claimed','dialing') AND created_at > now() - interval '5 minutes') OR (status = 'answered' AND created_at > now() - interval '45 minutes')" 2>/dev/null || echo 0
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

# Voice tuning (listening): set in the services' .env files; only lines that differ are rewritten.
#  API: the bot waits 700 ms of silence before answering (was 250 ms, it cut customers off).
#  Telephony: quieter speech reaches the bot and the end of each phrase is not clipped.
TEL_CHANGED=0
setenv() { # file key value -> returns 0 if changed
  local f="$1" k="$2" v="$3"
  [ -f "$f" ] || { sudo -u callbot touch "$f"; chmod 600 "$f"; }
  grep -qx "$k=$v" "$f" && return 1
  sed -i "/^$k=/d" "$f"; echo "$k=$v" >> "$f"; return 0
}
API_ENV="$APP/apps/callbot-backend/.env"; TEL_ENV="$APP/apps/telephony/.env"
setenv "$API_ENV" GEMINI_VAD_SILENCE_DURATION_MS 700 || true
setenv "$API_ENV" GEMINI_VAD_PREFIX_PADDING_MS 200 || true
setenv "$API_ENV" GEMINI_VAD_END_SENSITIVITY low || true
setenv "$TEL_ENV" CALLBOT_INBOUND_SPEECH_RMS 450 && TEL_CHANGED=1
setenv "$TEL_ENV" CALLBOT_INBOUND_SPEECH_RELEASE_MS 1200 && TEL_CHANGED=1
setenv "$TEL_ENV" CALLBOT_INBOUND_SPEECH_MIN_FRAMES 4 && TEL_CHANGED=1
chown callbot:callbot "$API_ENV" "$TEL_ENV"

echo "==> Restart"
systemctl restart robocall-api
if [ "$TEL_CHANGED" = 1 ]; then echo "   telefoniya ayarları dəyişdi, robocall-telephony də yenidən başlayır"; systemctl restart robocall-telephony; sleep 5; fi
release
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
