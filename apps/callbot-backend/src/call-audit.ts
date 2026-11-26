// Daily call audit: after the calling day, every call with a transcript is checked by fixed rules
// (Turkish/foreign words, fractions of manat, technical words, transfers, pushy offers, short
// calls) and the text model writes a report of the problems with examples and fixes.
//   CLI:  node dist/call-audit-cli.js [YYYY-MM-DD] [--no-ai]
//   API:  GET /api/call-audits/:day, POST /api/call-audits/:day/run
//   Audio: up to CALL_AUDIT_AUDIO_CALLS (20) recordings are listened to for Turkish pronunciation
//          (CALL_AUDIT_AUDIO=off to skip).
//   Auto: every day at CALL_AUDIT_TIME (Baku, default 18:45), set CALL_AUDIT_AUTO=off to stop.
import { GoogleGenAI } from '@google/genai';
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { textModel } from './text-model.js';
import { recordAiTokenUsage } from './ai-usage.js';
import { readFile } from 'node:fs/promises';
import { recordingFileInfo } from './recording.js';
import { FRACTION_AMOUNT, LANGUAGE_QUESTION, OTHER_LANGUAGE, TECHNICAL_WORDS, TURKISH_WORDS, uniqueMatches } from './speech-checks.js';

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(rows) ? rows : [];
}

export interface AuditedCall {
  jobId: number | null;
  campaign: string;
  duration: number | null;
  flags: string[];
  transcript: string;
}

export interface AuditStats {
  day: string;
  calls: number;
  withTalk: number;
  byCampaign: Record<string, number>;
  flagCounts: Record<string, number>;
  turkishWords: Record<string, number>;
  transfers: number;
  transferFailed: number;
  pronunciation?: { said: string; should: string; count: number }[];
  pronunciationError?: string;
}

