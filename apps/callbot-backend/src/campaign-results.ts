import { sql } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';
import { db } from './db/index.js';
import { recordAiTokenUsage } from './ai-usage.js';
import { scheduleArzoomAnalyticsPush } from './arzoom-analytics.js';

// Results of calls to customers imported from Excel (service customers, credit offer).
// ARZOOM applications keep their own arzoom_feedback table; these campaigns write here.

export const EXCEL_SOURCE = 'excel';
export const EXCEL_SEGMENTS = new Set(['service_return', 'credit_offer']);

export const RESULT_OUTCOMES: Record<string, Record<string, string>> = {
  service_return: {
    will_visit: 'Servisə gələcək',
    transferred_to_rep: 'Servis nümayəndəsinə qoşuldu',
    wants_rep_contact: 'Servis nümayəndəsi əlaqə saxlasın',
    callback: 'Sonra zəng edilməsini istədi',
    thinking: 'Düşünəcək',
    serviced_elsewhere: 'Başqa servisə gedir',
    sold_car: 'Maşını satıb / istifadə etmir',
    not_interested: 'Maraqlanmır',
    complaint: 'Narazılığı var',
    wrong_person: 'Səhv nömrə / başqa şəxs',
    other: 'Digər',
  },
  credit_offer: {
    agrees_send_link: 'Razıdır, müraciət linki göndərilsin',
    thinking: 'Düşünəcək',
    callback: 'Sonra zəng edilməsini istədi',
    not_interested: 'Maraqlanmır',
    has_car: 'Artıq maşını var / alıb',
    wrong_person: 'Səhv nömrə / başqa şəxs',
    other: 'Digər',
  },
};

// ARZOOM sends the application link for these brands only.
export const LINK_BRANDS = ['Toyota', 'BYD', 'Mazda', 'Mitsubishi'] as const;

export function linkBrand(raw: unknown): string | null {
  const t = String(raw ?? '').toLowerCase();
  if (!t) return null;
  if (/toyota|tayota|тойота/.test(t)) return 'Toyota';
  if (/\bbyd\b|^byd/.test(t)) return 'BYD';
  if (/mazda|мазда/.test(t)) return 'Mazda';
  if (/mitsub|мицуб/.test(t)) return 'Mitsubishi';
  return null;
}

// Brand of a Group Motors model name ("Seal 05" -> BYD, "Corolla" -> Toyota), for sheets
// that carry only the model.
const MODEL_BRANDS: Array<[RegExp, string]> = [
  [/\b(seal|sealion|yuan|song|han|tang|qin|atto|dolphin|shark|destroyer|frigate|leopard)\b/i, 'BYD'],
  [/\b(corolla|camry|rav\s*-?4|land\s*cruiser|prado|hilux|c-?hr|yaris|highlander|fortuner|bz\s*-?\d+x?|crown|avalon|sequoia|tundra|tacoma|hiace|rush|veloz|raize|innova|sienna|supra|lc\s*\d+)\b/i, 'Toyota'],
  [/\b(cx\s*-?\d+|mx\s*-?\d+|bt\s*-?50|mazda\s*\d)\b/i, 'Mazda'],
  [/\b(outlander|pajero|asx|l\s*-?200|eclipse|xpander|attrage|lancer|triton|montero|mirage)\b/i, 'Mitsubishi'],
];

export function brandOfModel(raw: unknown): string | null {
  const t = String(raw ?? '');
  return linkBrand(t) ?? MODEL_BRANDS.find(([re]) => re.test(t))?.[1] ?? null;
}

// Splits what the sheet gave into brand and model: a lone model gets its brand.
export function splitCar(brandCell: string, modelCell: string): { brand: string; model: string } {
  let brand = brandCell.trim();
  let model = modelCell.trim();
  if (brand && !linkBrand(brand) && !model) {
    model = brand;
    brand = '';
  }
  if (!brand) brand = brandOfModel(model) ?? '';
  return { brand, model };
}

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(rows) ? rows : [];
}

