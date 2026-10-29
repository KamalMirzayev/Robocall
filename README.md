# Robocall: Unified AI Telephony Platform

A comprehensive **AI-powered telephony solution** for Azerbaijani debt collection combining real-time voice conversations via Google Gemini with advanced PBX configuration and monitoring.

## 🎯 Project Overview

This is an integrated system consisting of:

- **Callbot Backend** — AI voice agent engine with Gemini Live API integration, call recording, transcription, and outbound campaign management
- **Telephony Backend** — Asterisk PBX management and live call monitoring dashboard
- **Unified Frontend** — Single Next.js 14 application managing both Callbot and Telephony resources with seamless integration

## 🚀 Unified Frontend (New)

The project now features a **modern, unified Next.js frontend** (`/apps/frontend`) that replaces separate legacy frontends with a single application serving both systems:

### Key Features

✅ **Dashboard & Statistics** — Overview of calls, agents, customers, and telephony configuration
✅ **Call Management** — Real-time call history, live call monitoring, call initiation with SIP trunk selection
✅ **Agent Management** — Create, edit, and manage AI agent personas (tone, gender, description)
✅ **Customer Management** — Manage debtor records with debt amount and overdue tracking
✅ **Recording Browser** — Search and play call recordings with transcripts
✅ **Telephony Configuration** — Editable forms for SIP accounts, trunks, IVR menus, and dialplan rules
✅ **Dynamic Asterisk Reload** — "Generate & Reload" buttons to apply configuration changes instantly
✅ **AI API Configuration** — Setup integration with external AI services and webhooks
✅ **Session Authentication** — Dual-backend login with session persistence across both systems
✅ **Responsive Design** — Tailwind CSS dark theme optimized for desktop and tablet

### Technology Stack

| Layer    | Technology                                 |
| -------- | ------------------------------------------ |
| Frontend | Next.js 14.2.3, React 18.3.1, TypeScript 5 |
| Styling  | Tailwind CSS 3.4.0 (dark theme)            |
| State    | React Context API + Custom Hooks           |
| HTTP     | Axios with cookie authentication           |
| Build    | Standalone npm apps (one per service)      |

### Navigation Structure

```
Protected Routes (requires login):
├── /calls              — Live call history + initiate outbound calls
├── /agents             — AI agent management (CRUD)
├── /customers          — Customer/debtor management (CRUD)
├── /recordings         — Call recording browser with search
├── /telephony          — SIP accounts & trunks configuration (editable)
├── /ivr                — IVR menu configuration (editable)
├── /dialplan           — Dialplan rules configuration (editable)
├── /statistics         — System statistics dashboard
├── /ai-api             — AI API integration settings (form)
└── /admin              — (Reserved for future admin features)

Public Routes:
├── /login              — Dual-backend login form
└── /register           — New user registration
```

### Running the Unified Frontend

```bash
cd apps/frontend
npm install
npm run dev              # Development server on port 3001
```

The frontend automatically connects to:

- Callbot backend: `http://localhost:4000/api`
- telephony backend: `http://localhost:8090/api`

Both via proxy routes: `/api/callbot/*` and `/api/telephony-panel/*`

## 📊 System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│          Unified Next.js Frontend (Port 3001)              │
│                                                             │
│  Dashboard │ Calls │ Agents │ Customers │ Telephony │ Stats │
└────┬───────────────┬──────────────────┬────────────────────┘
     │               │                  │
  Callbot         Telephony              Shared
  Backend         Backend            Database
  (4000)          (8090)             (5432)
