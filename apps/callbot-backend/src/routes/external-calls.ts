import { Router, type Request } from 'express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agents, calls, customers, dynamicContextCodes, externalCallRequests, telephonyJobs } from '../db/schema.js';
import { currentApiClient, type ApiClient } from '../api-auth.js';
import { createTelephonyJob } from './telephony.js';
import { resolveOrCreateExternalCustomer } from '../external-customers.js';
import { normalizePhone } from '../phone-utils.js';
import { createReadStream } from 'node:fs';
import { recordingFileInfo } from '../recording.js';

export const externalCallsRouter = Router();

const rateLimitPerMinute = Math.max(1, Number(process.env.EXTERNAL_API_RATE_LIMIT_PER_MINUTE || 20));
const rateLimitPerDay = Math.max(1, Number(process.env.EXTERNAL_API_RATE_LIMIT_PER_DAY || 500));
const phoneCooldownMinutes = Math.max(0, Number(process.env.EXTERNAL_API_PHONE_COOLDOWN_MINUTES || 60));
const idempotencyWindowHours = 24;

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const maybeRows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(maybeRows) ? maybeRows : [];
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

// Accepts a single code ("current_address") or an array of codes
// (["current_address", "missing_id_photo"]) — never arbitrary free text. Dedupes while
// preserving the caller's first-occurrence order (that order is also what the joined
// {DYNAMIC_CONTEXT} substitution follows, so a duplicate wouldn't just be wasted work, it'd
// duplicate a line in the bot's prompt).
function parseDynamicContextCodes(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value != null && cleanText(value) ? [value] : [];
  const cleaned = raw.map((v) => cleanText(v)).filter(Boolean);
  return Array.from(new Set(cleaned));
}

async function findIdempotentReplay(apiClient: ApiClient, idempotencyKey: string) {
  const [existing] = await db
    .select({
      telephonyJobId: externalCallRequests.telephonyJobId,
      status: externalCallRequests.status,
    })
    .from(externalCallRequests)
    .where(and(
      eq(externalCallRequests.apiClientId, apiClient.id),
      eq(externalCallRequests.idempotencyKey, idempotencyKey),
      sql`${externalCallRequests.createdAt} > now() - (${idempotencyWindowHours} || ' hours')::interval`,
    ))
    .limit(1);
  return existing ?? null;
}

async function checkRateLimits(apiClient: ApiClient, phone: string): Promise<string | null> {
  const perMinute = rowsFrom(await db.execute(sql`
    SELECT count(*)::int AS count FROM external_call_requests
    WHERE api_client_id = ${apiClient.id} AND created_at > now() - interval '1 minute'
  `))[0];
  if (Number(perMinute?.count ?? 0) >= rateLimitPerMinute) return 'rate limit exceeded (per minute)';

  const perDay = rowsFrom(await db.execute(sql`
    SELECT count(*)::int AS count FROM external_call_requests
    WHERE api_client_id = ${apiClient.id} AND created_at > now() - interval '1 day'
  `))[0];
  if (Number(perDay?.count ?? 0) >= rateLimitPerDay) return 'rate limit exceeded (per day)';

  if (phoneCooldownMinutes > 0) {
    const cooldown = rowsFrom(await db.execute(sql`
      SELECT count(*)::int AS count
      FROM external_call_requests ecr
      JOIN telephony_jobs tj ON tj.id = ecr.telephony_job_id
      WHERE tj.phone = ${phone} AND ecr.created_at > now() - (${phoneCooldownMinutes} || ' minutes')::interval
    `))[0];
    if (Number(cooldown?.count ?? 0) > 0) return `phone was already called within the last ${phoneCooldownMinutes} minutes`;
  }

  return null;
}

// is_active is deliberately not checked: it only decides which template loads when a call
// gives no explicit template, not whether one selected by key is usable (see templates.ts's
// loadTemplateById / baseTemplateExists) — a templateKey is only unresolvable if no row
// carries it.
async function resolveTemplateId(templateKey: string): Promise<string | null> {
  const rows = rowsFrom(await db.execute(sql`
    SELECT id FROM instruction_templates
    WHERE external_key = ${templateKey} AND template_type = 'base'
    LIMIT 1
  `));
  return rows[0]?.id ? String(rows[0].id) : null;
}

