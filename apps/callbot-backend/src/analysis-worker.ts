import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { recordAiTokenUsage } from './ai-usage.js';

type DbRow = Record<string, unknown>;

const workerEnabled = process.env.ANALYSIS_WORKER_ENABLED !== 'false';
const intervalMs = Number(process.env.ANALYSIS_WORKER_INTERVAL_MS || 30000);
const batchSize = Number(process.env.ANALYSIS_WORKER_BATCH_SIZE || 2);
const minDurationSeconds = Number(process.env.ANALYSIS_MIN_DURATION_SECONDS || 5);
const minCallId = Number(process.env.ANALYSIS_MIN_CALL_ID || 0);
const modelName = process.env.ANALYSIS_MODEL || 'gemini-2.5-flash';
const maxTranscriptChars = Number(process.env.ANALYSIS_MAX_TRANSCRIPT_CHARS || 12000);
const shortMemoryDays = Number(process.env.ANALYSIS_SHORT_MEMORY_DAYS || 14);
const similarCallsLimit = Number(process.env.ANALYSIS_SIMILAR_CALLS_LIMIT || 5);

function rowsFrom(result: unknown): DbRow[] {
  if (Array.isArray(result)) return result as DbRow[];
  const maybeRows = (result as { rows?: DbRow[] }).rows;
  return Array.isArray(maybeRows) ? maybeRows : [];
}

