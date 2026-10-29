import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';
import {
  fetchPksRowsForExecute,
  buildPksRowBatchMeta,
  dedupePksRowBatchMeta,
  batchResolveExistingCustomers,
  batchUpdateCustomers,
  campaignAttachmentStatusMap,
  type PksFilters,
  type PksFilterMode,
  type PksFilterGroup,
  type PksRowBatchMeta,
} from './routes/campaigns.js';

/**
 * Daily PKS customer-data refresh (see the "daily update customer data" campaign option).
 *
 * Once per day, at or after 08:30 Baku time, for every active campaign that was built from
 * a PKS import: replay the campaign's original PKS filters (stored at import time) and
 * - if the campaign has dailyCustomerRefresh enabled, refresh the PKS-sourced fields of
 *   customers still pending/retrying in this campaign (skipping any whose data is unchanged,
 *   via source_payload_hash — the real efficiency lever, since Postgres rewrites the whole
 *   row on UPDATE regardless of how many columns actually changed);
 * - either way, count how many fetched rows don't correspond to a customer already attached
 *   to this campaign ("new matches"), so the campaign page can show it without a live PKS
 *   call on every page view. Fetching this is the same PKS query either way, so it's free
 *   to do regardless of the refresh toggle.
 *
 * This never attaches new customers automatically — that's an explicit, user-triggered
 * action (POST /:id/pks/import-new-matches) so an in-flight campaign's roster never grows
 * silently overnight.
 */

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const maybeRows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(maybeRows) ? maybeRows : [];
}

function bakuDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku' }).format(date);
}

function bakuMinutesSinceMidnight(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Baku',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

const REFRESH_AT_MINUTES = 8 * 60 + 30; // 08:30 Baku time
const RETRY_THROTTLE_MS = Number(process.env.CUSTOMER_REFRESH_RETRY_THROTTLE_MS || 15 * 60 * 1000);
const PKS_PAGE_SIZE = 500;

type StoredPksFilters = {
  filters: PksFilters;
  filterMode: PksFilterMode;
  groupedFilters: PksFilterGroup[];
};

interface RefreshCampaignRow {
  id: number;
  daily_customer_refresh: boolean;
  pks_import_filters: StoredPksFilters | string;
  last_customer_refresh_attempt_at: string | null;
}

function parseStoredFilters(value: StoredPksFilters | string): StoredPksFilters {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return {
    filters: parsed?.filters || {},
    filterMode: parsed?.filterMode || 'and',
    groupedFilters: Array.isArray(parsed?.groupedFilters) ? parsed.groupedFilters : [],
  };
}

async function currentPayloadHashes(customerIds: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (customerIds.length === 0) return result;
  const rows = rowsFrom(await db.execute(sql`
    SELECT id, source_payload_hash
    FROM customers
    WHERE id IN (
      SELECT value::int FROM jsonb_array_elements(${JSON.stringify(customerIds)}::jsonb)
    )
  `));
  for (const r of rows) result.set(Number(r.id), String(r.source_payload_hash ?? ''));
  return result;
}

async function refreshCampaign(row: RefreshCampaignRow, todayBaku: string): Promise<void> {
  const campaignId = row.id;
  await db.execute(sql`UPDATE campaigns SET last_customer_refresh_attempt_at = now() WHERE id = ${campaignId}`);

  try {
    const { filters, filterMode, groupedFilters } = parseStoredFilters(row.pks_import_filters);
    const fetched = await fetchPksRowsForExecute(filters, filterMode, groupedFilters, PKS_PAGE_SIZE, Number.MAX_SAFE_INTEGER);
    const allMeta = dedupePksRowBatchMeta(buildPksRowBatchMeta(fetched.rows));
    const existingMap = await batchResolveExistingCustomers(allMeta);

    const existingIds = [...new Set(existingMap.values())];
    const attachment = await campaignAttachmentStatusMap(campaignId, existingIds);

    let refreshedCount = 0;
    if (row.daily_customer_refresh) {
      const updatesByCustomer = new Map<number, PksRowBatchMeta>();
      for (const m of allMeta) {
        const existingId = existingMap.get(m.idx);
        if (existingId === undefined) continue;
        const status = attachment.get(existingId);
        if (status !== 'pending' && status !== 'retrying') continue;
        const prev = updatesByCustomer.get(existingId);
        if (!prev || m.idx > prev.idx) updatesByCustomer.set(existingId, m);
      }

      const currentHashes = await currentPayloadHashes([...updatesByCustomer.keys()]);
      const changedEntries = [...updatesByCustomer.entries()].filter(
        ([customerId, m]) => currentHashes.get(customerId) !== m.syncHash
      );

      await batchUpdateCustomers(changedEntries, new Date().toISOString());
      refreshedCount = changedEntries.length;
    }

    let newMatchesCount = 0;
    for (const m of allMeta) {
      const existingId = existingMap.get(m.idx);
      if (existingId === undefined || !attachment.has(existingId)) newMatchesCount += 1;
    }

    await db.execute(sql`
      UPDATE campaigns
      SET last_customer_refresh_date = ${todayBaku}::date,
          new_customer_matches_count = ${newMatchesCount},
          new_customer_matches_checked_at = now(),
          updated_at = now()
      WHERE id = ${campaignId}
    `);

    console.log(
      `[Customer Refresh] Campaign ${campaignId}: fetched ${fetched.rows.length} PKS rows, `
      + `refreshed ${refreshedCount} existing customers, ${newMatchesCount} new matches found`
    );
  } catch (err) {
    // last_customer_refresh_date stays unset for today, so the next (throttled) tick retries.
    console.error(`[Customer Refresh] Campaign ${campaignId}: failed`, err);
  }
}

export async function customerRefreshTick(): Promise<void> {
  try {
    const now = new Date();
    if (bakuMinutesSinceMidnight(now) < REFRESH_AT_MINUTES) return;

    const todayBaku = bakuDateString(now);
    const rows = rowsFrom(await db.execute(sql`
      SELECT id, daily_customer_refresh, pks_import_filters,
             last_customer_refresh_attempt_at
      FROM campaigns
      WHERE status = 'active'
        AND pks_import_filters IS NOT NULL
        AND (last_customer_refresh_date IS NULL OR last_customer_refresh_date <> ${todayBaku}::date)
    `)) as unknown as RefreshCampaignRow[];

    for (const row of rows) {
      if (row.last_customer_refresh_attempt_at) {
        const sinceLastAttempt = now.getTime() - new Date(row.last_customer_refresh_attempt_at).getTime();
        if (sinceLastAttempt < RETRY_THROTTLE_MS) continue;
      }
      await refreshCampaign(row, todayBaku);
    }
  } catch (err) {
    console.error('[Customer Refresh] Tick error:', err);
  }
}
