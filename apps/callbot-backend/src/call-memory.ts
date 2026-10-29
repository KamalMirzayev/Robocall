import { sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { db } from './db/index.js';
import type { agents, customers } from './db/schema.js';

type Customer = InferSelectModel<typeof customers>;
type Agent = InferSelectModel<typeof agents>;

type CallMemoryRow = {
  id?: unknown;
  startedAt?: unknown;
  durationSeconds?: unknown;
  summary?: unknown;
  transcript?: unknown;
};

type Turn = {
  role: 'agent' | 'customer';
  text: string;
};

const memoryEnabled = process.env.CALL_MEMORY_ENABLED !== 'off';
const customerCallLimit = boundedInt(process.env.CALL_MEMORY_CUSTOMER_CALLS, 3, 0, 5);
const patternCallLimit = boundedInt(process.env.CALL_MEMORY_PATTERN_CALLS, 4, 0, 8);
const maxMemoryChars = boundedInt(process.env.CALL_MEMORY_MAX_CHARS, 4500, 1200, 9000);

const customerSignalPattern = /\b(öd|ode|borc|kredit|gecik|maaş|maas|pensiya|təqaüd|teqaud|sabah|həftə|hefte|ay(ın)?|qəbz|qebz|whatsapp|nömrə|nomre|məhkəmə|mehkeme|icra|işsiz|issiz|iş|is|xəstə|xeste|tanımıram|tanimiram|səhv|sehv|imtina|ödəməyəcəm|odemeyecem|sonra|zəng|zeng)\b/i;
const usefulExchangePattern = /\b(öd|ode|borc|kredit|gecik|maaş|maas|pensiya|sabah|həftə|hefte|qismən|qismen|hissə|hisse|məhkəmə|mehkeme|icra|tanımıram|tanimiram|səhv|sehv|vaxt|sonra|imkan|işsiz|issiz)\b/i;
const positiveSummaryPattern = /(Ödənişə söz verib|Ödənişi təxirə saldı|Hissə-hissə ödəniş|Borc bağlanıb|tam ödənib|Əlaqə saxlanılacaq)/i;

function boundedInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.round(parsed), max));
}

function rowsFrom(result: unknown): CallMemoryRow[] {
  if (Array.isArray(result)) return result as CallMemoryRow[];
  const rows = (result as { rows?: CallMemoryRow[] })?.rows;
  return Array.isArray(rows) ? rows : [];
}

function cleanText(value: unknown, maxLength = 260) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function formatDate(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return 'tarixsiz';
  return date.toISOString().slice(0, 10);
}