const TRANSFER_DONE = /\[Satış təmsilçisinə qoşuldu/;
const TRANSFER_FAILED = /\[Satış təmsilçisinə qoşmaq alınmadı\]/;
const REP_NOT_BRIEFED = /səs gəlmədi|heç nə demədi|izah elə(di)?\s*\S*\s*şərtləri|məlumat vermədi|mənə heç nə/i;
const TRANSFER_OFFER = /qoşum\?|qoşmağımı|birləşdirim\?|əlaqələndirim\?/gi;
const CUSTOMER_TROUBLE = /başa düşmürəm|başa düşmədim|eşitmirəm|eşitmədim|robotsan|robotdur|niyə belə|anlamadım|bir də deyin|təkrar edin/i;

const FLAG_TEXT: Record<string, string> = {
  turkish: 'Türkiyə türkcəsi sözü',
  other_language: 'başqa dil (ispan/ingilis)',
  fraction: 'qəpikli məbləğ',
  language_question: 'dil haqqında sual',
  technical: 'texniki söz səsləndi',
  rep_not_briefed: 'təmsilçi məlumat almayıb',
  transfer_failed: 'qoşma alınmadı',
  pushy_transfer: 'qoşmağı 2+ dəfə təklif etdi',
  customer_trouble: 'müştəri çətinlik çəkdi',
  very_short: 'çox qısa danışıq',
};

export function auditTranscript(transcript: string, duration: number | null): { flags: string[]; turkish: string[] } {
  const lines = transcript.split('\n');
  const bot = lines.filter((l) => l.startsWith('A:')).map((l) => l.slice(2)).join('\n');
  const customer = lines.filter((l) => l.startsWith('C:')).map((l) => l.slice(2)).join('\n');
  const transferAt = transcript.search(TRANSFER_DONE);
  // Before the transfer only: after it the rep's own words are written as bot lines.
  const botBefore = transferAt >= 0 ? lines.slice(0, transcript.slice(0, transferAt).split('\n').length).filter((l) => l.startsWith('A:')).join('\n') : bot;
  const flags: string[] = [];
  const turkish = uniqueMatches(botBefore, TURKISH_WORDS);
  if (turkish.length) flags.push('turkish');
  if (OTHER_LANGUAGE.test(botBefore)) flags.push('other_language');
  if (FRACTION_AMOUNT.test(botBefore)) flags.push('fraction');
  if (LANGUAGE_QUESTION.test(botBefore)) flags.push('language_question');
  if (TECHNICAL_WORDS.test(botBefore)) flags.push('technical');
  if (transferAt >= 0 && REP_NOT_BRIEFED.test(transcript.slice(transferAt))) flags.push('rep_not_briefed');
  if (TRANSFER_FAILED.test(transcript)) flags.push('transfer_failed');
  if ((botBefore.match(TRANSFER_OFFER) || []).length >= 2) flags.push('pushy_transfer');
  if (CUSTOMER_TROUBLE.test(customer)) flags.push('customer_trouble');
  if (lines.filter((l) => /^[AC]:/.test(l)).length <= 2 && (duration ?? 0) < 20) flags.push('very_short');
  return { flags, turkish };
}

async function loadCalls(day: string): Promise<AuditedCall[]> {
  const rows = rowsFrom(await db.execute(sql`
    SELECT c.telephony_job_id, c.duration_seconds, c.transcript, coalesce(cp.name, '-') AS campaign
    FROM calls c
    LEFT JOIN telephony_jobs t ON t.id = c.telephony_job_id
    LEFT JOIN campaigns cp ON cp.id = t.campaign_id
    WHERE (c.started_at AT TIME ZONE 'Asia/Baku')::date = ${day}::date
    ORDER BY c.id`));
  return rows.map((r) => {
    const transcript = String(r.transcript ?? '').trim();
    const duration = r.duration_seconds == null ? null : Number(r.duration_seconds);
    return {
      jobId: r.telephony_job_id == null ? null : Number(r.telephony_job_id),
      campaign: String(r.campaign),
      duration,
      flags: transcript ? auditTranscript(transcript, duration).flags : [],
      transcript,
    };
  });
}

function statsOf(day: string, calls: AuditedCall[]): AuditStats {
  const s: AuditStats = { day, calls: calls.length, withTalk: 0, byCampaign: {}, flagCounts: {}, turkishWords: {}, transfers: 0, transferFailed: 0 };
  for (const c of calls) {
    if (!c.transcript) continue;
    s.withTalk += 1;
    s.byCampaign[c.campaign] = (s.byCampaign[c.campaign] ?? 0) + 1;
    for (const f of c.flags) s.flagCounts[f] = (s.flagCounts[f] ?? 0) + 1;
    for (const w of auditTranscript(c.transcript, c.duration).turkish) s.turkishWords[w] = (s.turkishWords[w] ?? 0) + 1;
    if (TRANSFER_DONE.test(c.transcript)) s.transfers += 1;
    if (TRANSFER_FAILED.test(c.transcript)) s.transferFailed += 1;
  }
  return s;
}

function rulesReport(stats: AuditStats, calls: AuditedCall[]): string {
  const out: string[] = [];
  out.push(`# Zəng auditi: ${stats.day}`, '');
  out.push(`Cəmi zəng: ${stats.calls}, danışıq olan: ${stats.withTalk}, satışa qoşulan: ${stats.transfers}, qoşma alınmayan: ${stats.transferFailed}`);
  out.push('', '## Kampaniyalar');
  for (const [k, v] of Object.entries(stats.byCampaign).sort((a, b) => b[1] - a[1])) out.push(`- ${k}: ${v}`);
  out.push('', '## Qayda yoxlamaları (danışıq olan zənglərdən)');
  const flagged = Object.entries(stats.flagCounts).sort((a, b) => b[1] - a[1]);
  if (!flagged.length) out.push('- Problem tapılmadı');
  for (const [f, n] of flagged) {
    const jobs = calls.filter((c) => c.flags.includes(f)).slice(0, 8).map((c) => c.jobId).join(', ');
    const pct = stats.withTalk ? Math.round((n / stats.withTalk) * 100) : 0;
    out.push(`- ${FLAG_TEXT[f] ?? f}: ${n} zəng (${pct}%), məs. job ${jobs}`);
  }
  const tw = Object.entries(stats.turkishWords).sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (tw.length) out.push('', '## Botun işlətdiyi türkcə sözlər', ...tw.map(([w, n]) => `- "${w}": ${n} zəngdə`));
  return out.join('\n');
}

async function aiReport(stats: AuditStats, calls: AuditedCall[]): Promise<string | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  const talk = calls.filter((c) => c.transcript);
  if (!talk.length) return null;
  // Flagged calls first, then the rest, within the size limit.
  const ordered = [...talk.filter((c) => c.flags.length), ...talk.filter((c) => !c.flags.length)];
  const maxChars = Number(process.env.CALL_AUDIT_MAX_CHARS || 300000);
  let used = 0;
  const parts: string[] = [];
  for (const c of ordered) {
    const block = `### job ${c.jobId} | ${c.campaign} | ${c.duration ?? '?'} san | qaydalar: ${c.flags.join(', ') || '-'}\n${c.transcript.slice(0, 4000)}`;
    if (used + block.length > maxChars) break;
    parts.push(block);
    used += block.length;
  }
  const prompt = `Sən zəng mərkəzi keyfiyyət auditorusan. Aşağıda Azərbaycan dilində danışan səsli botun (A: bot, C: müştəri) bir günlük zənglərinin transkriptləri var (${parts.length}/${talk.length} zəng). Qayda yoxlamasının nəticəsi:
${JSON.stringify({ flagCounts: stats.flagCounts, turkishWords: stats.turkishWords, transfers: stats.transfers, transferFailed: stats.transferFailed })}

Qeyd: C: sətirləri müştərinin səsinin avtomatik yazısıdır, orada türkcə görünən sözlər çox vaxt tanıma səhvidir; botu yalnız A: sətirlərinə görə qiymətləndir. Satışa qoşulduqdan sonrakı sətirlər nümayəndənin sözləri ola bilər.

Azərbaycan dilində qısa, konkret hesabat yaz (markdown):
1. Ümumi qiymət (1-10) və bir cümlə xülasə.
2. Ən vacib 5 problem: hər biri üçün neçə zəngdə olduğu, 1-2 nümunə (job nömrəsi və botun dəqiq sözü), niyə problemdir.
3. Dil: botun türkcə və ya başqa dildə işlətdiyi söz və ifadələr, qeyri-təbii (tərcümə kimi) cümlələr.
4. Yanlış və ya uydurma məlumat (qiymət, şərt, ünvan), cavabsız qalan müştəri sualları.
5. Satışa qoşma: vaxtında idimi, israrlı idimi, nümayəndə məlumatlandırıldımı.
6. Konkret tövsiyələr: botun təlimatına nə əlavə edilməli və ya dəyişdirilməli (hazır mətn kimi).
Müştərilərin adlarını və telefon nömrələrini yazma.

${parts.join('\n\n')}`;
  const model = textModel(process.env.CALL_AUDIT_MODEL);
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const request = ai.models.generateContent({ model, contents: [{ role: 'user', parts: [{ text: prompt }] }], config: { temperature: 0.2 } });
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('call audit AI timed out')), 240000));
    const response = await Promise.race([request, timeout]);
    await recordAiTokenUsage({ model, operation: 'call_audit', usageMetadata: (response as { usageMetadata?: unknown }).usageMetadata as never });
    return String(response.text || '').trim() || null;
  } catch (err) {
    console.warn(`[call-audit] AI report failed: ${(err as Error).message}`);
    return null;
  }
}

