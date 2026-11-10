import { sql } from 'drizzle-orm';
import { db } from './db/index.js';

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const maybeRows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(maybeRows) ? maybeRows : [];
}

// Call analytics, counted from telephony_jobs (one row per dial attempt) over the last
// `days` days in Baku time, optionally for one campaign. Used by the ArzoomCall dashboard
// (GET /api/calls/analytics) and by the snapshot pushed to ARZOOM (arzoom-analytics.ts).
export async function computeCallAnalytics(opts: { days: number; campaignId?: number | null; recentLimit?: number; arzoomOnly?: boolean }) {
  const days = Math.max(1, Math.min(90, Math.floor(opts.days)));
  const campaignId = opts.campaignId || null;
  const recentLimit = Math.max(0, Math.min(200, opts.recentLimit ?? 30));
  const arzoomOnly = Boolean(opts.arzoomOnly);
  const jobFilter = sql`${campaignId ? sql`AND tj.campaign_id = ${campaignId}` : sql``} ${arzoomOnly ? sql`AND EXISTS (SELECT 1 FROM customers ax WHERE ax.id = tj.customer_id AND ax.source_system = 'arzoom')` : sql``}`;
  const since = sql`date_trunc('day', now() AT TIME ZONE 'Asia/Baku') AT TIME ZONE 'Asia/Baku' - make_interval(days => ${days - 1}::int)`;

  const [kpi] = rowsFrom(await db.execute(sql`
    SELECT count(*)::int AS attempts,
           count(*) FILTER (WHERE tj.answered_at IS NOT NULL)::int AS answered,
           count(*) FILTER (WHERE tj.completed_at IS NOT NULL AND tj.answered_at IS NULL)::int AS unanswered,
           count(*) FILTER (WHERE tj.completed_at IS NULL)::int AS in_progress,
           count(DISTINCT tj.customer_id)::int AS customers,
           count(DISTINCT tj.customer_id) FILTER (WHERE tj.answered_at IS NOT NULL)::int AS reached_customers,
           coalesce(round(avg(tj.duration_seconds) FILTER (WHERE tj.answered_at IS NOT NULL AND tj.duration_seconds > 0)), 0)::int AS avg_duration,
           coalesce(sum(tj.duration_seconds) FILTER (WHERE tj.answered_at IS NOT NULL), 0)::int AS total_seconds
    FROM telephony_jobs tj
    WHERE tj.created_at >= ${since} ${jobFilter}
  `));

  const daily = rowsFrom(await db.execute(sql`
    SELECT to_char(d, 'YYYY-MM-DD') AS day,
           count(tj.id)::int AS attempts,
           count(tj.id) FILTER (WHERE tj.answered_at IS NOT NULL)::int AS answered
    FROM generate_series((now() AT TIME ZONE 'Asia/Baku')::date - ${days - 1}::int, (now() AT TIME ZONE 'Asia/Baku')::date, interval '1 day') d
    LEFT JOIN telephony_jobs tj ON (tj.created_at AT TIME ZONE 'Asia/Baku')::date = d::date ${jobFilter}
    GROUP BY d ORDER BY d
  `));

  const hourly = rowsFrom(await db.execute(sql`
    SELECT extract(hour FROM tj.created_at AT TIME ZONE 'Asia/Baku')::int AS hour,
           count(*)::int AS attempts,
           count(*) FILTER (WHERE tj.answered_at IS NOT NULL)::int AS answered
    FROM telephony_jobs tj
    WHERE tj.created_at >= ${since} ${jobFilter}
    GROUP BY 1 ORDER BY 1
  `));

  const outcomes = rowsFrom(await db.execute(sql`
    SELECT f.outcome, max(f.outcome_label) AS label, count(*)::int AS count
    FROM arzoom_feedback f
    LEFT JOIN telephony_jobs tj ON tj.id = f.telephony_job_id
    WHERE f.created_at >= ${since} ${campaignId ? sql`AND tj.campaign_id = ${campaignId}` : sql``}
    GROUP BY f.outcome ORDER BY 3 DESC
  `).catch(() => []));

  const failures = rowsFrom(await db.execute(sql`
    SELECT CASE
             WHEN tj.last_error ILIKE '%reason 3%' OR tj.last_error ILIKE '%no answer%' THEN 'no_answer'
             WHEN tj.last_error ILIKE '%reason 5%' OR tj.last_error ILIKE '%busy%' THEN 'busy'
             WHEN tj.last_error ILIKE '%reason 8%' OR tj.last_error ILIKE '%congest%' THEN 'congestion'
             WHEN tj.last_error ILIKE '%stale%' THEN 'stale'
             WHEN tj.last_error IS NULL OR tj.last_error = '' THEN 'unknown'
             ELSE 'other'
           END AS reason,
           count(*)::int AS count
    FROM telephony_jobs tj
    WHERE tj.created_at >= ${since} ${jobFilter}
      AND tj.completed_at IS NOT NULL AND tj.answered_at IS NULL
    GROUP BY 1 ORDER BY 2 DESC
  `));

  const queue = rowsFrom(await db.execute(sql`
    SELECT c.id, c.name, c.status AS campaign_status, c.max_attempts, c.retry_interval_hours,
           count(cc.id)::int AS total,
           count(cc.id) FILTER (WHERE cc.status = 'pending')::int AS pending,
           count(cc.id) FILTER (WHERE cc.status = 'attempting')::int AS attempting,
           count(cc.id) FILTER (WHERE cc.status = 'retrying')::int AS retrying,
           count(cc.id) FILTER (WHERE cc.status = 'completed')::int AS completed,
           count(cc.id) FILTER (WHERE cc.status = 'failed')::int AS failed,
           count(cc.id) FILTER (WHERE cc.status = 'cancelled')::int AS cancelled,
           min(cc.call_after) FILTER (WHERE cc.status IN ('pending', 'retrying') AND cc.call_after > now()) AS next_call_after
    FROM campaigns c
    LEFT JOIN campaign_calls cc ON cc.campaign_id = c.id
    WHERE ${campaignId ? sql`c.id = ${campaignId}` : sql`c.status IN ('active', 'paused')`} ${arzoomOnly ? sql`AND c.segment = 'application_status'` : sql``}
    GROUP BY c.id ORDER BY c.id DESC
  `));

  const transfers = rowsFrom(await db.execute(sql`
    SELECT st.extension, max(st.brand) AS brand,
           count(*) FILTER (WHERE st.status = 'answered')::int AS answered,
           count(*) FILTER (WHERE st.status <> 'answered')::int AS missed
    FROM sales_transfers st
    LEFT JOIN telephony_jobs tj ON tj.id = st.telephony_job_id
    WHERE st.created_at >= ${since} ${campaignId ? sql`AND tj.campaign_id = ${campaignId}` : sql``}
    GROUP BY st.extension ORDER BY 3 DESC, 1
  `).catch(() => []));

  const recent = rowsFrom(await db.execute(sql`
    SELECT tj.id, tj.created_at, tj.phone, tj.status, tj.answered_at IS NOT NULL AS answered,
           tj.duration_seconds, tj.last_error,
           trim(concat_ws(' ', cu.name, cu.surname)) AS customer_name, cu.application_status,
           cu.source_record_key AS application_id,
           f.outcome, f.outcome_label, f.reason, cl.summary
    FROM telephony_jobs tj
    LEFT JOIN customers cu ON cu.id = tj.customer_id
    LEFT JOIN LATERAL (
      SELECT summary FROM calls WHERE telephony_job_id = tj.id ORDER BY id DESC LIMIT 1
    ) cl ON true
    LEFT JOIN LATERAL (
      SELECT outcome, outcome_label, reason FROM arzoom_feedback WHERE telephony_job_id = tj.id ORDER BY id DESC LIMIT 1
    ) f ON true
    WHERE tj.created_at >= ${since} ${jobFilter}
    ORDER BY tj.id DESC
    LIMIT ${recentLimit}
  `));

  const campaigns = rowsFrom(await db.execute(sql`
    SELECT id, name, status FROM campaigns WHERE status <> 'cancelled' ${arzoomOnly ? sql`AND segment = 'application_status'` : sql``} ORDER BY id DESC LIMIT 50
  `));

  return { days, campaignId, generatedAt: new Date().toISOString(), kpi, daily, hourly, outcomes, failures, queue, transfers, recent, campaigns };
}
