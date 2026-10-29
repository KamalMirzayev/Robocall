import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { telephonyJobs } from './db/schema.js';
import { customerRefreshTick } from './customer-refresh-scheduler.js';
import { updateCampaignStatistics } from './routes/telephony.js';
function rowsFrom(result) {
    if (Array.isArray(result))
        return result;
    const maybeRows = result.rows;
    return Array.isArray(maybeRows) ? maybeRows : [];
}
/**
 * Check if current time is within the campaign's run window (in Baku timezone).
 * runWindowStart and runWindowEnd are in HH:MM format (e.g., "09:00", "19:00")
 */
function isWithinRunWindow(runWindowStart, runWindowEnd) {
    // Get current time in Baku timezone using Intl API
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Baku',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parts.find((p) => p.type === 'hour')?.value || '00';
    const minute = parts.find((p) => p.type === 'minute')?.value || '00';
    const currentTime = `${hour}:${minute}`;
    return currentTime >= runWindowStart && currentTime < runWindowEnd;
}
/**
 * Check if today is a valid run day based on runWeekdays.
 * runWeekdays is a comma-separated string like "mon,tue,wed,thu,fri" (matches
 * the CampaignWeekday keys the campaign form stores).
 */
function isValidRunDay(runWeekdays) {
    if (!runWeekdays || runWeekdays.trim() === '') {
        // Empty = all days enabled
        return true;
    }
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Baku',
        weekday: 'long',
    });
    const dayName = formatter.format(now);
    const dayMap = {
        'Monday': 'mon',
        'Tuesday': 'tue',
        'Wednesday': 'wed',
        'Thursday': 'thu',
        'Friday': 'fri',
        'Saturday': 'sat',
        'Sunday': 'sun',
    };
    const todayKey = dayMap[dayName];
    const enabledDays = runWeekdays.split(',').map((d) => d.trim().toLowerCase());
    return enabledDays.includes(todayKey);
}
/**
 * postgres.js returns `date` columns from raw db.execute() as JS Date
 * objects (not strings, unlike drizzle's query builder), so normalize to
 * a "YYYY-MM-DD" key before comparing.
 */
function toDateKey(value) {
    if (!value)
        return null;
    if (value instanceof Date)
        return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}
/**
 * Check if today falls within the campaign's optional calendar date range
 * (in Baku timezone). NULL on either bound = unrestricted on that side.
 */
function isWithinDateRange(runStartDate, runEndDate) {
    const start = toDateKey(runStartDate);
    const end = toDateKey(runEndDate);
    if (!start && !end)
        return true;
    const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku' }).format(new Date());
    if (start && todayKey < start)
        return false;
    if (end && todayKey > end)
        return false;
    return true;
}
/**
 * Check if enough time has passed since the last attempt based on retryIntervalHours.
 */
function shouldRetry(createdAt, attemptNumber, retryIntervalHours) {
    if (attemptNumber === 0) {
        // First attempt, always allowed
        return true;
    }
    const createdTime = new Date(createdAt).getTime();
    const now = new Date().getTime();
    const hoursElapsed = (now - createdTime) / (1000 * 60 * 60);
    return hoursElapsed >= retryIntervalHours;
}
/**
 * Normalize phone number (remove non-digits).
 */
function normalizePhone(phone) {
    if (!phone)
        return null;
    const normalized = String(phone).replace(/\D/g, '');
    return normalized.length >= 10 ? normalized : null;
}
/**
 * Fail telephony jobs that were left behind by a backend crash or a lost
 * worker callback. Without this, a job stuck in 'answered' would block its
 * trunk forever (the scheduler treats such trunks as busy with no time limit).
 */
async function reapStaleJobs() {
    try {
        const reaped = rowsFrom(await db.execute(sql `
      UPDATE telephony_jobs
      SET status = 'failed',
          completed_at = now(),
          updated_at = now(),
          duration_seconds = 0,
          last_error = coalesce(nullif(last_error, ''), 'stale job reaped by campaign scheduler')
      WHERE completed_at IS NULL
        AND (
          (status IN ('pending', 'claimed', 'dialing') AND updated_at < now() - interval '15 minutes')
          OR (status = 'answered' AND updated_at < now() - interval '60 minutes')
        )
      RETURNING id, customer_id AS "customerId", campaign_id AS "campaignId"
    `));
        if (reaped.length > 0) {
            console.log(`[Campaign Scheduler] Reaped ${reaped.length} stale telephony jobs`);
            // A reaped job never goes through handleJobCompletion (routes/telephony.ts), so its
            // campaign_calls row would otherwise stay stuck in 'attempting' forever — invisible to
            // both the scheduler's pending-calls query and campaign completion stats.
            const affectedCampaigns = new Set();
            for (const job of reaped) {
                const campaignId = job.campaignId;
                const customerId = job.customerId;
                if (!campaignId || !customerId)
                    continue;
                const flipped = rowsFrom(await db.execute(sql `
          UPDATE campaign_calls
          SET status = 'failed', updated_at = now()
          WHERE campaign_id = ${campaignId}
            AND customer_id = ${customerId}
            AND status = 'attempting'
          RETURNING id
        `));
                if (flipped.length > 0)
                    affectedCampaigns.add(campaignId);
            }
            for (const campaignId of affectedCampaigns) {
                await updateCampaignStatistics(campaignId);
            }
        }
    }
    catch (err) {
        console.error('[Campaign Scheduler] Stale job reap failed', err);
    }
}
/**
 * Main scheduler loop: check active campaigns and create telephony jobs.
 */
