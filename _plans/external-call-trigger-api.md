# External Call-Trigger API (mobile app → Robocall)

## Context

A customer's mobile app lets a consumer self-register and provide data (incl. phone
number). We want that mobile app's backend to call into Robocall, server-to-server,
to trigger a single ad-hoc outbound call — the bot reminding the consumer about a
missing step or offering a product. This is explicitly **not** a campaign: no bulk
import, no campaign scheduling window, one call per API request, triggered on demand.

Investigation found the platform is closer to "ready" for this than expected:

- `telephony_jobs` (the actual dial queue) has **no campaign FK at all** — campaign
  calls and today's manual admin "test dial" both just insert a row into the same
  table. Ad-hoc calls fit this shape natively.
- `proxy/gemini.ts`'s `buildSystemInstruction(customer, agent, callMemoryContext, baseTemplateId)` **already accepts a per-call override** of which base instruction
  template to use — today only `campaigns.baseTemplateId` feeds it. This is the
  existing mechanism to reuse for "special instruction for mobile calls," instead of
  building new instruction-selection machinery on `agents`.
- `customers.sourceSystem` + `customers.sourceRecordKey` already exist and are
  exactly the "external system gives us a stable id, dedupe on it" pattern used by
  PKS import — reusable for mobile-app consumer identity without new columns.
- Auth today is 100% cookie/session (`auth.ts`) plus one shared static-secret bearer
  token (`TELEPHONY_WORKER_TOKEN`) for the telephony worker. There is **no
  per-client API key system, no rate limiting anywhere in the backend, and no
  inbound webhook signature verification** — all need to be added.
- `POST /callbot/telephony/jobs` (existing manual-dial endpoint) **requires an
  already-existing `customerId`** and is explicitly commented as "not part of the
  campaign_manager workflow" — closest precedent, but not directly reusable as-is
  since the mobile app has no `customerId`, only a phone number + its own consumer id.

## Design

### 1. Auth: per-client API keys (new, not the `TELEPHONY_WORKER_TOKEN` pattern)

New table `api_clients`: `id, name, key_hash (sha256, same technique as app_sessions.token_hash in auth.ts), webhook_secret (for HMAC-signing callbacks), default_agent_id (nullable FK → agents), default_webhook_url (nullable), active, created_at, last_used_at`.

New middleware `requireApiKey` (new file `src/api-auth.ts`, modeled on
`hashToken`/`currentUser` in `auth.ts`): reads `Authorization: Bearer <key>`, hashes,
looks up an active `api_clients` row, attaches `req.apiClient`, 401 otherwise. Use
`crypto.timingSafeEqual` for the comparison. One key per mobile-app/customer
integration — gives per-client identity, revocation, and rate limiting, which the
existing single shared `TELEPHONY_WORKER_TOKEN` can't.

A minimal admin-only CRUD route `src/routes/api-clients.ts` (`requireAuth + requireRole('admin')`) to create/list/revoke `api_clients` rows, so ops can onboard a
new mobile-app integration without touching the DB by hand.

### 2. Agent + "special instruction" selection

No changes needed to `agents` schema. Instead:

- Add `telephony_jobs.base_template_id` (nullable uuid FK → `instruction_templates.id`)
  — mirrors `campaigns.base_template_id`, but on the job itself so **any** job
  (campaign or not) can pin a specific script.
- **No fallback when `job.baseTemplateId` is set.** Collections-campaign scripts and
  mobile-app reminder/offer scripts serve fundamentally different purposes (different
  content, different consent basis) — silently falling back to `campaign.baseTemplateId`
  or the global active template if the pinned one is missing/inactive would mean the
  bot could say the wrong thing to the wrong audience. So the precedence is: if
  `job.baseTemplateId` is present, it is the **only** template considered — resolve it
  or fail the job (see §2a). The existing fallback chain (`campaign.baseTemplateId` →
  global active template) still applies only to jobs where `job.baseTemplateId` is
  `null` (i.e. today's campaign/manual-admin jobs, unaffected).

#### 2a. Strict pre-dial validation

Because a broken/deactivated template must never result in either (a) silently using
the wrong script or (b) the call ringing at all before we know the script is broken,
validate `job.baseTemplateId` at two points, both hard-failing (no fallback) rather
than degrading:

1. **At claim/dequeue time** — `telephony.ts`'s `GET /jobs/next` (where the worker
   claims a job to dial): if `job.base_template_id` is set, confirm it resolves to an
   `instruction_templates` row with `template_type='base'` and `is_active=true`
   *before* the job is handed to the worker. If it doesn't resolve, skip claiming it,
   mark the job `status='failed'`, `last_error='base_template_unavailable'`, and let
   the normal terminal-status handling (§6) fire the failure notification. This
   guarantees the phone never rings on a broken template.
2. **Defense-in-depth at connect time** — `buildSystemInstruction()` in
   `proxy/gemini.ts`: if `baseTemplateId` is passed but does not resolve, throw
   instead of falling back to the global active template; the WS handler must
   terminate the session and report the job as failed with the same
   `base_template_unavailable` reason, covering any race between claim and connect
   or other call sites that reach `buildSystemInstruction` directly.

