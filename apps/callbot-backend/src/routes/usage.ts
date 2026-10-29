import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { BILLING_CONFIG, type UsageResponse, type UsageSource, type DailyUsage, type TrunkUsage } from '../billing.js';
import { buildWorkbook, HEADER_STYLE, type XlsxCellInput } from '../xlsx.js';
import { resolveTrunkNames } from '../trunk-names.js';

const USAGE_SOURCES: UsageSource[] = ['campaign', 'manual', 'external_api'];

const SOURCE_LABELS: Record<UsageSource, string> = {
  campaign: 'Campaign calls',
  manual: 'Manual admin dial',
  external_api: 'External API',
};

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const maybeRows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(maybeRows) ? maybeRows : [];
}

function monthRange(month: string): { monthStart: Date; monthEnd: Date; monthLabel: string } {
  let monthStart: Date;
  let monthEnd: Date;
  if (/^\d{4}-\d{2}$/.test(month)) {
    const [year, mon] = month.split('-').map(Number);
    monthStart = new Date(Date.UTC(year, mon - 1, 1));
    monthEnd = new Date(Date.UTC(year, mon, 1));
  } else {
    const now = new Date();
    monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  }
  return { monthStart, monthEnd, monthLabel: monthStart.toISOString().slice(0, 7) };
}