// Resolves each requested code to its registered phrase (correct language/tone) and joins
// them with newlines into the text that gets substituted into the template's
// {DYNAMIC_CONTEXT} placeholder — one line per code, in the order the caller sent them. If
// ANY code doesn't resolve, the whole request is rejected (see caller) rather than silently
// substituting a partial list. Unlike templateKey, an inactive code is treated the same as a
// nonexistent one: deactivating a code is how it's retired, and a caller still sending it
// should get the same clear rejection either way.
async function resolveDynamicContext(codes: string[]): Promise<{ phrase: string | null; missing: string[] }> {
  if (codes.length === 0) return { phrase: null, missing: [] };

  const rows = await db.select({ code: dynamicContextCodes.code, phrase: dynamicContextCodes.phrase })
    .from(dynamicContextCodes)
    .where(and(inArray(dynamicContextCodes.code, codes), eq(dynamicContextCodes.active, true)));

  const phraseByCode = new Map(rows.map((row) => [row.code, row.phrase]));
  const missing = codes.filter((code) => !phraseByCode.has(code));
  if (missing.length > 0) return { phrase: null, missing };

  return { phrase: codes.map((code) => phraseByCode.get(code)!).join('\n'), missing: [] };
}

async function resolveAgentId(apiClient: ApiClient, requestedAgentId: unknown): Promise<number | null> {
  const requested = Number(requestedAgentId);
  const agentId = Number.isInteger(requested) && requested > 0 ? requested : apiClient.defaultAgentId;
  if (!agentId) return null;
  const [agent] = await db.select({ id: agents.id, enabled: agents.enabled }).from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent || !agent.enabled) return null;
  return agent.id;
}

