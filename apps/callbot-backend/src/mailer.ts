import nodemailer from 'nodemailer';
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';

// E-mail to managers about ARZOOM leasing customers handed to a sales rep: one mail per
// transfer as it happens, and a summary of the day at REPORT_DAILY_AT (Baku time).
//
// Sending goes through Microsoft 365: either Microsoft Graph (an app registration with the
// Mail.Send application permission: MS365_TENANT_ID, MS365_CLIENT_ID, MS365_CLIENT_SECRET,
// sent as MAIL_FROM), or SMTP (SMTP_HOST, e.g. smtp.office365.com, SMTP_PORT 587, SMTP_USER,
// SMTP_PASSWORD; the mailbox needs SMTP AUTH enabled). Graph is used when both are set.
// Recipients: REPORT_EMAILS, comma separated. Nothing is sent while it is empty.

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(rows) ? rows : [];
}

const env = (k: string) => String(process.env[k] || '').trim();

export function reportRecipients(): string[] {
  return env('REPORT_EMAILS').split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 30);
}

export function mailConfigured(): { mode: 'graph' | 'smtp' | null; recipients: number } {
  const graph = env('MS365_TENANT_ID') && env('MS365_CLIENT_ID') && env('MS365_CLIENT_SECRET') && env('MAIL_FROM');
  const smtp = env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASSWORD');
  return { mode: graph ? 'graph' : smtp ? 'smtp' : null, recipients: reportRecipients().length };
}

let graphToken: { value: string; until: number; key: string } | null = null;

async function graphAccessToken(): Promise<string> {
  const key = `${env('MS365_TENANT_ID')}|${env('MS365_CLIENT_ID')}|${env('MS365_CLIENT_SECRET')}`;
  if (graphToken && graphToken.key === key && graphToken.until > Date.now() + 60_000) return graphToken.value;
  const body = new URLSearchParams({
    client_id: env('MS365_CLIENT_ID'),
    client_secret: env('MS365_CLIENT_SECRET'),
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env('MS365_TENANT_ID'))}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !data.access_token) throw new Error(`Microsoft login: ${data.error || res.status} ${String(data.error_description || '').split('\n')[0].slice(0, 200)}`);
  graphToken = { value: data.access_token, until: Date.now() + (data.expires_in ?? 3600) * 1000, key };
  return data.access_token;
}

export async function sendMail(p: { to: string[]; subject: string; html: string }): Promise<void> {
  const { mode } = mailConfigured();
  if (!mode) throw new Error('e-mail is not configured');
  if (!p.to.length) throw new Error('no recipients');
  if (mode === 'graph') {
    const token = await graphAccessToken();
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env('MAIL_FROM'))}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: p.subject,
          body: { contentType: 'HTML', content: p.html },
          toRecipients: p.to.map((address) => ({ emailAddress: { address } })),
        },
        saveToSentItems: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Microsoft Graph ${res.status}: ${text.slice(0, 300)}`);
    }
    return;
  }
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

function bakuTime(d: Date | string): string {
  return new Intl.DateTimeFormat('az-AZ', { timeZone: 'Asia/Baku', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
}

function flatTerms(v: unknown): string {
  if (!v || typeof v !== 'object') return '';
  return Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== null && x !== '' && typeof x !== 'object')
    .slice(0, 12)
    .map(([k, x]) => `${esc(k)}: ${esc(x)}`)
    .join('<br>');
}

const TABLE = 'border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:13px';
const TD = 'border:1px solid #d0d7de;padding:6px 10px;vertical-align:top';

// One mail per ARZOOM customer connected to a sales rep. Errors are logged, never thrown.
export async function notifyTransfer(p: { customerId: number; telephonyJobId: number | null; extension: string; brand: string | null; customerSaid: string[] }): Promise<void> {
  const to = reportRecipients();
  if (!to.length || !mailConfigured().mode) return;
  try {
    const [cu] = rowsFrom(await db.execute(sql`
      SELECT name, surname, phone, source_system, source_record_key, application_status,
             arzoom_data->'final_terms' AS final_terms, arzoom_data->'offer' AS offer
      FROM customers WHERE id = ${p.customerId}
    `));
    if (!cu || cu.source_system !== 'arzoom') return;
    const name = [cu.name, cu.surname].filter((x) => x && x !== '-').join(' ');
    const terms = flatTerms(cu.final_terms) || flatTerms(cu.offer);
    const said = p.customerSaid.slice(-6).map((x) => esc(x)).join('<br>');
    const rows: [string, string][] = [
      ['Vaxt', esc(bakuTime(new Date()))],
      ['Müraciət №', esc(cu.source_record_key)],
      ['Müştəri', esc(name || '—')],
      ['Telefon', esc(cu.phone)],
      ['Marka', esc(p.brand || '—')],
      ['Müraciət statusu', esc(cu.application_status || '—')],
      ['Qoşulduğu nümayəndə (daxili)', esc(p.extension)],
    ];
    if (terms) rows.push(['Təklifin şərtləri', terms]);
    if (said) rows.push(['Müştərinin son sözləri', said]);
    const html = `<p>ArzoomCall: lizinq müştərisi şərtlərlə razılaşdı və satış nümayəndəsinə qoşuldu.</p>
