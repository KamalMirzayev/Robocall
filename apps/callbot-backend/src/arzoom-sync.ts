import { sql } from 'drizzle-orm';
import { db } from './db/index.js';

// ARZOOM (Arzoom Avto leasing app) -> robocall customers.
// GET {ARZOOM_API_URL}/api/integrations/robocall/applications?since=&limit= with header
// X-Integration-Token returns { items, has_more, next_since }, ordered by (changed_at, id).
// Each application becomes (or updates) one customer with source_system='arzoom' and
// source_record_key=<application id>. The full item is kept in customers.arzoom_data so the
// bot and the customers page can show it. URL and token come from the Integrations page.

export const ARZOOM_SOURCE = 'arzoom';
const CURSOR_KEY = 'arzoom_sync_cursor';
const PAGE_LIMIT = 500;
const MAX_PAGES_PER_RUN = 40;
const FETCH_TIMEOUT_MS = 20_000;
const INTERVAL_MS = Math.max(1, Number(process.env.ARZOOM_SYNC_MINUTES || 5)) * 60_000;

// ARZOOM status -> application_status segment's "result" value, used to auto-attach
// customers to active campaigns of that segment.
const STATUS_TO_RESULT: Record<string, string> = {
  review: 'in_review',
  info: 'needs_documents',
  offer: 'approved',
  accepted: 'approved',
  rejected: 'rejected',
};

interface ArzoomTerms {
  car_price?: number | null;
  down_payment_pct?: number | null;
  down_payment?: number | null;
  amount?: number | null;
  months?: number | null;
  monthly_payment?: number | null;
}

export interface ArzoomItem {
  id: string;
  deleted?: boolean;
  changed_at?: string;
  created_at?: string;
  phone?: string;
  status?: string;
  status_label?: string;
  fin_masked?: string;
  birth_date?: string | null;
  guarantor?: boolean | null;
  brand?: string | null;
  model?: string | null;
  car_price?: number | null;
  income_sources?: string[];
  partner?: string | null;
  partner_ref?: string | null;
  offer?: ArzoomTerms | null;
  final_terms?: ArzoomTerms | null;
  info_docs?: string[];
  info_text?: string | null;
  reject_reason?: string | null;
  last_call?: { outcome?: string; outcome_label?: string; channel?: string; text?: string; at?: string } | null;
  cabinet_url?: string | null;
}

const state: { running: Promise<void> | null; lastRunAt: Date | null; lastError: string | null; lastCount: number } = {
  running: null,
  lastRunAt: null,
  lastError: null,
  lastCount: 0,
};

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(rows) ? rows : [];
}

function endpoint(): { url: string; token: string } | null {
  const raw = String(process.env.ARZOOM_API_URL || '').trim();
  const token = String(process.env.ARZOOM_API_TOKEN || '').trim();
  if (!raw || !token) return null;
  try {
    return { url: `${new URL(raw).origin}/api/integrations/robocall/applications`, token };
  } catch {
    return null;
  }
}

export function arzoomConfigured(): boolean {
  return endpoint() !== null;
}

export async function ensureArzoomSchema(): Promise<void> {
  await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS arzoom_data jsonb`);
  await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS application_status varchar(40)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS customers_source_key_idx ON customers (source_system, source_record_key)`);
}

async function readCursor(): Promise<string> {
  const [row] = rowsFrom(await db.execute(sql`SELECT value FROM app_settings WHERE key = ${CURSOR_KEY}`));
  return row ? String(row.value) : '';
}

async function writeCursor(value: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (${CURSOR_KEY}, ${value}, 'arzoom-sync', now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);
}

const num = (v: unknown) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

function noteFor(item: ArzoomItem): string | null {
  if (item.status === 'info') {
    const docs = (item.info_docs || []).filter(Boolean).join(', ');
    return [docs, item.info_text].filter(Boolean).join(' — ') || null;
  }
  if (item.status === 'rejected') return item.reject_reason || null;
  return null;
}

