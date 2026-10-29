import { eq, sql } from 'drizzle-orm';
import { db } from './db/index.js';

// Fallback tone instructions (used if DB lookup fails)
const FALLBACK_TONE_INSTRUCTIONS: Record<string, string> = {
  soft: `- Müştərini ödənişə yönləndir, amma heç bir təzyiq göstərmə
- Anlayışlı ol, çətinliklərini qəbul et
- Könüllü ödəniş planı təklif et
- Kobud və ya təzyiqli sözlərdən tamamilə çəkin`,
  neutral: `- Müştərini ödənişə yönləndir
- Müəyyən təzyiq göstər, amma kobud olma
- Gecikməyin nəticələrini (faiz artımı, kredit tarixçəsi) xatırlat
- Ciddi, amma nəzakətli ol`,
  firm: `- Müştəriyə ödənişin vacibliyini qəti şəkildə çatdır
- Ödənilməməsinin ciddi nəticələrini (məhkəmə, icra, kredit reytinqi) açıq söylə
- Güzəşt variantlarını yalnız müştəri ciddi istək göstərəndə irəli sür
- Qısa, birbaşa danış — uzun izahatlardan çəkin`,
};

const FALLBACK_BASE_INSTRUCTION = `Sənin adın {AGENT_NAME}-dır. Sən {COMPANY_NAME} şirkətinin problemli kreditlər üzrə şöbəsinin işçisisən və Azərbaycan dilində danışırsan.
Sənin davranışın:
- Qısa və konkret danış
- Real call center tonu istifadə et
{TONE_INSTRUCTION}
- Real danışıq kimi cavab ver (robot kimi yox)
- "Hörmətli müştəri" kimi sözlər istifadə et
- danışıq dili istifadə et (formal yox)
- real insan kimi tərəddüd edə bilərsən

Aşağıda real dialoq nümunələri var:

Müştəri: Salam, salam əleyküm.
Operator: Alo, salam, hər vaxtınız xeyir olsun. Danışa bilirsiniz?

Müştəri: Bəli.
Operator: Qasımov Vüsal Məhərrəm oğlu? Nərimanov rayon icra şöbəsindən zəng edirəm.

Müştəri: Buyur.
Operator: Sizin borcunuz var, ödənişlər uzun müddətdir gecikir.

Müştəri: EPA ilə ödəyirəm də.
Operator: Bilirəm hörmətli müştəri, amma 2-3 manatlıq ödənişlər effektiv deyil, bunu normal məbləğlə etməlisən.

Müştəri: Gündəlik gücüm çatan qədər ödəyirəm.
Operator: Gündəlik xırda yox, ayda bir dəfə normal məbləğ ödəsən daha düzgün olar.

Müştəri: Pul saxlaya bilmirəm.
Operator: Onda çalış yığ, ay ərzində bir dəfə minimum 100 manat kimi ödə.

Müştəri: Başqa borclarım da var.
Operator: Yoxladım, digər borcların da icradadır. Bu vəziyyət sənin üçün risklidir.

Müştəri: Mən çalışıram ödəməyə.
Operator: Görürəm, amma bu formada davam etsən faizlər artacaq.

Müştəri: Pul gözləyirəm.
Operator: Onda işi məndə saxlayım, amma yaxın günlərdə normal ödəniş etməlisən.

Müştəri: Güzəşt edə bilərsiniz?
Operator: Bəli, müəyyən güzəşt edə bilərəm, amma tam bağlamağa çalış.

Müştəri: Bu dəqiqə tam ödəyə bilmirəm.
Operator: Heç olmasa 150-200 manat ödə, iş məhkəməyə getməsin.

Müştəri: İşim stabil deyil.
Operator: Başa düşürəm, amma gecikmə sənin kredit tarixçənə ciddi təsir edir.

Müştəri: Əsgərlikdə olmuşam.
Operator: Bunu qeyd edəcəyəm, amma yenə də ödənişi sürətləndirmək lazımdır.

Müştəri: Bu ay 100 manat ödəyə bilərəm.
Operator: Çalış 300 et, borc al, amma bağlamağa yaxınlaşdır.

Müştəri: Torpaq satacam.
Operator: Yaxşıdır, satılan kimi birbaşa borcu bağlamağa yönəlt.

Müştəri: Maaş alanda ödəyəcəm.
Operator: Oldu, amma bu günlərdə gecikdirmə, qəbzi də mənə göndər.

Müştəri: WhatsApp nömrənizi verin.
Operator: Qeyd elə: {WHATSAPP_PHONE}. Qəbzləri ora at.

Müştəri: Bu gün ödəyəcəm.
Operator: Oldu, gün sonuna qədər gözləyirəm.

Müştəri: Bağlamaq istəyirəm borcu.
Operator: Onda indi imkan daxilində maksimum ödə, qalanına güzəşt edim bağlayaq.`;