<table style="${TABLE}">${rows.map(([k, v]) => `<tr><td style="${TD};background:#f6f8fa;font-weight:600">${k}</td><td style="${TD}">${v}</td></tr>`).join('')}</table>
<p style="color:#666;font-size:12px">Zəng №${esc(p.telephonyJobId ?? '—')} · ArzoomCall avtomatik bildirişi</p>`;
    await sendMail({ to, subject: `ArzoomCall: satışa ötürüldü — ${name || cu.phone} (${p.brand || 'lizinq'})`, html });
    await logMail('transfer', String(p.telephonyJobId ?? ''), null);
  } catch (err) {
    console.warn('[mailer] transfer mail failed', (err as Error).message);
    await logMail('transfer', String(p.telephonyJobId ?? ''), (err as Error).message);
  }
}

async function ensureMailLog(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mail_log (
      id serial PRIMARY KEY,
      kind varchar(20) NOT NULL,
      ref varchar(40),
      error text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function logMail(kind: string, ref: string, error: string | null): Promise<void> {
  await db.execute(sql`INSERT INTO mail_log (kind, ref, error) VALUES (${kind}, ${ref.slice(0, 40)}, ${error ? error.slice(0, 500) : null})`).catch(() => {});
}

const REASON_AZ: Record<string, string> = {
  answered: 'Qoşuldu', answered_short: 'Qoşuldu, 20 san. içində kəsildi', no_answer: 'Nümayəndə açmadı', rejected: 'Məşğul / rədd',
  unreachable: 'Nömrə əlçatmaz', all_busy: 'Hamı məşğul', not_configured: 'Nümayəndə nömrəsi yoxdur', dial_failed: 'Yığım xətası',
  customer_left: 'Müştəri gözləmədə çıxdı', call_gone: 'Zəng artıq bitmişdi', error: 'Texniki xəta',
};

// Summary of today's ARZOOM transfers: who was connected to whom, and the ones that failed.
export async function sendDailyReport(): Promise<{ ok: boolean; error?: string; count?: number }> {
  const to = reportRecipients();
  if (!to.length || !mailConfigured().mode) return { ok: false, error: 'e-mail is not configured' };
  try {
    const rows = rowsFrom(await db.execute(sql`
      SELECT DISTINCT ON (st.telephony_job_id) st.created_at, st.extension, st.brand,
             CASE WHEN st.status = 'answered' AND st.ended_at IS NOT NULL AND st.ended_at - st.created_at < interval '20 seconds' THEN 'answered_short' ELSE st.status END AS status,
             cu.name, cu.surname, cu.phone, cu.source_record_key
      FROM sales_transfers st
      JOIN customers cu ON cu.id = st.customer_id AND cu.source_system = 'arzoom'
      WHERE st.created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Baku') AT TIME ZONE 'Asia/Baku'
      ORDER BY st.telephony_job_id, (st.status = 'answered') DESC, st.id DESC
    `));
    rows.sort((a, b) => new Date(String(a.created_at)).getTime() - new Date(String(b.created_at)).getTime());
    const ok = rows.filter((r) => r.status === 'answered').length;
    const [calls] = rowsFrom(await db.execute(sql`
      SELECT count(*)::int AS attempts, count(*) FILTER (WHERE tj.answered_at IS NOT NULL)::int AS answered
      FROM telephony_jobs tj JOIN customers cu ON cu.id = tj.customer_id AND cu.source_system = 'arzoom'
      WHERE tj.created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Baku') AT TIME ZONE 'Asia/Baku'
    `));
    const body = rows.length
      ? `<table style="${TABLE}"><tr>${['Vaxt', 'Müraciət №', 'Müştəri', 'Telefon', 'Marka', 'Daxili', 'Nəticə'].map((h) => `<th style="${TD};background:#f6f8fa;text-align:left">${h}</th>`).join('')}</tr>${rows
          .map((r) => `<tr>${[
            bakuTime(String(r.created_at)).split(' ').pop(),
            r.source_record_key,
            [r.name, r.surname].filter((x) => x && x !== '-').join(' ') || '—',
            r.phone,
            r.brand || '—',
            r.extension,
            REASON_AZ[String(r.status)] || r.status,
          ].map((v) => `<td style="${TD}">${esc(v)}</td>`).join('')}</tr>`)
          .join('')}</table>`
      : '<p>Bu gün satışa ötürmə olmayıb.</p>';
    const html = `<p>ArzoomCall — lizinq müraciətləri üzrə günlük hesabat (${esc(bakuTime(new Date()).split(' ')[0])}).</p>
