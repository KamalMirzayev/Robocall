# Databases: Separation of Concerns (`callbot` vs `crm_ai`)

This system uses **two logical PostgreSQL databases on a single Postgres server**
(a host PostgreSQL 16 cluster, in both dev and production). They are owned by two
different applications and must be kept **disjoint** — the same table should never
live in both databases.

> **Golden rule:** No cross-database duplicate tables. Each table has exactly one
> owning database. Duplicating a table in both leads to silent data drift (two
> copies edited independently, no synchronization).

---

## The two databases

| | **`callbot`** | **`crm_ai`** |
|---|---|---|
| **Owning app** | Callbot backend (`callbot/apps/backend`, Drizzle ORM) + `frontend-unified` (Next.js) | CRM admin app (`app/src/server.js`, raw `pg`) |
| **Ports** | backend `:4000`, frontend `:3001` | `:8090` (+ AudioSocket/RTP `:10000`) |
| **Domain** | Dialer, customers, calls, campaigns, AI call analysis | Asterisk provisioning + CRM admin |
| **Schema managed by** | Drizzle migrations (`callbot/apps/backend/drizzle/`) | `postgres/init/*.sql` + self-bootstrap in `server.js` |

---

## Who owns which tables

### `callbot` database — dialer & AI domain
- `customers` — debtor/customer records
- `calls` — call sessions, transcripts, summaries, AI descriptions
- `campaigns`, `campaign_calls` — campaign definitions and per-customer execution state
- `agents` — AI agent definitions
- `telephony_jobs` — outbound dial queue
- `ai_token_usage` — Gemini/AI token accounting
- `app_users`, `app_sessions` — backend auth
- `instruction_templates` — **AI instruction/prompt content for campaigns**

### `crm_ai` database — Asterisk provisioning & CRM admin domain
- `sip_trunks`, `sip_accounts` — SIP/PJSIP endpoints
- `dialplan_rules` — routing rules
- `ivr_menus`, `ivr_options` — IVR trees
- `ai_settings` — CRM-app-level AI/telephony settings
- `crm_admin_auth` — CRM admin credentials

---

## Data flow / source of truth

### Asterisk configuration → `crm_ai` only
Asterisk does **not** use database realtime. It loads static config files that
`#include` generated fragments:

- `asterisk/config/pjsip.conf` → `#include custom/pjsip_dynamic.conf`
- `asterisk/config/extensions.conf` → `#include custom/extensions_dynamic.conf`

The CRM admin app (`app/src/server.js`, `renderConfig()`) reads
`sip_trunks` / `sip_accounts` / `dialplan_rules` / `ivr_menus` / `ivr_options`
from **`crm_ai`**, writes the `*_dynamic.conf` files into the shared `asterisk/custom/`
mount, and reloads Asterisk over AMI (`pjsip reload`, `dialplan reload`).

➡️ **`crm_ai` is the single source of truth for Asterisk telephony config.** The
callbot backend never writes Asterisk config and must not own these tables.

### AI call analysis → `callbot` only
The post-call analysis worker (`callbot/apps/backend/src/analysis-worker.ts`) stores
call descriptions in `callbot.calls` and builds its "memory" layer entirely from
PostgreSQL (short-term memory = latest description per customer; "similar calls" =
full-text search over `calls`). It does not depend on any `crm_ai` table.

### `instruction_templates` lives with `callbot`
Instruction templates are AI/campaign content — unrelated to Asterisk — so they
belong in the `callbot` database (created via Drizzle migration
`0014_instruction_templates.sql`). They are served by the callbot backend at
`GET/POST /api/instruction-templates` and edited via `frontend-unified` at
`/ai-bot/instruction-templates`. The CRM app (`crm_ai`) no longer stores or serves them.

---

## Guardrails against drift

The `postgres/init/` scripts that seed `crm_ai` are hardened so telephony/admin
tables can never leak into `callbot`:

- `\set ON_ERROR_STOP on` — a failed `\c crm_ai` aborts the script instead of
  silently continuing on the previous (`callbot`) connection.
- A `current_database()` guard after `\c crm_ai` raises unless connected to `crm_ai`.

If you add a new table, decide its **one** owning database up front:
- AI / dialer / campaign / customer data → `callbot` (add to Drizzle schema + a migration).
- Asterisk provisioning / CRM admin data → `crm_ai` (add to `postgres/init/`).

---

## Connections

| App | Env var | Value (dev) |
|---|---|---|
| Callbot backend | `DATABASE_URL` (`callbot/apps/backend/.env`) | `postgresql://callbot:***@127.0.0.1:5432/callbot` |
| CRM admin app | `DATABASE_URL` (`app/.env`) | `postgresql://callbot:***@127.0.0.1:5432/crm_ai` |

Both databases share one server, so a single `pg_dumpall` (or one server upgrade)
covers both — the two-database split is about **ownership boundaries**, not
operational overhead.