// Shared by GET / (JSON, for the page) and GET /export.xlsx (workbook) so both always agree —
// see usage.ts's git history for the bug this replaced (a customer-id join that could
// misattribute or double-count campaign minutes).
async function computeUsage(month: string): Promise<UsageResponse> {
  const { monthStart, monthEnd, monthLabel } = monthRange(month);

  // Overall usage: answered calls only (duration_seconds > 0)
  const overallRows = rowsFrom(await db.execute(sql`
    SELECT
      count(*)::int as answered_calls,
      coalesce(sum(ceil(duration_seconds / 60.0)), 0)::float as total_minutes
    FROM calls
    WHERE duration_seconds > 0
      AND started_at >= ${monthStart.toISOString()}
      AND started_at < ${monthEnd.toISOString()}
  `));
  const overall = overallRows[0] || { answered_calls: 0, total_minutes: 0 };
  const totalMinutes = Number(overall.total_minutes) || 0;
  const totalUsageCostAzn = Math.round(totalMinutes * BILLING_CONFIG.usagePerMinuteAzn * 100) / 100;

  // Per-campaign breakdown via telephony_jobs.campaign_id — set directly at job-creation
  // time (see schema.ts), not inferred by joining back to campaign_calls on customer_id.
  // That join used to misattribute or double-count whenever a customer had calls from more
  // than one source (e.g. two campaigns, or a campaign plus a manual/external-API call).
  const campaignRows = rowsFrom(await db.execute(sql`
    SELECT
      c.id as campaign_id,
      c.name as campaign_name,
      count(*)::int as answered_calls,
      coalesce(sum(ceil(ca.duration_seconds / 60.0)), 0)::float as minutes
    FROM calls ca
    JOIN telephony_jobs tj ON tj.id = ca.telephony_job_id
    JOIN campaigns c ON c.id = tj.campaign_id
    WHERE ca.duration_seconds > 0
      AND ca.started_at >= ${monthStart.toISOString()}
      AND ca.started_at < ${monthEnd.toISOString()}
    GROUP BY c.id, c.name
    ORDER BY minutes DESC
  `));

  const byCampaign = campaignRows.map((row) => {
    const minutes = Number(row.minutes) || 0;
    return {
      campaignId: Number(row.campaign_id),
      campaignName: String(row.campaign_name || ''),
      answeredCalls: Number(row.answered_calls) || 0,
      minutes,
      usageCostAzn: Math.round(minutes * BILLING_CONFIG.usagePerMinuteAzn * 100) / 100,
    };
  });

  // Per-source breakdown (campaign / manual admin dial / external API) — telephony_jobs.source
  // is set directly at job-creation time, so this is a plain group-by with no joins at all.
  const sourceRows = rowsFrom(await db.execute(sql`
    SELECT
      tj.source as source,
      count(*)::int as answered_calls,
      coalesce(sum(ceil(ca.duration_seconds / 60.0)), 0)::float as minutes
    FROM calls ca
    JOIN telephony_jobs tj ON tj.id = ca.telephony_job_id
    WHERE ca.duration_seconds > 0
      AND ca.started_at >= ${monthStart.toISOString()}
      AND ca.started_at < ${monthEnd.toISOString()}
    GROUP BY tj.source
    ORDER BY minutes DESC
  `));

  const bySource = sourceRows.map((row) => {
    const minutes = Number(row.minutes) || 0;
    return {
      source: String(row.source || 'manual') as UsageSource,
      answeredCalls: Number(row.answered_calls) || 0,
      minutes,
      usageCostAzn: Math.round(minutes * BILLING_CONFIG.usagePerMinuteAzn * 100) / 100,
    };
  });

  // Per-trunk breakdown. trunk_id is a uuid from sip_trunks (a different database — see
  // billing.ts's TrunkUsage comment), so this only groups by the raw id; callers resolve
  // names separately (the page via the same trunks list /telephony fetches, the export via
  // trunk-names.ts).
  const trunkRows = rowsFrom(await db.execute(sql`
    SELECT
      tj.trunk_id as trunk_id,
      count(*)::int as answered_calls,
      coalesce(sum(ceil(ca.duration_seconds / 60.0)), 0)::float as minutes
    FROM calls ca
    JOIN telephony_jobs tj ON tj.id = ca.telephony_job_id
    WHERE ca.duration_seconds > 0
      AND ca.started_at >= ${monthStart.toISOString()}
      AND ca.started_at < ${monthEnd.toISOString()}
    GROUP BY tj.trunk_id
    ORDER BY minutes DESC
  `));

  const byTrunk: TrunkUsage[] = trunkRows.map((row) => {
    const minutes = Number(row.minutes) || 0;
    return {
      trunkId: row.trunk_id ? String(row.trunk_id) : null,
      answeredCalls: Number(row.answered_calls) || 0,
      minutes,
      usageCostAzn: Math.round(minutes * BILLING_CONFIG.usagePerMinuteAzn * 100) / 100,
    };
  });

  // Daily breakdown, segmented by source, for the bar chart. date_trunc is pinned to UTC to
  // match the UTC month boundaries computed above, rather than the DB session's timezone.
  const dailyRows = rowsFrom(await db.execute(sql`
    SELECT
      to_char(date_trunc('day', ca.started_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') as day,
      tj.source as source,
      coalesce(sum(ceil(ca.duration_seconds / 60.0)), 0)::float as minutes,
      count(*)::int as calls
    FROM calls ca
    JOIN telephony_jobs tj ON tj.id = ca.telephony_job_id
    WHERE ca.duration_seconds > 0
      AND ca.started_at >= ${monthStart.toISOString()}
      AND ca.started_at < ${monthEnd.toISOString()}
    GROUP BY day, source
  `));

  const dailyByDay = new Map<string, Partial<Record<UsageSource, { minutes: number; calls: number }>>>();
  for (const row of dailyRows) {
    const day = String(row.day);
    const source = String(row.source || 'manual') as UsageSource;
    if (!dailyByDay.has(day)) dailyByDay.set(day, {});
    dailyByDay.get(day)![source] = { minutes: Number(row.minutes) || 0, calls: Number(row.calls) || 0 };
  }

  // Zero-filled for every day in the month, not just days with calls, so the chart's x-axis
  // is a continuous calendar rather than skipping quiet days.
  const daily: DailyUsage[] = [];
  for (const cursor = new Date(monthStart); cursor < monthEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const dateLabel = cursor.toISOString().slice(0, 10);
    const dayEntry = dailyByDay.get(dateLabel) || {};
    const sources = {} as DailyUsage['sources'];
    let dayMinutes = 0;
    for (const source of USAGE_SOURCES) {
      const minutes = dayEntry[source]?.minutes || 0;
      dayMinutes += minutes;
      sources[source] = {
        minutes,
        calls: dayEntry[source]?.calls || 0,
        costAzn: Math.round(minutes * BILLING_CONFIG.usagePerMinuteAzn * 100) / 100,
      };
    }
    daily.push({
      date: dateLabel,
      sources,
      totalMinutes: dayMinutes,
      totalCostAzn: Math.round(dayMinutes * BILLING_CONFIG.usagePerMinuteAzn * 100) / 100,
    });
  }

  return {
    month: monthLabel,
    baseFeeAzn: BILLING_CONFIG.monthlyBaseFeeAzn,
    currency: BILLING_CONFIG.currency,
    usage: {
      totalAnsweredCalls: Number(overall.answered_calls) || 0,
      totalMinutes,
      totalUsageCostAzn,
      totalCostAzn: Math.round((BILLING_CONFIG.monthlyBaseFeeAzn + totalUsageCostAzn) * 100) / 100,
    },
    byCampaign,
    bySource,
    byTrunk,
    daily,
  };
}

