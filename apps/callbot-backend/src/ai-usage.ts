import { Router } from 'express';
import { geminiCreditStatus } from './gemini-credit.js';
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';

type UsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

type UsageInput = {
  model: string;
  operation: string;
  callId?: number | null;
  usageMetadata?: UsageMetadata | null;
};

type UsageSummaryRow = Record<string, unknown> & {
  operation?: unknown;
  totalTokens?: unknown;
  requests?: unknown;
  estimatedCostUsd?: number;
};

const liveModel = 'gemini-3.1-flash-live-preview';
const liveOperation = 'live_audio_estimate';
const liveAudioInputUsdPerMinute = 0.005;
const liveAudioOutputUsdPerMinute = 0.018;
const liveAudioTotalUsdPerMinute = liveAudioInputUsdPerMinute + liveAudioOutputUsdPerMinute;

function tokenNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function priceFor(model: string, operation: string) {
  if (model === liveModel) {
    return { inputPerMillion: 3, outputPerMillion: 12, unit: 'audio_estimate' };
  }
  if (model === 'gemini-2.5-flash') {
    const audioInput = operation === 'post_call_transcription';
    return { inputPerMillion: audioInput ? 1 : 0.3, outputPerMillion: 2.5, unit: audioInput ? 'audio_input_text_output' : 'text' };
  }
  return { inputPerMillion: 0.3, outputPerMillion: 2.5, unit: 'fallback_text' };
}

function usageCostUsd(model: string, operation: string, promptTokens: number, candidateTokens: number, totalTokens: number) {
  const price = priceFor(model, operation);
  const knownTokens = promptTokens + candidateTokens;
  const inputTokens = knownTokens ? promptTokens : totalTokens;
  const outputTokens = knownTokens ? candidateTokens : 0;
  return ((inputTokens / 1_000_000) * price.inputPerMillion) + ((outputTokens / 1_000_000) * price.outputPerMillion);
}

function liveEstimatedTokenCounts(durationSeconds: number) {
  const seconds = tokenNumber(durationSeconds);
  if (!seconds) return null;
  const minutes = seconds / 60;
  const price = priceFor(liveModel, liveOperation);
  const promptTokens = Math.round((minutes * liveAudioInputUsdPerMinute * 1_000_000) / price.inputPerMillion);
  const candidateTokens = Math.round((minutes * liveAudioOutputUsdPerMinute * 1_000_000) / price.outputPerMillion);
  return {
    promptTokens,
    candidateTokens,
    totalTokens: promptTokens + candidateTokens,
  };
}

export async function recordAiTokenUsage(input: UsageInput) {
  const promptTokens = tokenNumber(input.usageMetadata?.promptTokenCount);
  const candidateTokens = tokenNumber(input.usageMetadata?.candidatesTokenCount);
  const totalTokens = tokenNumber(input.usageMetadata?.totalTokenCount) || promptTokens + candidateTokens;
  if (!totalTokens) return;

  try {
    await db.execute(sql`
      INSERT INTO ai_token_usage (provider, model, operation, call_id, prompt_tokens, candidate_tokens, total_tokens)
      VALUES (
        'gemini',
        ${input.model},
        ${input.operation},
        ${input.callId || null},
        ${promptTokens},
        ${candidateTokens},
        ${totalTokens}
      )
    `);
  } catch (error) {
    console.warn('Failed to record AI token usage', error);
  }
}

export async function recordLiveEstimatedUsage(input: { callId?: number | null; durationSeconds: number }) {
  const usage = liveEstimatedTokenCounts(input.durationSeconds);
  if (!usage?.totalTokens) return;

  try {
    await db.execute(sql`
      INSERT INTO ai_token_usage (provider, model, operation, call_id, prompt_tokens, candidate_tokens, total_tokens)
      VALUES (
        'gemini',
        ${liveModel},
        ${liveOperation},
        ${input.callId || null},
        ${usage.promptTokens},
        ${usage.candidateTokens},
        ${usage.totalTokens}
      )
    `);
  } catch (error) {
    console.warn('Failed to record live AI usage estimate', error);
  }
}

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const maybeRows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(maybeRows) ? maybeRows : [];
}

