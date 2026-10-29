import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';
import {
  runPksImportPipeline,
  type PksImportJobRequest,
  type PksImportJobProgress,
  type PksImportJobResult,
} from './routes/campaigns.js';

/**
 * Background worker that processes queued PKS import jobs (fire-and-poll).
 *
 * One tick runs every POLL_MS (default 3 s). A module-level `processing` flag
 * prevents overlapping ticks. Jobs are claimed with FOR UPDATE SKIP LOCKED so
 * even if the process were duplicated, only one instance picks up a given row.
 *
 * Crash recovery: jobs left `running` for longer than STALE_RUNNING_MS (default
 * 30 min) are marked `failed` with an "interrupted" error. Queued jobs older than
 * 24 h are failed. Completed/failed jobs older than RETENTION_DAYS (default 30)
 * are deleted.
 */

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const maybeRows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(maybeRows) ? maybeRows : [];
}

const POLL_MS = Number(process.env.PKS_IMPORT_JOB_POLL_MS || 3000);
const STALE_RUNNING_MS = Number(process.env.PKS_IMPORT_JOB_STALE_MS || 30 * 60 * 1000);
const ORPHANED_QUEUED_HOURS = Number(process.env.PKS_IMPORT_JOB_ORPHANED_QUEUED_HOURS || 24);
const RETENTION_DAYS = Number(process.env.PKS_IMPORT_JOB_RETENTION_DAYS || 30);

let processing = false;

async function persistProgress(jobId: number, p: Partial<PksImportJobProgress>) {
  const sets: string[] = [];
  if (p.pagesFetched !== undefined) sets.push(`pages_fetched = ${p.pagesFetched}`);
  if (p.rowsFetched !== undefined) sets.push(`rows_fetched = ${p.rowsFetched}`);
  if (p.customersUpdated !== undefined) sets.push(`customers_updated = ${p.customersUpdated}`);
  if (p.customersCreated !== undefined) sets.push(`customers_created = ${p.customersCreated}`);
  if (p.attachedRows !== undefined) sets.push(`attached_rows = ${p.attachedRows}`);
  if (sets.length === 0) return;
  await db.execute(sql`UPDATE pks_import_jobs SET ${
    sql.raw(sets.join(', '))
  }, updated_at = now() WHERE id = ${jobId}`);
}

async function processJobs() {
  // 1. Reclaim stale running jobs (crash recovery)
  await db.execute(sql`
    UPDATE pks_import_jobs
    SET status = 'failed', completed_at = now(), updated_at = now(),
        last_error = coalesce(nullif(last_error, ''), 'import interrupted by server restart')
    WHERE status = 'running'
      AND started_at IS NOT NULL
      AND started_at < now() - (${STALE_RUNNING_MS} * interval '1 ms')
  `);

  // 2. Fail orphaned queued jobs
  await db.execute(sql`
    UPDATE pks_import_jobs
    SET status = 'failed', completed_at = now(), updated_at = now(),
        last_error = coalesce(nullif(last_error, ''), 'import job was never picked up (orphaned)')
    WHERE status = 'queued'
      AND created_at < now() - (${ORPHANED_QUEUED_HOURS} || ' hours')::interval
  `);

  // 3. Retention sweep
  await db.execute(sql`
    DELETE FROM pks_import_jobs
    WHERE completed_at IS NOT NULL
      AND completed_at < now() - (${RETENTION_DAYS} || ' days')::interval
  `);

  // 4. Claim next queued job (FOR UPDATE SKIP LOCKED prevents double-claim)
  const claimed = rowsFrom(await db.execute(sql`
    UPDATE pks_import_jobs
    SET status = 'running', started_at = now(), updated_at = now()
    WHERE id = (
      SELECT id FROM pks_import_jobs
      WHERE status = 'queued'
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, campaign_id, request, total_pages
  `));

  if (!claimed[0]) return; // no jobs to process

  const jobRow = claimed[0];
  const jobId = Number(jobRow.id);
  const campaignId = Number(jobRow.campaign_id);

  let request: PksImportJobRequest;
  try {
    request = typeof jobRow.request === 'string'
      ? JSON.parse(jobRow.request as string)
      : (jobRow.request as unknown as PksImportJobRequest);
  } catch {
    await db.execute(sql`
      UPDATE pks_import_jobs
      SET status = 'failed', completed_at = now(), last_error = 'corrupt request payload'
      WHERE id = ${jobId}
    `);
    return;
  }

  console.log(`[PKS Import Job ${jobId}] Starting import for campaign ${campaignId}`);

  const progress: PksImportJobProgress = {
    pagesFetched: 0, rowsFetched: 0,
    customersUpdated: 0, customersCreated: 0, attachedRows: 0,
  };

  const onProgress = (p: Partial<PksImportJobProgress>) => {
    Object.assign(progress, p);
    persistProgress(jobId, p).catch(() => { /* best-effort */ });
  };

  try {
    const result: PksImportJobResult = await runPksImportPipeline(campaignId, request, onProgress);

    await db.execute(sql`
      UPDATE pks_import_jobs
      SET status = 'completed',
          result = ${JSON.stringify(result)}::jsonb,
          pages_fetched = ${progress.pagesFetched},
          rows_fetched = ${progress.rowsFetched},
          customers_created = ${progress.customersCreated},
          customers_updated = ${progress.customersUpdated},
          attached_rows = ${progress.attachedRows},
          completed_at = now(),
          updated_at = now()
      WHERE id = ${jobId}
    `);

    console.log(
      `[PKS Import Job ${jobId}] Completed: ${result.importedRows} imported, ` +
      `${result.createdCustomers} created, ${result.updatedCustomers} updated, ` +
      `${result.attachedRows} attached, ${result.pagesProcessed} pages`
    );
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err).slice(0, 2000);
    console.error(`[PKS Import Job ${jobId}] Failed:`, message);

    await db.execute(sql`
      UPDATE pks_import_jobs
      SET status = 'failed',
          last_error = ${message},
          pages_fetched = ${progress.pagesFetched},
          rows_fetched = ${progress.rowsFetched},
          customers_created = ${progress.customersCreated},
          customers_updated = ${progress.customersUpdated},
          attached_rows = ${progress.attachedRows},
          completed_at = now(),
          updated_at = now()
      WHERE id = ${jobId}
    `);
  }
}

export function startPksImportJobProcessor() {
  const enabled = process.env.PKS_IMPORT_JOB_PROCESSOR_ENABLED !== 'false';
  if (!enabled) {
    console.log('[PKS Import Jobs] Disabled via PKS_IMPORT_JOB_PROCESSOR_ENABLED=false');
    return;
  }

  const tick = async () => {
    if (processing) return;
    processing = true;
    try {
      await processJobs();
    } catch (err) {
      console.error('[PKS Import Jobs] Tick error:', err);
    } finally {
      processing = false;
    }
  };

  // Run immediately on start to pick up any jobs queued before last restart
  tick();
  setInterval(tick, POLL_MS);
  console.log(`[PKS Import Jobs] Processor started (poll ${POLL_MS} ms)`);
}
