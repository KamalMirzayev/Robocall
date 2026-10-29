import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { eq, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agents, calls, customers, telephonyJobs } from '../db/schema.js';
import { requireAuth, requireRole, type AppUser } from '../auth.js';
import { digitsOnly, normalizePhone, phoneVariants } from '../phone-utils.js';
import { notifyExternalCallback } from '../external-webhook.js';

export const telephonyRouter = Router();
const staleDialingSeconds = Math.max(10, Number(process.env.TELEPHONY_DIALING_STALE_SECONDS || 30));

function normalizeOutboundChannel(value: unknown): 'provider' | 'gsm_gateway' {
  return String(value ?? '').trim() === 'gsm_gateway' ? 'gsm_gateway' : 'provider';
}

function buildWsUrl(customerId: number, agentId: number, jobId?: number): string {
  const base = process.env.TELEPHONY_WS_BASE_URL ?? process.env.PUBLIC_WS_URL ?? 'wss://robocall.az/ws/gemini';
  const url = new URL(base);
  url.searchParams.set('customerId', String(customerId));
  url.searchParams.set('agentId', String(agentId));
  if (jobId) url.searchParams.set('jobId', String(jobId));
  return url.toString();
}

function requireWorkerAuth(req: Request, res: Response): boolean {
  const expected = process.env.TELEPHONY_WORKER_TOKEN;
  if (!expected) {
    res.status(503).json({ error: 'TELEPHONY_WORKER_TOKEN is not configured' });
    return false;
  }
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.get('x-telephony-token');
  if (token !== expected) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const maybeRows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(maybeRows) ? maybeRows : [];
}

function requestUser(req: Request) {
  return (req as Request & { user?: AppUser }).user;
}

function lifecycleStatus(value: unknown): string {
  const status = String(value ?? '').trim();
  return ['dialing', 'answered', 'ended', 'failed'].includes(status) ? status : '';
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = String(text || '').trim();
  const raw = trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function classificationReason(category: unknown): string {
  switch (String(category || '').trim()) {
    case 'number_not_exist':
      return 'number does not exist or is invalid';
    case 'busy':
      return 'busy';
    case 'no_answer':
      return 'no answer';
    case 'unavailable':
      return 'phone unavailable or switched off';
    default:
      return '';
  }
}

function durationSeconds(start: unknown, end: unknown): number | null {
  const startedAt = start ? new Date(String(start)) : null;
  const endedAt = end ? new Date(String(end)) : new Date();
  if (!startedAt || Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) return null;
  return Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));
}

function dateOrNow(value: unknown): Date {
  const date = value ? new Date(String(value)) : null;
  return date && !Number.isNaN(date.getTime()) ? date : new Date();
}

function unreachedSummary(error: unknown, phone: unknown): string {
  const text = String(error ?? '').toLowerCase();
  if (!digitsOnly(phone)) return 'Nömrə qeyd olunmayıb';
  if (/\b(busy|mesgul|m[eə]şgul|486|hangupcause=17)\b/.test(text)) return 'Nömrə məşğuldur';
  if (/\b(number does not exist|does not exist|unallocated|unassigned|no such|not found|invalid number|invalid number format|address incomplete|no route|number changed|nomer\s*ne\s*sushestvuyet|nomer\s*ne\s*opredelen|404|hangupcause=(1|2|22|28))\b/.test(text)) {
    return 'Nömrə mövcud deyil / səhvdir';
  }
  // Check for no answer / timeout scenarios BEFORE checking for generic unknown errors
  // Includes: no answer, cavab, timeout, originate failed reason 3, and Asterisk hangup causes
  if (/\b(no\s*answer|noanswer|cavab|timeout|timed?\s*out|originate\s*failed.*reason\s*3|408|hangupcause=19|hangupcause=3)\b/.test(text)) return 'Cavab vermir / əlaqə qurulmur';
  if (/\b(switched\s*off|powered\s*off|phone\s*off|sonul|s[oö]n|ba[gğ]l[iı]|unavailable|unavail|chanunavail|unreachable|deactiv|deaktiv|480|503|hangupcause=(20|27|34|38|41|42|44|47))\b/.test(text)) {
    return 'Telefon sönülüdür / nömrə əlçatan deyil';
  }
  if (/\b(invalid|unknown|not\s*found|wrong|yanlis|s[eə]hv|nomer\s*ne\s*opredelen|number\s*not\s*defined)\b/.test(text)) {
    return 'Nömrə səhvdir / təyin olunmayıb';
  }
  if (/\b(congestion|congested|network|xett|x[eə]tt|şəbəkə|sebeke)\b/.test(text)) return 'Xətdə problem / zəng çatmadı';
  return 'Cavab vermir / əlaqə qurulmur';
}