export const usageRouter = Router();

// GET /api/usage?month=2026-08
usageRouter.get('/', async (req, res) => {
  try {
    const result = await computeUsage(String(req.query.month || '').trim());
    res.json(result);
  } catch (err) {
    console.error('[Usage] Error:', err);
    res.status(500).json({ error: 'failed to fetch usage data' });
  }
});

// GET /api/usage/export.xlsx?month=2026-08 — one workbook, one sheet per Group By dimension
// (plus a Summary and a Daily sheet), covering the same data shown on the Usage & Billing page.
usageRouter.get('/export.xlsx', async (req, res) => {
  try {
    const month = String(req.query.month || '').trim();
    const result = await computeUsage(month);
    const trunkNames = await resolveTrunkNames(result.byTrunk.map((t) => t.trunkId).filter((id): id is string => Boolean(id)));

    const header = (values: string[]): XlsxCellInput[] => values.map((value) => ({ value, style: HEADER_STYLE }));

    const summaryRows: XlsxCellInput[][] = [
      header(['Field', 'Value']),
      ['Month', result.month],
      ['Base Fee', `${result.baseFeeAzn} ${result.currency}`],
      ['Answered Calls', result.usage.totalAnsweredCalls],
      ['Billable Minutes', result.usage.totalMinutes],
      ['Usage Cost', `${result.usage.totalUsageCostAzn.toFixed(2)} ${result.currency}`],
      ['Total Cost', `${result.usage.totalCostAzn.toFixed(2)} ${result.currency}`],
    ];

    const campaignRows: XlsxCellInput[][] = [
      header(['Campaign', 'Calls', 'Minutes', `Cost (${result.currency})`]),
      ...result.byCampaign.map((c) => [c.campaignName, c.answeredCalls, c.minutes, c.usageCostAzn]),
    ];

    const sourceRows: XlsxCellInput[][] = [
      header(['Source', 'Calls', 'Minutes', `Cost (${result.currency})`]),
      ...result.bySource.map((s) => [SOURCE_LABELS[s.source] || s.source, s.answeredCalls, s.minutes, s.usageCostAzn]),
    ];

    const trunkRows: XlsxCellInput[][] = [
      header(['Trunk', 'Calls', 'Minutes', `Cost (${result.currency})`]),
      ...result.byTrunk.map((t) => [
        t.trunkId ? (trunkNames[t.trunkId] || t.trunkId) : 'Auto-selected (no trunk pinned)',
        t.answeredCalls,
        t.minutes,
        t.usageCostAzn,
      ]),
    ];

    const dailyRows: XlsxCellInput[][] = [
      header(['Date', ...USAGE_SOURCES.map((s) => `${SOURCE_LABELS[s]} (min)`), 'Total Minutes', `Total Cost (${result.currency})`]),
      ...result.daily.map((d) => [
        d.date,
        ...USAGE_SOURCES.map((s) => d.sources[s].minutes),
        d.totalMinutes,
        d.totalCostAzn,
      ]),
    ];

    const workbook = buildWorkbook([
      { name: 'Summary', rows: summaryRows, widths: [20, 30] },
      { name: 'By Campaign', rows: campaignRows, widths: [30, 10, 12, 14] },
      { name: 'By Source', rows: sourceRows, widths: [22, 10, 12, 14] },
      { name: 'By Trunk', rows: trunkRows, widths: [30, 10, 12, 14] },
      { name: 'Daily', rows: dailyRows, widths: [12, 16, 18, 16, 14, 16] },
    ]);

    const filename = `usage-${result.month}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(workbook.length));
    res.send(workbook);
  } catch (err) {
    console.error('[Usage export] Error:', err);
    res.status(500).json({ error: 'failed to export usage data' });
  }
});
