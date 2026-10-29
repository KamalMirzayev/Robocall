# Robocall

A modern Next.js 14.2.3 frontend for Robocall voice operations and telephony management in a single admin dashboard.

## Features

- **Authentication & RBAC** — JWT-based auth with role-based access control (admin/manager/operator/viewer)
- **Dark Mode Dashboard** — Professional UI with Tailwind CSS
- **Callbot Integration** — Live calls, agents, customers, recordings
- **Telephony Integration** — SIP accounts, trunks, dialplan, IVR, statistics
- **Responsive Design** — Mobile-friendly sidebar navigation
- **Type-Safe** — Full TypeScript support

## Project Structure

```
app/
├── (auth)/              # Login/register pages
├── (protected)/         # Role-gated dashboard
│   ├── calls/          # Live calls monitoring
│   ├── agents/         # Agent management
│   ├── customers/      # Customer management
│   ├── recordings/     # Call recordings
│   ├── telephony/      # SIP, trunks, dialplan, IVR
│   └── admin/          # Admin settings
├── api/                # API routes for auth & proxying
└── layout.tsx          # Root layout
components/
├── ui/                 # shadcn/ui components
├── layout/             # AppShell, sidebar, header
├── callbot/           # Callbot-specific components
└── telephony/         # telephony-specific components
lib/
├── auth.tsx           # Authentication context
├── api-client.ts      # Axios HTTP client
├── rbac.ts            # Role-based access control
└── hooks/             # Custom React hooks
types/
├── auth.ts            # Auth types
├── callbot.ts         # Callbot data types
└── telephony.ts       # telephony data types
```

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Navigate to frontend directory
cd apps/frontend

# Install dependencies
npm install

# Create environment file
cp .env.example .env.local

# Update environment variables
# NEXT_PUBLIC_CALLBOT_API=http://localhost:4000
# NEXT_PUBLIC_TELEPHONY_API=http://localhost:8090
```

### Development

```bash
# Start development server (port 3001)
npm run dev

# In another terminal, start both backends:
# - Callbot backend on port 4000
# - telephony backend on port 8090
```

Visit `http://localhost:3001/login` and login with:
- **Username**: admin
- **Password**: password

### Demo Credentials

| Username | Password | Role |
|----------|----------|------|
| admin | password | Admin |
| manager | password | Manager |
| operator | password | Operator |

## Available Pages

### Callbot (Call Center)
- `/calls` — Live calls monitor
- `/agents` — Agent management
- `/customers` — Customer list & bulk import
- `/recordings` — Call recordings browser

### Telephony Tools
- `/telephony` — SIP accounts, trunks, dialplan, IVR config
- `/telephony/live-monitor` — Live system monitoring
- `/telephony/statistics` — Call statistics & Excel export

### Admin
- `/admin` — System settings & user management

### Dashboard
- `/` — Overview with stats & quick navigation

## Build & Deployment

Runs as a systemd service (`robocall-frontend.service`) behind a host-level Nginx reverse proxy — see [../../docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md) for the full deployment walkthrough.

### Production Build

```bash
# Build
npm run build

# Start
npm start
```

## API Endpoints

### Authentication
- `POST /api/auth/login` — Login with username/password
- `GET /api/health` — Health check

### Proxy Routes
- `/api/callbot/*` — Routes to Callbot backend (port 4000)
- `/api/telephony-panel/*` — Routes to telephony backend (port 8090)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_CALLBOT_API` | http://localhost:4000 | Callbot backend URL |
| `NEXT_PUBLIC_TELEPHONY_API` | http://localhost:8090 | telephony backend URL |
| `NEXT_PUBLIC_API_URL` | http://localhost:3001/api | Frontend API URL |
| `NODE_ENV` | development | Environment (development/production) |
| `PORT` | 3001 | Server port |

## Technologies

- **Next.js 14.2.3** — React framework with App Router
- **TypeScript** — Type-safe development
- **Tailwind CSS 3.4.0** — Utility-first CSS
- **Radix UI** — Headless UI components
- **React Hook Form** — Form state management
- **Zod** — Schema validation
- **Axios** — HTTP client
- **Framer Motion** — Animations
- **Lucide React** — Icons

## Development

### Type Checking
```bash
npm run type-check
```

### Linting
```bash
npm run lint
```

## Features (Roadmap)

- [x] Phase 1: Project scaffold, routing, auth layout
- [ ] Phase 2: JWT authentication & RBAC complete
- [ ] Phase 3: Callbot screens with live WebSocket integration
- [ ] Phase 4: Telephony tools with Asterisk AMI/ARI
- [ ] Phase 5: Dashboard with real-time statistics
- [ ] Phase 6: API proxy & full backend integration

## Contributing

1. Create a feature branch
2. Make changes
3. Test locally with `npm run dev`
4. Submit pull request

## License

Proprietary — Internal use only