Both checks feed the same reporting path: `telephony_jobs.status`/`last_error` →
`external_call_requests.status` → the outcome webhook (§6) and `GET /api/external/v1/calls/:id`, so the mobile-app backend is told promptly *why* the
call didn't happen rather than left polling a call that will never dial.

- Add `instruction_templates.external_key` (nullable, unique varchar) — a stable
  slug (e.g. `"missing-steps-reminder"`, `"product-offer"`) that the external API
  contract references, decoupling it from internal UUIDs so template content/version
  can change without the mobile app changing anything.
- Ops creates one or more real `agents` rows for this purpose (e.g. "Mobile App
  Consumer Bot") via the existing `/api/agents` CRUD — pure config, no code change —
  and one or more `instruction_templates` rows (`template_type='base'`,
  `external_key=...`) with the actual reminder/offer scripts.
- Add `telephony_jobs.dynamic_context` (nullable text) — free-form per-call text
  (e.g. "KYC document upload" or "20% discount on Product X") supplied by the mobile
  app in the request. Extend `template-variables.ts` to substitute it into a new
  `{DYNAMIC_CONTEXT}` placeholder. This avoids an explosion of named variables for
  every possible reminder/offer type while still letting the mobile app parameterize
  the script per call. Stored directly on `telephony_jobs` (not a joined table) so
  `proxy/gemini.ts` needs no new lookups at call-connect time.

`api_clients.default_agent_id` lets each mobile-app integration have its own default
persona without the mobile app needing to pass an `agentId`; the request can still
override it explicitly.

### 3. Customer resolution (find-or-create by phone, without touching collections data)

Do **not** dedupe against existing PKS/collections `customers` rows — mixing a
self-registered mobile-app consumer with a debt-collection record on phone match
alone is a correctness/consent risk. Instead:

- New helper `resolveOrCreateExternalCustomer()` (new file `src/external-customers.ts`)
  keyed on `sourceSystem = 'mobile_app'` (or the api_client's own identifier) +
  `sourceRecordKey = externalConsumerId` (the mobile app's own user id, supplied in
  the request) — exact-match lookup first (idempotent), else insert a new
  `customers` row with `name`/`surname` (required NOT NULL — default to a placeholder
  if the mobile app doesn't send one), `phone`, `mobilePhone`, `sourceSystem`,
  `sourceRecordKey`, `importedAt`.
- Extract `normalizePhone`/`normalizeSinglePhone` out of `campaigns.ts` into a shared
  `src/phone-utils.ts` so this new helper and the existing PKS path both use one
  implementation instead of duplicating phone normalization.

### 4. New endpoint

New file `src/routes/external-calls.ts`, mounted at `/api/external/v1`, protected by
`requireApiKey` (not cookie auth). Extract the `telephony_jobs` insert logic
currently inline in `telephony.ts`'s `POST /jobs` into a shared
`createTelephonyJob()` so both the internal admin route and this new one share one
code path (trunk defaulting, etc.) instead of duplicating it.

`POST /api/external/v1/calls`

```
{
  externalConsumerId: string,   // mobile app's user id -> customers.sourceRecordKey
  phone: string,
  name?: string, surname?: string,
  templateKey: string,          // -> instruction_templates.external_key
  agentId?: string,             // else api_clients.default_agent_id
  dynamicContext?: string,
  consentGiven: true,           // required; see compliance note below
  idempotencyKey?: string,
  callbackUrl?: string
}
```

Flow: rate-limit checks → idempotency check → resolve template by `external_key`
(400 if missing/inactive — this is the request-time check; §2a is the belt-and-braces
recheck immediately before dialing, since the template could be deactivated after the
job is queued but before it's claimed) → resolve agent → resolve/create customer →
insert `telephony_jobs` (with `base_template_id`, `dynamic_context`) → insert an audit
row (see below) → `202 { callId, status: 'queued' }`. Dialing itself stays async,
handled by the existing `apps/telephony` worker poll loop — unchanged, except that
poll loop's claim step now honors the §2a pre-dial template check.

`GET /api/external/v1/calls/:id` (also `requireApiKey`, scoped to the caller's own
requests only) — lets the mobile backend poll for status/summary instead of relying
solely on the webhook.

New table `external_call_requests`: `id, api_client_id FK, idempotency_key (nullable), telephony_job_id FK, customer_id FK, consent_given bool, consent_timestamp, callback_url, status (cached), created_at, updated_at`. Backs
idempotency (replay of the same `idempotencyKey` within 24h returns the original
result instead of dialing twice), gives a per-client audit trail, and is the source
for webhook dispatch.

### 5. Rate limiting & idempotency (no new dependency — DB-backed)

No rate limiting exists anywhere in the backend today, and there's no Redis in the
stack (per `docs/qdrant-redis-to-postgres-analysis.md`, already moved off Redis) —
so implement limits as simple counting queries against `external_call_requests`
rather than adding `express-rate-limit`/Redis:

- Per-`api_client_id`: max N calls/minute, M calls/day → 429 if exceeded.
- Per-phone cooldown (e.g. don't re-dial the same number within X hours) — doubles
  as consumer-protection against accidental hammering from mobile-app retries/bugs.
- `idempotencyKey` replay check as described above, independent of the cooldown.

### 6. Outcome callback to the mobile-app backend

Extend the existing outbound-webhook pattern (`postWebhook()` in
`src/ai-tools/index.ts`, currently only used for in-call tool events) with a new
`notifyExternalCallback()` called from `telephony.ts`'s `POST /jobs/:id/event`
handler when a job tied to an `external_call_requests` row reaches a terminal status
(`ended`/`failed` — including the `failed`/`base_template_unavailable` case from §2a,
so a broken template produces an immediate, explicit failure notification rather than
silence). POST to `callbackUrl` (or `api_clients.default_webhook_url`) with
`{ externalConsumerId, callId, status, failureReason?, durationSeconds, timestamp }`,
**HMAC-signed**
using `api_clients.webhook_secret` (header `X-Robocall-Signature`) — proper
signature verification, unlike today's outbound-only `WEBHOOK_SECRET` which is just
a static shared header value. Treat the webhook as a "something happened, come poll"
ping; `GET /calls/:id` remains the source of truth for the enriched summary once
`analysis-worker.ts` fills it in (that worker is already campaign-agnostic, no
changes needed there or in `call-memory.ts`).

### 7. Compliance / consent (explicit call-out, not just code)

Outbound automated calls to consumers carry real regulatory risk. Require
`consentGiven: true` in the request (400 if absent) and persist
`consent_given`/`consent_timestamp` on `external_call_requests` as audit evidence
that the mobile app captured consent at registration. Per-phone cooldown (§5) also
serves as a harassment guard. Quiet-hours enforcement is a reasonable v1 nice-to-have
but not blocking — flagged as a fast-follow.

### 8. Known limitation: shared dial concurrency

`TELEPHONY_MAX_CONCURRENT_CALLS` is enforced in `apps/telephony/src/server.js` as a
single global counter shared by every `telephony_jobs` row regardless of origin —
campaign, manual admin, and (new) external calls all compete for the same pool, same
as manual admin calls do today. Acceptable for v1; if external call volume grows
large enough to starve campaigns, revisit with a `source`/`priority` column and a
fairness change in the worker's claim query — that's a separate-service change
(`apps/telephony`) and out of scope here.

## Files touched

**New:**

- `apps/callbot-backend/src/api-auth.ts` — `requireApiKey` middleware, key hashing.
- `apps/callbot-backend/src/routes/api-clients.ts` — admin CRUD for API clients.
- `apps/callbot-backend/src/routes/external-calls.ts` — `POST/GET /api/external/v1/calls`.
- `apps/callbot-backend/src/external-customers.ts` — find-or-create by phone/consumer id.
- `apps/callbot-backend/src/phone-utils.ts` — extracted from `campaigns.ts`.

**Modified:**

- `apps/callbot-backend/src/db/schema.ts` — `api_clients`, `external_call_requests`
  tables; `telephony_jobs.base_template_id`, `telephony_jobs.dynamic_context`;
  `instruction_templates.external_key`.
- `apps/callbot-backend/src/routes/telephony.ts` — extract `createTelephonyJob()`
  shared helper; call `notifyExternalCallback()` on terminal job status.
- `apps/callbot-backend/src/routes/campaigns.ts` — export `normalizePhone`/
  `normalizeSinglePhone` from the new `phone-utils.ts` instead of local copies.
- `apps/callbot-backend/src/proxy/gemini.ts` — prefer `job.baseTemplateId` when
  present; read `{DYNAMIC_CONTEXT}`.
- `apps/callbot-backend/src/template-variables.ts` — add `{DYNAMIC_CONTEXT}`.
- `apps/callbot-backend/src/ai-tools/index.ts` — add `notifyExternalCallback()`
  alongside existing `postWebhook()`.
- `apps/callbot-backend/src/index.ts` — mount new routes.

**Ops/data (no code):** create the mobile-persona `agents` row(s), the
`instruction_templates` row(s) with `external_key`s, and the first `api_clients` row
for the mobile-app team via the new admin CRUD route.

## Verification

- Staging: create a test `api_clients` key via the new admin route, `POST /api/external/v1/calls` against a real test phone number; confirm a
  `telephony_jobs` row is created with `base_template_id` set and no campaign
  linkage, and that the existing `apps/telephony` worker dials it.
- Replay the same `idempotencyKey` twice → second call returns the cached result,
  no second `telephony_jobs` row.
- Exceed per-client and per-phone rate limits → 429.
- Point `callbackUrl` at a local test listener → verify the HMAC-signed payload on
  call completion (`X-Robocall-Signature` validates against `webhook_secret`).
- Confirm `call-memory.ts` and `analysis-worker.ts` behave unchanged for these calls
  (both are already keyed only on `customerId`/`agentId`, not campaign).
- Confirm existing campaign and manual-admin dialing flows are unaffected
  (`telephony.ts` refactor is a pure extraction, no behavior change).
