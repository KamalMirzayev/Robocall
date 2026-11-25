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

/**
 * After a service-campaign call: when the customer wanted the coordinator but was not put
 * through live (transfer failed, or the bot took a "contact me" request), mail the customer's
 * details, the chosen service and the transcript to the campaign's coordinatorEmail.
 * Errors are logged, never thrown.
 */
export async function notifyCoordinatorByMail(p: { customerId: number; telephonyJobId: number | null; transcript: string | null }): Promise<void> {
  try {
    if (!p.telephonyJobId) return;
    const [row] = rowsFrom(await db.execute(sql`
      SELECT ca.name AS campaign, ca.segment, ca.segment_params AS params,
             c.name, c.surname, c.phone, c.import_data AS data,
             (SELECT jsonb_agg(jsonb_build_object('outcome', r.outcome, 'label', r.outcome_label, 'reason', r.reason) ORDER BY r.id)
                FROM campaign_results r WHERE r.telephony_job_id = ${p.telephonyJobId}) AS results
      FROM telephony_jobs tj JOIN campaigns ca ON ca.id = tj.campaign_id JOIN customers c ON c.id = ${p.customerId}
      WHERE tj.id = ${p.telephonyJobId}
    `));
    if (!row || row.segment !== 'service_return') return;
    const params = (typeof row.params === 'string' ? JSON.parse(row.params) : row.params) as Record<string, unknown> | null;
    const to = emailsOf(params?.coordinatorEmail);
    if (!to.length) return;
    const results = (Array.isArray(row.results) ? row.results : []) as Array<{ outcome: string; label: string; reason: string | null }>;
    const transcript = String(p.transcript || '');
    if (results.some((r) => r.outcome === 'transferred_to_rep')) return;
    const transferFailed = transcript.includes('qoşmaq alınmadı');
    const wantsContact = results.some((r) => r.outcome === 'wants_rep_contact');
    if (!transferFailed && !wantsContact) return;
    if (!smtpConfigured()) {
      console.warn(`[mail] job ${p.telephonyJobId}: coordinator e-mail not sent, SMTP is not configured`);
      return;
    }
    const data = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data || {}) as Record<string, unknown>;
    const name = [row.name, row.surname].map((x) => String(x ?? '').trim()).filter((x) => x && x !== '-').join(' ') || 'Müştəri';
    const car = [data.brand, data.model].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ').replace(/^Mazda Mazda/i, 'Mazda');
    const last = results[results.length - 1];
    const when = new Intl.DateTimeFormat('az-AZ', { timeZone: 'Asia/Baku', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    const rows: Array<[string, unknown]> = [
      ['Müştəri', name],
      ['Telefon', row.phone],
      ['Avtomobil', car],
      ['Dövlət nömrəsi', data.plate],
      ['VİN', data.vin],
      ['Nəticə', last ? last.label : 'Koordinatorla danışmaq istədi'],
      ['Qeyd (xidmət, uyğun vaxt)', last?.reason],
      ['Canlı qoşma', transferFailed ? 'Alınmadı (xətt məşğul idi və ya cavab verilmədi)' : 'Edilmədi'],
      ['Zəng vaxtı', when],
    ];
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">
<p>Salam${String(params?.coordinatorName || '').trim() ? `, ${esc(String(params?.coordinatorName).trim())}` : ''}.</p>
<p><b>${esc(row.campaign)}</b> üzrə müştəri sizinlə danışmaq istədi, amma canlı qoşmaq mümkün olmadı. Zəhmət olmasa, müştəri ilə əlaqə saxlayın.</p>
<table style="border-collapse:collapse;font-size:13px">${rows.filter(([, v]) => String(v ?? '').trim()).map(([k, v]) => `<tr><td style="${TD};background:#f6f8fa"><b>${esc(k)}</b></td><td style="${TD}">${esc(v)}</td></tr>`).join('')}</table>
<p style="margin-top:16px"><b>Danışıq</b></p>
<pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;background:#f6f8fa;padding:10px;border-radius:6px">${esc(transcript.slice(0, 8000))}</pre>
<p style="color:#666;font-size:12px">ArzoomCall avtomatik məktubu.</p></div>`;
    await sendMail({ to, subject: `${car || 'Servis'}: ${name} koordinatorla əlaqə gözləyir`, html });
    console.log(`[mail] job ${p.telephonyJobId}: coordinator e-mail sent (${to.length} recipient)`);
  } catch (err) {
    console.error(`[mail] job ${p.telephonyJobId ?? '-'}: coordinator e-mail failed`, (err as Error).message);
  }
}
