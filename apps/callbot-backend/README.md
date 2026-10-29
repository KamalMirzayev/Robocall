# Callbot — Backend

## Stack
- Node.js + Express 4 + TypeScript
- `ws` — WebSocket server
- `drizzle-orm` + `postgres` — type-safe DB access
- `@google/genai` — Gemini Live API (server-side only)

## Key Files

### `src/index.ts`
Express HTTP server + WebSocketServer on `/ws/gemini`. On each WS connection calls `handleGeminiProxy`.

### `src/routes/telephony.ts`
Server-side telephony contract for CRM/Asterisk:
- `POST /api/telephony/resolve`
- accepts `callerPhone` or `callerId`, optional `customerId`, optional `agentId`
- resolves customer by normalized phone when `customerId` is absent
- resolves agent by `agentId`, `DEFAULT_TELEPHONY_AGENT_ID`, or first available agent
- returns `{ customerId, agentId, wsUrl, customer, agent }`
- `POST /api/telephony/jobs` creates a physical-call job from the GUI
- `GET /api/telephony/jobs/next`, `POST /api/telephony/jobs/:id/complete`, and `POST /api/telephony/jobs/:id/fail` are used by the outbound telephony worker
- worker endpoints require `Authorization: Bearer $TELEPHONY_WORKER_TOKEN`

### `src/proxy/gemini.ts`
Bridges frontend WS ↔ Gemini Live session:
- Opens Gemini session on WS connect
- Frontend sends `{ type: "audio", data: base64 }` → forwarded to Gemini
- Gemini audio chunks → `{ type: "audio", data: base64 }` to frontend
- Gemini transcription → `{ type: "transcription", role, text }` to frontend
- System instruction: built dynamically from agent (name, company, gender→voice, tone) + customer data

### `src/db/schema.ts`
Four tables:
- `agents` — id, email, name, role, phone_whatsapp, company_name, gender, tone, created_at
- `customers` — id, name, surname, father_name, debt_amount, overdue_days, phone, created_at
- `calls` — id, agent_id, customer_id, started_at, ended_at, duration_seconds, transcript
- `telephony_jobs` — queued physical-call jobs claimed by telephony workers

## Environment (`.env`)
```
DATABASE_URL=postgresql://callbot:callbot@localhost:5432/callbot
GEMINI_API_KEY=...   # Required. Never sent to frontend.
PORT=4000
TELEPHONY_WS_BASE_URL=wss://robocall.az/ws/gemini
DEFAULT_TELEPHONY_AGENT_ID=1
TELEPHONY_WORKER_TOKEN=... # Required for telephony pull/queue worker endpoints
```

## Dev Commands
```bash
pnpm dev           # tsx watch src/index.ts — port 4000
pnpm build         # tsc → dist/
pnpm db:generate   # Generate migration file from schema changes
pnpm db:studio     # drizzle-kit studio (DB GUI)
pnpm check-types
pnpm lint
```

## Constraints
- No frontend access to `GEMINI_API_KEY` — key stays in `.env` only
- `drizzle.config.ts` is in root of `apps/backend/` (not `src/`) — included in tsconfig explicitly
- Migrations run automatically on app start via `migrate()` in `src/db/index.ts`
- After schema changes: run `db:generate` → commit the new file in `drizzle/`