async function ensureUnreachedCallSummary(input: {
  id?: unknown;
  agentId?: unknown;
  agent_id?: unknown;
  customerId?: unknown;
  customer_id?: unknown;
  phone?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
  error?: unknown;
  summary?: string;
}) {
  const telephonyJobId = Number(input.id ?? 0) || null;
  const agentId = Number(input.agentId ?? input.agent_id ?? 0) || null;
  const customerId = Number(input.customerId ?? input.customer_id ?? 0) || null;
  const summary = input.summary || unreachedSummary(input.error, input.phone);
  const error = String(input.error ?? '').replace(/\s+/g, ' ').trim();
  const description = [
    `Zəng müştəriyə çatmadı. Səbəb: ${summary}.`,
    error && error !== summary ? `Texniki qeyd: ${error.slice(0, 500)}` : '',
  ].filter(Boolean).join('\n');

  if (telephonyJobId) {
    const [existing] = await db
      .select({ id: calls.id, transcript: calls.transcript })
      .from(calls)
      .where(eq(calls.telephonyJobId, telephonyJobId))
      .limit(1);

    if (existing) {
      if (String(existing.transcript || '').trim()) return existing.id;
      await db.update(calls).set({
        endedAt: new Date(),
        durationSeconds: 0,
        summary,
        description,
      }).where(eq(calls.id, existing.id));
      return existing.id;
    }
  }

  const [call] = await db.insert(calls).values({
    agentId,
    customerId,
    telephonyJobId,
    startedAt: dateOrNow(input.createdAt ?? input.created_at),
    endedAt: new Date(),
    durationSeconds: 0,
    transcript: null,
    summary,
    description,
  }).returning({ id: calls.id });

  return call?.id ?? null;
}

/**
 * Update campaign statistics based on campaign_calls records.
 * Calculates total customers, completed calls, and successful calls.
 */
export async function updateCampaignStatistics(campaignId: number) {
  try {
    const stats = rowsFrom(await db.execute(sql`
      SELECT 
        COUNT(DISTINCT customer_id) as total_customers,
        COUNT(*) FILTER (WHERE status IN ('completed', 'failed')) as completed_calls,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM calls c 
          WHERE c.customer_id = campaign_calls.customer_id 
          AND c.summary NOT LIKE '%səhvdir%' 
          AND c.summary NOT LIKE '%məşğul%' 
          AND c.summary NOT LIKE '%sönülü%'
          AND c.summary NOT LIKE '%problem%'
          LIMIT 1
        )) as successful_calls
      FROM campaign_calls
      WHERE campaign_id = ${campaignId}
    `));
    
    const stat = stats[0];
    if (stat) {
      const totalCustomers = Number(stat.total_customers) || 0;
      const completedCalls = Number(stat.completed_calls) || 0;
      const successfulCalls = Number(stat.successful_calls) || 0;
      
      // Check if all calls are completed and no pending/attempting/retrying calls remain
      const pendingCount = rowsFrom(await db.execute(sql`
        SELECT COUNT(*) as count FROM campaign_calls
        WHERE campaign_id = ${campaignId}
        AND status IN ('pending', 'attempting', 'retrying')
      `))[0];
      
      const hasPendingCalls = Number(pendingCount?.count || 0) > 0;
      const shouldMarkComplete = totalCustomers > 0 && completedCalls > 0 && !hasPendingCalls;
      
      await db.execute(sql`
        UPDATE campaigns
        SET total_customers = ${totalCustomers},
            completed_calls = ${completedCalls},
            successful_calls = ${successfulCalls},
            status = CASE 
              WHEN ${shouldMarkComplete} AND status = 'active' THEN 'completed'
              ELSE status
            END,
            updated_at = now()
        WHERE id = ${campaignId}
      `);
      
      if (shouldMarkComplete) {
        console.log(`[Campaign Stats] Campaign ${campaignId} marked as completed (${totalCustomers} customers, ${completedCalls} calls)`);
      }
    }
  } catch (err) {
    console.error(`[Campaign Stats] Error updating stats for campaign ${campaignId}:`, err);
  }
}