// Template cache: cacheKey (type:name) -> { content, expireAt }
const templateCache = new Map<string, { content: string; expireAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function loadTemplateFromDb(name: string, type: 'base' | 'tone'): Promise<string | null> {
  try {
    const rows = await db.execute(sql`
      SELECT content FROM instruction_templates
      WHERE name = ${name} 
        AND template_type = ${type}
        AND is_active = true
      LIMIT 1
    `);
    const row = Array.isArray(rows) ? rows[0] : (rows as { rows?: Array<{ content?: string }> }).rows?.[0];
    return row?.content ? String(row.content) : null;
  } catch (err) {
    console.error(`Failed to load ${type} template "${name}" from DB:`, err);
    return null;
  }
}

// Deliberately does NOT filter on is_active: a template selected explicitly by id (a
// campaign's or job's baseTemplateId) should be used as specified regardless of which
// template happens to be "the" active default — is_active only decides what loads when
// NO id is given (see loadActiveTemplateFromDb below). A row is only unavailable here if
// it no longer exists.
async function loadTemplateById(id: string): Promise<string | null> {
  try {
    const rows = await db.execute(sql`
      SELECT content FROM instruction_templates
      WHERE id = ${id}
      LIMIT 1
    `);
    const row = Array.isArray(rows) ? rows[0] : (rows as { rows?: Array<{ content?: string }> }).rows?.[0];
    return row?.content ? String(row.content) : null;
  } catch (err) {
    console.error(`Failed to load template by ID "${id}" from DB:`, err);
    return null;
  }
}

async function getCachedOrLoad(name: string, type: 'base' | 'tone'): Promise<string | null> {
  const cacheKey = `${type}:${name}`;
  const cached = templateCache.get(cacheKey);

  if (cached && cached.expireAt > Date.now()) {
    return cached.content;
  }

  const content = await loadTemplateFromDb(name, type);
  if (content) {
    templateCache.set(cacheKey, { content, expireAt: Date.now() + CACHE_TTL_MS });
  }
  return content;
}

async function loadActiveTemplateFromDb(type: 'base' | 'tone' | 'system'): Promise<string | null> {
  try {
    const rows = await db.execute(sql`
      SELECT content FROM instruction_templates
      WHERE template_type = ${type}
        AND is_active = true
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    const row = Array.isArray(rows) ? rows[0] : (rows as { rows?: Array<{ content?: string }> }).rows?.[0];
    return row?.content ? String(row.content) : null;
  } catch (err) {
    console.error(`Failed to load active ${type} template from DB:`, err);
    return null;
  }
}

async function getCachedActiveOrLoad(type: 'base' | 'tone' | 'system'): Promise<string | null> {
  const cacheKey = `active:${type}`;
  const cached = templateCache.get(cacheKey);

  if (cached && cached.expireAt > Date.now()) {
    return cached.content;
  }

  const content = await loadActiveTemplateFromDb(type);
  if (content) {
    templateCache.set(cacheKey, { content, expireAt: Date.now() + CACHE_TTL_MS });
  }
  return content;
}

// There is only ever one active 'base' template at a time (enforced in the
// instruction-templates routes), so calls always use whichever one is active.
export async function loadBaseInstruction(): Promise<string> {
  const dbTemplate = await getCachedActiveOrLoad('base');
  return dbTemplate || FALLBACK_BASE_INSTRUCTION;
}

// Load a specific base template by ID (for per-campaign overrides).
// Falls back to the globally active template if the ID is not found.
export async function loadBaseInstructionById(id: string): Promise<string> {
  const cacheKey = `base-id:${id}`;
  const cached = templateCache.get(cacheKey);
  if (cached && cached.expireAt > Date.now()) return cached.content;

  const content = await loadTemplateById(id);
  if (content) {
    templateCache.set(cacheKey, { content, expireAt: Date.now() + CACHE_TTL_MS });
    return content;
  }
  return loadBaseInstruction();
}

export async function loadToneInstruction(tone: string = 'neutral'): Promise<string> {
  const templateName = `tone_${tone}`;
  const dbTemplate = await getCachedOrLoad(templateName, 'tone');
  return dbTemplate || FALLBACK_TONE_INSTRUCTIONS[tone] || FALLBACK_TONE_INSTRUCTIONS.neutral;
}

export async function loadToneInstructionById(toneTemplateId: string): Promise<string | null> {
  if (!toneTemplateId) return null;
  try {
    const cacheKey = `tone-id:${toneTemplateId}`;
    const cached = templateCache.get(cacheKey);

    if (cached && cached.expireAt > Date.now()) {
      return cached.content;
    }

    const content = await loadTemplateById(toneTemplateId);
    if (content) {
      templateCache.set(cacheKey, { content, expireAt: Date.now() + CACHE_TTL_MS });
    }
    return content;
  } catch (err) {
    console.error(`Failed to load tone instruction by template ID: ${err}`);
    return null;
  }
}

export function clearTemplateCache(): void {
  templateCache.clear();
}

// Strict existence check for telephonyJobs.baseTemplateId (see schema.ts) — used wherever a
// job's pinned template must resolve exactly, with NO fallback to the global active template.
// Deliberately does NOT check is_active (see loadTemplateById above: that flag only decides
// the default when no id is given, it doesn't gate direct-by-id selection) — a template is
// only "unavailable" here if the row no longer exists. Unlike loadBaseInstructionById, a miss
// here must be treated as a hard failure by the caller, not a silent fallback.
export async function baseTemplateExists(id: string): Promise<boolean> {
  try {
    const rows = await db.execute(sql`
      SELECT 1 FROM instruction_templates
      WHERE id = ${id} AND template_type = 'base'
      LIMIT 1
    `);
    const list = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
    return list.length > 0;
  } catch (err) {
    console.error(`Failed to check base template existence for "${id}":`, err);
    return false;
  }
}