function periodSql(period: string) {
  if (period === 'month') return sql`date_trunc('month', now())`;
  if (period === 'week') return sql`date_trunc('week', now())`;
  return sql`date_trunc('day', now())`;
}

export const aiUsageRouter = Router();

aiUsageRouter.get('/', async (req, res) => {
  const period = String(req.query.period || 'today');
  res.json(await usageSince(periodSql(period), period));
});

// Remaining Gemini balance. Google exposes no balance API for Gemini keys, so the admin
// enters the balance shown in Google AI Studio / Cloud Billing (GEMINI_BALANCE_USD in
// Integrations); the moment it is saved is the starting point, and the estimated spend
// since then (the same estimate as the usage page) is taken off it.
aiUsageRouter.get('/balance', async (_req, res) => {
  try {
    const [row] = rowsFrom(await db.execute(sql`SELECT value, updated_at FROM app_settings WHERE key = 'GEMINI_BALANCE_USD'`));
    const raw = String(row?.value ?? process.env.GEMINI_BALANCE_USD ?? '').replace(',', '.').trim();
    const starting = Number(raw);
    const today = await usageSince(sql`date_trunc('day', now() AT TIME ZONE 'Asia/Baku') AT TIME ZONE 'Asia/Baku'`, 'today');
    const lastHour = await usageSince(sql`now() - interval '1 hour'`, 'hour');
    if (!raw || !Number.isFinite(starting)) {
      res.json({ configured: false, credit: geminiCreditStatus(), todaySpentUsd: today.estimatedCostUsd, lastHourSpentUsd: lastHour.estimatedCostUsd, checkedAt: new Date().toISOString() });
      return;
    }
    const setAt = row?.updated_at ? new Date(row.updated_at as string).toISOString() : null;
    const spent = setAt ? (await usageSince(sql`${setAt}::timestamptz`, 'since')).estimatedCostUsd : 0;
    const remaining = starting - spent;
    const perHour = lastHour.estimatedCostUsd;
    res.json({
      configured: true,
      credit: geminiCreditStatus(),
      startingBalanceUsd: starting,
      setAt,
      spentSinceSetUsd: spent,
      remainingUsd: remaining,
      todaySpentUsd: today.estimatedCostUsd,
      lastHourSpentUsd: perHour,
      hoursLeftAtCurrentRate: perHour > 0 ? Math.max(0, remaining) / perHour : null,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ai-usage/balance]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function usageSince(from: ReturnType<typeof sql>, period: string) {
  const rows = rowsFrom(await db.execute(sql`
    SELECT
      coalesce(sum(prompt_tokens), 0)::int AS "promptTokens",
      coalesce(sum(candidate_tokens), 0)::int AS "candidateTokens",
      coalesce(sum(total_tokens), 0)::int AS "totalTokens",
      count(*)::int AS "requests"
    FROM ai_token_usage
    WHERE created_at >= ${from}
  `));
  const byOperation = rowsFrom(await db.execute(sql`
    SELECT operation,
           coalesce(sum(total_tokens), 0)::int AS "totalTokens",
           coalesce(sum(prompt_tokens), 0)::int AS "promptTokens",
           coalesce(sum(candidate_tokens), 0)::int AS "candidateTokens",
           count(*)::int AS "requests"
    FROM ai_token_usage
    WHERE created_at >= ${from}
    GROUP BY operation
    ORDER BY "totalTokens" DESC
  `));
  const byModel: UsageSummaryRow[] = rowsFrom(await db.execute(sql`
    SELECT model, operation,
           coalesce(sum(prompt_tokens), 0)::int AS "promptTokens",
           coalesce(sum(candidate_tokens), 0)::int AS "candidateTokens",
           coalesce(sum(total_tokens), 0)::int AS "totalTokens",
           count(*)::int AS "requests"
    FROM ai_token_usage
    WHERE created_at >= ${from}
    GROUP BY model, operation
    ORDER BY "totalTokens" DESC
  `)).map((row) => {
    const model = String(row.model || '');
    const operation = String(row.operation || '');
    const promptTokens = tokenNumber(row.promptTokens);
    const candidateTokens = tokenNumber(row.candidateTokens);
    const totalTokens = tokenNumber(row.totalTokens);
    const price = priceFor(model, operation);
    return {
      ...row,
      price,
      estimatedCostUsd: usageCostUsd(model, operation, promptTokens, candidateTokens, totalTokens),
    } as UsageSummaryRow;
  });
  const totals = rows[0] || {};
  const legacyLiveRows = rowsFrom(await db.execute(sql`
    SELECT coalesce(sum(duration_seconds), 0)::int AS "durationSeconds",
           count(*)::int AS "calls"
    FROM calls ca
    WHERE ca.started_at >= ${from}
      AND ca.ended_at IS NOT NULL
      AND coalesce(ca.duration_seconds, 0) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM ai_token_usage au
        WHERE au.call_id = ca.id
          AND au.operation = ${liveOperation}
      )
  `));
  const liveUsageRows = byModel.filter((row) => String(row.operation || '') === liveOperation);
  const persistedLiveTokens = liveUsageRows.reduce((sum, row) => sum + tokenNumber(row.totalTokens), 0);
  const persistedLiveRequests = liveUsageRows.reduce((sum, row) => sum + tokenNumber(row.requests), 0);
  const persistedLiveEstimatedCostUsd = liveUsageRows.reduce((sum, row) => sum + Number(row.estimatedCostUsd || 0), 0);
  const legacyLiveDurationSeconds = tokenNumber(legacyLiveRows[0]?.durationSeconds);
  const legacyLiveUsage = liveEstimatedTokenCounts(legacyLiveDurationSeconds);
  const legacyLiveEstimatedCostUsd = (legacyLiveDurationSeconds / 60) * liveAudioTotalUsdPerMinute;
  const liveEstimatedCostUsd = persistedLiveEstimatedCostUsd + legacyLiveEstimatedCostUsd;
  const liveDurationSeconds = Math.round((persistedLiveEstimatedCostUsd / liveAudioTotalUsdPerMinute) * 60) + legacyLiveDurationSeconds;
  const liveMinutes = liveDurationSeconds / 60;
  const dailyLimit = tokenNumber(process.env.AI_DAILY_TOKEN_LIMIT);
  const storedTotalTokens = tokenNumber(totals.totalTokens);
  const totalTokens = storedTotalTokens + (legacyLiveUsage?.totalTokens || 0);
  const postCallTotalTokens = Math.max(0, storedTotalTokens - persistedLiveTokens);
  const postCallEstimatedCostUsd = byModel
    .filter((row) => String(row.operation || '') !== liveOperation)
    .reduce((sum, row) => sum + Number(row.estimatedCostUsd || 0), 0);
  const estimatedCostUsd = postCallEstimatedCostUsd + liveEstimatedCostUsd;
  const effectiveUsdPerToken = postCallTotalTokens ? postCallEstimatedCostUsd / postCallTotalTokens : null;
  return {
    provider: 'gemini',
    period: period === 'month' || period === 'week' ? period : 'today',
    promptTokens: tokenNumber(totals.promptTokens) + (legacyLiveUsage?.promptTokens || 0),
    candidateTokens: tokenNumber(totals.candidateTokens) + (legacyLiveUsage?.candidateTokens || 0),
    totalTokens,
    requests: tokenNumber(totals.requests) + tokenNumber(legacyLiveRows[0]?.calls),
    estimatedCostUsd,
    postCallEstimatedCostUsd,
    effectiveUsdPerToken,
    live: {
      model: liveModel,
      calls: persistedLiveRequests + tokenNumber(legacyLiveRows[0]?.calls),
      durationSeconds: liveDurationSeconds,
      minutes: liveMinutes,
      audioInputUsdPerMinute: liveAudioInputUsdPerMinute,
      audioOutputUsdPerMinute: liveAudioOutputUsdPerMinute,
      totalUsdPerMinute: liveAudioTotalUsdPerMinute,
      estimatedCostUsd: liveEstimatedCostUsd,
      operation: liveOperation,
    },
    dailyLimit: dailyLimit || null,
    remainingTokens: dailyLimit ? Math.max(0, dailyLimit - totalTokens) : null,
    byOperation,
    byModel,
    note: dailyLimit ? '' : 'AI_DAILY_TOKEN_LIMIT is not configured; remaining tokens are unavailable.',
    liveUsageNote: 'Gemini Live API does not expose exact token usage here; live audio is persisted as a duration-based billing estimate.',
  };
}