/**
 * Update campaign_calls status and campaign statistics after a telephony job completes.
 */
async function handleJobCompletion(jobId: number, status: 'ended' | 'failed', answered: boolean) {
  try {
    // Find the campaign_call for this telephony job. Scoped to the job's own
    // campaign_id (not just customer_id) — a customer can be queued in more than
    // one active campaign at once, and matching by customer_id alone risked
    // flipping the wrong campaign's row to completed/failed.
    const campaignCallResult = rowsFrom(await db.execute(sql`
      SELECT cc.id, cc.campaign_id
      FROM campaign_calls cc
      JOIN telephony_jobs tj ON tj.id = ${jobId}
      WHERE cc.customer_id = tj.customer_id
        AND cc.campaign_id = tj.campaign_id
        AND cc.status = 'attempting'
      ORDER BY cc.id DESC
      LIMIT 1
    `));
    
    if (campaignCallResult.length > 0) {
      const campaignCall = campaignCallResult[0];
      const ccId = Number(campaignCall.id);
      const campaignId = Number(campaignCall.campaign_id);
      
      // Update campaign_call status based on whether call was answered
      const newStatus = answered && status === 'ended' ? 'completed' : 'failed';
      await db.execute(sql`
        UPDATE campaign_calls 
        SET status = ${newStatus}, updated_at = now()
        WHERE id = ${ccId}
      `);
      
      // Recalculate campaign statistics
      if (campaignId) {
        await updateCampaignStatistics(campaignId);
      }
    }
  } catch (err) {
    console.error(`[Campaign Stats] Error handling job completion for job ${jobId}:`, err);
  }
}

// Common terminal-failure bookkeeping shared by the pre-dial template check below, the
// worker-reported failure paths (/jobs/:id/event, /jobs/:id/fail), and index.ts's /ws/gemini
// connect-time template recheck: writes the "unreached call" summary, updates campaign stats
// if applicable, and — if this job originated from the external call-trigger API — notifies
// the caller's webhook so a broken template (or any other unreachable outcome) is reported
// back promptly instead of left to time out.
export async function finalizeFailedJob(job: {
  id: number;
  agentId?: unknown;
  agent_id?: unknown;
  customerId?: unknown;
  customer_id?: unknown;
  phone?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
  answeredAt?: unknown;
  answered_at?: unknown;
}, error: string) {
  await ensureUnreachedCallSummary({ ...job, error });
  await handleJobCompletion(job.id, 'failed', Boolean(job.answeredAt ?? job.answered_at));
  await notifyExternalCallback(job.id, 'failed', { failureReason: error }).catch((err) => {
    console.error(`External callback failed for job ${job.id}:`, err);
  });
}

telephonyRouter.post('/resolve', async (req, res) => {
  const requestedCustomerId = Number(req.body.customerId);
  const requestedAgentId = Number(req.body.agentId ?? process.env.DEFAULT_TELEPHONY_AGENT_ID);
  const variants = phoneVariants(req.body.callerPhone ?? req.body.callerId);

  const [customer] = Number.isInteger(requestedCustomerId) && requestedCustomerId > 0
    ? await db.select().from(customers).where(eq(customers.id, requestedCustomerId)).limit(1)
    : variants.length > 0
      ? await db
        .select()
        .from(customers)
        .where(or(...variants.map((phone) => sql`regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g') = ${phone}`)))
        .limit(1)
      : [];

  if (!customer) {
    res.status(404).json({ error: 'customer not found' });
    return;
  }

  const [agent] = Number.isInteger(requestedAgentId) && requestedAgentId > 0
    ? await db.select().from(agents).where(eq(agents.id, requestedAgentId)).limit(1)
    : await db.select().from(agents).orderBy(agents.id).limit(1);

  if (!agent) {
    res.status(404).json({ error: 'agent not found' });
    return;
  }

  res.json({
    customerId: customer.id,
    agentId: agent.id,
    wsUrl: buildWsUrl(customer.id, agent.id, Number(req.body.jobId) || undefined),
    customer,
    agent,
  });
});