externalCallsRouter.post('/calls', async (req, res) => {
  const apiClient = currentApiClient(req);

  const externalConsumerId = cleanText(req.body.externalConsumerId);
  const phone = normalizePhone(req.body.phone);
  const templateKey = cleanText(req.body.templateKey);
  const name = cleanText(req.body.name);
  const surname = cleanText(req.body.surname);
  // Not free text — one code, or an array of codes, from the dynamic_context_codes
  // registry (see resolveDynamicContext below), e.g. "current_address" or
  // ["current_address", "missing_id_photo"]. Named *Input to avoid shadowing the
  // dynamicContextCodes schema table imported above.
  const dynamicContextCodesInput = parseDynamicContextCodes(req.body.dynamicContext);
  const idempotencyKey = cleanText(req.body.idempotencyKey) || null;
  const callbackUrl = cleanText(req.body.callbackUrl) || null;
  const consentGiven = req.body.consentGiven === true;

  if (!externalConsumerId || !phone || !templateKey || !name || !surname) {
    res.status(400).json({ error: 'externalConsumerId, phone, templateKey, name, and surname are required' });
    return;
  }
  if (!consentGiven) {
    res.status(400).json({ error: 'consentGiven must be true — the calling app must have captured consent for automated calls' });
    return;
  }

  // sip_trunks lives in the telephony service's own database (robocall_crm), not this one,
  // so its existence/enabled state can't be checked here — that check already happens in
  // originateAiCall() (apps/telephony/src/server.js) right before dialing, same as it does
  // for the internal manual-dial route. Rejected here only for shape (not silently ignored
  // and auto-selecting a different trunk than the caller asked for); an id that doesn't
  // resolve to a real trunk fails the job cleanly at dial time instead (see GET /calls/:id).
  // sip_trunks.id is a uuid (gen_random_uuid()), not an auto-increment integer.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let trunkId: string | undefined;
  if (req.body.trunkId !== undefined && req.body.trunkId !== null && req.body.trunkId !== '') {
    const rawTrunkId = cleanText(req.body.trunkId);
    if (!UUID_RE.test(rawTrunkId)) {
      res.status(400).json({ error: 'trunkId must be a valid trunk id (uuid)' });
      return;
    }
    trunkId = rawTrunkId;
  }

  if (idempotencyKey) {
    const replay = await findIdempotentReplay(apiClient, idempotencyKey);
    if (replay) {
      res.status(200).json({ callId: replay.telephonyJobId, status: replay.status, replay: true });
      return;
    }
  }

  const rateLimitError = await checkRateLimits(apiClient, phone);
  if (rateLimitError) {
    res.status(429).json({ error: rateLimitError });
    return;
  }

  // Request-time template check. Strict — no fallback to any other template if this key
  // doesn't resolve (see schema.ts's telephonyJobs.baseTemplateId comment). GET /jobs/next
  // and the /ws/gemini connect handler recheck this again just before dialing/connecting,
  // since the template row could be deleted/renamed after this job is queued but before
  // it's claimed.
  const baseTemplateId = await resolveTemplateId(templateKey);
  if (!baseTemplateId) {
    res.status(400).json({ error: `templateKey "${templateKey}" does not resolve to a template` });
    return;
  }

  let dynamicContext: string | null = null;
  if (dynamicContextCodesInput.length > 0) {
    const resolved = await resolveDynamicContext(dynamicContextCodesInput);
    if (resolved.missing.length > 0) {
      res.status(400).json({ error: `dynamicContext code(s) not recognized: ${resolved.missing.join(', ')}` });
      return;
    }
    dynamicContext = resolved.phrase;
  }

  const agentId = await resolveAgentId(apiClient, req.body.agentId);
  if (!agentId) {
    res.status(400).json({ error: 'agentId is required (no default agent configured for this API client)' });
    return;
  }

  const customer = await resolveOrCreateExternalCustomer({
    externalConsumerId,
    phone,
    name,
    surname,
  });

  const jobResult = await createTelephonyJob({
    agentId,
    customerId: customer.id,
    phone,
    baseTemplateId,
    dynamicContext,
    trunkId,
    source: 'external_api',
  });
  if (!jobResult.job) {
    res.status(400).json({ error: jobResult.error });
    return;
  }

  const [auditRow] = await db.insert(externalCallRequests).values({
    apiClientId: apiClient.id,
    idempotencyKey,
    telephonyJobId: jobResult.job.id,
    customerId: customer.id,
    consentGiven: true,
    consentTimestamp: new Date(),
    callbackUrl,
    status: 'queued',
  }).returning({ id: externalCallRequests.id });

  res.status(202).json({ callId: jobResult.job.id, status: 'queued', requestId: auditRow.id });
});

externalCallsRouter.get('/calls/:id', async (req: Request, res) => {
  const apiClient = currentApiClient(req);
  const telephonyJobId = Number(req.params.id);
  if (!Number.isInteger(telephonyJobId) || telephonyJobId <= 0) {
    res.status(400).json({ error: 'invalid call id' });
    return;
  }

  const [row] = await db
    .select({
      status: telephonyJobs.status,
      failureReason: externalCallRequests.failureReason,
      lastError: telephonyJobs.lastError,
      durationSeconds: telephonyJobs.durationSeconds,
      createdAt: telephonyJobs.createdAt,
      completedAt: telephonyJobs.completedAt,
      summary: calls.summary,
      transcript: calls.transcript,
    })
    .from(externalCallRequests)
    .innerJoin(telephonyJobs, eq(telephonyJobs.id, externalCallRequests.telephonyJobId))
    .leftJoin(calls, eq(calls.telephonyJobId, telephonyJobs.id))
    .where(and(eq(externalCallRequests.apiClientId, apiClient.id), eq(externalCallRequests.telephonyJobId, telephonyJobId)))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: 'call not found' });
    return;
  }

  // telephony_jobs' internal status vocabulary (pending/claimed/dialing/...) is shared with
  // campaigns and manual-admin dialing; external callers get a smaller, stable vocabulary
  // instead — 'queued' covers both, matching the literal status POST /calls returns before
  // the job has been claimed by the dialer.
  const externalStatus = row.status === 'pending' || row.status === 'claimed' ? 'queued' : row.status;

  res.json({ callId: telephonyJobId, ...row, status: externalStatus });
});

