import nodemailer from 'nodemailer';
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';

// E-mail through SMTP (SMTP_HOST, SMTP_PORT 587/465, SMTP_USER, SMTP_PASSWORD, optional MAIL_FROM).
// Used to hand a campaign customer to a person by mail when the live transfer did not go
// through (the Mazda service coordinator's mobile was busy or did not answer).

const env = (k: string) => String(process.env[k] || '').trim();

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(rows) ? rows : [];
}

export function smtpConfigured(): boolean {
  return !!(env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASSWORD'));
}

export async function sendMail(p: { to: string[]; subject: string; html: string }): Promise<void> {
  if (!smtpConfigured()) throw new Error('SMTP is not configured (SMTP_HOST, SMTP_USER, SMTP_PASSWORD)');
  if (!p.to.length) throw new Error('no recipients');
  const port = Number(env('SMTP_PORT') || 587);
  const transport = nodemailer.createTransport({
    host: env('SMTP_HOST'),
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: env('SMTP_USER'), pass: env('SMTP_PASSWORD') },
    connectionTimeout: 15_000,
  });
  await transport.sendMail({ from: env('MAIL_FROM') || env('SMTP_USER'), to: p.to.join(', '), subject: p.subject, html: p.html });
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export function emailsOf(v: unknown): string[] {
  return String(v ?? '').split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 10);
}

const TD = 'border:1px solid #d0d7de;padding:6px 10px;vertical-align:top';

const segmentName: Record<string, string> = {
  application_status: 'Kredit müraciətinin nəticəsi',
  credit_offer: 'Kredit təklifi (churn)',
  trade_in: 'Trade-in',
  service_return: 'Servis kampaniyası',
};

/**
 * After any campaign call where the customer agreed to talk to a person and the bot tried to
 * put them through, but nobody picked up (busy, no answer, the queue dropped, the customer left
 * while waiting): mail the customer's details, the result and the transcript.
 * Recipients: the campaign's transferFailEmails (and a service campaign's coordinatorEmail),
 * plus TRANSFER_FAIL_EMAILS from the Integrations panel for every campaign.
 * Errors are logged, never thrown.
 */
export async function notifyFailedTransferByMail(p: { customerId: number; telephonyJobId: number | null; transcript: string | null }): Promise<void> {
  try {
    if (!p.telephonyJobId) return;
    const [row] = rowsFrom(await db.execute(sql`
      SELECT ca.name AS campaign, ca.segment, ca.segment_params AS params,
             c.name, c.surname, c.phone, c.import_data AS data, c.source_system, c.source_record_key,
             (SELECT jsonb_agg(jsonb_build_object('status', t.status, 'brand', t.brand, 'reason', t.reason) ORDER BY t.id)
                FROM sales_transfers t WHERE t.telephony_job_id = ${p.telephonyJobId}) AS transfers,
             (SELECT concat_ws(' — ', r.outcome_label, nullif(r.reason, '')) FROM campaign_results r
                WHERE r.telephony_job_id = ${p.telephonyJobId} ORDER BY r.id DESC LIMIT 1) AS result,
             (SELECT concat_ws(' — ', f.outcome_label, nullif(f.reason, '')) FROM arzoom_feedback f
                WHERE f.telephony_job_id = ${p.telephonyJobId} ORDER BY f.id DESC LIMIT 1) AS feedback
      FROM telephony_jobs tj LEFT JOIN campaigns ca ON ca.id = tj.campaign_id JOIN customers c ON c.id = ${p.customerId}
      WHERE tj.id = ${p.telephonyJobId}
    `));
    if (!row) return;
    const transcript = String(p.transcript || '');
    const transfers = (Array.isArray(row.transfers) ? row.transfers : []) as Array<{ status: string; brand: string | null; reason: string | null }>;
    if (transfers.some((t) => t.status === 'answered')) return;
    const failed = transcript.includes('qoşmaq alınmadı') || transfers.some((t) => t.status !== 'not_configured');
    if (!failed) return;
    const params = (typeof row.params === 'string' ? JSON.parse(row.params) : row.params) as Record<string, unknown> | null;
    const to = [...new Set([
      ...emailsOf(params?.transferFailEmails),
      ...(row.segment === 'service_return' ? emailsOf(params?.coordinatorEmail) : []),
      ...emailsOf(process.env.TRANSFER_FAIL_EMAILS),
    ].map((x) => x.toLowerCase()))];
    if (!to.length) return;
    if (!smtpConfigured()) {
      console.warn(`[mail] job ${p.telephonyJobId}: failed-transfer e-mail not sent, SMTP is not configured`);
      return;
    }
    const data = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data || {}) as Record<string, unknown>;
    const name = [row.name, row.surname].map((x) => String(x ?? '').trim()).filter((x) => x && x !== '-' && !/hörmətli|müştəri/i.test(x)).join(' ') || 'Müştəri';
    const brand = transfers.map((t) => t.brand).find(Boolean) || data.brand;
    const car = [brand, data.model].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ').replace(/^(\w+) \1/i, '$1');
    const why = [...new Set(transfers.map((t) => t.reason).filter(Boolean))].join('; ');
    const when = new Intl.DateTimeFormat('az-AZ', { timeZone: 'Asia/Baku', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    const campaign = String(row.campaign || segmentName[String(row.segment)] || 'Kampaniya');
    const rows: Array<[string, unknown]> = [
      ['Kampaniya', campaign],
      ['Müştəri', name],
      ['Telefon', row.phone],
      ['ARZOOM müraciəti', row.source_system === 'arzoom' ? row.source_record_key : ''],
      ['Marka / avtomobil', car],
      ['Dövlət nömrəsi', data.plate],
      ['VİN', data.vin],
      ['Nəticə', row.result || row.feedback || 'Nümayəndə ilə danışmağa razı oldu'],
      ['Niyə qoşulmadı', why || 'Nümayəndə cavab vermədi'],
      ['Zəng vaxtı', when],
    ];
    const coordinator = row.segment === 'service_return' ? String(params?.coordinatorName || '').trim() : '';
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">
<p>Salam${coordinator ? `, ${esc(coordinator)}` : ''}.</p>
<p><b>${esc(campaign)}</b> üzrə müştəri nümayəndə ilə danışmağa razı oldu, bot onu xəttə qoşdu, amma cavab verilmədi. Zəhmət olmasa, müştəri ilə əlaqə saxlayın.</p>
<table style="border-collapse:collapse;font-size:13px">${rows.filter(([, v]) => String(v ?? '').trim()).map(([k, v]) => `<tr><td style="${TD};background:#f6f8fa"><b>${esc(k)}</b></td><td style="${TD}">${esc(v)}</td></tr>`).join('')}</table>
<p style="margin-top:16px"><b>Danışıq</b></p>
<pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;background:#f6f8fa;padding:10px;border-radius:6px">${esc(transcript.slice(0, 8000))}</pre>
<p style="color:#666;font-size:12px">ArzoomCall avtomatik məktubu.</p></div>`;
    await sendMail({ to, subject: `${campaign}: ${name} nümayəndə ilə əlaqə gözləyir`, html });
    console.log(`[mail] job ${p.telephonyJobId}: failed-transfer e-mail sent (${to.length} recipient)`);
  } catch (err) {
    console.error(`[mail] job ${p.telephonyJobId ?? '-'}: failed-transfer e-mail failed`, (err as Error).message);
  }
}