export async function campaignSchedulerTick() {
    try {
        console.log(`[Campaign Scheduler] Tick at ${new Date().toISOString()}`);
        await reapStaleJobs();
        // Fetch all active campaigns
        const campaignRows = rowsFrom(await db.execute(sql `
      SELECT id, name, status, agent_id as "agentId", max_attempts as "maxAttempts",
             retry_interval_hours as "retryIntervalHours",
             run_window_start as "runWindowStart", run_window_end as "runWindowEnd",
             run_weekdays as "runWeekdays", skip_next_day_after_success as "skipNextDayAfterSuccess",
             trunk_id as "trunkId", trunk_ids as "trunkIds",
             run_start_date as "runStartDate", run_end_date as "runEndDate"
      FROM campaigns
      WHERE status = 'active'
    `));
        console.log(`[Campaign Scheduler] Found ${campaignRows.length} active campaigns`);
        for (const campaign of campaignRows) {
            console.log(`[Campaign Scheduler] Campaign ${campaign.id}: checking...`, {
                name: campaign.name,
                runWindowStart: campaign.runWindowStart,
                runWindowEnd: campaign.runWindowEnd,
                runWeekdays: campaign.runWeekdays,
            });
            // Check if campaign is within its run window
            if (!isWithinRunWindow(campaign.runWindowStart, campaign.runWindowEnd)) {
                console.log(`[Campaign Scheduler] Campaign ${campaign.id} outside run window`);
                continue;
            }
            // Check if today is a valid run day
            if (!isValidRunDay(campaign.runWeekdays)) {
                console.log(`[Campaign Scheduler] Campaign ${campaign.id} not scheduled for today`);
                continue;
            }
            // Check if today falls within the campaign's optional calendar date range
            if (!isWithinDateRange(campaign.runStartDate, campaign.runEndDate)) {
                console.log(`[Campaign Scheduler] Campaign ${campaign.id} outside its run date range`);
                continue;
            }
            console.log(`[Campaign Scheduler] Processing campaign ${campaign.id}: ${campaign.name}`);
            // Resolve trunk IDs: use trunk_ids if set, fall back to single trunk_id,
            // empty array = auto (no pinned trunk, handled by originateAiCall)
            const assignedTrunks = campaign.trunkIds
                ? campaign.trunkIds.split(',').map((t) => t.trim()).filter(Boolean)
                : campaign.trunkId
                    ? [campaign.trunkId]
                    : [];
            // Fetch pending campaign calls that haven't reached max attempts
            const callRows = rowsFrom(await db.execute(sql `
        SELECT id, campaign_id as "campaignId", customer_id as "customerId", status,
               attempt_number as "attemptNumber", created_at as "createdAt"
        FROM campaign_calls
        WHERE campaign_id = ${campaign.id}
          AND status IN ('pending', 'retrying')
          AND attempt_number < ${campaign.maxAttempts}
        ORDER BY created_at ASC
        LIMIT 50
      `));
            console.log(`[Campaign Scheduler] Found ${callRows.length} pending calls for campaign ${campaign.id}`);
            if (callRows.length === 0)
                continue;
            // Multi-trunk mode: create one job per available trunk per tick
            if (assignedTrunks.length > 0) {
                // Get trunks currently busy (have active telephony jobs)
                const busyTrunkRows = rowsFrom(await db.execute(sql `
          SELECT DISTINCT trunk_id FROM telephony_jobs
          WHERE trunk_id IS NOT NULL
            AND status IN ('pending', 'answered')
        `));
                const busyTrunks = new Set(busyTrunkRows.map((r) => String(r.trunk_id)));
                let jobCount = 0;
                for (const trunkId of assignedTrunks) {
                    if (busyTrunks.has(trunkId)) {
                        console.log(`[Campaign Scheduler] Trunk ${trunkId} busy, skipping`);
                        continue;
                    }
                    // Find next eligible call for this trunk
                    let callPlaced = false;
                    for (const call of callRows) {
                        if (!shouldRetry(call.createdAt, call.attemptNumber, campaign.retryIntervalHours))
                            continue;
                        // Check this specific customer doesn't already have an active job
                        const customerBusy = rowsFrom(await db.execute(sql `
              SELECT 1 FROM telephony_jobs
              WHERE customer_id = ${call.customerId}
                AND status IN ('pending', 'answered')
              LIMIT 1
            `));
                        if (customerBusy.length > 0)
                            continue;
                        const customerRows = rowsFrom(await db.execute(sql `
              SELECT id, phone, name FROM customers WHERE id = ${call.customerId} LIMIT 1
            `));
                        const customer = customerRows[0];
                        if (!customer)
                            continue;
                        const phone = normalizePhone(customer.phone);
                        if (!phone) {
                            await db.execute(sql `
                UPDATE campaign_calls SET status = 'failed' WHERE id = ${call.id}
              `);
                            continue;
                        }
                        try {
                            const [job] = await db
                                .insert(telephonyJobs)
                                .values({
                                agentId: campaign.agentId,
                                customerId: call.customerId,
                                phone,
                                outboundChannel: 'provider',
                                trunkId,
                                status: 'pending',
                                source: 'campaign',
                                campaignId: campaign.id,
                            })
                                .returning();
                            await db.execute(sql `
                UPDATE campaign_calls
                SET status = 'attempting', attempt_number = attempt_number + 1, updated_at = now()
                WHERE id = ${call.id}
              `);
                            console.log(`[Campaign Scheduler] Created job ${job.id} for customer ${call.customerId} ` +
                                `(campaign ${campaign.id}, trunk ${trunkId}, attempt ${call.attemptNumber + 1})`);
                            jobCount++;
                            callPlaced = true;
                        }
                        catch (err) {
                            console.error(`[Campaign Scheduler] Error creating job for call ${call.id}:`, err);
                        }
                        break; // one call per trunk
                    }
                    if (!callPlaced) {
                        console.log(`[Campaign Scheduler] No eligible calls for trunk ${trunkId}`);
                    }
                }
                console.log(`[Campaign Scheduler] Campaign ${campaign.id}: created ${jobCount} jobs across ${assignedTrunks.length} trunks`);
            }
            else {
                // Single-trunk / auto mode: existing behavior (one call at a time)
                // Still check for active jobs at the campaign level
                const activeJobRows = rowsFrom(await db.execute(sql `
          SELECT id FROM telephony_jobs
          WHERE customer_id IN (
            SELECT customer_id FROM campaign_calls WHERE campaign_id = ${campaign.id}
          )
          AND status IN ('pending', 'answered')
          LIMIT 1
        `));
                if (activeJobRows.length > 0) {
                    console.log(`[Campaign Scheduler] Campaign ${campaign.id} has active calls in progress, skipping`);
                    continue;
                }
                for (const call of callRows) {
                    if (!shouldRetry(call.createdAt, call.attemptNumber, campaign.retryIntervalHours))
                        continue;
                    const customerRows = rowsFrom(await db.execute(sql `
            SELECT id, phone, name FROM customers WHERE id = ${call.customerId} LIMIT 1
          `));
                    const customer = customerRows[0];
                    if (!customer)
                        continue;
                    const phone = normalizePhone(customer.phone);
                    if (!phone) {
                        await db.execute(sql `
              UPDATE campaign_calls SET status = 'failed' WHERE id = ${call.id}
            `);
                        continue;
                    }
                    try {
                        const [job] = await db
                            .insert(telephonyJobs)
                            .values({
                            agentId: campaign.agentId,
                            customerId: call.customerId,
                            phone,
                            outboundChannel: 'provider',
                            trunkId: campaign.trunkId || null,
                            status: 'pending',
                            source: 'campaign',
                            campaignId: campaign.id,
                        })
                            .returning();
                        await db.execute(sql `
              UPDATE campaign_calls
              SET status = 'attempting', attempt_number = attempt_number + 1, updated_at = now()
              WHERE id = ${call.id}
            `);
                        console.log(`[Campaign Scheduler] Created job ${job.id} for customer ${call.customerId} ` +
                            `(campaign ${campaign.id}, attempt ${call.attemptNumber + 1})`);
                        break; // one call per tick in auto mode
                    }
                    catch (err) {
                        console.error(`[Campaign Scheduler] Error creating job for call ${call.id}:`, err);
                    }
                }
            }
        }
        console.log(`[Campaign Scheduler] Tick complete`);
    }
    catch (err) {
        console.error('[Campaign Scheduler] Error:', err);
    }
}
/**
 * Start the campaign scheduler with configurable interval.
 */
export function startCampaignScheduler() {
    const schedulerEnabled = process.env.CAMPAIGN_SCHEDULER_ENABLED !== 'false';
    const intervalMs = Number(process.env.CAMPAIGN_SCHEDULER_INTERVAL_MS || 60000); // 1 minute default
    if (!schedulerEnabled) {
        console.log('[Campaign Scheduler] Disabled via CAMPAIGN_SCHEDULER_ENABLED=false');
        return;
    }
    console.log(`[Campaign Scheduler] Starting with interval ${intervalMs}ms`);
    // Run immediately on start
    campaignSchedulerTick();
    customerRefreshTick();
    // Then run periodically
    setInterval(() => {
        campaignSchedulerTick();
        customerRefreshTick();
    }, intervalMs);
}