// Shared by the internal admin dial endpoint below and routes/external-calls.ts, so both
// paths format the phone number, default the outbound channel/trunk, and report a
// missing-phone failure the same way instead of duplicating this logic.
export async function createTelephonyJob(params: {
  agentId: number;
  customerId: number;
  phone: unknown;
  outboundChannel?: unknown;
  trunkId?: unknown;
  baseTemplateId?: string | null;
  dynamicContext?: string | null;
  // No default — every caller must say which of 'manual' | 'external_api' it is, so
  // usage/cost attribution (telephony_jobs.source) is never left to guesswork.
  source: 'manual' | 'external_api';
}): Promise<{ job: typeof telephonyJobs.$inferSelect | null; error?: string; callId?: number | null }> {
  const phone = normalizePhone(params.phone);
  const outboundChannel = normalizeOutboundChannel(params.outboundChannel);
  const trunkId = String(params.trunkId ?? '').trim() || null;
  if (!phone) {
    const callId = await ensureUnreachedCallSummary({
      agentId: params.agentId,
      customerId: params.customerId,
      phone,
      summary: 'Nömrə qeyd olunmayıb',
      error: 'phone is required',
    });
    return { job: null, error: 'phone is required', callId };
  }

  const [job] = await db.insert(telephonyJobs).values({
    agentId: params.agentId,
    customerId: params.customerId,
    phone,
    outboundChannel,
    trunkId,
    baseTemplateId: params.baseTemplateId ?? null,
    dynamicContext: params.dynamicContext ?? null,
    source: params.source,
  }).returning();

  return { job };
}

// Manual single-call dialing is an AI/telephony testing tool, not part of the campaign_manager
// workflow (campaigns are started/managed via the campaigns router), so it's admin-only.
telephonyRouter.post('/jobs', requireAuth, requireRole('admin'), async (req, res) => {
  const customerId = Number(req.body.customerId);
  const agentId = Number(req.body.agentId ?? process.env.DEFAULT_TELEPHONY_AGENT_ID);

  if (!Number.isInteger(customerId) || customerId <= 0 || !Number.isInteger(agentId) || agentId <= 0) {
    res.status(400).json({ error: 'customerId and agentId are required' });
    return;
  }

  const [[customer], [agent]] = await Promise.all([
    db.select().from(customers).where(eq(customers.id, customerId)).limit(1),
    db.select().from(agents).where(eq(agents.id, agentId)).limit(1),
  ]);

  if (!customer) {
    res.status(404).json({ error: 'customer not found' });
    return;
  }
  if (!agent) {
    res.status(404).json({ error: 'agent not found' });
    return;
  }

  const result = await createTelephonyJob({
    agentId,
    customerId,
    phone: req.body.phone ?? customer.phone,
    outboundChannel: req.body.outboundChannel ?? req.body.outbound_channel,
    trunkId: req.body.trunkId ?? req.body.trunk_id,
    source: 'manual',
  });
  if (!result.job) {
    res.status(400).json({ error: result.error, callId: result.callId });
    return;
  }

  res.status(202).json({ job: result.job });
});

