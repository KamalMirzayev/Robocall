# Customers

A customer is a debtor — the person the AI agent calls. The customer's debt information is injected into the system instruction sent to Gemini so the AI can speak with full context.

## Database Schema

| Column | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | serial PK | — | auto | Unique identifier |
| `name` | varchar(255) | yes | — | First name |
| `surname` | varchar(255) | yes | — | Last name |
| `fatherName` | varchar(255) | no | — | Patronymic |
| `debtAmount` | decimal(10,2) | yes | `0` | Outstanding debt (currency) |
| `overdueDays` | integer | yes | `0` | Number of overdue days |
| `phone` | varchar(50) | no | — | Phone number |
| `createdAt` | timestamp | — | now() | Creation timestamp |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/customers` | List all customers |
| `GET` | `/api/customers/:id` | Get a single customer |
| `POST` | `/api/customers` | Create a new customer |
| `PUT` | `/api/customers/:id` | Update a customer |
| `DELETE` | `/api/customers/:id` | Delete a customer |

## Frontend

- **Hook:** `useCustomers()` — [`apps/frontend/src/hooks/useCustomers.ts`](../apps/frontend/src/hooks/useCustomers.ts)
- **Screens:**
  - `CustomerList` — [`apps/frontend/src/screens/CustomerList.tsx`](../apps/frontend/src/screens/CustomerList.tsx) — list + CRUD
  - `AgentSelector` — [`apps/frontend/src/screens/AgentSelector.tsx`](../apps/frontend/src/screens/AgentSelector.tsx) — customer selection before a call

## Flow

1. User creates / edits customers in `CustomerList`.
2. A customer is selected in `AgentSelector` before initiating a call.
3. When the call starts, the backend passes `debtAmount`, `overdueDays`, `name`, `surname`, and `fatherName` to `buildSystemInstruction()`.
4. Gemini uses this context to speak with the customer about their debt.

> **Relationship:** Customer → [Calls](./calls.md) (1:N). One customer can have many call history entries. Customers have no direct relationship with [Agents](./agents.md) — the link exists only through Calls.

## File References

- Schema: [`apps/backend/src/db/schema.ts:14`](../apps/backend/src/db/schema.ts#L14)
- Routes: [`apps/backend/src/routes/customers.ts`](../apps/backend/src/routes/customers.ts)
- System prompt builder: [`apps/backend/src/proxy/gemini.ts:105`](../apps/backend/src/proxy/gemini.ts#L105)
- Frontend types: [`apps/frontend/src/types.ts:1`](../apps/frontend/src/types.ts#L1)