async function upsertItem(item: ArzoomItem): Promise<number | null> {
  const key = String(item.id || '').trim();
  if (!key) return null;
  const [existing] = rowsFrom(await db.execute(sql`
    SELECT id FROM customers WHERE source_system = ${ARZOOM_SOURCE} AND source_record_key = ${key} LIMIT 1
  `));

  if (item.deleted) {
    if (!existing) return null;
    await db.execute(sql`
      UPDATE customers SET application_status = 'deleted', last_synced_at = now() WHERE id = ${existing.id as number}
    `);
    // Nobody should be called about a deleted application.
    await db.execute(sql`
      UPDATE campaign_calls SET status = 'cancelled', updated_at = now()
      WHERE customer_id = ${existing.id as number} AND status = 'pending'
    `);
    return null;
  }

  const terms = item.final_terms || item.offer || null;
  const car = [item.brand, item.model].filter(Boolean).join(' ') || null;
  const values = {
    phone: item.phone || null,
    contractNo: key,
    fin: item.fin_masked || null,
    monthlyPayment: num(terms?.monthly_payment),
    reference: item.partner_ref || null,
    sourceOrganization: item.partner || null,
    category: car,
    statusCategory: item.status_label || item.status || null,
    note: noteFor(item),
    callStatus: item.last_call?.outcome_label || null,
    callComment: item.last_call?.text || null,
    status: item.status || null,
    data: JSON.stringify(item),
    createdAt: item.created_at || null,
  };

  if (existing) {
    await db.execute(sql`
      UPDATE customers SET
        phone = ${values.phone}, mobile_phone = ${values.phone}, contract_no = ${values.contractNo},
        fin = ${values.fin}, monthly_payment = ${values.monthlyPayment}, reference = ${values.reference},
        source_organization = ${values.sourceOrganization}, category = ${values.category},
        pks_status_category = ${values.statusCategory}, comment_template_name = ${values.note},
        pks_status = ${values.callStatus}, pks_comment = ${values.callComment},
        application_status = ${values.status}, arzoom_data = ${values.data}::jsonb, last_synced_at = now()
      WHERE id = ${existing.id as number}
    `);
    return Number(existing.id);
  }

  const [created] = rowsFrom(await db.execute(sql`
    INSERT INTO customers (
      name, surname, phone, mobile_phone, contract_no, fin, monthly_payment, reference,
      source_organization, category, pks_status_category, comment_template_name, pks_status, pks_comment,
      application_status, arzoom_data, source_system, source_record_key, imported_at, last_synced_at, created_at
    ) VALUES (
      '', '', ${values.phone}, ${values.phone}, ${values.contractNo}, ${values.fin}, ${values.monthlyPayment}, ${values.reference},
      ${values.sourceOrganization}, ${values.category}, ${values.statusCategory}, ${values.note}, ${values.callStatus}, ${values.callComment},
      ${values.status}, ${values.data}::jsonb, ${ARZOOM_SOURCE}, ${key}, now(), now(), coalesce(${values.createdAt}::timestamptz, now())
    )
    RETURNING id
  `));
  return created ? Number(created.id) : null;
}

// Puts the customer into every active "loan application result" campaign whose result
// parameter matches the application's status (or that has no result set), and takes them
// out of the pending queue of campaigns whose result no longer matches.
async function attachToCampaigns(customerId: number, status: string | undefined): Promise<void> {
  const result = status ? STATUS_TO_RESULT[status] : undefined;
  const campaigns = rowsFrom(await db.execute(sql`
    SELECT id, segment_params->>'result' AS result FROM campaigns
    WHERE segment = 'application_status' AND status IN ('active', 'draft', 'paused')
  `));
  for (const c of campaigns) {
    const campaignId = Number(c.id);
    const wanted = Boolean(result) && (!c.result || c.result === result);
    const [link] = rowsFrom(await db.execute(sql`
      SELECT id, status FROM campaign_calls WHERE campaign_id = ${campaignId} AND customer_id = ${customerId} LIMIT 1
    `));
    if (wanted && !link) {
      await db.execute(sql`
        INSERT INTO campaign_calls (campaign_id, customer_id, status, attempt_number, created_at, updated_at)
        VALUES (${campaignId}, ${customerId}, 'pending', 0, now(), now())
      `);
      await db.execute(sql`UPDATE campaigns SET total_customers = total_customers + 1, updated_at = now() WHERE id = ${campaignId}`);
    } else if (wanted && link && link.status === 'cancelled') {
      // Status moved back into this campaign's result (e.g. info -> offer): queue again.
      await db.execute(sql`UPDATE campaign_calls SET status = 'pending', attempt_number = 0, updated_at = now() WHERE id = ${link.id as number}`);
    } else if (!wanted && link && link.status === 'pending') {
      await db.execute(sql`UPDATE campaign_calls SET status = 'cancelled', updated_at = now() WHERE id = ${link.id as number}`);
    }
  }
}

