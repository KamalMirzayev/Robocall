import { sql } from 'drizzle-orm';
import { db } from './db/index.js';

// Per-segment campaign parameters (sales offer, application result, survey setup...).
// The admin fills them in on the campaign form; at call time they are rendered into
// {DYNAMIC_CONTEXT} so the bot knows what this campaign is about. Keys and select options
// mirror apps/frontend/lib/segments.ts (SEGMENT_FIELDS); labels here are the prompt wording.

interface FieldDef {
  key: string;
  label: string;
  options?: Record<string, string>;
  // Comma-separated list of option values.
  multi?: boolean;
  // Saved with the campaign but left out of the bot's context.
  hidden?: boolean;
}

const SEGMENT_FIELDS: Record<string, FieldDef[]> = {
  sales: [
    { key: 'offer', label: 'Təklif' },
    { key: 'models', label: 'Marka və modellər' },
    { key: 'benefit', label: 'Əsas üstünlük' },
    { key: 'deadline', label: 'Təklifin son tarixi' },
    {
      key: 'nextStep',
      label: 'Maraq olarsa növbəti addım',
      options: {
        application: 'Müraciəti qeydə al',
        showroom: 'Salona dəvət et',
        test_drive: 'Test-sürüşə yazdır',
        callback: 'Menecerin geri zəngini təklif et',
      },
    },
    { key: 'location', label: 'Salon / filial ünvanı' },
  ],
  application_status: [
    {
      key: 'statuses',
      label: 'Bu kampaniyada zəng edilən müraciət statusları',
      multi: true,
      options: {
        approved: 'Təklif göndərilib',
        needs_documents: 'Əlavə sənəd gözlənilir',
        declined: 'Müştəri imtina etdi / ləğv etdi',
        sent_to_sales: 'Satışa ötürülüb',
      },
    },
    { key: 'callCenter', label: 'Zəng mərkəzi nömrəsi' },
    { key: 'location', label: 'Filial ünvanı və iş saatları' },
    { key: 'note', label: 'Əlavə qeyd' },
    // Campaign switches, not shown to the bot (arzoom-sync.ts reads them).
    { key: 'autoAdd', label: '', options: { on: 'on', off: 'off' }, hidden: true },
    { key: 'requeue', label: '', options: { on: 'on', off: 'off' }, hidden: true },
  ],
  // Former service customers, imported from Excel (excel-import.ts).
  service_return: [
    { key: 'offer', label: 'Kampaniya təklifi (servis)' },
    { key: 'location', label: 'Servis ünvanı və iş saatları' },
    { key: 'phone', label: 'Servis əlaqə nömrəsi' },
    { key: 'note', label: 'Əlavə qeyd' },
    // Live transfer to service reps (campaign-results.ts reads it), not shown to the bot.
    { key: 'repExtensions', label: '', hidden: true },
  ],
  // Credit customers without a result: a car-on-credit offer, the ARZOOM application link by SMS.
  credit_offer: [
    { key: 'offer', label: 'Kampaniya təklifi (kredit)' },
    { key: 'brand', label: 'Marka', options: { Toyota: 'Toyota', Mitsubishi: 'Mitsubishi', Mazda: 'Mazda', BYD: 'BYD' } },
    { key: 'deadline', label: 'Təklifin son tarixi' },
    { key: 'note', label: 'Əlavə qeyd' },
  ],
  satisfaction: [
    {
      key: 'serviceType',
      label: 'Sorğu bu xidmət haqqındadır',
      options: {
        purchase: 'Avtomobil alışı',
        service: 'Texniki servis',
        leasing: 'Lizinq / kredit rəsmiləşdirilməsi',
        test_drive: 'Test-sürüş',
        call_center: 'Zəng mərkəzi',
      },
    },
    { key: 'scale', label: 'Qiymət şkalası', options: { '1-5': '1-dən 5-ə qədər', '0-10': '0-dan 10-a qədər' } },
    { key: 'lowScore', label: 'Bu baldan aşağı qiymət şikayət sayılır' },
    { key: 'questions', label: 'Əlavə suallar' },
  ],
};

const MAX_VALUE_LENGTH = 1000;

export function isCampaignSegment(segment: unknown): segment is string {
  return typeof segment === 'string' && /^[a-z_]{1,40}$/.test(segment);
}

// Keeps only the known fields of the segment, as trimmed strings.
export function sanitizeSegmentParams(segment: string | null, raw: unknown): Record<string, string> | null {
  const fields = segment ? SEGMENT_FIELDS[segment] : undefined;
  if (!fields || !raw || typeof raw !== 'object') return null;
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = (raw as Record<string, unknown>)[f.key];
    if (v === undefined || v === null) continue;
    const s = String(v).trim().slice(0, MAX_VALUE_LENGTH);
    if (!s) continue;
    if (f.options && f.multi) {
      const picked = s.split(',').map((x) => x.trim()).filter((x) => x in f.options!);
      if (picked.length) out[f.key] = [...new Set(picked)].join(',');
      continue;
    }
    if (f.options && !(s in f.options)) continue;
    out[f.key] = s;
  }
  return Object.keys(out).length ? out : null;
}

export function segmentContext(segment: string | null | undefined, params: unknown): string | null {
  const fields = segment ? SEGMENT_FIELDS[segment] : undefined;
  if (!fields || !params || typeof params !== 'object') return null;
  const lines: string[] = [];
  for (const f of fields) {
    if (f.hidden) continue;
    const v = (params as Record<string, unknown>)[f.key];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    const s = String(v).trim();
    const shown = f.multi
      ? s.split(',').map((x) => f.options?.[x.trim()] ?? x.trim()).join(', ')
      : f.options?.[s] ?? s;
    lines.push(`- ${f.label}: ${shown}`);
  }
  return lines.length ? lines.join('\n') : null;
}

export async function ensureCampaignSegmentSchema(): Promise<void> {
  await db.execute(sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS segment varchar(40)`);
  await db.execute(sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS segment_params jsonb`);
}