export async function ensureCampaignResultsSchema(): Promise<void> {
  await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS import_data jsonb`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS campaign_results (
      id serial PRIMARY KEY,
      campaign_id integer,
      customer_id integer NOT NULL,
      telephony_job_id integer,
      segment varchar(40) NOT NULL,
      outcome varchar(40) NOT NULL,
      outcome_label text NOT NULL,
      reason text,
      callback_at timestamptz,
      sms_status varchar(20),
      sms_error text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`ALTER TABLE campaign_results ADD COLUMN IF NOT EXISTS brand varchar(20)`);
  // Sheets imported before brand/model were recognised: pull "Brend"/"Model" out of the extra
  // columns, and give a lone model its brand.
  for (const row of rowsFrom(await db.execute(sql`
    SELECT id, import_data AS d FROM customers
    WHERE source_system = 'excel' AND import_data IS NOT NULL
      AND (coalesce(import_data->>'model', '') = '' OR import_data->>'brand' IS NULL OR import_data->>'brand' !~* '(toyota|byd|mazda|mitsub)')
  `))) {
    const d = (typeof row.d === 'string' ? JSON.parse(row.d) : row.d) as Record<string, unknown>;
    const extra = d.extra && typeof d.extra === 'object' ? (d.extra as Record<string, unknown>) : {};
    const pick = (re: RegExp) => String(Object.entries(extra).find(([k]) => re.test(k))?.[1] ?? '');
    const { brand, model } = splitCar(String(d.brand ?? '') || pick(/brend|brand|marka/i), String(d.model ?? '') || pick(/model/i));
    if (brand === String(d.brand ?? '') && model === String(d.model ?? '')) continue;
    await db.execute(sql`
      UPDATE customers SET import_data = import_data || ${JSON.stringify({ brand: brand || null, model: model || null })}::jsonb,
        category = ${[brand, model].filter(Boolean).join(' ') || null}
      WHERE id = ${Number(row.id)}
    `);
  }
  await db.execute(sql`CREATE INDEX IF NOT EXISTS campaign_results_job_idx ON campaign_results (telephony_job_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS campaign_results_customer_idx ON campaign_results (customer_id)`);
}

// ---------------------------------------------------------------------------------------
// Time helpers (Baku). The bot passes "YYYY-MM-DD HH:MM" for a callback.

export function bakuIsoNow(): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'long',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute} (${p.weekday})`;
}

export function parseBakuTime(value: unknown): Date | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(text);
  const at = m && !/(Z|[+-]\d{2}:?\d{2})$/.test(text)
    ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, '0')}:${m[5]}:00+04:00`)
    : new Date(text);
  const t = at.getTime();
  if (!Number.isFinite(t)) return null;
  if (t < Date.now() + 5 * 60_000 || t > Date.now() + 60 * 24 * 3600_000) return null;
  return at;
}

function bakuText(at: Date): string {
  return new Intl.DateTimeFormat('az-AZ', { timeZone: 'Asia/Baku', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
}

// ---------------------------------------------------------------------------------------
// What the bot is told about an imported customer.

export function excelCustomerLines(data: unknown, segment: string | null, opts: { canTransfer?: boolean } = {}): string[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  const lines: string[] = [];
  const s = (v: unknown) => (v == null ? '' : String(v).trim());
  const extraModel = d.extra && typeof d.extra === 'object'
    ? Object.entries(d.extra as Record<string, unknown>).find(([k]) => /model/i.test(k))?.[1]
    : undefined;
  const extraBrand = d.extra && typeof d.extra === 'object'
    ? Object.entries(d.extra as Record<string, unknown>).find(([k]) => /brend|brand|marka/i.test(k))?.[1]
    : undefined;
  const sc = splitCar(s(d.brand) || s(extraBrand), s(d.model) || s(extraModel));
  const car = [sc.brand, sc.model && !sc.brand.toLowerCase().includes(sc.model.toLowerCase()) ? sc.model : ''].filter(Boolean).join(' ');
  if (car) lines.push(segment === 'credit_offer' ? `- Əvvəl kredit üçün müraciət etdiyi avtomobil (marka və model): ${car}` : `- Avtomobil: ${car}`);
  if (s(d.last_service_date)) lines.push(`- Son dəfə servisə gəlib: ${s(d.last_service_date)}`);
  if (s(d.last_talk)) lines.push(`- Əvvəlki danışıq (müştəri ilə son əlaqənin qeydi): ${s(d.last_talk).slice(0, 800)}`);
  const extra = d.extra && typeof d.extra === 'object' ? (d.extra as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(extra).slice(0, 10)) {
    if (s(v)) lines.push(`- ${k}: ${s(v).slice(0, 300)}`);
  }
  const outcomes = RESULT_OUTCOMES[segment ?? ''] ?? {};
  if (Object.keys(outcomes).length) {
    lines.push(`- NƏTİCƏ: Zəngin sonunda (sağollaşmadan əvvəl) record_campaign_result alətini çağır. outcome bunlardan biri: ${Object.entries(outcomes).map(([k, v]) => `${k} (${v})`).join(', ')}. reason-a müştərinin dediklərini 1-3 cümlə ilə yaz.`);
  }
  lines.push(`- SONRA ZƏNG: İndiki vaxt (Bakı): ${bakuIsoNow()}. Müştəri indi danışa bilmədiyini və ya sonra zəng edilməsini istəsə: "Sizə hansı gün, saat neçədə zəng edək?" deyə soruş, yalnız gün desə saatı da soruş. Sonra record_campaign_result alətini outcome=callback və callback_at="YYYY-MM-DD HH:MM" (Bakı vaxtı) ilə çağır, vaxtı müştəriyə təkrarla və sağollaş. Heç bir vaxt demək istəmirsə callback_at="unknown" ver.`);
  lines.push('- Müştəri ona bir daha zəng edilməməsini istəsə: üzr istə, "sizə bir daha zəng edilməyəcək" de, record_campaign_result alətini outcome=not_interested, do_not_call=true ilə çağır və sağollaş.');
  if (segment === 'service_return') {
    lines.push(opts.canTransfer
      ? '- SERVİS NÜMAYƏNDƏSİ: Müştəri təklifə razıdırsa və servisə gəlmək üçün nümayəndə ilə danışmaq istəsə: "Zəhmət olmasa bir neçə saniyə xətdə qalın, sizi servis nümayəndəsinə qoşuram" de və dərhal transfer_to_sales alətini çağır, bundan sonra heç nə demə. Alət uğursuz olsa, nümayəndənin ona tezliklə geri zəng edəcəyini de və record_campaign_result alətini outcome=wants_rep_contact ilə çağır.'
      : '- SERVİS NÜMAYƏNDƏSİ: Müştəri servisə gəlmək üçün nümayəndə ilə əlaqə istəsə, servis nümayəndəsinin ona tezliklə zəng edəcəyini de və record_campaign_result alətini outcome=wants_rep_contact ilə çağır; reason-a müştərinin uyğun vaxtını yaz.');
  }
  if (segment === 'credit_offer') {
    const applied = car;
    lines.push([
      '- CHURN SSENARİSİ (agent təlimatından üstündür, bu ardıcıllıqla danış):',
      '  1) "Salam, hörmətli müştəri, sizi Group Motors şirkətindən salamlayıram" de və danışmağa vaxtı olub-olmadığını soruş. Müştəriyə adı ilə müraciət etmə, ad-soyad soruşma; həmişə "hörmətli müştəri" de.',
      applied
        ? `  2) Xatırlat: "Siz əvvəl ${applied} üçün kreditlə avtomobil əldə etmək məqsədilə müraciət etmişdiniz."`
        : '  2) Xatırlat: "Siz əvvəl kreditlə avtomobil əldə etmək üçün müraciət etmişdiniz."',
      '  3) De: "Hazırda yeni kampaniyamız var və Group Motors-un təqdim etdiyi dörd marka üzrə müraciət edə bilərsiniz: Toyota, BYD, Mazda və Mitsubishi." Paneldə kampaniya təklifi yazılıbsa, onu da qısa əlavə et.',
      '  4) Soruş: hansı marka maraqlıdır və kredit şərtləri ilə tanış olmaq istəyirmi. Avtomobillər haqqında sualları bilik bazasından cavablandır; faiz və komissiya rəqəmi demə.',
      '  5) Maraqlıdırsa: "Sizə SMS ilə müraciət linki göndərirəm, linkə daxil olub kredit müraciətinizi edin, 1-2 dəqiqə ərzində müraciətinizə cavab gələcək" de və record_campaign_result alətini outcome=agrees_send_link və brand=<müştərinin seçdiyi marka: Toyota, BYD, Mazda və ya Mitsubishi> ilə çağır. Marka seçməyibsə, brand-i boş burax.',
      '  6) Maraqlı deyilsə, səbəbini bir dəfə nəzakətlə soruş, təşəkkür et, nəticəni yaz və sağollaş.',
      '  MƏQSƏD: müştərini SMS linki ilə onlayn kredit müraciəti etməyə razı salmaq. Müştəri tərəddüd etsə ("düşünərəm", "indi lazım deyil", "bahadır" və s.), etirazını nəzakətlə cavablandır və üstünlükləri de: müraciət onlayndır və bir neçə dəqiqə çəkir, heç yerə getmək lazım deyil, 1-2 dəqiqə ərzində cavab gəlir, dörd markadan (Toyota, BYD, Mazda, Mitsubishi) seçmək olar, müraciət etmək heç bir öhdəlik yaratmır, sadəcə şərtləri görəcək. Sonra linki göndərməyi təklif et: "Linki göndərim, şərtlərə baxarsınız, sizə uyğun olmasa heç nə etməyə borclu deyilsiniz." Bunu ən çox iki dəfə et; müştəri qəti imtina etsə, hörmətlə qəbul et, nəticəni yaz və sağollaş. Kobudluq etmə, yalan vəd vermə.',
    ].join('\n'));
    lines.push('- MÜRACİƏT LİNKİ: Müştəri təklifə maraq göstərib müraciət etmək istəsə, ona de: "Sizə SMS ilə müraciət linki göndərəcəyik, linkə daxil olub bir neçə dəqiqəyə onlayn müraciət edə bilərsiniz." Sonra record_campaign_result alətini outcome=agrees_send_link ilə çağır. Sənədləri WhatsApp və ya başqa kanalla göndərməyi heç vaxt təklif etmə.');
  }
  return lines;
}

// ---------------------------------------------------------------------------------------

async function segmentOfJob(telephonyJobId: number | null, customerId: number): Promise<{ campaignId: number | null; segment: string | null }> {
  const [row] = rowsFrom(await db.execute(sql`
    SELECT c.id, c.segment FROM campaigns c
    WHERE c.id = coalesce(
      (SELECT campaign_id FROM telephony_jobs WHERE id = ${telephonyJobId}),
      (SELECT cc.campaign_id FROM campaign_calls cc WHERE cc.customer_id = ${customerId} ORDER BY cc.updated_at DESC LIMIT 1)
    )
    LIMIT 1
  `));
  return { campaignId: row ? Number(row.id) : null, segment: row ? String(row.segment ?? '') || null : null };
}

export async function recordCampaignResult(params: {
  customerId: number;
  telephonyJobId: number | null;
  outcome: string;
  reason: string;
  callbackAt?: string | null;
  doNotCall?: boolean;
  brand?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { campaignId, segment } = await segmentOfJob(params.telephonyJobId, params.customerId);
  const outcomes = RESULT_OUTCOMES[segment ?? ''];
  if (!outcomes) return { ok: false, error: 'this call is not part of a service or credit-offer campaign' };
  const label = outcomes[params.outcome];
  if (!label) return { ok: false, error: `outcome must be one of: ${Object.keys(outcomes).join(', ')}` };

  let callbackAt: Date | null = null;
  let reason = String(params.reason || '').trim().slice(0, 1500);
  if (params.outcome === 'callback') {
    const raw = String(params.callbackAt ?? '').trim();
    callbackAt = parseBakuTime(raw);
    if (!callbackAt && raw.toLowerCase() !== 'unknown') {
      return {
        ok: false,
        error: `callback_at is missing or invalid. Ask the customer which day and at what time to call (now in Baku: ${bakuIsoNow()}) and pass "YYYY-MM-DD HH:MM" in Baku time, or "unknown" if they will not say.`,
      };
    }
    reason = [reason, callbackAt ? `Zəng vaxtı: ${bakuText(callbackAt)}` : 'Zəng vaxtı: müştəri dəqiq vaxt deməyib'].filter(Boolean).join('. ');
  }
  const wantsSms = segment === 'credit_offer' && params.outcome === 'agrees_send_link';
  const brand = wantsSms ? linkBrand(params.brand) : null;
  if (brand) reason = [reason, `Seçdiyi marka: ${brand}`].filter(Boolean).join('. ');
  await db.execute(sql`
    INSERT INTO campaign_results (campaign_id, customer_id, telephony_job_id, segment, outcome, outcome_label, reason, callback_at, sms_status, brand)
    VALUES (${campaignId}, ${params.customerId}, ${params.telephonyJobId}, ${segment}, ${params.outcome}, ${label}, ${reason || null},
            ${callbackAt ? callbackAt.toISOString() : null}::timestamptz, ${wantsSms ? 'pending' : null}, ${brand})
  `);
  await db.execute(sql`
    UPDATE customers SET pks_status = ${label}, pks_comment = ${reason || null} WHERE id = ${params.customerId}
  `);
  if (params.doNotCall) {
    await db.execute(sql`UPDATE customers SET do_not_call = true WHERE id = ${params.customerId}`);
    await db.execute(sql`UPDATE campaign_calls SET status = 'cancelled', updated_at = now() WHERE customer_id = ${params.customerId} AND status IN ('pending', 'retrying')`);
  } else if (params.outcome === 'callback') {
    await applyResultCallback(params.telephonyJobId);
  }
  if (wantsSms) void sendPendingApplicationSms().catch((err) => console.error('[campaign-results] sms failed', err));
  scheduleArzoomAnalyticsPush();
  return { ok: true };
}

// Re-dial at the agreed time. No-op while the call is still running ("attempting"); the
// job completion handler calls it again once the queue entry is closed.
export async function applyResultCallback(telephonyJobId: number | null): Promise<void> {
  if (!telephonyJobId) return;
  const [fb] = rowsFrom(await db.execute(sql`
    SELECT outcome, callback_at FROM campaign_results WHERE telephony_job_id = ${telephonyJobId} ORDER BY id DESC LIMIT 1
  `));
  if (!fb || fb.outcome !== 'callback') return;
  const rows = rowsFrom(await db.execute(sql`
    UPDATE campaign_calls cc
    SET status = 'retrying', attempt_number = 0,
        call_after = coalesce(${fb.callback_at ? new Date(String(fb.callback_at)).toISOString() : null}::timestamptz,
                              now() + make_interval(hours => c.retry_interval_hours)),
        updated_at = now()
    FROM campaigns c, telephony_jobs tj, customers cu
    WHERE tj.id = ${telephonyJobId}
      AND cc.customer_id = tj.customer_id AND cc.campaign_id = tj.campaign_id
      AND c.id = cc.campaign_id AND cu.id = cc.customer_id AND cu.do_not_call = false
      AND cc.status IN ('completed', 'failed', 'retrying')
    RETURNING cc.campaign_id
  `));
  for (const row of rows) {
    await db.execute(sql`UPDATE campaigns SET status = 'active', updated_at = now() WHERE id = ${Number(row.campaign_id)} AND status = 'completed'`);
  }
}

// Safety net when the bot hung up without recording a result.
export async function ensureCampaignResultFromTranscript(params: {
  customerId: number;
  telephonyJobId: number | null;
  startedAt: Date;
  transcript: string | null;
}): Promise<void> {
  const transcript = String(params.transcript || '').trim();
  if (!transcript) return;
  const [existing] = rowsFrom(await db.execute(sql`
    SELECT 1 FROM campaign_results WHERE customer_id = ${params.customerId}
      AND (telephony_job_id = ${params.telephonyJobId} OR created_at >= ${params.startedAt.toISOString()}::timestamptz)
    LIMIT 1
  `));
  if (existing) return;
  const { segment } = await segmentOfJob(params.telephonyJobId, params.customerId);
  const outcomes = RESULT_OUTCOMES[segment ?? ''];
  if (!outcomes) return;
  let outcome = 'other';
  let reason = '';
  let doNotCall = false;
  let callbackAt: string | null = null;
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (key) {
    try {
      const model = process.env.POST_CALL_SUMMARY_MODEL || 'gemini-2.5-flash';
      const ai = new GoogleGenAI({ apiKey: key });
      const when = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(params.startedAt);
      const prompt = `Bu, telefon zənginin transkriptidir (A: bot, C: müştəri). Zəng vaxtı (Bakı): ${when}.