// ---- Pronunciation from the recordings ------------------------------------------------------
// The transcript cannot show an accent: a sample of the day's recordings goes to the model, which
// listens to the bot's voice only and lists words said with a Turkey-Turkish pronunciation.
const AUDIO_PROMPT = `Bu, telefon zənginin səs yazısıdır. Danışanlar: səsli bot (şirkət adından zəng edən, süni intellekt) və müştəri. YALNIZ botun səsinə qulaq as.
Bot Azərbaycan dilində (Bakı tələffüzü) danışmalıdır. Botun Türkiyə türkcəsi tələffüzü ilə dediyi sözləri tap: məsələn "ə" yerinə "e" ("teklif", "merkez"), qalın "q" yerinə "k" ("kiymet", "koşuram"), türk vurğusu və intonasiyası, türkcə sözlər ("tamam", "şimdi", "evet", "-iyor").
Yalnız JSON qaytar, başqa heç nə yazma:
{"turkish_accent_score": 0-10 (0 = tamamilə Azərbaycan tələffüzü, 10 = tam türk tələffüzü), "words": [{"said": "botun dediyi kimi", "should_be": "Azərbaycan dilində düzgün forması", "type": "accent|turkish_word", "time": "mm:ss"}]}`;

interface AudioFinding { jobId: number; score: number | null; words: { said: string; should_be: string; type: string; time?: string }[] }