// ARZOOM's "Yenidən zəng et": puts an ARZOOM application's customer back into the queue of
// every application-status campaign it belongs to, so the scheduler calls again right away.
// Applications ArzoomCall never calls (in review, rejected, re-offer pending, deleted) are refused.
externalCallsRouter.post('/arzoom/requeue', async (req: Request, res) => {
  try {
    const applicationId = String(req.body?.application_id ?? '').trim();
    if (!applicationId) {
      res.status(400).json({ error: 'application_id is required' });
      return;
    }
    const [customer] = rowsOf(await db.execute(sql`
      SELECT id, application_status FROM customers
      WHERE source_system = 'arzoom' AND source_record_key = ${applicationId}
      LIMIT 1
    `));
    if (!customer) {
      res.status(404).json({ error: 'application not found' });
      return;
    }
    const status = String(customer.application_status ?? '');
    if (['review', 'rejected', 'reoffer', 'deleted'].includes(status)) {
      res.status(409).json({ error: `application status "${status}" is not called` });
      return;
    }
    const busy = rowsOf(await db.execute(sql`
      SELECT 1 FROM telephony_jobs WHERE customer_id = ${customer.id as number} AND status IN ('pending', 'answered') LIMIT 1
    `));
    if (busy.length) {
      res.json({ ok: true, queued: 0, note: 'a call to this customer is already in progress' });
      return;
    }
    const queued = rowsOf(await db.execute(sql`
      UPDATE campaign_calls cc
      SET status = 'pending', attempt_number = 0, call_after = NULL, updated_at = now()
      FROM campaigns c
      WHERE c.id = cc.campaign_id AND c.segment = 'application_status'
        AND c.status IN ('active', 'paused', 'completed')
        AND cc.customer_id = ${customer.id as number}
        AND cc.status <> 'attempting'
      RETURNING cc.campaign_id
    `));
    if (!queued.length) {
      res.status(409).json({ error: 'customer is not in any application-status campaign' });
      return;
    }
    for (const row of queued) {
      await db.execute(sql`UPDATE campaigns SET status = 'active', updated_at = now() WHERE id = ${row.campaign_id as number} AND status = 'completed'`);
    }
    res.json({ ok: true, queued: queued.length });
  } catch (err) {
    console.error('[external/arzoom/requeue]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Call recording for ARZOOM's player: {id} is the call id from the analytics snapshot's
// recent_calls (the telephony job id). Only calls to ARZOOM customers are served. Supports
// Range requests so the player can seek.
externalCallsRouter.get('/arzoom/recordings/:id', async (req: Request, res) => {
  try {
    const jobId = Number(req.params.id);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      res.status(400).json({ error: 'invalid call id' });
      return;
    }
    const [owned] = rowsOf(await db.execute(sql`
      SELECT 1 FROM telephony_jobs tj JOIN customers c ON c.id = tj.customer_id
      WHERE tj.id = ${jobId} AND c.source_system = 'arzoom' LIMIT 1
    `));
    const file = owned ? await recordingFileInfo(jobId) : null;
    if (!file) {
      res.status(404).json({ error: 'recording not found' });
      return;
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    let start = 0;
    let end = file.size - 1;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(end, Number(range[2]));
      } else {
        start = Math.max(0, file.size - Number(range[2]));
      }
      if (start > end || start >= file.size) {
        res.status(416).setHeader('Content-Range', `bytes */${file.size}`).end();
        return;
      }
      res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
    }
    res.setHeader('Content-Length', String(end - start + 1));
    const stream = createReadStream(file.filePath, { start, end });
    stream.on('error', (err) => {
      console.error('[external/arzoom/recordings]', err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
      else res.destroy();
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (err) {
    console.error('[external/arzoom/recordings]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const maybeRows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(maybeRows) ? maybeRows : [];
}