telephonyRouter.post('/classify-audio', async (req, res) => {
  if (!requireWorkerAuth(req, res)) return;

  const audioBase64 = String(req.body.audioBase64 ?? '');
  const mimeType = String(req.body.mimeType ?? 'audio/wav').slice(0, 80);
  if (!audioBase64 || audioBase64.length > 2_500_000) {
    res.status(400).json({ error: 'audioBase64 is required or too large' });
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const response = await ai.models.generateContent({
      model: process.env.EARLY_MEDIA_CLASSIFICATION_MODEL || 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          {
            text: `Bu audio mobil operatorun early-media elanıdır. Müştəri danışığı deyil.
Səsi dinlə və zəng nəticəsini təsnif et.

Kateqoriyalar:
- number_not_exist: operator nömrənin mövcud olmadığını, səhv yığıldığını, xidmətdən kənar olduğunu və ya belə nömrə olmadığını deyir.
- busy: xətt/nömrə məşğuldur.
- no_answer: çağırış gedir, amma cavab yoxdur.
- unavailable: telefon söndürülüb, abunəçi əlçatan deyil, şəbəkədən kənardır.
- unknown: dəqiq anlaşılan operator elanı yoxdur.

Yalnız JSON qaytar:
{"category":"number_not_exist|busy|no_answer|unavailable|unknown","transcript":"eşitdiyin qısa mətn","confidence":0.0}`,
          },
          { inlineData: { mimeType, data: audioBase64 } },
        ],
      }],
      config: { temperature: 0 },
    });
    const parsed = parseJsonObject(response.text || '');
    const category = String(parsed.category || 'unknown');
    const reason = classificationReason(category);
    res.json({
      category,
      reason,
      transcript: String(parsed.transcript || '').slice(0, 1000),
      confidence: Number(parsed.confidence || 0) || 0,
    });
  } catch (err) {
    console.error('Early media classification failed', err);
    res.status(500).json({ error: 'early media classification failed' });
  }
});


telephonyRouter.get('/jobs/status/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid job id' });
    return;
  }

  await db.execute(sql`
    UPDATE telephony_jobs
    SET status = 'failed',
        completed_at = now(),
        updated_at = now(),
        duration_seconds = 0,
        last_error = coalesce(nullif(last_error, ''), 'call was not answered or was cancelled before answer')
    WHERE id = ${id}
      AND status IN ('pending', 'claimed', 'dialing')
      AND answered_at IS NULL
      AND completed_at IS NULL
      AND created_at < now() - (${staleDialingSeconds} * interval '1 second')
  `);

  const [job] = await db
    .select({
      id: telephonyJobs.id,
      status: telephonyJobs.status,
      agentId: telephonyJobs.agentId,
      agentName: agents.name,
      customerId: telephonyJobs.customerId,
      customerName: customers.name,
      customerSurname: customers.surname,
      customerFatherName: customers.fatherName,
      customerPhone: customers.phone,
      phone: telephonyJobs.phone,
      outboundChannel: telephonyJobs.outboundChannel,
      trunkId: telephonyJobs.trunkId,
      attempts: telephonyJobs.attempts,
      lastError: telephonyJobs.lastError,
      channelId: telephonyJobs.channelId,
      createdAt: telephonyJobs.createdAt,
      claimedAt: telephonyJobs.claimedAt,
      answeredAt: telephonyJobs.answeredAt,
      completedAt: telephonyJobs.completedAt,
      durationSeconds: telephonyJobs.durationSeconds,
      workerId: telephonyJobs.workerId,
    })
    .from(telephonyJobs)
    .leftJoin(customers, eq(customers.id, telephonyJobs.customerId))
    .leftJoin(agents, eq(agents.id, telephonyJobs.agentId))
    .where(eq(telephonyJobs.id, id))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: 'job not found' });
    return;
  }

  res.json({ job });
});