async function listenToCall(ai: GoogleGenAI, model: string, jobId: number): Promise<AudioFinding | null> {
  const info = await recordingFileInfo(jobId);
  if (!info || info.size < 20000 || info.size > 15 * 1024 * 1024) return null;
  const data = (await readFile(info.filePath)).toString('base64');
  const request = ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/mpeg', data } }, { text: AUDIO_PROMPT }] }],
    config: { temperature: 0, responseMimeType: 'application/json' },
  });
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 120000));
  const response = await Promise.race([request, timeout]);
  await recordAiTokenUsage({ model, operation: 'call_audit_audio', usageMetadata: (response as { usageMetadata?: unknown }).usageMetadata as never });
  const raw = String(response.text || '').replace(/^```(json)?|```$/g, '').trim();
  const parsed = JSON.parse(raw) as { turkish_accent_score?: number; words?: AudioFinding['words'] };
  return { jobId, score: Number.isFinite(Number(parsed.turkish_accent_score)) ? Number(parsed.turkish_accent_score) : null, words: Array.isArray(parsed.words) ? parsed.words.slice(0, 30) : [] };
}

async function pronunciationReport(calls: AuditedCall[], stats: AuditStats): Promise<string | null> {
  if (!process.env.GEMINI_API_KEY) console.warn('[call-audit] GEMINI_API_KEY is not set: no AI report, no recordings check');
  if (!process.env.GEMINI_API_KEY || String(process.env.CALL_AUDIT_AUDIO || 'on').toLowerCase() === 'off') return null;
  const max = Math.max(1, Math.min(Number(process.env.CALL_AUDIT_AUDIO_CALLS || 20), 100));
  // Real conversations only, flagged ones first, then the longest.
  const pool = calls.filter((c) => c.jobId && c.transcript.split('\n').filter((l) => l.startsWith('A:')).length >= 3);
  pool.sort((a, b) => Number(b.flags.includes('turkish')) - Number(a.flags.includes('turkish')) || (b.duration ?? 0) - (a.duration ?? 0));
  const picked = pool.slice(0, max);
  if (!picked.length) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = textModel(process.env.CALL_AUDIT_AUDIO_MODEL || process.env.CALL_AUDIT_MODEL);
  const findings: AudioFinding[] = [];
  for (const c of picked) {
    try {
      const f = await listenToCall(ai, model, c.jobId as number);
      if (f) findings.push(f);
    } catch (err) {
      const msg = (err as Error).message;
      console.warn(`[call-audit] listening to job ${c.jobId} failed: ${msg.slice(0, 300)}`);
      // Out of quota or over the spending cap: every other recording would fail the same way.
      if (/\b429\b|RESOURCE_EXHAUSTED|spending cap/i.test(msg)) {
        stats.pronunciationError = 'Gemini limiti dolub (429): səs yazıları dinlənmədi';
        break;
      }
    }
  }
  if (!findings.length) return `## Tələffüz (səs yazılarından)\n\n${stats.pronunciationError || 'Səs yazıları dinlənə bilmədi.'}`;
  const scored = findings.filter((f) => f.score != null);
  const avg = scored.length ? (scored.reduce((a, f) => a + (f.score as number), 0) / scored.length).toFixed(1) : '-';
  const counts = new Map<string, { n: number; should: string; type: string; jobs: Set<number> }>();
  for (const f of findings) for (const w of f.words) {
    const k = String(w.said || '').toLowerCase().trim();
    if (!k) continue;
    const e = counts.get(k) ?? { n: 0, should: String(w.should_be || ''), type: String(w.type || ''), jobs: new Set<number>() };
    e.n += 1; e.jobs.add(f.jobId); counts.set(k, e);
  }
  const top = [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 25);
  stats.pronunciation = top.filter(([, e]) => e.should).map(([k, e]) => ({ said: k, should: e.should, count: e.n }));
  const worst = [...scored].sort((a, b) => (b.score as number) - (a.score as number)).slice(0, 5);
  const out = ['## Tələffüz (səs yazılarından)', '',
    `Dinlənilən zəng: ${findings.length}. Türk tələffüzü balı (0 yaxşı, 10 pis): orta ${avg}.`,
    `Bal 4 və yuxarı olan zənglər: ${scored.filter((f) => (f.score as number) >= 4).length}.`];
  if (worst.length) out.push('', 'Ən çox türk tələffüzü olan zənglər:', ...worst.map((f) => `- job ${f.jobId}: bal ${f.score}`));
  if (top.length) out.push('', 'Türk kimi səslənən sözlər (necə dedi → necə olmalıdır):', ...top.map(([k, e]) => `- "${k}" → "${e.should}" (${e.type === 'turkish_word' ? 'türkcə söz' : 'tələffüz'}), ${e.n} dəfə, job ${[...e.jobs].slice(0, 5).join(', ')}`));
  else out.push('', 'Türk tələffüzü ilə deyilmiş söz tapılmadı.');
  return out.join('\n');
}

