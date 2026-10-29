# Deployment Guide — Robocall Platform

Target: **Ubuntu 24.04** (bare metal or VM). Each customer organization gets its own dedicated instance — no shared multi-tenant components.

## Architecture (per instance)

```
Public IP ── nginx (80/443, TLS termination)
              ├── /                    → frontend        (127.0.0.1:3001)  Next.js 14.2.3 SSR
              ├── /api                 → callbot-backend (127.0.0.1:4000)  Express + Gemini WS
              └── /api/telephony-panel → telephony       (127.0.0.1:8090)  Express + AMI/ARI

PostgreSQL 16/17            (127.0.0.1:5432)  databases: robocall_callbot, robocall_crm
Asterisk PBX                (0.0.0.0:5060)    PJSIP, AMI:5039, ARI:8088
ffmpeg                      (on-demand)       recording post-processing
```

All app services run as the `callbot` system user, managed by systemd. Only nginx and Asterisk listen on public interfaces; everything else is loopback-only.

---

## Server Sizing

### Minimal — 2 vCPU / 4 GB RAM / 40 GB SSD

For small orgs with **≤ 5 concurrent calls**, light AI usage, evaluation/pilot deployments.

**Required tuning** (edit systemd units before starting):
```
# robocall-api.service
Environment="NODE_OPTIONS=--max-old-space-size=1024"

# robocall-telephony.service
Environment="NODE_OPTIONS=--max-old-space-size=512"

# robocall-frontend.service
Environment="NODE_OPTIONS=--max-old-space-size=512"
```
And in `/etc/postgresql/*/main/postgresql.conf`:
```
shared_buffers = 128MB
```
Without these reductions the stack **will** OOM under load. Disk covers OS (~10 GB) + apps + ~25 GB of recordings (~10k calls at 64kbps MP3). Add 2 GB swap as a safety valve.

**Risk**: concurrent Gemini WebSocket sessions + ffmpeg post-processing + a DB query peak can still trigger the OOM killer. Suitable only for pilot/testing orgs.

### Suggested — 4 vCPU / 8 GB RAM / 80 GB SSD

For typical orgs with **5–20 concurrent calls**. **Recommended starting point for any paying customer.**

Default heap sizes work as-is:
| Service | Heap | Approx. real usage |
|---|---|---|
| callbot-backend (robocall-api) | 2048 MB | ~2.5 GB |
| telephony (robocall-telephony) | 2048 MB | ~2.5 GB |
| frontend (robocall-frontend) | 1024 MB | ~1.3 GB |
| PostgreSQL | — | ~1 GB |
| Asterisk | — | ~300 MB |
| nginx + OS | — | ~700 MB |
| **Total** | | **~8.3 GB** |

4 vCPUs handle parallel ffmpeg encodes + Gemini streams + Asterisk RTP. Disk: 80 GB covers OS + apps + ~50 GB of recordings (~20k calls). Add 4 GB swap.

### Heavy — 8 vCPU / 16 GB RAM / 160 GB+ SSD

For high-volume orgs with **20–50+ concurrent calls**, or all AI features enabled (post-call summaries, call memory, analysis worker).

- Bump PostgreSQL `shared_buffers` to 4 GB.
- CPU headroom for simultaneous Gemini streams + ffmpeg transcodes.
- Consider a separate volume for `/opt/robocall/recordings` to isolate recording I/O.
- Increase `max_connections` in PostgreSQL as needed (default in deploy script: 200).

### General Notes

- **SSD required** — PostgreSQL and ffmpeg both degrade significantly on spinning disk.
- **Swap**: 2 GB (minimal), 4 GB (suggested), 8 GB (heavy) — safety valve for ffmpeg spikes.
- **Network**: instance needs a public IP. SIP/RTP latency to the trunk provider matters more than bandwidth. Budget ~100 kbps per concurrent call for signaling + RTP.
- **Scaling model**: horizontal (more orgs = more VMs). No resource pooling across tenants — this keeps data isolation simple.
- **Cost-saving**: If a customer only needs the callbot (no PBX self-management), drop Asterisk + the telephony backend, saving ~1 GB RAM and 1 vCPU.
- **Recording storage**: at 64kbps MP3, a 5-minute call ≈ 2.4 MB. 1,000 calls ≈ 2.4 GB. Size disk according to your retention policy.

---

## One-Command Production Install

For a fresh Ubuntu 24.04 server:

```bash
sudo mkdir -p /opt/robocall
sudo git clone https://github.com/easgarli/robocall.git /opt/robocall
cd /opt/robocall
sudo ./deploy-prod.sh
```

The script is idempotent for most steps. It installs and configures:

1. **System packages**: asterisk, nginx, ffmpeg, certbot, ufw, build-essential
2. **Node.js 20.x** (if not present)
3. **PostgreSQL 17** from the PGDG repo (or uses existing install if detected)
4. **Asterisk PBX** — copies static config from `infra/asterisk/config/`, seeds empty dynamic configs, adds the `callbot` user to the `asterisk` group
5. **App services** — installs npm deps, builds, runs `db:push`, installs systemd units
6. **nginx** — reverse proxy config for the instance's three domains (prompted; template `infra/nginx/nginx-robocall.conf` with placeholders)
7. **Let's Encrypt SSL** — certbot with auto-renewal
8. **ufw** — OpenSSH + 80/tcp + 443/tcp only; app ports stay loopback-only

### Pre-flight Checklist