telephonyRouter.get('/jobs/next', async (req, res) => {
  if (!requireWorkerAuth(req, res)) return;

  const workerId = String(req.query.workerId ?? 'robocall-asterisk').slice(0, 120);
  const claimToken = randomUUID();

  // Strict pre-dial template check: a job with base_template_id set must use exactly that
  // template — no falling back to a campaign's or the global active template (see
  // schema.ts's telephonyJobs.baseTemplateId comment). Fail these out BEFORE they can be
  // claimed, so the phone never rings on a broken/deactivated template; the external
  // call-trigger API's caller is notified via finalizeFailedJob -> notifyExternalCallback.
  const failedTemplateJobs = rowsFrom(await db.execute(sql`
    UPDATE telephony_jobs t
    SET status = 'failed',
        completed_at = now(),
        updated_at = now(),
        last_error = 'base_template_unavailable'
    WHERE t.status = 'pending'
      AND t.base_template_id IS NOT NULL
      AND NOT EXISTS (
        -- is_active is deliberately not checked here: it only decides the fallback used
        -- when no template is specified, not whether a directly-referenced one is usable
        -- (see templates.ts's loadTemplateById / baseTemplateExists). A pinned template is
        -- only "unavailable" if the row itself no longer exists.
        SELECT 1 FROM instruction_templates it
        WHERE it.id = t.base_template_id AND it.template_type = 'base'
      )
    RETURNING id, agent_id AS "agentId", customer_id AS "customerId", phone,
              created_at AS "createdAt", answered_at AS "answeredAt"
  `));
  for (const failedJob of failedTemplateJobs) {
    await finalizeFailedJob(failedJob as { id: number }, 'base_template_unavailable');
  }

  // A trunk maps to a single physical channel with the provider, so at most
  // one job per non-null trunk_id may be claimed/dialing/answered at a time.
  // The advisory lock closes the race window that FOR UPDATE SKIP LOCKED
  // alone leaves open: it only locks the chosen row, not the rows the
  // correlated NOT EXISTS reads, so two concurrent claims for the same
  // trunk could otherwise both pass the check before either commits.
  const result = await db.execute(sql`
    UPDATE telephony_jobs
    SET status = 'claimed',
        worker_id = ${workerId},
        claim_token = ${claimToken},
        attempts = attempts + 1,
        claimed_at = now(),
        updated_at = now(),
        last_error = null
    WHERE id = (
      SELECT t.id
      FROM telephony_jobs t
      WHERE (t.status = 'pending' OR (t.status = 'claimed' AND t.claimed_at < now() - interval '2 minutes'))
        AND (t.trunk_id IS NULL OR pg_try_advisory_xact_lock(hashtext(t.trunk_id)))
        AND (
          t.trunk_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM telephony_jobs busy
            WHERE busy.trunk_id = t.trunk_id
              AND busy.id <> t.id
              AND (
                -- Genuinely in-progress call: answered and not absurdly old
                -- (3h backstop only guards against a worker crashing mid-call
                -- and never calling /complete; real calls end long before that).
                (busy.status = 'answered' AND busy.answered_at > now() - interval '3 hours')
                OR (
                  -- Still ringing/connecting: only counts as busy while fresh.
                  -- A job that hasn't been answered within staleDialingSeconds
                  -- of creation is treated as abandoned elsewhere in this file
                  -- (see /jobs/status/:id) and must not block the trunk forever.
                  busy.status IN ('claimed', 'dialing')
                  AND busy.answered_at IS NULL
                  AND busy.created_at > now() - (${staleDialingSeconds} * interval '1 second')
                )
              )
          )
        )
      ORDER BY t.created_at ASC
      FOR UPDATE OF t SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, agent_id, customer_id, phone, outbound_channel, trunk_id, status, worker_id, claim_token, attempts, created_at, claimed_at
  `);
  const [job] = rowsFrom(result);

  if (!job) {
    res.status(204).end();
    return;
  }

  res.json({ job });
});

telephonyRouter.post('/jobs/:id/complete', async (req, res) => {
  if (!requireWorkerAuth(req, res)) return;

  const id = Number(req.params.id);
  const claimToken = String(req.body.claimToken ?? '');
  const result = await db.execute(sql`
    UPDATE telephony_jobs
    SET status = CASE
          WHEN status IN ('pending', 'claimed') THEN 'dialing'
          ELSE status
        END,
        updated_at = now(),
        last_error = CASE
          WHEN status IN ('pending', 'claimed', 'dialing', 'answered') THEN null
          ELSE last_error
        END
    WHERE id = ${id} AND claim_token = ${claimToken}
    RETURNING id, status
  `);
  const [job] = rowsFrom(result);

  if (!job) {
    res.status(404).json({ error: 'claimed job not found' });
    return;
  }

  res.json({ job });
});