YALNIZ JSON qaytar: {"outcome": "...", "reason": "...", "do_not_call": false, "callback_at": null}
outcome bunlardan biri: ${Object.entries(outcomes).map(([k, v]) => `${k} (${v})`).join(', ')}.
reason: Azərbaycan dilində 1-3 cümlə, müştəri nə dedi. Müştəri danışmayıbsa outcome "other", reason boş.
do_not_call: müştəri açıq şəkildə bir daha zəng edilməməsini istəyibsə true.
callback_at: outcome "callback" olanda deyilən gün və saat "YYYY-MM-DD HH:MM" (Bakı vaxtı), deyilməyibsə "unknown", başqa hallarda null.

Transkript:
${transcript.slice(-8000)}`;
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { temperature: 0, responseMimeType: 'application/json' },
      });
      await recordAiTokenUsage({ model, operation: 'campaign_result', usageMetadata: (response as { usageMetadata?: unknown }).usageMetadata as never }).catch(() => undefined);
      const parsed = JSON.parse(String(response.text || '{}').replace(/^```json|```$/g, '').trim()) as { outcome?: string; reason?: string; do_not_call?: boolean; callback_at?: string | null };
      if (parsed.outcome && parsed.outcome in outcomes) outcome = parsed.outcome;
      reason = String(parsed.reason || '').trim().slice(0, 1000);
      doNotCall = parsed.do_not_call === true;
      callbackAt = parsed.callback_at ? String(parsed.callback_at) : null;
    } catch (err) {
      console.error('[campaign-results] transcript classification failed', err);
    }
  }
  if (outcome === 'callback' && !parseBakuTime(callbackAt)) callbackAt = 'unknown';
  await recordCampaignResult({
    customerId: params.customerId,
    telephonyJobId: params.telephonyJobId,
    outcome,
    reason: reason || 'Bot zəng zamanı nəticəni qeyd etməyib.',
    callbackAt,
    doNotCall,
  });
}

// ---------------------------------------------------------------------------------------
// SMS with the ARZOOM leasing application link, sent by ARZOOM (robocall has no SMS
// provider). Set ARZOOM_SMS_LINK_PATH once ARZOOM exposes the endpoint; until then the
// requests wait in campaign_results with sms_status = 'pending'.

let sending: Promise<void> | null = null;

export function sendPendingApplicationSms(): Promise<void> {
  if (sending) return sending;
  sending = (async () => {
    const base = String(process.env.ARZOOM_API_URL || '').trim();
    const token = String(process.env.ARZOOM_API_TOKEN || process.env.ARZOOM_INTEGRATION_TOKEN || '').trim();
    const path = String(process.env.ARZOOM_SMS_LINK_PATH || '/api/integrations/robocall/send-application-link').trim();
    if (!base || !token) return;
    const origin = new URL(base).origin;
    const rows = rowsFrom(await db.execute(sql`
      SELECT r.id, cu.phone, r.brand AS chosen, cp.segment_params->>'brand' AS campaign_brand, cu.import_data->>'brand' AS applied, cu.import_data->>'model' AS model
      FROM campaign_results r JOIN customers cu ON cu.id = r.customer_id
      LEFT JOIN campaigns cp ON cp.id = r.campaign_id
      WHERE r.sms_status = 'pending' ORDER BY r.id LIMIT 20
    `));
    for (const row of rows) {
      // One link per customer, ever: a later "yes" on another call is not sent again.
      const [already] = rowsFrom(await db.execute(sql`
        SELECT 1 FROM campaign_results r2
        WHERE r2.customer_id = (SELECT customer_id FROM campaign_results WHERE id = ${Number(row.id)})
          AND r2.id <> ${Number(row.id)} AND r2.sms_status = 'sent'
        LIMIT 1
      `));
      if (already) {
        await db.execute(sql`UPDATE campaign_results SET sms_status = 'duplicate', sms_error = 'link artıq göndərilib' WHERE id = ${Number(row.id)}`);
        continue;
      }
      try {
        const res = await fetch(`${origin}${path.startsWith('/') ? path : `/${path}`}`, {
          method: 'POST',
          headers: { 'X-Integration-Token': token, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ phone: String(row.phone || '').replace(/\D/g, ''), brand: linkBrand(row.chosen) ?? brandOfModel(row.applied) ?? brandOfModel(row.model) ?? linkBrand(row.campaign_brand) ?? undefined, source: 'robocall' }),
          signal: AbortSignal.timeout(15_000),
        });
        const body = (await res.json().catch(() => ({}))) as { duplicate?: boolean; error?: string };
        // 429 duplicate: this number already got the link in the last 24 h.
        // 400/401: will never succeed. 429 (daily cap), 502, 503: retried later.
        const final = res.ok ? 'sent' : res.status === 429 && body.duplicate ? 'duplicate' : [400, 401, 404].includes(res.status) ? 'failed' : null;
        if (!final) throw new Error(`HTTP ${res.status}${body.error ? ` ${String(body.error).slice(0, 120)}` : ''}`);
        await db.execute(sql`UPDATE campaign_results SET sms_status = ${final}, sms_error = ${res.ok ? null : `HTTP ${res.status}`} WHERE id = ${Number(row.id)}`);
      } catch (err) {
        await db.execute(sql`UPDATE campaign_results SET sms_error = ${String((err as Error)?.message || err).slice(0, 300)} WHERE id = ${Number(row.id)}`);
      }
    }
  })().finally(() => {
    sending = null;
  });
  return sending;
}

export function startApplicationSmsRetry(): void {
  setInterval(() => void sendPendingApplicationSms().catch(() => undefined), 60_000).unref?.();
}

// Segment and service-rep extensions for a call to an imported customer.
export async function excelCallContext(telephonyJobId: number | null, customerId: number): Promise<{ segment: string | null; transferExtensions: string[] }> {
  const { campaignId, segment } = await segmentOfJob(telephonyJobId, customerId);
  let transferExtensions: string[] = [];
  if (campaignId && segment === 'service_return') {
    const [row] = rowsFrom(await db.execute(sql`SELECT segment_params->>'repExtensions' AS exts FROM campaigns WHERE id = ${campaignId}`));
    transferExtensions = String(row?.exts || '').split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^\d{2,6}$/.test(x)).slice(0, 20);
  }
  return { segment, transferExtensions };
}
