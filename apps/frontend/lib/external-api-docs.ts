// Markdown content offered as a download from /telephony/external-api (admin-only page
// for managing external API access). Mirrors docs/external-call-api.md in the backend
// repo, minus the internal source-file references that don't mean anything to an
// external integrator. Keep this in sync by hand if the API contract changes.
export const EXTERNAL_API_DOCS_MD = `# External Call-Trigger API

Lets a third-party backend (e.g. a customer's mobile-app server) trigger a single
ad-hoc outbound call — the bot reminding a consumer about a missing step, or offering
a product — without going through Robocall's campaign system. One call per request,
triggered on demand.

**This is a server-to-server API.** Call it from your backend, never from the mobile
app itself — the API key is a secret and must not ship inside a mobile client.

## Base URL

Ask Robocall ops for the base URL for your environment. All paths below are relative
to it, e.g. \`{baseUrl}/api/external/v1/calls\`.

## Authentication

\`Authorization: Bearer <api_key>\` on every request. Keys are provisioned by Robocall
ops — you can't self-serve one. The raw key is shown exactly once at creation time;
if it's lost, ops has to issue a new one (the server only ever stores its SHA-256
hash).

A missing or invalid key returns \`401 { "error": "unauthorized" }\`.

## POST /api/external/v1/calls

Triggers one outbound call. Returns \`202\` once the call is queued — dialing happens
asynchronously; poll \`GET /calls/:id\` or listen for the webhook for the outcome.

### Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| \`externalConsumerId\` | string | yes | Your own user/consumer id. Used to find-or-create the Robocall customer record (idempotent — the same id always maps to the same customer). |
| \`phone\` | string | yes | Azerbaijani number. Accepts \`+994XXXXXXXXX\`, \`0XXXXXXXXX\`, or bare \`XXXXXXXXX\`. Anything else is used as-is and will likely fail to dial — send E.164 when possible. |
| \`templateKey\` | string | yes | Which script the bot uses. Assigned by Robocall ops when your instruction templates are set up (e.g. \`"missing-steps-reminder"\`, \`"product-offer"\`) — ask ops for your valid keys. |
| \`consentGiven\` | boolean | yes | Must be literally \`true\`. Your app must have captured the consumer's consent to receive an automated call before sending this. |
| \`name\` | string | yes | Consumer's first name. |
| \`surname\` | string | yes | Consumer's last name. |
| \`agentId\` | number | no | Overrides your account's default agent (persona/voice). Ask ops if you need more than one. |
| \`trunkId\` | string (uuid) | no | Pin a specific SIP trunk instead of letting the telephony worker auto-select one. Not existence-checked at request time — a malformed id is rejected with \`400\`, but an id that's well-formed yet doesn't resolve to a real, enabled trunk only fails once the job reaches the dial queue: the job ends in \`status: "failed"\` with \`failureReason\`/\`lastError\` explaining why (poll \`GET /calls/:id\` or listen for the webhook) — it does not retry indefinitely. |
| \`dynamicContext\` | string \\| string[] | no | One registered code, or an array of them (e.g. \`"current_address"\` or \`["current_address", "missing_id_photo"]\`), **not free text**. Every code must match the Dynamic Context Codes registry or the whole request is rejected — see "Dynamic context codes" below. Only takes effect if the chosen template's script references \`{DYNAMIC_CONTEXT}\`. |
| \`idempotencyKey\` | string | no, but recommended | Replaying the same key within 24h returns the original result instead of dialing again — use this to make retries after a network timeout safe. Max 200 chars. |
| \`callbackUrl\` | string | no | Where to POST the outcome webhook for this call. Falls back to your account's default webhook URL if omitted; if neither is set, no webhook fires and you must poll. |

### Success response

\`202 Accepted\`
\`\`\`json
{ "callId": 5125, "status": "queued", "requestId": 1 }
\`\`\`

\`callId\` is the id you'll use for \`GET /calls/:id\` and that appears in the webhook
payload.

Replaying an already-used \`idempotencyKey\` (within 24h) returns \`200\` instead of
\`202\`, with the original \`callId\` and \`"replay": true\`:
\`\`\`json
{ "callId": 5125, "status": "queued", "replay": true }
\`\`\`

### Error responses

| Status | Body | Cause |
|---|---|---|
| 400 | \`{ "error": "externalConsumerId, phone, templateKey, name, and surname are required" }\` | A required field is missing. |
| 400 | \`{ "error": "consentGiven must be true — the calling app must have captured consent for automated calls" }\` | \`consentGiven\` was absent or not exactly \`true\`. |
| 400 | \`{ "error": "templateKey \\"...\\" does not resolve to a template" }\` | Unknown or removed \`templateKey\`. Confirm the exact key with ops — there is no discovery endpoint for valid keys today. |
| 400 | \`{ "error": "dynamicContext code(s) not recognized: ..." }\` | One or more \`dynamicContext\` codes aren't known, active codes — listed by name. The whole request is rejected even if only one code out of several is bad. Confirm the exact codes with ops — see "Dynamic context codes" below. |
| 400 | \`{ "error": "agentId is required (no default agent configured for this API client)" }\` | You didn't pass \`agentId\` and your account has no default agent configured. Ask ops to set one, or pass \`agentId\` explicitly. |
| 400 | \`{ "error": "trunkId must be a valid trunk id (uuid)" }\` | \`trunkId\` was present but not a well-formed uuid. A well-formed uuid that doesn't resolve to a real trunk is **not** caught here — see the \`trunkId\` row above. |
| 400 | \`{ "error": "phone is required" }\` | \`phone\` didn't normalize to anything dialable. |
| 429 | \`{ "error": "rate limit exceeded (per minute)" }\` | More than ~20 requests/minute from your account (see Rate limits below). |
| 429 | \`{ "error": "rate limit exceeded (per day)" }\` | More than ~500 requests/day from your account. |
| 429 | \`{ "error": "phone was already called within the last N minutes" }\` | The same phone number was called too recently — a consumer-protection guard, not per-account. |

### Dynamic context codes

\`dynamicContext\` is a code, not free text — deliberately. Robocall's calls speak in a
specific language and tone; letting an external caller inject arbitrary text straight
into that live prompt risked the wrong language, wrong tone, or unvalidated content
coming out of the bot's mouth mid-call. Instead:

1. Ops registers a code and its actual phrase (e.g. code \`current_address\`, phrase
   "Müştəridən hazırkı ünvanını təsdiqləməsini xahiş et...") in advance.
2. You send one code, or an array of codes, in \`dynamicContext\`.
3. Robocall resolves each one to its registered phrase at request time and joins them
   with newlines — one phrase per line, in the order you sent them — into the text
   substituted into the chosen template's \`{DYNAMIC_CONTEXT}\` placeholder.
4. If any code in the list is unrecognized or deactivated, the whole request is
   rejected with \`400\` immediately, naming every code that didn't resolve — no
   partial substitution.

Example with two codes: \`{ "dynamicContext": ["current_address", "missing_id_photo"] }\`
resolves to a two-line \`{DYNAMIC_CONTEXT}\` (assuming both are registered).

There's no discovery endpoint for valid codes yet — get the list from ops.

## GET /api/external/v1/calls/:id

Poll for status and outcome. \`:id\` is the \`callId\` from the \`POST\` response. Only
returns calls your own API key triggered — \`404\` otherwise, same as if it never
existed.

\`\`\`json
{
  "callId": 5125,
  "status": "ended",
  "failureReason": null,
  "lastError": null,
  "durationSeconds": 47,
  "createdAt": "2026-08-20T18:37:38.272Z",
  "completedAt": "2026-08-20T18:38:25.900Z",
  "summary": "Consumer confirmed they'll upload the missing document today.",
  "transcript": null
}
\`\`\`

| Field | Notes |
|---|---|
| \`status\` | \`queued\` → \`dialing\` → \`answered\` → \`ended\` \\| \`failed\`. Terminal states are \`ended\` and \`failed\`. |
| \`failureReason\` | Set only when \`status: "failed"\`. Either a fixed code (\`base_template_unavailable\` — your \`templateKey\` stopped resolving between request and dial) or a truncated (60 char) copy of the underlying telephony error. |
| \`lastError\` | The full, untruncated error message when failed — more useful for debugging than \`failureReason\`. |
| \`durationSeconds\` | Set once the call has ended. |
| \`summary\`, \`transcript\` | Filled in after the call completes and the post-call analysis step runs (not instant — poll again after a few seconds if \`status\` is \`ended\` but these are still \`null\`). |

\`GET\` on an unknown or not-yours \`callId\` returns \`404 { "error": "call not found" }\`.

## Outcome webhook

If \`callbackUrl\` (or your account's default) is set, Robocall POSTs once the call
reaches a terminal state (\`ended\` or \`failed\`):

\`\`\`json
{
  "externalConsumerId": "consumer-8213",
  "callId": 5125,
  "status": "ended",
  "failureReason": null,
  "durationSeconds": 47,
  "timestamp": "2026-08-20T18:38:25.912Z"
}
\`\`\`

Signed with your account's webhook secret (shown once at provisioning, alongside the
API key):

\`\`\`
X-Robocall-Signature: sha256=<hex-encoded HMAC-SHA256 of the raw request body>
\`\`\`

Verify it (Node example — port the HMAC logic to your stack):
\`\`\`js
const crypto = require('crypto');

function isValidSignature(rawBody, signatureHeader, webhookSecret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}
\`\`\`
Compute the HMAC over the *raw* request body (before JSON parsing) — re-serializing a
parsed object can produce a different byte sequence and fail verification.

Treat the webhook as a "something happened, go check" ping rather than the full
record: \`summary\`/\`transcript\` are filled in slightly after the call ends (a
background step), so \`GET /calls/:id\` a few seconds after receiving the webhook is
the reliable way to get the enriched outcome. The webhook delivery itself isn't
retried on failure (e.g. your endpoint being down) — \`GET\` is always the fallback
source of truth regardless.

## Rate limits and idempotency

Defaults as of this writing (ops can tune these per deployment):

- **20 requests/minute** and **500 requests/day** per API key.
- **60-minute cooldown** per phone number, across all callers — a consumer-protection
  guard against a bug or retry loop hammering the same person. Not per-account: if
  another integration called the same number recently, you'll also get \`429\`.
- **Idempotency window: 24 hours**, fixed. Reuse \`idempotencyKey\` for retries; a
  replay is a \`200\`, not a new \`202\` — no duplicate call goes out.

## Consent

\`consentGiven: true\` is required on every request. Your app is responsible for
having actually captured the consumer's consent to receive an automated call before
sending it — this isn't just a formality, it's evidence retained for compliance.
Automated outbound calls carry real regulatory risk; don't set this to \`true\` unless
consent was genuinely obtained.

## Getting set up

Ask Robocall ops for:
1. An API key + webhook secret — shown once, store them securely (e.g. a secrets
   manager), not in source control.
2. At least one \`templateKey\` — the script(s) your calls should use.
3. A default agent (voice/persona), if you don't want to pass \`agentId\` on every call.
4. Any \`dynamicContext\` codes you need — ops registers each code + its actual phrase in
   advance; you only ever send the code.
5. The base URL for your environment.
`;