telephonyRouter.post('/jobs/:id/event', async (req, res) => {
  if (!requireWorkerAuth(req, res)) return;

  const id = Number(req.params.id);
  const status = lifecycleStatus(req.body.status);
  const channelId = String(req.body.channelId ?? '').slice(0, 180) || null;

  if (!Number.isInteger(id) || id <= 0 || !status) {
    res.status(400).json({ error: 'invalid job event' });
    return;
  }

  const [current] = await db.select().from(telephonyJobs).where(eq(telephonyJobs.id, id)).limit(1);
  if (!current) {
    res.status(404).json({ error: 'job not found' });
    return;
  }

  const endedAt = req.body.endedAt ? String(req.body.endedAt) : new Date().toISOString();
  const result = status === 'answered'
    ? await db.execute(sql`
      UPDATE telephony_jobs
      SET status = 'answered',
          channel_id = coalesce(${channelId}, channel_id),
          answered_at = coalesce(answered_at, now()),
          updated_at = now(),
          last_error = null
      WHERE id = ${id}
      RETURNING id, status
    `)
    : status === 'ended'
      ? await db.execute(sql`
        UPDATE telephony_jobs
        SET status = 'ended',
            channel_id = coalesce(${channelId}, channel_id),
            completed_at = now(),
            duration_seconds = coalesce(${durationSeconds(current.answeredAt, endedAt)}, duration_seconds, 0),
            updated_at = now(),
            last_error = null
        WHERE id = ${id}
        RETURNING id, status, duration_seconds
      `)
      : status === 'failed'
        ? await db.execute(sql`
          UPDATE telephony_jobs
          SET status = 'failed',
              completed_at = now(),
              updated_at = now(),
              last_error = ${String(req.body.error ?? 'call failed').slice(0, 2000)}
          WHERE id = ${id}
          RETURNING id, status, last_error, agent_id AS "agentId", customer_id AS "customerId", phone, created_at AS "createdAt", answered_at AS "answeredAt"
        `)
        : await db.execute(sql`
          UPDATE telephony_jobs
          SET status = 'dialing',
              channel_id = coalesce(${channelId}, channel_id),
              updated_at = now(),
              last_error = null
          WHERE id = ${id}
          RETURNING id, status
        `);

  const [job] = rowsFrom(result);
  if (status === 'failed' && !current.answeredAt) {
    await finalizeFailedJob(current, String(req.body.error ?? job?.last_error ?? 'call failed'));
  } else if (status === 'ended' || status === 'failed') {
    // Update campaign statistics when job completes
    await handleJobCompletion(id, status, Boolean(current.answeredAt));
    await notifyExternalCallback(id, status, {
      durationSeconds: status === 'ended' ? Number((job as Record<string, unknown>)?.duration_seconds ?? 0) || null : null,
      failureReason: status === 'failed' ? String(req.body.error ?? job?.last_error ?? 'call failed') : null,
    }).catch((err) => console.error(`External callback failed for job ${id}:`, err));
  }

  res.json({ job });
});

telephonyRouter.post('/jobs/:id/fail', async (req, res) => {
  if (!requireWorkerAuth(req, res)) return;

  const id = Number(req.params.id);
  const claimToken = String(req.body.claimToken ?? '');
  const retry = req.body.retry !== false;
  const status = retry ? 'pending' : 'failed';
  const lastError = String(req.body.error ?? 'telephony worker failed').slice(0, 2000);
  const result = await db.execute(sql`
    UPDATE telephony_jobs
    SET status = ${status},
        claim_token = null,
        claimed_at = CASE WHEN ${retry} THEN null ELSE claimed_at END,
        completed_at = CASE WHEN ${retry} THEN null ELSE now() END,
        updated_at = now(),
        last_error = ${lastError}
    WHERE id = ${id} AND claim_token = ${claimToken}
    RETURNING id, status, last_error, agent_id AS "agentId", customer_id AS "customerId", phone, created_at AS "createdAt", answered_at AS "answeredAt"
  `);
  const [job] = rowsFrom(result);

  if (!job) {
    res.status(404).json({ error: 'claimed job not found' });
    return;
  }

  if (!retry) {
    if (!job.answeredAt) {
      await finalizeFailedJob(job as { id: number }, lastError);
    } else {
      // Update campaign statistics when job fails permanently
      await handleJobCompletion(id, 'failed', Boolean(job.answeredAt));
      await notifyExternalCallback(id, 'failed', { failureReason: lastError }).catch((err) => {
        console.error(`External callback failed for job ${id}:`, err);
      });
    }
  }

  res.json({ job });
});