export async function ensureCallAuditSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS call_audits (
      day date PRIMARY KEY,
      report text NOT NULL,
      stats jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
}

export async function runCallAudit(day: string, opts: { ai?: boolean } = {}): Promise<{ report: string; stats: AuditStats }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('day must be YYYY-MM-DD');
  await ensureCallAuditSchema();
  const calls = await loadCalls(day);
  const stats = statsOf(day, calls);
  let report = rulesReport(stats, calls);
  if (opts.ai !== false) {
    const pron = await pronunciationReport(calls, stats).catch((err) => { console.warn(`[call-audit] pronunciation: ${(err as Error).message}`); return null; });
    if (pron) report += `\n\n${pron}`;
    const ai = await aiReport(stats, calls);
    report += ai ? `\n\n## Süni intellekt təhlili\n\n${ai}` : '\n\n(Süni intellekt təhlili alınmadı)';
  }
  await db.execute(sql`
    INSERT INTO call_audits (day, report, stats, created_at) VALUES (${day}::date, ${report}, ${JSON.stringify(stats)}::jsonb, now())
    ON CONFLICT (day) DO UPDATE SET report = EXCLUDED.report, stats = EXCLUDED.stats, created_at = now()`);
  console.log(`[call-audit] ${day}: ${stats.withTalk} calls audited`);
  return { report, stats };
}

export async function getCallAudit(day: string): Promise<{ report: string; stats: unknown; created_at: unknown } | null> {
  await ensureCallAuditSchema();
  const [row] = rowsFrom(await db.execute(sql`SELECT report, stats, created_at FROM call_audits WHERE day = ${day}::date`));
  return row ? { report: String(row.report), stats: row.stats, created_at: row.created_at } : null;
}

export const bakuDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const bakuHm = (d = new Date()) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baku', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

/** Once a day after the calling window: today's audit, unless it already exists. */
export function startCallAuditScheduler(): void {
  if (String(process.env.CALL_AUDIT_AUTO || 'on').toLowerCase() === 'off') return;
  const at = String(process.env.CALL_AUDIT_TIME || '18:45');
  let running = false;
  const tick = async () => {
    if (running || bakuHm() < at) return;
    const day = bakuDay();
    running = true;
    try {
      if (!(await getCallAudit(day))) await runCallAudit(day);
    } catch (err) {
      console.warn(`[call-audit] scheduled run failed: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  };
  setInterval(() => void tick(), 10 * 60 * 1000).unref();
}

// The words the last audits heard with a Turkish pronunciation go back into the bot's instruction,
// so each day's findings correct the next day's calls. Cached: read at most every 10 minutes.
let hintsCache: { at: number; text: string } = { at: 0, text: '' };
export async function pronunciationHints(): Promise<string> {
  if (Date.now() - hintsCache.at < 10 * 60 * 1000) return hintsCache.text;
  hintsCache = { at: Date.now(), text: hintsCache.text };
  try {
    await ensureCallAuditSchema();
    const rows = rowsFrom(await db.execute(sql`SELECT stats FROM call_audits WHERE day > current_date - 7 ORDER BY day DESC`));
    const words = new Map<string, { should: string; count: number }>();
    for (const r of rows) {
      const st = (typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats) as AuditStats | null;
      for (const w of st?.pronunciation ?? []) {
        const e = words.get(w.said) ?? { should: w.should, count: 0 };
        e.count += w.count; words.set(w.said, e);
      }
    }
    const top = [...words.entries()].filter(([said, e]) => e.should && e.should.toLowerCase() !== said).sort((a, b) => b[1].count - a[1].count).slice(0, 20);
    hintsCache.text = top.length
      ? `TƏLƏFFÜZ DÜZƏLİŞLƏRİ (son zənglərin auditindən: bu sözləri türk kimi deyirsən, yalnız sağdakı Azərbaycan formasında de): ${top.map(([said, e]) => `"${said}" yox "${e.should}"`).join('; ')}.`
      : '';
  } catch (err) {
    console.warn(`[call-audit] pronunciation hints: ${(err as Error).message}`);
  }
  return hintsCache.text;
}

/** One recording, for a quick check from the CLI (--job N). */
export async function listenToJob(jobId: number): Promise<unknown> {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return (await listenToCall(ai, textModel(process.env.CALL_AUDIT_AUDIO_MODEL || process.env.CALL_AUDIT_MODEL), jobId)) ?? { error: 'recording not found or too short' };
}