function parseTranscript(transcript: unknown): Turn[] {
  const turns: Turn[] = [];
  for (const rawLine of String(transcript || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const agentMatch = /^A\s*:\s*(.+)$/i.exec(line);
    if (agentMatch) {
      turns.push({ role: 'agent', text: cleanText(agentMatch[1], 360) });
      continue;
    }

    const customerMatch = /^C\s*:\s*(.+)$/i.exec(line);
    if (customerMatch) {
      turns.push({ role: 'customer', text: cleanText(customerMatch[1], 360) });
      continue;
    }

    const previous = turns[turns.length - 1];
    if (previous) previous.text = cleanText(`${previous.text} ${line}`, 360);
  }
  return turns.filter((turn) => turn.text.length > 0);
}

function uniqueTexts(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function customerSignals(turns: Turn[], limit = 3) {
  const customerTurns = turns
    .filter((turn) => turn.role === 'customer')
    .map((turn) => turn.text)
    .filter((text) => text.length >= 4);
  const signaled = customerTurns.filter((text) => customerSignalPattern.test(text));
  const source = signaled.length > 0 ? signaled : customerTurns.slice(-limit);
  return uniqueTexts(source).slice(0, limit).map((text) => cleanText(text, 180));
}

function firstUsefulExchange(turns: Turn[]) {
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    if (turn.role !== 'customer' || !usefulExchangePattern.test(turn.text)) continue;
    const agentTurn = turns.slice(index + 1).find((candidate) => candidate.role === 'agent');
    if (!agentTurn) continue;
    return {
      customer: cleanText(turn.text, 140),
      agent: cleanText(agentTurn.text, 180),
    };
  }
  return null;
}

function describeCustomerCall(row: CallMemoryRow) {
  const turns = parseTranscript(row.transcript);
  const facts = customerSignals(turns);
  const summary = cleanText(row.summary, 220) || 'summary yoxdur';
  const lines = [`- ${formatDate(row.startedAt)}: ${summary}.`];
  if (facts.length > 0) lines.push(`  Müştəri əvvəl demişdi: ${facts.map((fact) => `"${fact}"`).join(' | ')}`);
  return lines.join('\n');
}

function describePatternCall(row: CallMemoryRow) {
  const exchange = firstUsefulExchange(parseTranscript(row.transcript));
  if (!exchange) return null;
  const summary = cleanText(row.summary, 160) || 'nəticə qeyd olunmayıb';
  return `- Müştəri: "${exchange.customer}" -> agent cavabı: "${exchange.agent}" (${summary})`;
}

function clampMemory(text: string) {
  if (text.length <= maxMemoryChars) return text;
  return `${text.slice(0, Math.max(0, maxMemoryChars - 80)).trim()}\n... yaddaş qısaldılıb; yalnız ən vacib qeydlərdən istifadə et.`;
}

export async function buildCallMemoryContext(customer: Customer, agent: Agent) {
  if (!memoryEnabled || (customerCallLimit === 0 && patternCallLimit === 0)) return '';

  try {
    const [customerRows, patternRows] = await Promise.all([
      customerCallLimit > 0
        ? db.execute(sql`
            SELECT id, started_at AS "startedAt", duration_seconds AS "durationSeconds", summary, transcript
            FROM calls
            WHERE customer_id = ${customer.id}
              AND ended_at IS NOT NULL
              AND coalesce(transcript, '') <> ''
            ORDER BY started_at DESC, id DESC
            LIMIT ${customerCallLimit}
          `)
        : Promise.resolve([]),
      patternCallLimit > 0
        ? db.execute(sql`
            SELECT id, started_at AS "startedAt", duration_seconds AS "durationSeconds", summary, transcript
            FROM calls
            WHERE agent_id = ${agent.id}
              AND customer_id <> ${customer.id}
              AND ended_at IS NOT NULL
              AND coalesce(transcript, '') <> ''
              AND coalesce(summary, '') <> ''
            ORDER BY
              CASE WHEN summary ~* ${positiveSummaryPattern.source} THEN 0 ELSE 1 END,
              started_at DESC,
              id DESC
            LIMIT ${patternCallLimit}
          `)
        : Promise.resolve([]),
    ]);

    const customerNotes = rowsFrom(customerRows).map(describeCustomerCall);
    const patternNotes = rowsFrom(patternRows)
      .map(describePatternCall)
      .filter((value): value is string => Boolean(value));

    if (customerNotes.length === 0 && patternNotes.length === 0) return '';

    const sections = [
      '\n\nKeçmiş zənglərdən kontrollu yaddaş:',
      '- Bu hissə daxili kontekstdir, müştəriyə oxuma.',
      '- Keçmiş zənglərdəki məlumatı fakt kimi yalnız həmin zəngdən gəldiyini bildirərək istifadə et; cari müştəri məlumatları və müştərinin indi dedikləri həmişə üstündür.',
    ];

    if (customerNotes.length > 0) {
      sections.push('\nBu müştəri ilə əvvəlki zənglər:', ...customerNotes);
    }
    if (patternNotes.length > 0) {
      sections.push('\nDigər uğurlu zənglərdən danışıq nümunələri:', ...patternNotes);
    }

    return clampMemory(sections.join('\n'));
  } catch (error) {
    console.error('Failed to build call memory context', error);
    return '';
  }
}
