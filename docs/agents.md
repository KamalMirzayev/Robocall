# Agents

An agent is a call center operator persona. It defines the identity of the AI voice that calls customers. The system instruction sent to Gemini is built from the agent's configuration.

## Database Schema

| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | serial PK | — | auto | Unique identifier |
| `name` | varchar(255) | yes | — | Agent's name (used when AI introduces itself) |
| `role` | varchar(50) | yes | `agent` | Job role (e.g. `collector`, `agent`) |
| `phoneWhatsapp` | varchar(50) | no | — | WhatsApp number (given to customer during call) |
| `companyName` | varchar(255) | no | — | Company name (used in AI dialogue) |
| `gender` | varchar(10) | no | `female` | Gemini voice gender (`male` / `female`) |
| `tone` | varchar(20) | no | `neutral` | Speaking tone (`neutral`, `friendly`, `strict`) |
| `createdAt` | timestamp | — | now() | Creation timestamp |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents` | List all agents |
| `POST` | `/api/agents` | Create a new agent |
| `PUT` | `/api/agents/:id` | Update an agent |
| `DELETE` | `/api/agents/:id` | Delete an agent |

## Frontend

- **Hook:** `useAgents()` — [`apps/frontend/src/hooks/useAgents.ts`](../apps/frontend/src/hooks/useAgents.ts)
- **Screen:** `AgentSelector` — [`apps/frontend/src/screens/AgentSelector.tsx`](../apps/frontend/src/screens/AgentSelector.tsx)

## Flow

1. User selects an agent on the `AgentSelector` screen.
2. The selected agent ID is sent to the backend when the WebSocket connection opens.
3. Backend passes agent data into the Gemini system prompt inside `buildSystemInstruction()`: name, company name, tone, gender, WhatsApp number.
4. Gemini speaks as that agent's persona throughout the call.

> **Relationship:** Agent → [Calls](./calls.md) (1:N). One agent can have many calls. Agents have no direct relationship with [Customers](./customers.md) — the link exists only through Calls.

## File References

- Schema: [`apps/backend/src/db/schema.ts:3`](../apps/backend/src/db/schema.ts#L3)
- Routes: [`apps/backend/src/routes/agents.ts`](../apps/backend/src/routes/agents.ts)
- System prompt builder: [`apps/backend/src/proxy/gemini.ts:105`](../apps/backend/src/proxy/gemini.ts#L105)
- Frontend types: [`apps/frontend/src/types.ts:11`](../apps/frontend/src/types.ts#L11)
