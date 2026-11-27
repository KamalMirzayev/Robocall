import { sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { recordArzoomFeedback } from './arzoom-sync.js';
import { recordCampaignResult } from './campaign-results.js';
import { emailsOf, sendMail, smtpConfigured } from './mailer.js';

// Customers who agreed to talk to a rep, were put on the line, and nobody picked up.
// - backfillAgreedNotConnected(): calls before this was handled live get the same result now:
//   handed to sales (ARZOOM feedback / campaign result) with a "call back" note.
// - sendFailedTransferDigest(): every day at TRANSFER_FAIL_DIGEST_TIME (Baku, default 17:55),
//   one mail per campaign to its owners with the customers not mailed yet (each is mailed once).

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(rows) ? rows : [];
}

export async function ensureTransferFailSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS transfer_fail_mails (
      telephony_job_id integer PRIMARY KEY,
      sent_at timestamptz NOT NULL DEFAULT now()
    )`);
}

export async function markMailed(jobIds: number[]): Promise<void> {
  if (!jobIds.length) return;
  await ensureTransferFailSchema();
  await db.execute(sql`
    INSERT INTO transfer_fail_mails (telephony_job_id)
    SELECT unnest(${`{${jobIds.join(',')}}`}::int[]) ON CONFLICT DO NOTHING`);
}

export async function wasMailed(jobId: number): Promise<boolean> {
  await ensureTransferFailSchema();
  const [row] = rowsFrom(await db.execute(sql`SELECT 1 FROM transfer_fail_mails WHERE telephony_job_id = ${jobId}`));
  return !!row;
}

/** Jobs with a transfer attempt that no rep answered, since a Baku day. */
async function failedJobs(sinceDay: string) {
  return rowsFrom(await db.execute(sql`
    SELECT tj.id AS job, tj.customer_id, tj.campaign_id, ca.name AS campaign, ca.segment, ca.segment_params AS params,
           c.name, c.surname, c.phone, c.source_system, c.source_record_key, c.import_data AS data,
           min(t.created_at) AS at,
           string_agg(DISTINCT t.reason, '; ') AS why,
           max(t.brand) AS brand
    FROM sales_transfers t
    JOIN telephony_jobs tj ON tj.id = t.telephony_job_id
    JOIN customers c ON c.id = tj.customer_id
    LEFT JOIN campaigns ca ON ca.id = tj.campaign_id
    WHERE t.created_at >= (${sinceDay}::date::timestamp AT TIME ZONE 'Asia/Baku')
      AND t.status <> 'not_configured'
      AND NOT EXISTS (SELECT 1 FROM sales_transfers a WHERE a.telephony_job_id = t.telephony_job_id AND a.status = 'answered')
    GROUP BY tj.id, ca.id, c.id
    ORDER BY min(t.created_at)
  `));
}

/** Records the old ones as handed to sales. Returns how many were changed. */
export async function backfillAgreedNotConnected(sinceDay: string): Promise<{ checked: number; recorded: number }> {
  const jobs = await failedJobs(sinceDay);
  let recorded = 0;
  for (const j of jobs) {
    const jobId = Number(j.job);
    const customerId = Number(j.customer_id);
    const note = `Müştəri nümayəndə ilə danışmağa razı oldu, amma xəttə qoşulmadı (${String(j.why || 'cavab verilmədi').slice(0, 200)}). Satış nümayəndəsi müştəriyə geri zəng etməlidir.`;
    if (j.source_system === 'arzoom') {
      // Skip when already recorded, or when a later call gave a newer answer that must stay the latest.
      const [done] = rowsFrom(await db.execute(sql`SELECT 1 FROM arzoom_feedback WHERE customer_id = ${customerId}
        AND (telephony_job_id = ${jobId} AND outcome = 'transferred_to_sales' OR telephony_job_id > ${jobId}) LIMIT 1`));
      if (done) continue;
      const r = await recordArzoomFeedback({ customerId, telephonyJobId: jobId, outcome: 'transferred_to_sales', reason: note });
      if (r.ok) recorded += 1;
    } else {
      const [done] = rowsFrom(await db.execute(sql`SELECT 1 FROM campaign_results WHERE customer_id = ${customerId}
        AND (telephony_job_id = ${jobId} AND outcome = 'transferred_to_rep' OR telephony_job_id > ${jobId}) LIMIT 1`));
      if (done) continue;
      const r = await recordCampaignResult({ customerId, telephonyJobId: jobId, outcome: 'transferred_to_rep', reason: note, brand: (j.brand as string) || null });
      if (r.ok) recorded += 1;
    }
  }
  return { checked: jobs.length, recorded };
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const TD = 'border:1px solid #d0d7de;padding:6px 10px;vertical-align:top';
const bakuTime = (d: unknown) => new Intl.DateTimeFormat('az-AZ', { timeZone: 'Asia/Baku', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(String(d)));

/** One mail per campaign with the customers not mailed yet. */
export async function sendFailedTransferDigest(sinceDay: string): Promise<{ campaigns: number; customers: number; skipped: string[] }> {
  await ensureTransferFailSchema();
  const skipped: string[] = [];
  if (!smtpConfigured()) return { campaigns: 0, customers: 0, skipped: ['SMTP is not configured'] };
  const sent = new Set(rowsFrom(await db.execute(sql`SELECT telephony_job_id FROM transfer_fail_mails`)).map((r) => Number(r.telephony_job_id)));
  const byCampaign = new Map<string, Record<string, unknown>[]>();
  for (const j of await failedJobs(sinceDay)) {
    if (sent.has(Number(j.job))) continue;
    const key = String(j.campaign_id ?? '-');
    byCampaign.set(key, [...(byCampaign.get(key) ?? []), j]);
  }
  let campaigns = 0;
  let customers = 0;
  for (const [, jobs] of byCampaign) {
    const first = jobs[0];
    const params = (typeof first.params === 'string' ? JSON.parse(first.params) : first.params) as Record<string, unknown> | null;
    const to = [...new Set([...emailsOf(params?.transferFailEmails), ...(first.segment === 'service_return' ? emailsOf(params?.coordinatorEmail) : [])].map((x) => x.toLowerCase()))];
    const campaign = String(first.campaign || 'Kampaniyasız zənglər');
    if (!to.length) {
      skipped.push(`${campaign}: sahiblərin e-poçtu yazılmayıb (${jobs.length} müştəri)`);
      continue;
    }
    const rows = jobs.map((j) => {
      const data = (typeof j.data === 'string' ? JSON.parse(j.data) : j.data || {}) as Record<string, unknown>;
      const name = [j.name, j.surname].map((x) => String(x ?? '').trim()).filter((x) => x && x !== '-' && !/hörmətli|müştəri/i.test(x)).join(' ') || 'Müştəri';
      const extra = j.source_system === 'arzoom' ? `ARZOOM ${j.source_record_key}` : [j.brand || data.brand, data.model, data.plate].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ');
      return `<tr><td style="${TD}">${esc(bakuTime(j.at))}</td><td style="${TD}">${esc(name)}</td><td style="${TD}">${esc(j.phone)}</td><td style="${TD}">${esc(extra)}</td><td style="${TD}">${esc(j.why || 'cavab verilmədi')}</td></tr>`;
    }).join('');
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">
<p>Salam.</p>
<p><b>${esc(campaign)}</b> üzrə bu müştərilər nümayəndə ilə danışmağa razı oldu, bot onları xəttə qoşdu, amma cavab verilmədi. Zəhmət olmasa, geri zəng edin.</p>
<table style="border-collapse:collapse;font-size:13px"><tr><th style="${TD};background:#f6f8fa">Vaxt</th><th style="${TD};background:#f6f8fa">Müştəri</th><th style="${TD};background:#f6f8fa">Telefon</th><th style="${TD};background:#f6f8fa">Müraciət / avtomobil</th><th style="${TD};background:#f6f8fa">Niyə qoşulmadı</th></tr>${rows}</table>
<p style="color:#666;font-size:12px">ArzoomCall günlük siyahısı. Əvvəl göndərilmiş müştərilər bura daxil deyil.</p></div>`;
    try {
      await sendMail({ to, subject: `${campaign}: geri zəng gözləyən ${jobs.length} müştəri`, html });
      await markMailed(jobs.map((j) => Number(j.job)));
      campaigns += 1;
      customers += jobs.length;
    } catch (err) {
      skipped.push(`${campaign}: ${(err as Error).message.slice(0, 200)}`);
    }
  }
  return { campaigns, customers, skipped };
}

const bakuDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const bakuHm = (d = new Date()) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baku', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

export function startTransferFailDigestScheduler(): void {
  if (String(process.env.TRANSFER_FAIL_DIGEST || 'on').toLowerCase() === 'off') return;
  const at = String(process.env.TRANSFER_FAIL_DIGEST_TIME || '17:55');
  let lastDay = '';
  const tick = async () => {
    const day = bakuDay();
    if (day === lastDay || bakuHm() < at) return;
    lastDay = day;
    try {
      const since = bakuDay(new Date(Date.now() - 30 * 86400_000));
      const r = await sendFailedTransferDigest(since);
      console.log(`[transfer-fail] digest: ${r.customers} customers in ${r.campaigns} campaigns${r.skipped.length ? `; skipped: ${r.skipped.join(' | ')}` : ''}`);
    } catch (err) {
      console.warn(`[transfer-fail] digest failed: ${(err as Error).message}`);
    }
  };
  setInterval(() => void tick(), 60_000).unref();
}
