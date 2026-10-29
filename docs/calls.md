# Calls

A call is a recorded session — created automatically when an AI agent calls a customer. The REST API is read-only; writes happen exclusively through the WebSocket proxy.

## Database Schema

| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | serial PK | — | auto | Unique identifier |
| `agentId` | integer FK | no | — | → `agents.id` |
| `customerId` | integer FK | no | — | → `customers.id` |
| `startedAt` | timestamp | yes | now() | Call start time |
| `endedAt` | timestamp | no | — | Call end time |
| `durationSeconds` | integer | no | — | Call duration in seconds |
| `transcript` | text | no | — | Full conversation text (Gemini output) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/calls` | List all calls (agent + customer names joined) |
| `GET` | `/api/calls/:id` | Get a single call (includes transcript) |

> No POST / PUT / DELETE — calls are created only via WebSocket.

## Frontend

- **Hook:** `useCalls()` — [`apps/frontend/src/hooks/useCalls.ts`](../apps/frontend/src/hooks/useCalls.ts)
- **Screens:**
  - `CallsList` — [`apps/frontend/src/screens/CallsList.tsx`](../apps/frontend/src/screens/CallsList.tsx) — past calls list
  - `CallDetail` — [`apps/frontend/src/screens/CallDetail.tsx`](../apps/frontend/src/screens/CallDetail.tsx) — transcript + metadata
  - `CallScreen` — [`apps/frontend/src/screens/CallScreen.tsx`](../apps/frontend/src/screens/CallScreen.tsx) — active call UI

## Call Creation Flow (WebSocket)

```
Frontend                Backend                        Gemini Live API
   |                       |                                |
   |-- WS open(agentId,    |                                |
   |          customerId) ->|                                |
   |                       |-- DB: fetch agent + customer   |
   |                       |-- buildSystemInstruction()     |
   |                       |-- DB: INSERT call row          |
   |                       |-- WS connect ------------------>|
   |                       |                                |
   |<-- audio stream ------>|<-- audio stream -------------->|
   |                       |                                |
   |-- WS close ----------->|                                |
   |                       |-- WS close -------------------->|
   |                       |-- DB: UPDATE call              |
   |                       |   (endedAt, duration,          |
   |                       |    transcript)                 |
```

1. Frontend opens a WebSocket and sends `agentId` + `customerId`.
2. Backend fetches agent and customer records from the DB.
3. `buildSystemInstruction()` builds the system prompt from both records.
4. A new row is inserted into `calls` with `startedAt` set.
5. A WebSocket connection to Gemini Live API is opened and audio is bridged.
6. When the call ends, `endedAt`, `durationSeconds`, and `transcript` are written to the DB.

## Relationships

```
agents (id)
   │ 1
   │
   │ N
calls (agentId FK, customerId FK)
   │ N
   │
   │ 1
customers (id)
```

- [Agent](./agents.md) → Call: 1:N — one agent can have many calls
- [Customer](./customers.md) → Call: 1:N — one customer can have many calls
- Call → Agent + Customer: each call belongs to exactly one agent and one customer

## File References

- Schema: [`apps/backend/src/db/schema.ts:25`](../apps/backend/src/db/schema.ts#L25)
- Routes: [`apps/backend/src/routes/calls.ts`](../apps/backend/src/routes/calls.ts)
- WebSocket handler: [`apps/backend/src/index.ts:26`](../apps/backend/src/index.ts#L26)
- Gemini proxy: [`apps/backend/src/proxy/gemini.ts`](../apps/backend/src/proxy/gemini.ts)
- Frontend types: [`apps/frontend/src/types.ts:21`](../apps/frontend/src/types.ts#L21)