async function runSync(): Promise<void> {
  const ep = endpoint();
  if (!ep) return;
  let since = await readCursor();
  let count = 0;
  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (since) params.set('since', since);
    const res = await fetch(`${ep.url}?${params}`, {
      headers: { 'X-Integration-Token': ep.token, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { items?: ArzoomItem[]; has_more?: boolean; next_since?: string };
    const items = Array.isArray(body.items) ? body.items : [];
    // In order: a later live row for the same id must win over an earlier delete.
    for (const item of items) {
      const customerId = await upsertItem(item);
      if (customerId) await attachToCampaigns(customerId, item.status);
      count++;
    }
    if (body.next_since && body.next_since !== since) {
      since = body.next_since;
      await writeCursor(since);
    }
    if (!body.has_more || items.length === 0) break;
  }
  state.lastCount = count;
}

export function syncArzoom(): Promise<void> {
  if (state.running) return state.running;
  state.running = (async () => {
    try {
      await runSync();
      state.lastError = null;
      if (state.lastCount) console.log(`[arzoom-sync] applied ${state.lastCount} application(s)`);
    } catch (err) {
      state.lastError = (err as Error)?.name === 'TimeoutError' ? 'timeout' : (err as Error)?.message || 'failed';
      console.error(`[arzoom-sync] failed: ${state.lastError}`);
    } finally {
      state.lastRunAt = new Date();
      state.running = null;
    }
  })();
  return state.running;
}

// Clearing the cursor makes the next run pull every application again (e.g. after the
// URL is changed to another ARZOOM instance).
export async function resetArzoomCursor(): Promise<void> {
  await db.execute(sql`DELETE FROM app_settings WHERE key = ${CURSOR_KEY}`);
}

export function startArzoomSync(): void {
  if (arzoomConfigured()) void syncArzoom();
  setInterval(() => {
    if (arzoomConfigured()) void syncArzoom();
  }, INTERVAL_MS).unref();
}

export async function arzoomStatus() {
  const [row] = rowsFrom(await db.execute(sql`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE application_status IS DISTINCT FROM 'deleted')::int AS live
    FROM customers WHERE source_system = ${ARZOOM_SOURCE}
  `));
  return {
    configured: arzoomConfigured(),
    customers: Number(row?.live ?? 0),
    lastRunAt: state.lastRunAt?.toISOString() ?? null,
    lastCount: state.lastCount,
    error: state.lastError,
  };
}

const money = (v: unknown) => (num(v) === null ? null : `${Number(v).toLocaleString('az-AZ')} AZN`);

// Lines for the bot's "customer data" block. No interest or commission is ever included.
export function arzoomCustomerLines(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const item = data as ArzoomItem;
  const lines: string[] = [`- Müraciət nömrəsi: ${item.id}`];
  if (item.status_label) lines.push(`- Müraciətin statusu: ${item.status_label}`);
  const car = [item.brand, item.model].filter(Boolean).join(' ');
  if (car) lines.push(`- Avtomobil: ${car}${item.car_price ? ` (${money(item.car_price)})` : ''}`);
  const terms = item.final_terms || item.offer;
  if (terms) {
    const t: string[] = [];
    if (terms.down_payment != null) t.push(`ilkin ödəniş ${money(terms.down_payment)}${terms.down_payment_pct != null ? ` (${terms.down_payment_pct}%)` : ''}`);
    if (terms.amount != null) t.push(`maliyyələşdirmə ${money(terms.amount)}`);
    if (terms.months != null) t.push(`müddət ${terms.months} ay`);
    if (terms.monthly_payment != null) t.push(`aylıq ödəniş ${money(terms.monthly_payment)}`);
    if (t.length) lines.push(`- ${item.final_terms ? 'Razılaşdırılmış şərtlər' : 'Təklif'}: ${t.join(', ')}`);
  }
  if (item.status === 'info') {
    const docs = (item.info_docs || []).filter(Boolean);
    if (docs.length) lines.push(`- Müştəridən istənən sənədlər: ${docs.join(', ')}`);
    if (item.info_text) lines.push(`- Əlavə tələb: ${item.info_text}`);
  }
  if (item.status === 'rejected' && item.reject_reason) lines.push(`- İmtina səbəbi (müştəriyə deyilə bilər): ${item.reject_reason}`);
  if (item.guarantor === true) lines.push('- Zamin: var');
  if (item.cabinet_url) lines.push(`- Şəxsi kabinet linki: ${item.cabinet_url}`);
  if (item.last_call?.outcome_label) {
    lines.push(`- Əvvəlki əlaqə: ${item.last_call.outcome_label}${item.last_call.text ? ` — ${item.last_call.text}` : ''}`);
  }
  return lines;
}