Before running `deploy-prod.sh`:

- [ ] Point DNS A records to the server's public IP for the three instance domains (frontend / API / telephony — the script prompts for them; each customer instance gets its own domains)
- [ ] Set `ASTERISK_TRUNK_PROVIDER_IP` env var if you know the SIP trunk IP (otherwise SIP/RTP ports stay closed)
- [ ] Set `LETSENCRYPT_EMAIL` env var (defaults to `e.asgarli@gmail.com`)

### Post-install Steps

1. **Set Gemini API key** in `apps/callbot-backend/.env` (or via Telephony → AI API in the UI), then: `systemctl restart robocall-api`
2. **Configure SIP trunk** — log into the UI (Telephony), add your SIP trunk/GSM gateway, click "Generate & Reload" to populate `/etc/asterisk/custom/*.conf`
3. **Open SIP/RTP** — once you know the trunk provider's public IP: `sudo ufw allow from <TRUNK_IP> to any port 5060 proto udp` and `sudo ufw allow from <TRUNK_IP> to any port 11000:11100 proto udp`

---

## Manual Deployment (without deploy-prod.sh)

### Prerequisites

```bash
apt-get update && apt-get install -y curl git build-essential ffmpeg nginx \
  asterisk certbot python3-certbot-nginx ufw ca-certificates
```

### Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

### PostgreSQL 17

```bash
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
apt-get update && apt-get install -y postgresql-17 postgresql-contrib-17
```

### Service User

```bash
useradd -r -m -d /home/callbot -s /bin/false callbot
usermod -aG asterisk callbot
mkdir -p /var/log/robocall/backend /var/log/robocall/frontend /var/log/robocall/telephony
chown -R callbot:callbot /var/log/robocall
```

### Database

```bash
sudo -u postgres createuser -P callbot  # set a strong password
sudo -u postgres createdb -O callbot robocall_callbot
psql -h 127.0.0.1 -U callbot -d robocall_callbot -f infra/postgres/init/001_schema.sql
psql -h 127.0.0.1 -U callbot -d robocall_callbot -f infra/postgres/init/002_create_robocall_crm_db.sql
```

### Environment Files

Create three `.env` files as shown in `deploy-prod.sh`'s `write_env_files()` function:
- `apps/callbot-backend/.env`
- `apps/telephony/.env`
- `apps/frontend/.env.production`

### Build & Install Services

```bash
# Build
cd apps/frontend && sudo -u callbot -H npm install && sudo -u callbot -H npm run build
cd apps/callbot-backend && sudo -u callbot -H npm install && sudo -u callbot -H npm run build && sudo -u callbot -H npm run db:push
cd apps/telephony && sudo -u callbot -H npm install

# Install systemd units
cp infra/systemd/robocall-api.service /etc/systemd/system/
cp infra/systemd/robocall-frontend.service /etc/systemd/system/
cp infra/systemd/robocall-telephony.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now robocall-api robocall-frontend robocall-telephony
```

### Nginx

```bash
cp infra/nginx/nginx-robocall.conf /etc/nginx/sites-available/robocall.az
ln -sf /etc/nginx/sites-available/robocall.az /etc/nginx/sites-enabled/robocall.az
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
certbot --nginx --redirect -d robocall.az -d api.robocall.az -d telephony.robocall.az
```

---

## Routine Deploy (already-provisioned server)

```bash
./deploy.sh   # git pull → npm install → npm run build → install units → systemctl restart
```

---

## Service Management

```bash
# Status
systemctl status robocall-api robocall-telephony robocall-frontend

# Logs
journalctl -u robocall-api -u robocall-telephony -u robocall-frontend -f

# Restart after config change
systemctl restart robocall-api

# Check ports
ss -tlnp | grep -E ':(3001|4000|8090|5432)'
```

---

## Port Map

| Port | Service | Public? |
|------|---------|---------|
| 80/443 | nginx (HTTPS) | Yes |
| 3001 | Next.js frontend | Loopback only |
| 4000 | Callbot backend | Loopback only |
| 8090 | Telephony backend | Loopback only |
| 5432 | PostgreSQL | Loopback only |
| 5060/udp | Asterisk PJSIP | Yes (trunk provider IP only via ufw) |
| 5039 | Asterisk AMI | Loopback only |
| 8088 | Asterisk ARI | Loopback only |
| 11000–11100/udp | Asterisk RTP | Yes (trunk provider IP only via ufw) |

---

## Key Files

| File | Purpose |
|------|---------|
| `infra/systemd/robocall-api.service` | systemd unit, callbot backend (heap: 2048 MB) |
| `infra/systemd/robocall-telephony.service` | systemd unit, telephony backend (heap: 2048 MB) |
| `infra/systemd/robocall-frontend.service` | systemd unit, frontend (heap: 1024 MB) |
| `infra/nginx/nginx-robocall.conf` | nginx reverse proxy template |
| `infra/misc/asterisk-logrotate.conf` | Asterisk log rotation |
| `apps/callbot-backend/.env` | Callbot backend secrets + AI config |
| `apps/telephony/.env` | Telephony backend secrets + Asterisk creds |
| `apps/frontend/.env.production` | Frontend API URLs |
| `infra/asterisk/config/` | Asterisk static config (copied to /etc/asterisk) |
| `infra/asterisk/custom/` | Dynamic config placeholders (written by telephony backend at runtime) |
| `infra/postgres/init/` | Database schema migrations |