```

### Data Flow

**Inbound Call:**

1. External call → Asterisk (Telephony) receives via SIP/GSM gateway
2. Asterisk dialplan routes to Callbot WebSocket
3. Callbot connects to Google Gemini Live API
4. Call progress visible in Unified Frontend
5. Post-call: Recording, transcription, summary stored
6. Admin views call in Recordings page

**Outbound Call:**

1. Admin initiates from Unified Frontend
2. Callbot creates job in telephony_jobs table
3. Asterisk worker dials customer via SIP trunk
4. Same Gemini conversation as inbound
5. Admin monitors job status in Calls page

**Configuration Changes:**

1. Admin edits SIP accounts/trunks/IVR/dialplan in Unified Frontend
2. Changes saved to telephony backend (PostgreSQL)
3. Admin clicks "Generate & Reload" button
4. Asterisk configuration regenerated and reloaded via AMI
5. Changes take effect immediately (no service restart)

## 📁 Project Structure

```
/opt/robocall/
├── README.md                           ← You are here
├── deploy.sh / dev-deploy.sh           ← Pull → build → restart scripts
├── deploy-prod.sh                      ← First-time production installer
│
├── apps/
│   ├── telephony/                      ← telephony backend (Asterisk PBX management + monitoring API)
│   │   └── src/server.js               ← entry point (API-only; UI is apps/frontend)
│   │
│   ├── callbot-backend/                ← Callbot API + Gemini proxy
│   │   ├── src/
│   │   │   ├── index.ts               ← Main server
│   │   │   ├── ai-usage.ts            ← Token tracking
│   │   │   ├── recording.ts           ← Audio recording
│   │   │   ├── transcription.ts       ← Speech-to-text
│   │   │   ├── summary.ts             ← Call summaries
│   │   │   └── routes/                ← calls, agents, customers, ...
│   │   └── drizzle/                   ← Database migrations
│   │
│   └── frontend/                       ← Unified Next.js Frontend
│       ├── app/(protected)/            ← calls, agents, customers, recordings,
│       │                                ← telephony, ivr, dialplan, statistics, ...
│       ├── components/  hooks/  lib/  types/
│       └── package.json
│
├── infra/
│   ├── asterisk/                       ← Asterisk configuration
│   │   ├── config/                    ← pjsip.conf, extensions.conf, ari.conf, ...
│   │   └── custom/                    ← Dynamic configs generated by Telephony
│   ├── postgres/                       ← init SQL + postgresql.conf
│   ├── nginx/                          ← nginx-robocall.conf reverse-proxy template
│   ├── systemd/                        ← robocall-{api,frontend,telephony}.service
│   └── misc/                           ← asterisk-logrotate.conf
│
├── docs/                               ← DEPLOYMENT.md + API documentation
├── recordings/                         ← Call recordings (runtime, gitignored)
└── backups/                            ← Historical SQL dumps
```

## 🔐 Authentication

The Unified Frontend supports **dual-backend authentication**:

1. **Login with Callbot credentials** (username + password)

   - Session stored via httpOnly cookie: `robocall_session`
   - User role and permissions loaded from Callbot backend
2. **Cross-backend access**

   - After Callbot login, credentials forwarded to telephony backend
   - Session established for Telephony resources
   - Single sign-on experience across both systems

Both backends must be running for full functionality.

## 🛠️ Development Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 16
- Asterisk
- Nginx (production reverse proxy)

### Quick Start

```bash
# Install dependencies per app (all npm standalone)
(cd apps/callbot-backend && npm install)   # callbot API (port 4000)
(cd apps/telephony && npm install)         # telephony backend (port 8090)
(cd apps/frontend && npm install)          # unified frontend (port 3001)

# Start each service (dev)
(cd apps/callbot-backend && npm run dev)
(cd apps/telephony && npm start)
(cd apps/frontend && npm run dev)
```

Access the frontend at: `http://localhost:3001`.

### Environment Variables

**Frontend** (`.env.local` in `apps/frontend`):

```
NEXT_PUBLIC_CALLBOT_API=http://localhost:4000
NEXT_PUBLIC_TELEPHONY_API=http://localhost:8090
```

**Callbot Backend** (.env):

```
PORT=4000
DATABASE_URL=postgresql://user:password@localhost:5432/callbot
GEMINI_API_KEY=your-key-here
```

**Telephony Backend** (.env):

```
PORT=8090
DATABASE_URL=postgresql://user:password@localhost:5432/robocall_crm
ASTERISK_AMI_HOST=localhost
ASTERISK_AMI_PORT=5039
```

## 📚 Documentation

For detailed technical information about:

- **Database schema** (complete table references)
- **API endpoints** (full REST endpoint listing)
- **Asterisk integration** (AMI/ARI, call flows)
- **Security model** (authentication, authorization)
- **Deployment** (systemd, Nginx, environment config)