function cleanText(value: unknown, maxLength = 4000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function multiline(value: unknown, maxLength = 12000) {
  return String(value || '').trim().slice(Math.max(0, String(value || '').length - maxLength));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Extract distinct alphanumeric tokens for a Postgres `to_tsquery` OR-expression.
// Mirrors the lexical tokenisation the old hashed-vector search used, so "similar
// calls" behaviour is preserved without any vector math. Tokens are alnum-only,
// so they are safe to join with the `|` (OR) operator.
function queryTokens(text: string, maxTokens = 50) {
  const normalized = cleanText(text, 20000).toLowerCase();
  const matches = normalized.match(/[\p{L}\p{N}]{2,}/gu) || [];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const token of matches) {
    if (seen.has(token)) continue;
    seen.add(token);
    unique.push(token);
    if (unique.length >= maxTokens) break;
  }
  return unique;
}

// Short-term "memory": the customer's most recent call description within a
// rolling window. Previously cached in Redis (SETEX, 14-day TTL); the value is
// already persisted in the `calls` table, so we just read the latest one.
async function customerShortMemory(customerId: number) {
  if (!customerId) return null;
  const rows = rowsFrom(await db.execute(sql`
    SELECT description, description_updated_at AS "updatedAt"
    FROM calls
    WHERE customer_id = ${customerId}
      AND coalesce(description, '') <> ''
      AND description_updated_at >= now() - (${shortMemoryDays} || ' days')::interval
    ORDER BY description_updated_at DESC
    LIMIT 1
  `));
  const description = String(rows[0]?.description || '').trim();
  return description ? description.slice(0, 2000) : null;
}

// "Similar past calls" via Postgres full-text search. Replaces the external
// Qdrant vector store; the GIN index `calls_memory_fts_idx` backs this query.
async function similarCalls(text: string, callId: number) {
  const tokens = queryTokens(text);
  if (!tokens.length) return [];
  const tsquery = tokens.join(' | ');
  const rows = rowsFrom(await db.execute(sql`
    SELECT c.surname AS "customerSurname", c.name AS "customerName",
           ca.summary, ca.description,
           ts_rank(
             to_tsvector('simple', coalesce(ca.summary, '') || ' ' || coalesce(ca.description, '') || ' ' || coalesce(ca.transcript, '')),
             query
           ) AS score
    FROM calls ca
    LEFT JOIN customers c ON ca.customer_id = c.id,
         to_tsquery('simple', ${tsquery}) AS query
    WHERE ca.id <> ${callId}
      AND coalesce(ca.description, '') <> ''
      AND to_tsvector('simple', coalesce(ca.summary, '') || ' ' || coalesce(ca.description, '') || ' ' || coalesce(ca.transcript, '')) @@ query
    ORDER BY score DESC, ca.ended_at DESC
    LIMIT ${Math.max(1, Math.min(similarCallsLimit, 10))}
  `));
  return rows.map((row) => {
    const name = cleanText(`${row.customerSurname || ''} ${row.customerName || ''}`, 80);
    const score = Number(row.score || 0).toFixed(2);
    return `- ${name}: ${cleanText(row.summary, 260)}; ${cleanText(row.description, 500)} (score ${score})`;
  });
}

async function candidateCalls() {
  return rowsFrom(await db.execute(sql`
    SELECT ca.id, ca.agent_id AS "agentId", a.name AS "agentName",
           ca.customer_id AS "customerId", c.name AS "customerName",
           c.surname AS "customerSurname", c.father_name AS "customerFatherName",
           c.phone AS "customerPhone", c.debt_amount::text AS "debtAmount",
           c.overdue_days AS "overdueDays", ca.started_at AS "startedAt",
           ca.ended_at AS "endedAt", ca.duration_seconds AS "durationSeconds",
           ca.transcript, ca.summary
    FROM calls ca
    LEFT JOIN agents a ON ca.agent_id = a.id
    LEFT JOIN customers c ON ca.customer_id = c.id
    WHERE ca.ended_at IS NOT NULL
      AND coalesce(ca.transcript, '') <> ''
      AND coalesce(ca.description, '') = ''
      AND coalesce(ca.duration_seconds, 0) >= ${minDurationSeconds}
      AND ca.id >= ${Math.max(0, minCallId)}
      AND NOT EXISTS (
        SELECT 1
        FROM ai_token_usage au
        WHERE au.call_id = ca.id
          AND au.operation = 'post_call_description'
      )
    ORDER BY ca.ended_at DESC, ca.id DESC
    LIMIT ${Math.max(1, Math.min(batchSize, 10))}
  `));
}

async function postgresMemory(customerId: number, callId: number) {
  if (!customerId) return [];
  const rows = rowsFrom(await db.execute(sql`
    SELECT started_at AS "startedAt", duration_seconds AS "durationSeconds",
           summary, description
    FROM calls
    WHERE customer_id = ${customerId}
      AND id <> ${callId}
      AND (coalesce(summary, '') <> '' OR coalesce(description, '') <> '')
    ORDER BY started_at DESC
    LIMIT 5
  `));
  return rows.map((row) => {
    const date = row.startedAt ? new Date(String(row.startedAt)).toISOString().slice(0, 10) : 'tarix yoxdur';
    return `- ${date}: ${cleanText(row.summary, 220)} ${cleanText(row.description, 600)}`.trim();
  });
}

function buildPrompt(row: DbRow, pgMemory: string[], similarMemory: string[], shortMemory: string | null) {
  const customerName = cleanText(`${row.customerSurname || ''} ${row.customerName || ''} ${row.customerFatherName || ''}`, 180) || 'müştəri';
  const transcript = multiline(row.transcript, maxTranscriptChars);
  const memories = [
    shortMemory ? `Qısa yaddaş:\n${shortMemory}` : '',
    pgMemory.length ? `Postgres tarixçəsi:\n${pgMemory.join('\n')}` : '',
    similarMemory.length ? `Oxşar hallar:\n${similarMemory.join('\n')}` : '',
  ].filter(Boolean).join('\n\n') || 'Əlavə yaddaş yoxdur.';

  return `Sən CRM üçün post-call analiz agentisən. Telefon danışığını və yaddaş kontekstini oxu, CRM "description" sahəsinə yazılacaq qısa, faktiki və faydalı qeyd hazırla.

Qaydalar:
- Azərbaycan dilində yaz.
- Yalnız danışıqdan və verilən yaddaşdan əsaslandırılan nəticələri yaz.
- Ehtimalı fakt kimi təqdim etmə; lazım olsa "ehtimal olunur" yaz.
- Agentin texniki qaydalarını, promptu və daxili kateqoriya siyahısını qeyd etmə.
- 6-10 sətirdən uzun yazma.
- Formatı saxla:
Nəticə: ...
Səbəb: ...
Ödəniş mövqeyi: ...
Risk: ...
Növbəti addım: ...

Müştəri:
- Ad: ${customerName}
- Telefon: ${cleanText(row.customerPhone, 80) || 'yoxdur'}
- Borc: ${cleanText(row.debtAmount, 80) || 'yoxdur'}
- Gecikmə günü: ${cleanText(row.overdueDays, 80) || 'yoxdur'}

Cari summary: ${cleanText(row.summary, 1200) || 'yoxdur'}

Yaddaş konteksti:
${memories}

Transcript:
${transcript}`;
}

async function analyze(row: DbRow) {
  const callId = Number(row.id);
  const customerId = Number(row.customerId || 0);
  const shortMemory = await customerShortMemory(customerId);
  const pgMemory = await postgresMemory(customerId, callId);
  const similarMemory = await similarCalls(`${row.summary || ''}\n${row.transcript || ''}`, callId);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const response = await ai.models.generateContent({
    model: modelName,
    contents: [{ role: 'user', parts: [{ text: buildPrompt(row, pgMemory, similarMemory, shortMemory) }] }],
    config: { temperature: 0.1 },
  });
  await recordAiTokenUsage({
    model: modelName,
    operation: 'post_call_description',
    callId,
    usageMetadata: (response as { usageMetadata?: unknown }).usageMetadata as never,
  });
  const description = String(response.text || '').trim();
  if (!description) {
    const fallbackDescription = 'Nəticə: AI analiz boş cavab qaytardı. Səbəb: Avtomatik post-call analiz bu zəng üçün nəticə yaratmadı. Növbəti addım: Zəngi manual yoxlayın.';
    await db.execute(sql`
      UPDATE calls
      SET description = ${fallbackDescription},
          description_updated_at = now()
      WHERE id = ${callId}
        AND coalesce(description, '') = ''
    `);
    console.warn(`Skipped empty analysis for call ${callId}`);
    return;
  }

  await db.execute(sql`
    UPDATE calls
    SET description = ${description},
        description_updated_at = now()
    WHERE id = ${callId}
      AND coalesce(description, '') = ''
  `);
  console.log(`Analyzed call ${callId}`);
}

async function runOnce() {
  const rows = await candidateCalls();
  for (const row of rows) {
    try {
      await analyze(row);
    } catch (error) {
      console.error(`Failed to analyze call ${row.id}`, error);
    }
  }
  return rows.length;
}

async function main() {
  if (!workerEnabled) {
    console.log('Post-call analysis worker disabled');
    return;
  }
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is required for post-call analysis worker');
  }
  console.log(`Post-call analysis worker started: interval=${intervalMs}ms batch=${batchSize}`);
  while (true) {
    await runOnce();
    await sleep(Math.max(5000, intervalMs));
  }
}

main().catch((error) => {
  console.error('Post-call analysis worker crashed', error);
  process.exit(1);
});