<p>Zəng: <b>${Number(calls?.attempts || 0)}</b>, cavab verilən: <b>${Number(calls?.answered || 0)}</b>, satışa qoşulan müştəri: <b>${ok}</b>, qoşulmayan: <b>${rows.length - ok}</b>.</p>
${body}
<p style="color:#666;font-size:12px">ArzoomCall avtomatik hesabatı</p>`;
    await sendMail({ to, subject: `ArzoomCall günlük hesabat: ${ok} müştəri satışa qoşuldu`, html });
    await logMail('daily', new Date().toISOString().slice(0, 10), null);
    return { ok: true, count: rows.length };
  } catch (err) {
    console.warn('[mailer] daily report failed', (err as Error).message);
    await logMail('daily', new Date().toISOString().slice(0, 10), (err as Error).message);
    return { ok: false, error: (err as Error).message };
  }
}

export async function lastMailError(): Promise<{ at: string; error: string } | null> {
  const [row] = rowsFrom(await db.execute(sql`SELECT created_at, error FROM mail_log ORDER BY id DESC LIMIT 1`).catch(() => []));
  return row?.error ? { at: String(row.created_at), error: String(row.error) } : null;
}

// Daily report once a day at REPORT_DAILY_AT (Baku, default 19:05), Monday to Saturday.
export async function startMailReports(): Promise<void> {
  await ensureMailLog().catch((err) => console.warn('[mailer] schema', (err as Error).message));
  setInterval(() => {
    void (async () => {
      const at = env('REPORT_DAILY_AT') || '19:05';
      if (!/^\d{2}:\d{2}$/.test(at)) return;
      const now = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baku', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
      const part = (t: string) => now.find((x) => x.type === t)?.value ?? '';
      if (part('weekday') === 'Sun' || `${part('hour')}:${part('minute')}` !== at) return;
      if (!reportRecipients().length || !mailConfigured().mode) return;
      const [sent] = rowsFrom(await db.execute(sql`
        SELECT 1 FROM mail_log WHERE kind = 'daily' AND error IS NULL
          AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Baku') AT TIME ZONE 'Asia/Baku' LIMIT 1
      `));
      if (!sent) await sendDailyReport();
    })().catch((err) => console.warn('[mailer] scheduler', (err as Error).message));
  }, 30_000);
}