→ See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the full systemd + Nginx deployment walkthrough, and **[docs/agents.md](docs/agents.md)** / **[docs/calls.md](docs/calls.md)** / **[docs/customers.md](docs/customers.md)** for API documentation.

## 🚀 Deployment

### Systemd + Nginx (Production)

The stack runs as three systemd services behind a host-level Nginx reverse proxy — no containers involved.

```bash
# Copy service units and reload systemd
sudo cp infra/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now robocall-api robocall-frontend robocall-telephony

# Install the Nginx reverse proxy config (substitute your domain placeholders)
sudo sed -e "s/__FRONTEND_DOMAIN__/your.domain/g" \
         -e "s/__API_DOMAIN__/api.your.domain/g" \
         -e "s/__TELEPHONY_DOMAIN__/telephony.your.domain/g" \
         infra/nginx/nginx-robocall.conf > /etc/nginx/sites-available/robocall
sudo ln -sf /etc/nginx/sites-available/robocall /etc/nginx/sites-enabled/robocall
sudo nginx -t && sudo systemctl reload nginx
```

This runs:

- PostgreSQL (host service)
- Asterisk PBX (host service)
- telephony backend (port 8090, `robocall-telephony.service`)
- Callbot backend (port 4000, `robocall-api.service`)
- Unified frontend (port 3001, `robocall-frontend.service`)
- Nginx reverse proxy (host, terminates TLS)

Full step-by-step walkthrough (service user, `/opt` layout, log rotation): **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. For fresh-server automated installs, use `sudo ./deploy-prod.sh`.

### Production Deployment

For production use:

1. Set all environment variables securely
2. Enable HTTPS on Nginx (see `infra/nginx/nginx-robocall.conf`)
3. Configure firewall rules
4. Use managed PostgreSQL service
5. Scale Callbot backend as needed (stateless, load-balanceable)

## 🐛 Troubleshooting

### Frontend can't connect to backends

- Verify backends running: `sudo systemctl status robocall-api robocall-telephony robocall-frontend`
- Check listening ports: `sudo ss -tlnp | grep -E ':(3001|4000|8090)'`
- Verify network connectivity: `curl http://localhost:4000/` and `curl http://localhost:8090/`

### Login fails

- Ensure PostgreSQL is running and initialized
- Check database credentials in backend .env files
- View backend logs: `sudo journalctl -u robocall-api -n 100`

### Asterisk config changes not applying

- Check "Generate & Reload" button feedback message
- Verify Asterisk AMI credentials in telephony backend
- View Asterisk logs: `sudo journalctl -u asterisk -n 100`

### One-way or no audio on a SIP trunk (signaling connects, but no voice)

- Don't assume it's the SIP provider just because signaling (INVITE/183/200/ACK) looks healthy — verify with an independent softphone using the same trunk credentials before concluding it's their fault.
- If this server (or a replica) is hosted on a cloud VM behind NAT (e.g. VMware Cloud Director), a missing DNAT rule or a whole-subnet SNAT/masquerade for the RTP UDP port range (`rtp.conf`'s `rtpstart`/`rtpend`) at the **hypervisor/Edge Gateway level** will silently drop inbound RTP even when the guest OS's own `ufw` is wide open. See `infra/asterisk/ASTERISK_CONFIG_REVIEW.md` §6 for the exact NAT rules required and how this was diagnosed (2026-08-06 incident).

### Call recording not working

- Verify the recordings directory exists and is writable: `ls -la recordings/` (path set by `RECORDINGS_DIR` in `apps/callbot-backend/.env`)
- View Callbot backend logs for recording errors: `sudo journalctl -u robocall-api -f`

## 📞 Support & Contact

For issues or questions:

1. Review API documentation in `docs/` (agents.md, calls.md, customers.md)
2. Examine logs: `sudo journalctl -u robocall-api -u robocall-telephony -u robocall-frontend -f`

## 📄 License

[License information if applicable]

---

**Last Updated:** July 2026
**Frontend Version:** Next.js 14.2.3
**Status:** Production Ready
