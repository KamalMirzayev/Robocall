import crypto from 'node:crypto';
import { Router } from 'express';
import { requireRole } from '../auth.js';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { validateFin } from '../pks-utils.js';
import { buildWorkbook, HEADER_STYLE } from '../xlsx.js';
function buildRouteError(err, fallback) {
    const pick = (value) => {
        if (!value || typeof value !== 'object')
            return null;
        return value;
    };
    const base = pick(err) || {};
    const cause1 = pick(base.cause) || {};
    const cause2 = pick(cause1.cause) || {};
    const resolved = [cause2, cause1, base].find((candidate) => candidate?.message) || base;
    return {
        error: resolved?.message || fallback,
        code: resolved?.code,
        detail: resolved?.detail,
        constraint: resolved?.constraint,
        table: resolved?.table,
        column: resolved?.column,
    };
}
function rowsFrom(result) {
    if (Array.isArray(result))
        return result;
    const maybeRows = result.rows;
    return Array.isArray(maybeRows) ? maybeRows : [];
}
function normalizeSinglePhone(value) {
    let digits = value.replace(/\D/g, '');
    if (!digits)
        return null;
    // Support numbers provided as 00994..., +994..., 994..., 0xx..., or xx... (9-digit local).
    if (digits.startsWith('00'))
        digits = digits.slice(2);
    if (digits.startsWith('9940') && digits.length === 13) {
        // Some inputs are provided as 9940XXXXXXXXX; remove the trunk 0.
        digits = `994${digits.slice(4)}`;
    }
    else if (digits.startsWith('0') && digits.length === 10) {
        digits = `994${digits.slice(1)}`;
    }
    else if (digits.length === 9) {
        digits = `994${digits}`;
    }
    if (!digits.startsWith('994') || digits.length !== 12)
        return null;
    return `+${digits}`;
}
function normalizePhone(value) {
    const raw = String(value ?? '').trim();
    if (!raw)
        return null;
    // Source data sometimes packs multiple numbers into one field, e.g.
    // "503634407, 559499511". Split on common delimiters and take the
    // first candidate that normalizes to a valid AZ mobile number.
    const candidates = raw.split(/[,;/|]+|\bor\b/i).map((c) => c.trim()).filter(Boolean);
    for (const candidate of candidates.length > 0 ? candidates : [raw]) {
        const normalized = normalizeSinglePhone(candidate);
        if (normalized)
            return normalized;
    }
    return null;
}
function cleanText(value) {
    const next = String(value ?? '').trim();
    return next ? next : null;
}
function cleanDecimal(value) {
    if (value == null || value === '')
        return null;
    const normalized = String(value).replace(',', '.').trim();
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed))
        return null;
    return parsed.toFixed(2);
}
function cleanInt(value) {
    if (value == null || value === '')
        return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed))
        return null;
    return parsed;
}
function decimalNumber(value) {
    const normalized = cleanDecimal(value);
    return normalized == null ? 0 : Number(normalized) || 0;
}
function parseBooleanInput(value) {
    if (value === undefined || value === null)
        return null;
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'number')
        return value !== 0;
    const text = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(text))
        return true;
    if (['false', '0', 'no', 'off'].includes(text))
        return false;
    return null;
}
function asBooleanCell(value) {
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'number')
        return value !== 0;
    return String(value ?? '').trim().toLowerCase() === 'true';
}
function splitName(fullName) {
    const prepared = cleanText(fullName) || 'Unknown Customer';
    const parts = prepared.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) {
        return {
            name: parts[0] || 'Unknown',
            surname: '-',
            fatherName: null,
        };
    }
    return {
        name: parts[0],
        surname: parts[1] || '-',
        fatherName: parts[2] || null,
    };
}
function parseFilters(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return {};
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
        const nextKey = String(key || '').trim();
        if (!nextKey)
            continue;
        out[nextKey] = String(value ?? '').trim();
    }
    return out;
}
function parseFilterMode(raw) {
    const value = String(raw ?? 'and').trim().toLowerCase();
    if (value === 'or')
        return 'or';
    if (value === 'grouped')
        return 'grouped';
    return 'and';
}
function parseFilterOperator(raw) {
    const op = String(raw ?? '=').trim();
    return ['=', '!=', '>', '<', '>=', '<='].includes(op) ? op : '=';
}
function parseGroupedFilters(raw) {
    if (!Array.isArray(raw))
        return [];
    const parsed = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object')
            continue;
        const row = item;
        const column = String(row.column ?? '').trim();
        if (!column)
            continue;
        const operator = parseFilterOperator(row.operator);
        const valuesRaw = Array.isArray(row.values) ? row.values : [];
        const values = valuesRaw
            .map((value) => String(value ?? '').trim())
            .filter(Boolean);
        if (values.length === 0)
            continue;
        parsed.push({ column, operator, values: Array.from(new Set(values)) });
    }
    return parsed;
}
function buildFilterEntry(column, operator, value) {
    if (operator === '=')
        return [column, value];
    return [`${column}${operator}${value}`, ''];
}
function cartesianFilterBuckets(groups) {
    if (groups.length === 0)
        return [{}];
    let buckets = [{}];
    for (const group of groups) {
        const next = [];
        for (const bucket of buckets) {
            for (const value of group.values) {
                const [key, payloadValue] = buildFilterEntry(group.column, group.operator, value);
                next.push({ ...bucket, [key]: payloadValue });
            }
        }
        buckets = next;
    }
    return buckets;
}
function buildFilterBuckets(filters, mode, groups) {
    const entries = Object.entries(filters);
    if (mode === 'grouped') {
        const groupedBuckets = cartesianFilterBuckets(groups);
        if (entries.length === 0)
            return groupedBuckets;
        return groupedBuckets.map((bucket) => ({ ...filters, ...bucket }));
    }
    if (entries.length === 0)
        return [{}];
    if (mode === 'and')
        return [filters];
    return entries.map(([key, value]) => ({ [key]: value }));
}
function dedupePksRows(rows) {
    const seen = new Set();
    const unique = [];
    for (const row of rows) {
        const key = payloadHash(row);
        if (seen.has(key))
            continue;
        seen.add(key);
        unique.push(row);
    }
    return unique;
}
function makeSourceRecordKey(row) {
    const fin = validateFin(row.fin);
    const contractNo = cleanText(row.muqavile_no);
    if (fin && contractNo)
        return `${fin}::${contractNo}`;
    if (contractNo)
        return `contract::${contractNo}`;
    const phone = normalizePhone(row.mobile_phone);
    if (phone)
        return `phone::${phone}`;
    return null;
}
export function payloadHash(row) {
    return crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
}
function requirePksConfig() {
    const url = process.env.PKS_DB_QUERY_URL;
    const apiKey = process.env.PKS_DB_QUERY_API_KEY;
    if (!url || !apiKey) {
        throw new Error('PKS integration is not configured. Set PKS_DB_QUERY_URL and PKS_DB_QUERY_API_KEY.');
    }
    return {
        url,
        apiKey,
        timeoutMs: Number(process.env.PKS_DB_QUERY_TIMEOUT_MS || 180000),
    };
}
// Cloudflare gateway/edge errors (520-530) plus generic upstream 502-504 — all transient,
// same class of failure operators currently work around by manually re-running the import.
const PKS_RETRYABLE_STATUS = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);
const PKS_RETRY_ATTEMPTS = Number(process.env.PKS_DB_QUERY_RETRY_ATTEMPTS || 4);
const PKS_RETRY_BASE_MS = Number(process.env.PKS_DB_QUERY_RETRY_BASE_MS || 2000);
class RetryablePksError extends Error {
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function queryPksOnce(filters, page, pageSize) {
    const cfg = requirePksConfig();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    try {
        let response;
        try {
            response = await fetch(cfg.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Internal-API-Key': cfg.apiKey,
                },
                body: JSON.stringify({ filters, page, page_size: pageSize }),
                signal: ctrl.signal,
            });
        }
        catch (err) {
            // Network failure or our own timeout abort — both transient, worth a retry.
            throw new RetryablePksError(err?.message || 'PKS request failed');
        }
        const text = await response.text();
        let payload = {};
        try {
            payload = text ? JSON.parse(text) : {};
        }
        catch {
            payload = { detail: text || 'unexpected response' };
        }
        if (!response.ok) {
            const detail = String(payload.detail ?? payload.error ?? `PKS query failed (${response.status})`);
            if (PKS_RETRYABLE_STATUS.has(response.status)) {
                throw new RetryablePksError(detail);
            }
            throw new Error(detail);
        }
        const data = Array.isArray(payload.data)
            ? payload.data
            : Array.isArray(payload.rows)
                ? payload.rows
                : [];
        const pagination = (payload.pagination || {});
        const totalRows = Number(pagination.total_rows
            ?? pagination.totalRows
            ?? payload.fetched_rows
            ?? data.length);
        const resolvedPageSize = Number(pagination.page_size
            ?? pagination.pageSize
            ?? pageSize);
        const resolvedTotalPages = Number(pagination.total_pages
            ?? pagination.totalPages
            ?? Math.max(1, Math.ceil(totalRows / Math.max(1, resolvedPageSize))));
        return {
            data,
            pagination: {
                page: Number(pagination.page ?? page),
                pageSize: resolvedPageSize,
                totalRows,
                totalPages: resolvedTotalPages,
            },
            queryTimeMs: Number(payload.query_time_ms || 0),
        };
    }
    finally {
        clearTimeout(timer);
    }
}
// Retries transient failures (Cloudflare gateway errors, network blips, timeouts) with
// exponential backoff. Non-retryable errors (bad filters, auth, etc.) fail immediately.
export async function queryPks(filters, page, pageSize) {
    let lastErr;
    for (let attempt = 1; attempt <= PKS_RETRY_ATTEMPTS; attempt++) {
        try {
            return await queryPksOnce(filters, page, pageSize);
        }
        catch (err) {
            lastErr = err;
            if (!(err instanceof RetryablePksError) || attempt === PKS_RETRY_ATTEMPTS)
                throw err;
            const backoffMs = PKS_RETRY_BASE_MS * 2 ** (attempt - 1);
            console.warn(`[PKS] Query failed (attempt ${attempt}/${PKS_RETRY_ATTEMPTS}), retrying in ${backoffMs}ms: ${err.message}`);
            await sleep(backoffMs);
        }
    }
    throw lastErr;
}
async function queryPksPreviewWithMode(filters, mode, groups, pageSize) {
    if (mode === 'and') {
        const single = await queryPks(filters, 1, pageSize);
        return {
            data: single.data,
            totalRows: single.pagination.totalRows,
            totalPages: single.pagination.totalPages,
            pageSize: single.pagination.pageSize,
            queryTimeMs: single.queryTimeMs,
        };
    }
    const buckets = buildFilterBuckets(filters, mode, groups);
    if (buckets.length > 200) {
        throw new Error('Too many grouped filter combinations. Reduce values per field.');
    }
    const results = await Promise.all(buckets.map((bucket) => queryPks(bucket, 1, pageSize)));
    const mergedRows = dedupePksRows(results.flatMap((item) => item.data));
    return {
        data: mergedRows,
        // OR mode requires multiple PKS requests; overlap is deduped in sample/import rows.
        totalRows: results.reduce((sum, item) => sum + item.pagination.totalRows, 0),
        totalPages: results.reduce((sum, item) => sum + item.pagination.totalPages, 0),
        pageSize,
        queryTimeMs: results.reduce((sum, item) => sum + item.queryTimeMs, 0),
    };
}
export async function fetchPksRowsForExecute(filters, mode, groups, pageSize, maxPages, onProgress) {
    if (mode === 'and') {
        let page = 1;
        let totalPages = 1;
        const rows = [];
        while (page <= totalPages && page <= maxPages) {
            const result = await queryPks(filters, page, pageSize);
            totalPages = result.pagination.totalPages;
            rows.push(...result.data);
            page += 1;
            onProgress?.(Math.min(maxPages, page - 1), rows.length);
        }
        return {
            rows,
            pagesProcessed: Math.min(maxPages, Math.max(0, page - 1)),
            cappedByMaxPages: page - 1 >= maxPages,
        };
    }
    const buckets = buildFilterBuckets(filters, mode, groups);
    if (buckets.length > 200) {
        throw new Error('Too many grouped filter combinations. Reduce values per field.');
    }
    const allRows = [];
    let pagesProcessed = 0;
    let cappedByMaxPages = false;
    for (const bucket of buckets) {
        let page = 1;
        let totalPages = 1;
        while (page <= totalPages && page <= maxPages) {
            const result = await queryPks(bucket, page, pageSize);
            totalPages = result.pagination.totalPages;
            pagesProcessed += 1;
            allRows.push(...result.data);
            page += 1;
            onProgress?.(pagesProcessed, allRows.length);
        }
        if (page - 1 >= maxPages)
            cappedByMaxPages = true;
    }
    return {
        rows: dedupePksRows(allRows),
        pagesProcessed,
        cappedByMaxPages,
    };
}
export async function ensureCampaignExists(campaignId) {
    try {
        const rows = rowsFrom(await db.execute(sql `SELECT id FROM campaigns WHERE id = ${campaignId} LIMIT 1`));
        return rows.length > 0;
    }
    catch {
        return false;
    }
}
async function hasTable(tableName) {
    try {
        const rows = rowsFrom(await db.execute(sql `SELECT to_regclass(${`public.${tableName}`}) AS table_name`));
        return Boolean(rows[0]?.table_name);
    }
    catch {
        return false;
    }
}
async function ensureCampaignExistsOrCreate(campaignId, seed) {
    if (await ensureCampaignExists(campaignId))
        return true;
    const safeName = cleanText(seed?.name) || `Campaign ${campaignId}`;
    const safeDescription = cleanText(seed?.description);
    const safeStatus = ['draft', 'active', 'paused', 'completed', 'cancelled'].includes(String(seed?.status || '').trim())
        ? String(seed?.status).trim()
        : 'draft';
    const maxAttempts = Math.max(1, Math.min(Number(seed?.maxAttempts || 3), 10));
    const retryIntervalHours = Math.max(1, Math.min(Number(seed?.retryIntervalHours || 24), 24 * 14));
    const orderByMonthlyPaymentDesc = parseBooleanInput(seed?.orderByMonthlyPaymentDesc) ?? false;
    const skipNextDayAfterSuccess = parseBooleanInput(seed?.skipNextDayAfterSuccess) ?? false;
    const dailyCustomerRefresh = parseBooleanInput(seed?.dailyCustomerRefresh) ?? false;
    const trunkIds = Array.isArray(seed?.trunkIds)
        ? seed.trunkIds.filter(Boolean).slice(0, 50).join(',')
        : null;
    const runWeekdays = Array.isArray(seed?.runWeekdays) ? seed?.runWeekdays.filter(Boolean).slice(0, 7) : [];
    const runWindowStart = cleanText(seed?.runWindowStart) || '09:00';
    const runWindowEnd = cleanText(seed?.runWindowEnd) || '19:00';
    const scheduleConfig = {
        runWeekdays,
        runWindowStart,
        runWindowEnd,
    };
    try {
        await db.execute(sql `
      INSERT INTO campaigns (
        id,
        name,
        description,
        status,
        max_attempts,
        retry_interval_hours,
        order_by_monthly_payment_desc,
        skip_next_day_after_success,
        daily_customer_refresh,
        trunk_ids,
        schedule_config,
        created_at,
        updated_at
      ) VALUES (
        ${campaignId},
        ${safeName},
        ${safeDescription},
        ${safeStatus},
        ${maxAttempts},
        ${retryIntervalHours},
        ${orderByMonthlyPaymentDesc},
        ${skipNextDayAfterSuccess},
        ${dailyCustomerRefresh},
        ${trunkIds},
        ${JSON.stringify(scheduleConfig)},
        now(),
        now()
      )
      ON CONFLICT (id) DO NOTHING
    `);
        return await ensureCampaignExists(campaignId);
    }
    catch {
        return false;
    }
}
async function resolveExistingCustomer(row) {
    const sourceKey = makeSourceRecordKey(row);
    if (sourceKey) {
        const found = rowsFrom(await db.execute(sql `
      SELECT id
      FROM customers
      WHERE source_system = 'pks' AND source_record_key = ${sourceKey}
      LIMIT 1
    `));
        if (found[0])
            return Number(found[0].id);
    }
    const fin = validateFin(row.fin);
    const contractNo = cleanText(row.muqavile_no);
    if (fin && contractNo) {
        const found = rowsFrom(await db.execute(sql `
      SELECT id
      FROM customers
      WHERE upper(trim(coalesce(fin, ''))) = upper(trim(${fin}))
        AND upper(trim(coalesce(contract_no, ''))) = upper(trim(${contractNo}))
      LIMIT 1
    `));
        if (found[0])
            return Number(found[0].id);
    }
    const phone = normalizePhone(row.mobile_phone);
    if (phone) {
        const found = rowsFrom(await db.execute(sql `
      SELECT id
      FROM customers
      WHERE regexp_replace(coalesce(mobile_phone, phone, ''), '[^0-9]', '', 'g') = regexp_replace(${phone}, '[^0-9]', '', 'g')
         OR right(regexp_replace(coalesce(mobile_phone, phone, ''), '[^0-9]', '', 'g'), 9)
            = right(regexp_replace(${phone}, '[^0-9]', '', 'g'), 9)
      LIMIT 1
    `));
        if (found[0])
            return Number(found[0].id);
    }
    return null;
}
async function upsertCustomerFromPks(row) {
    // Backward-compat: warn if caller still sends removed cari_borc field
    if (row.cari_borc !== undefined && row.comment_template_name === undefined) {
        console.warn('[PKS] Deprecated field "cari_borc" received without "comment_template_name". API contract has changed — update the source. cari_borc will not be persisted.');
    }
    const nowIso = new Date().toISOString();
    const fullName = cleanText(row.musterinin_asa);
    const normalizedName = splitName(fullName);
    const phone = normalizePhone(row.mobile_phone);
    const sourceKey = makeSourceRecordKey(row);
    const syncHash = payloadHash(row);
    const existingId = await resolveExistingCustomer(row);
    if (existingId) {
        await db.execute(sql `
      UPDATE customers
      SET name = ${normalizedName.name},
          surname = ${normalizedName.surname},
          father_name = ${normalizedName.fatherName},
          overdue_days = ${cleanInt(row.days_due) ?? 0},
          debt_amount = ${cleanDecimal(row.odenis_ayliq) ?? '0.00'},
          organization = ${cleanText(row.organization)},
          contract_no = ${cleanText(row.muqavile_no)},
          source_full_name = ${fullName},
          fin = ${validateFin(row.fin)},
          employee_code = ${cleanText(row.emekdas)},
          reference = ${cleanText(row.rehber)},
          branch = ${cleanText(row.magaza)},
          category = ${cleanText(row.kateqoriya)},
          pks_status = ${cleanText(row.status)},
          pks_comment = ${cleanText(row.comment)},
          comment_template_name = ${cleanText(row.comment_template_name)},
          pks_status_category = ${cleanText(row.status_category)},
          active_contract_count = ${cleanInt(row.active_contract_count)},
          last_3_payment_dates = ${cleanText(row.last_3_payment_dates)},
          last_3_payment_amounts = ${cleanText(row.last_3_payment_amounts)},
          total_paid_last_90_days = ${cleanDecimal(row.total_paid_last_90_days)},
          kept_promise_count_90d = ${cleanInt(row.kept_promise_count_90d)},
          broken_promise_count_90d = ${cleanInt(row.broken_promise_count_90d)},
          collector_organization = ${cleanText(row.collector_organization)},
          source_organization = ${cleanText(row.source_organization)},
          last_payment_date = ${cleanText(row.last_payment_date)},
          last_payment_amount = ${cleanDecimal(row.last_payment_amount)},
            phone = coalesce(${phone}, phone),
            mobile_phone = coalesce(${phone}, mobile_phone),
          source_system = 'pks',
          source_record_key = coalesce(${sourceKey}, source_record_key),
          last_synced_at = ${nowIso},
          source_payload_hash = ${syncHash}
      WHERE id = ${existingId}
    `);
        return { customerId: existingId, action: 'updated' };
    }
    const inserted = rowsFrom(await db.execute(sql `
    INSERT INTO customers (
      name,
      surname,
      father_name,
      debt_amount,
      overdue_days,
      days_due,
      phone,
      organization,
      contract_no,
      source_full_name,
      fin,
      monthly_payment,
      employee_code,
      reference,
      branch,
      category,
      pks_status,
      pks_comment,
      comment_template_name,
      pks_status_category,
      active_contract_count,
      last_3_payment_dates,
      last_3_payment_amounts,
      total_paid_last_90_days,
      kept_promise_count_90d,
      broken_promise_count_90d,
      collector_organization,
      source_organization,
      last_payment_date,
      last_payment_amount,
      mobile_phone,
      source_system,
      source_record_key,
      imported_at,
      last_synced_at,
      source_payload_hash
    ) VALUES (
      ${normalizedName.name},
      ${normalizedName.surname},
      ${normalizedName.fatherName},
      ${cleanDecimal(row.odenis_ayliq) ?? '0.00'},
      ${cleanInt(row.days_due) ?? 0},
      0,
      ${phone},
      ${cleanText(row.organization)},
      ${cleanText(row.muqavile_no)},
      ${fullName},
      ${validateFin(row.fin)},
      null,
      ${cleanText(row.emekdas)},
      ${cleanText(row.rehber)},
      ${cleanText(row.magaza)},
      ${cleanText(row.kateqoriya)},
      ${cleanText(row.status)},
      ${cleanText(row.comment)},
      ${cleanText(row.comment_template_name)},
      ${cleanText(row.status_category)},
      ${cleanInt(row.active_contract_count)},
      ${cleanText(row.last_3_payment_dates)},
      ${cleanText(row.last_3_payment_amounts)},
      ${cleanDecimal(row.total_paid_last_90_days)},
      ${cleanInt(row.kept_promise_count_90d)},
      ${cleanInt(row.broken_promise_count_90d)},
      ${cleanText(row.collector_organization)},
      ${cleanText(row.source_organization)},
      ${cleanText(row.last_payment_date)},
      ${cleanDecimal(row.last_payment_amount)},
      ${phone},
      'pks',
      ${sourceKey},
      ${nowIso},
      ${nowIso},
      ${syncHash}
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `));
    if (inserted[0]) {
        return { customerId: Number(inserted[0].id), action: 'created' };
    }
    const resolvedAfterConflict = await resolveExistingCustomer(row);
    if (resolvedAfterConflict) {
        await db.execute(sql `
      UPDATE customers
      SET name = ${normalizedName.name},
          surname = ${normalizedName.surname},
          father_name = ${normalizedName.fatherName},
          overdue_days = ${cleanInt(row.days_due) ?? 0},
          debt_amount = ${cleanDecimal(row.odenis_ayliq) ?? '0.00'},
          organization = ${cleanText(row.organization)},
          contract_no = ${cleanText(row.muqavile_no)},
          source_full_name = ${fullName},
          fin = ${validateFin(row.fin)},
          employee_code = ${cleanText(row.emekdas)},
          reference = ${cleanText(row.rehber)},
          branch = ${cleanText(row.magaza)},
          category = ${cleanText(row.kateqoriya)},
          pks_status = ${cleanText(row.status)},
          pks_comment = ${cleanText(row.comment)},
          comment_template_name = ${cleanText(row.comment_template_name)},
          pks_status_category = ${cleanText(row.status_category)},
          active_contract_count = ${cleanInt(row.active_contract_count)},
          last_3_payment_dates = ${cleanText(row.last_3_payment_dates)},
          last_3_payment_amounts = ${cleanText(row.last_3_payment_amounts)},
          total_paid_last_90_days = ${cleanDecimal(row.total_paid_last_90_days)},
          kept_promise_count_90d = ${cleanInt(row.kept_promise_count_90d)},
          broken_promise_count_90d = ${cleanInt(row.broken_promise_count_90d)},
          collector_organization = ${cleanText(row.collector_organization)},
          source_organization = ${cleanText(row.source_organization)},
          last_payment_date = ${cleanText(row.last_payment_date)},
          last_payment_amount = ${cleanDecimal(row.last_payment_amount)},
            phone = coalesce(${phone}, phone),
            mobile_phone = coalesce(${phone}, mobile_phone),
          source_system = 'pks',
          source_record_key = coalesce(${sourceKey}, source_record_key),
          last_synced_at = ${nowIso},
          source_payload_hash = ${syncHash}
      WHERE id = ${resolvedAfterConflict}
    `);
        return { customerId: resolvedAfterConflict, action: 'updated' };
    }
    throw new Error('failed to upsert customer from PKS');
}
async function attachToCampaign(campaignId, customerId) {
    // Check existence first — no unique constraint on (campaign_id, customer_id) in the DB
    const existing = rowsFrom(await db.execute(sql `
    SELECT 1 FROM campaign_calls
    WHERE campaign_id = ${campaignId} AND customer_id = ${customerId}
    LIMIT 1
  `));
    if (existing.length > 0)
        return false;
    const inserted = rowsFrom(await db.execute(sql `
    INSERT INTO campaign_calls (campaign_id, customer_id, status, attempt_number, created_at, updated_at)
    VALUES (${campaignId}, ${customerId}, 'pending', 0, now(), now())
    RETURNING id
  `));
    return inserted.length > 0;
}
async function hadSuccessfulCallYesterday(customerId) {
    const rows = rowsFrom(await db.execute(sql `
    SELECT 1
    FROM calls
    WHERE customer_id = ${customerId}
      AND ended_at IS NOT NULL
      AND coalesce(duration_seconds, 0) > 0
      AND ended_at::date = current_date - interval '1 day'
    LIMIT 1
  `));
    return rows.length > 0;
}
// ===========================================================================
// Batch PKS customer upsert helpers
// ===========================================================================
const BATCH_CHUNK_SIZE = 1000;
export function buildPksRowBatchMeta(rows) {
    return rows.map((row, idx) => {
        const fullName = cleanText(row.musterinin_asa);
        const normalizedName = splitName(fullName);
        const phone = normalizePhone(row.mobile_phone);
        const fin = validateFin(row.fin);
        const contractNo = cleanText(row.muqavile_no);
        return {
            idx,
            row,
            sourceKey: makeSourceRecordKey(row),
            fin,
            finUpper: fin?.toUpperCase() ?? null,
            contractNo,
            contractNoUpper: contractNo?.toUpperCase() ?? null,
            phone,
            phoneDigits: phone?.replace(/\D/g, '') ?? null,
            syncHash: payloadHash(row),
            fullName,
            name: normalizedName.name,
            surname: normalizedName.surname,
            fatherName: normalizedName.fatherName,
        };
    });
}
/**
 * Deduplicate by source_key: keep the highest-idx row (last write wins). This mirrors the
 * sequential behaviour where a later row updates an earlier row's newly-created customer
 * when they share the same source_record_key.
 */
export function dedupePksRowBatchMeta(meta) {
    const bestIdxByKey = new Map();
    for (const m of meta) {
        if (!m.sourceKey)
            continue;
        const prev = bestIdxByKey.get(m.sourceKey);
        if (prev === undefined || m.idx > prev)
            bestIdxByKey.set(m.sourceKey, m.idx);
    }
    const keep = new Set(bestIdxByKey.values());
    return meta.filter((m) => !m.sourceKey || keep.has(m.idx));
}
/**
 * Resolve all existing customers in 3 batched queries.
 * Resolution order: source_key → FIN+contract_no → phone (first match wins).
 */
export async function batchResolveExistingCustomers(meta) {
    const result = new Map();
    // ---- Strategy 1: by source_key (source_system = 'pks') ----
    const withSourceKey = meta.filter((m) => m.sourceKey !== null);
    if (withSourceKey.length > 0) {
        const keys = withSourceKey.map((m) => m.sourceKey);
        const rows = rowsFrom(await db.execute(sql `
      SELECT c.source_record_key, c.id
      FROM customers c
      WHERE c.source_system = 'pks'
        AND c.source_record_key IN (
            SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)
          )
    `));
        const keyToId = new Map();
        for (const r of rows) {
            keyToId.set(String(r.source_record_key), Number(r.id));
        }
        for (const m of withSourceKey) {
            const id = keyToId.get(m.sourceKey);
            if (id !== undefined)
                result.set(m.idx, id);
        }
    }
    // ---- Strategy 2: by FIN + contract_no (unmatched rows only) ----
    const unmatched1 = meta.filter((m) => !result.has(m.idx) && m.finUpper && m.contractNoUpper);
    if (unmatched1.length > 0) {
        const jsonData = unmatched1.map((m) => ({
            idx: m.idx,
            fin_upper: m.finUpper,
            contract_upper: m.contractNoUpper,
        }));
        const rows = rowsFrom(await db.execute(sql `
      WITH pairs AS (
        SELECT v.idx, v.fin_upper, v.contract_upper
        FROM jsonb_to_recordset(${JSON.stringify(jsonData)}::jsonb)
        AS v(idx int, fin_upper text, contract_upper text)
      )
      SELECT DISTINCT ON (p.idx) p.idx, c.id
      FROM pairs p
      JOIN customers c ON
        upper(trim(coalesce(c.fin, ''))) = p.fin_upper
        AND upper(trim(coalesce(c.contract_no, ''))) = p.contract_upper
      ORDER BY p.idx, c.id
    `));
        for (const r of rows) {
            result.set(Number(r.idx), Number(r.id));
        }
    }
    // ---- Strategy 3: by phone (unmatched rows only) ----
    const unmatched2 = meta.filter((m) => !result.has(m.idx) && m.phoneDigits);
    if (unmatched2.length > 0) {
        const jsonData = unmatched2.map((m) => ({
            idx: m.idx,
            digits: m.phoneDigits,
        }));
        const rows = rowsFrom(await db.execute(sql `
      WITH phones AS (
        SELECT v.idx, v.digits
        FROM jsonb_to_recordset(${JSON.stringify(jsonData)}::jsonb)
        AS v(idx int, digits text)
      )
      SELECT DISTINCT ON (p.idx) p.idx, c.id
      FROM phones p
      JOIN customers c ON
        regexp_replace(coalesce(c.mobile_phone, c.phone, ''), '[^0-9]', '', 'g') = p.digits
        OR right(regexp_replace(coalesce(c.mobile_phone, c.phone, ''), '[^0-9]', '', 'g'), 9)
           = right(p.digits, 9)
      ORDER BY p.idx, c.id
    `));
        for (const r of rows) {
            if (!result.has(Number(r.idx))) {
                result.set(Number(r.idx), Number(r.id));
            }
        }
    }
    return result;
}
/**
 * Batch UPDATE all matched customers in chunks.
 * Uses jsonb_to_recordset — a single parameter that avoids PostgreSQL's
 * 1664-entry ROW expression limit.
 */
export async function batchUpdateCustomers(entries, nowIso) {
    for (let i = 0; i < entries.length; i += BATCH_CHUNK_SIZE) {
        const chunk = entries.slice(i, i + BATCH_CHUNK_SIZE);
        if (chunk.length === 0)
            continue;
        const jsonData = chunk.map(([customerId, meta]) => ({
            id: customerId,
            name: meta.name,
            surname: meta.surname,
            father_name: meta.fatherName,
            overdue_days: cleanInt(meta.row.days_due) ?? 0,
            debt_amount: cleanDecimal(meta.row.odenis_ayliq) ?? '0.00',
            organization: cleanText(meta.row.organization),
            contract_no: cleanText(meta.row.muqavile_no),
            source_full_name: meta.fullName,
            fin: validateFin(meta.row.fin),
            employee_code: cleanText(meta.row.emekdas),
            reference: cleanText(meta.row.rehber),
            branch: cleanText(meta.row.magaza),
            category: cleanText(meta.row.kateqoriya),
            pks_status: cleanText(meta.row.status),
            pks_comment: cleanText(meta.row.comment),
            comment_template_name: cleanText(meta.row.comment_template_name),
            pks_status_category: cleanText(meta.row.status_category),
            active_contract_count: cleanInt(meta.row.active_contract_count),
            last_3_payment_dates: cleanText(meta.row.last_3_payment_dates),
            last_3_payment_amounts: cleanText(meta.row.last_3_payment_amounts),
            total_paid_last_90_days: cleanDecimal(meta.row.total_paid_last_90_days),
            kept_promise_count_90d: cleanInt(meta.row.kept_promise_count_90d),
            broken_promise_count_90d: cleanInt(meta.row.broken_promise_count_90d),
            collector_organization: cleanText(meta.row.collector_organization),
            source_organization: cleanText(meta.row.source_organization),
            last_payment_date: cleanText(meta.row.last_payment_date),
            last_payment_amount: cleanDecimal(meta.row.last_payment_amount),
            phone: meta.phone,
            source_record_key: meta.sourceKey,
            last_synced_at: nowIso,
            source_payload_hash: meta.syncHash,
        }));
        await db.execute(sql `
      UPDATE customers c
      SET
        name = v.name,
        surname = v.surname,
        father_name = v.father_name,
        overdue_days = v.overdue_days,
        debt_amount = v.debt_amount::numeric,
        organization = v.organization,
        contract_no = v.contract_no,
        source_full_name = v.source_full_name,
        fin = v.fin,
        employee_code = v.employee_code,
        reference = v.reference,
        branch = v.branch,
        category = v.category,
        pks_status = v.pks_status,
        pks_comment = v.pks_comment,
        comment_template_name = v.comment_template_name,
        pks_status_category = v.pks_status_category,
        active_contract_count = v.active_contract_count,
        last_3_payment_dates = v.last_3_payment_dates,
        last_3_payment_amounts = v.last_3_payment_amounts,
        total_paid_last_90_days = v.total_paid_last_90_days::numeric,
        kept_promise_count_90d = v.kept_promise_count_90d,
        broken_promise_count_90d = v.broken_promise_count_90d,
        collector_organization = v.collector_organization,
        source_organization = v.source_organization,
        last_payment_date = v.last_payment_date::date,
        last_payment_amount = v.last_payment_amount::numeric,
        phone = coalesce(v.phone, c.phone),
        mobile_phone = coalesce(v.phone, c.mobile_phone),
        source_system = 'pks',
        source_record_key = coalesce(v.source_record_key, c.source_record_key),
        last_synced_at = v.last_synced_at::timestamptz,
        source_payload_hash = v.source_payload_hash
      FROM jsonb_to_recordset(${JSON.stringify(jsonData)}::jsonb)
      AS v(
        id int,
        name text,
        surname text,
        father_name text,
        overdue_days int,
        debt_amount text,
        organization text,
        contract_no text,
        source_full_name text,
        fin text,
        employee_code text,
        reference text,
        branch text,
        category text,
        pks_status text,
        pks_comment text,
        comment_template_name text,
        pks_status_category text,
        active_contract_count int,
        last_3_payment_dates text,
        last_3_payment_amounts text,
        total_paid_last_90_days text,
        kept_promise_count_90d int,
        broken_promise_count_90d int,
        collector_organization text,
        source_organization text,
        last_payment_date text,
        last_payment_amount text,
        phone text,
        source_record_key text,
        last_synced_at text,
        source_payload_hash text
      )
      WHERE c.id = v.id
    `);
    }
}
/**
 * Batch INSERT new customers in chunks.
 * Uses jsonb_to_recordset — a single parameter that avoids PostgreSQL's
 * 1664-entry ROW expression limit.
 * Returns inserted customer IDs in the same order as metaList.
 */
export async function batchInsertCustomers(metaList, nowIso) {
    const allIds = [];
    for (let i = 0; i < metaList.length; i += BATCH_CHUNK_SIZE) {
        const chunk = metaList.slice(i, i + BATCH_CHUNK_SIZE);
        if (chunk.length === 0)
            continue;
        const jsonData = chunk.map((meta) => ({
            name: meta.name,
            surname: meta.surname,
            father_name: meta.fatherName,
            debt_amount: cleanDecimal(meta.row.odenis_ayliq) ?? '0.00',
            overdue_days: cleanInt(meta.row.days_due) ?? 0,
            days_due: 0,
            phone: meta.phone,
            organization: cleanText(meta.row.organization),
            contract_no: cleanText(meta.row.muqavile_no),
            source_full_name: meta.fullName,
            fin: validateFin(meta.row.fin),
            employee_code: cleanText(meta.row.emekdas),
            reference: cleanText(meta.row.rehber),
            branch: cleanText(meta.row.magaza),
            category: cleanText(meta.row.kateqoriya),
            pks_status: cleanText(meta.row.status),
            pks_comment: cleanText(meta.row.comment),
            comment_template_name: cleanText(meta.row.comment_template_name),
            pks_status_category: cleanText(meta.row.status_category),
            active_contract_count: cleanInt(meta.row.active_contract_count),
            last_3_payment_dates: cleanText(meta.row.last_3_payment_dates),
            last_3_payment_amounts: cleanText(meta.row.last_3_payment_amounts),
            total_paid_last_90_days: cleanDecimal(meta.row.total_paid_last_90_days),
            kept_promise_count_90d: cleanInt(meta.row.kept_promise_count_90d),
            broken_promise_count_90d: cleanInt(meta.row.broken_promise_count_90d),
            collector_organization: cleanText(meta.row.collector_organization),
            source_organization: cleanText(meta.row.source_organization),
            last_payment_date: cleanText(meta.row.last_payment_date),
            last_payment_amount: cleanDecimal(meta.row.last_payment_amount),
            mobile_phone: meta.phone,
            source_system: 'pks',
            source_record_key: meta.sourceKey,
            imported_at: nowIso,
            last_synced_at: nowIso,
            source_payload_hash: meta.syncHash,
        }));
        const rows = rowsFrom(await db.execute(sql `
      INSERT INTO customers (
        name, surname, father_name, debt_amount, overdue_days, days_due,
        phone, organization, contract_no, source_full_name, fin,
        employee_code, reference, branch, category,
        pks_status, pks_comment, comment_template_name, pks_status_category,
        active_contract_count, last_3_payment_dates, last_3_payment_amounts,
        total_paid_last_90_days, kept_promise_count_90d, broken_promise_count_90d,
        collector_organization, source_organization,
        last_payment_date, last_payment_amount,
        mobile_phone, source_system, source_record_key,
        imported_at, last_synced_at, source_payload_hash
      )
      SELECT
        v.name,
        v.surname,
        v.father_name,
        v.debt_amount::numeric,
        v.overdue_days,
        v.days_due,
        v.phone,
        v.organization,
        v.contract_no,
        v.source_full_name,
        v.fin,
        v.employee_code,
        v.reference,
        v.branch,
        v.category,
        v.pks_status,
        v.pks_comment,
        v.comment_template_name,
        v.pks_status_category,
        v.active_contract_count,
        v.last_3_payment_dates,
        v.last_3_payment_amounts,
        v.total_paid_last_90_days::numeric,
        v.kept_promise_count_90d,
        v.broken_promise_count_90d,
        v.collector_organization,
        v.source_organization,
        v.last_payment_date::date,
        v.last_payment_amount::numeric,
        v.mobile_phone,
        v.source_system,
        v.source_record_key,
        v.imported_at::timestamptz,
        v.last_synced_at::timestamptz,
        v.source_payload_hash
      FROM jsonb_to_recordset(${JSON.stringify(jsonData)}::jsonb)
      AS v(
        name text,
        surname text,
        father_name text,
        debt_amount text,
        overdue_days int,
        days_due int,
        phone text,
        organization text,
        contract_no text,
        source_full_name text,
        fin text,
        employee_code text,
        reference text,
        branch text,
        category text,
        pks_status text,
        pks_comment text,
        comment_template_name text,
        pks_status_category text,
        active_contract_count int,
        last_3_payment_dates text,
        last_3_payment_amounts text,
        total_paid_last_90_days text,
        kept_promise_count_90d int,
        broken_promise_count_90d int,
        collector_organization text,
        source_organization text,
        last_payment_date text,
        last_payment_amount text,
        mobile_phone text,
        source_system text,
        source_record_key text,
        imported_at text,
        last_synced_at text,
        source_payload_hash text
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `));
        for (const r of rows) {
            allIds.push(Number(r.id));
        }
    }
    return allIds;
}
/**
 * Batch-check which customers had a successful call yesterday.
 */
async function batchHadSuccessfulCallYesterday(customerIds) {
    const result = new Set();
    if (customerIds.length === 0)
        return result;
    // Process in chunks to avoid hitting parameter limits
    for (let i = 0; i < customerIds.length; i += BATCH_CHUNK_SIZE) {
        const chunk = customerIds.slice(i, i + BATCH_CHUNK_SIZE);
        const rows = rowsFrom(await db.execute(sql `
      SELECT DISTINCT customer_id
      FROM calls
      WHERE customer_id IN (
        SELECT value::int FROM jsonb_array_elements(${JSON.stringify(chunk)}::jsonb)
      )
        AND ended_at IS NOT NULL
        AND coalesce(duration_seconds, 0) > 0
        AND ended_at::date = current_date - interval '1 day'
    `));
        for (const r of rows) {
            result.add(Number(r.customer_id));
        }
    }
    return result;
}
/**
 * Batch-attach customers to a campaign.
 * Returns the count of newly attached rows.
 */
export async function batchAttachToCampaign(campaignId, customerIds) {
    if (customerIds.length === 0)
        return 0;
    // Filter out already-attached customers — no unique constraint on (campaign_id, customer_id)
    const statusMap = await campaignAttachmentStatusMap(campaignId, customerIds);
    const newIds = customerIds.filter((id) => !statusMap.has(id));
    if (newIds.length === 0)
        return 0;
    let totalAttached = 0;
    for (let i = 0; i < newIds.length; i += BATCH_CHUNK_SIZE) {
        const chunk = newIds.slice(i, i + BATCH_CHUNK_SIZE);
        const rows = rowsFrom(await db.execute(sql `
      INSERT INTO campaign_calls (
        campaign_id, customer_id, status, attempt_number, created_at, updated_at
      )
      SELECT ${campaignId}, x.value::int, 'pending', 0, now(), now()
      FROM jsonb_array_elements(${JSON.stringify(chunk)}::jsonb) AS x
      RETURNING id
    `));
        totalAttached += rows.length;
    }
    return totalAttached;
}
/**
 * campaign_calls status per customer id, for whichever of customerIds are already attached
 * to campaignId. Shared by the "new PKS matches" route/count and the daily refresh job.
 */
export async function campaignAttachmentStatusMap(campaignId, customerIds) {
    const result = new Map();
    if (customerIds.length === 0)
        return result;
    const rows = rowsFrom(await db.execute(sql `
    SELECT customer_id, status
    FROM campaign_calls
    WHERE campaign_id = ${campaignId}
      AND customer_id IN (
        SELECT value::int FROM jsonb_array_elements(${JSON.stringify(customerIds)}::jsonb)
      )
  `));
    for (const r of rows)
        result.set(Number(r.customer_id), String(r.status));
    return result;
}
export const campaignsRouter = Router();
// GET all campaigns
campaignsRouter.get('/', async (req, res) => {
    try {
        const campaigns = rowsFrom(await db.execute(sql `
      SELECT id, name, description, status, max_attempts, retry_interval_hours,
             order_by_monthly_payment_desc, skip_next_day_after_success, daily_customer_refresh,
             new_customer_matches_count, new_customer_matches_checked_at,
             run_weekdays, run_window_start, run_window_end,
             run_start_date::text, run_end_date::text,
             base_template_id, agent_id, trunk_id, trunk_ids,
             total_customers, completed_calls, successful_calls,
             created_at, updated_at
      FROM campaigns
      ORDER BY created_at DESC
    `));
        res.json(campaigns.map(c => ({
            id: c.id,
            name: c.name,
            description: c.description,
            status: c.status,
            maxAttempts: c.max_attempts,
            retryIntervalHours: c.retry_interval_hours,
            orderByMonthlyPaymentDesc: asBooleanCell(c.order_by_monthly_payment_desc),
            skipNextDayAfterSuccess: asBooleanCell(c.skip_next_day_after_success),
            dailyCustomerRefresh: asBooleanCell(c.daily_customer_refresh),
            newCustomerMatchesCount: c.new_customer_matches_count,
            newCustomerMatchesCheckedAt: c.new_customer_matches_checked_at,
            runWeekdays: String(c.run_weekdays || '').split(',').map((day) => day.trim()).filter(Boolean),
            runWindowStart: c.run_window_start,
            runWindowEnd: c.run_window_end,
            runStartDate: c.run_start_date,
            runEndDate: c.run_end_date,
            baseTemplateId: c.base_template_id,
            agentId: c.agent_id,
            trunkId: c.trunk_id,
            trunkIds: String(c.trunk_ids || '').split(',').map((t) => t.trim()).filter(Boolean),
            totalCustomers: c.total_customers,
            completedCalls: c.completed_calls,
            successfulCalls: c.successful_calls,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
        })));
    }
    catch (err) {
        res.status(500).json(buildRouteError(err, 'failed to fetch campaigns'));
    }
});
// GET distinct values for a PKS filter column
campaignsRouter.get('/pks/distinct-values', async (req, res) => {
    const column = String(req.query.column ?? '').trim();
    const allowedColumns = [
        'organization', 'muqavile_no', 'musterinin_asa', 'fin',
        'comment_template_name', 'status_category', 'odenis_ayliq',
        'emekdas', 'rehber', 'magaza', 'kateqoriya', 'status',
        'comment', 'last_payment_date', 'last_payment_amount', 'mobile_phone',
    ];
    if (!allowedColumns.includes(column)) {
        res.status(400).json({ error: `invalid column: ${column}` });
        return;
    }
    try {
        const pageSize = 20000;
        const maxPages = 5; // up to 100k rows — sufficient for distinct values
        let page = 1;
        let totalPages = 1;
        const seen = new Set();
        while (page <= totalPages && page <= maxPages) {
            const result = await queryPks({}, page, pageSize);
            totalPages = result.pagination.totalPages;
            for (const row of result.data) {
                const value = row[column];
                const text = String(value ?? '').trim();
                if (text)
                    seen.add(text);
            }
            page += 1;
        }
        const values = Array.from(seen).sort((a, b) => a.localeCompare(b, 'az', { sensitivity: 'base' }));
        res.json({ column, values });
    }
    catch (err) {
        res.status(400).json(buildRouteError(err, 'failed to fetch distinct values'));
    }
});
// GET single campaign
campaignsRouter.get('/:id', async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
        res.status(400).json({ error: 'invalid campaign id' });
        return;
    }
    try {
        const campaigns = rowsFrom(await db.execute(sql `
      SELECT id, name, description, status, max_attempts, retry_interval_hours,
             order_by_monthly_payment_desc, skip_next_day_after_success, daily_customer_refresh,
             new_customer_matches_count, new_customer_matches_checked_at,
             run_weekdays, run_window_start, run_window_end,
             run_start_date::text, run_end_date::text,
             base_template_id, agent_id, trunk_id, trunk_ids,
             total_customers, completed_calls, successful_calls,
             created_at, updated_at
      FROM campaigns
      WHERE id = ${campaignId}
      LIMIT 1
    `));
        if (campaigns.length === 0) {
            res.status(404).json({ error: 'campaign not found' });
            return;
        }
        const c = campaigns[0];
        res.json({
            id: c.id,
            name: c.name,
            description: c.description,
            status: c.status,
            maxAttempts: c.max_attempts,
            retryIntervalHours: c.retry_interval_hours,
            orderByMonthlyPaymentDesc: asBooleanCell(c.order_by_monthly_payment_desc),
            skipNextDayAfterSuccess: asBooleanCell(c.skip_next_day_after_success),
            dailyCustomerRefresh: asBooleanCell(c.daily_customer_refresh),
            newCustomerMatchesCount: c.new_customer_matches_count,
            newCustomerMatchesCheckedAt: c.new_customer_matches_checked_at,
            runWeekdays: String(c.run_weekdays || '').split(',').map((day) => day.trim()).filter(Boolean),
            runWindowStart: c.run_window_start,
            runWindowEnd: c.run_window_end,
            runStartDate: c.run_start_date,
            runEndDate: c.run_end_date,
            baseTemplateId: c.base_template_id,
            agentId: c.agent_id,
            trunkId: c.trunk_id,
            trunkIds: String(c.trunk_ids || '').split(',').map((t) => t.trim()).filter(Boolean),
            totalCustomers: c.total_customers,
            completedCalls: c.completed_calls,
            successfulCalls: c.successful_calls,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
        });
    }
    catch (err) {
        res.status(500).json(buildRouteError(err, 'failed to fetch campaign'));
    }
});
campaignsRouter.get('/:id/calls', async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
        res.status(400).json({ error: 'invalid campaign id' });
        return;
    }
    try {
        const campaignExists = await ensureCampaignExists(campaignId);
        if (!campaignExists) {
            res.status(404).json({ error: 'campaign not found' });
            return;
        }
        const rows = rowsFrom(await db.execute(sql `
      SELECT
        cc.id,
        cc.customer_id AS "customerId",
        concat_ws(' ', c.name, c.surname, c.father_name) AS "customerName",
        c.fin AS "fin",
        coalesce(c.mobile_phone, c.phone) AS phone,
        cc.status,
        cc.attempt_number AS "attemptNumber",
        cc.updated_at AS "updatedAt",
        lc.id AS "lastCallId",
        lc.started_at AS "lastCallStartedAt",
        lc.ended_at AS "lastCallEndedAt",
        lc.duration_seconds AS "lastCallDurationSeconds",
        lc.summary AS "lastCallSummary",
        lc.description AS "lastCallDescription"
      FROM campaign_calls cc
      LEFT JOIN customers c ON c.id = cc.customer_id
      LEFT JOIN LATERAL (
        SELECT ca.id, ca.started_at, ca.ended_at, ca.duration_seconds, ca.summary, ca.description
        FROM calls ca
        WHERE ca.customer_id = cc.customer_id
        ORDER BY ca.started_at DESC, ca.id DESC
        LIMIT 1
      ) lc ON true
      WHERE cc.campaign_id = ${campaignId}
      ORDER BY cc.updated_at DESC, cc.id DESC
    `));
        res.json({ items: rows, total: rows.length, campaignId });
    }
    catch (err) {
        res.status(500).json(buildRouteError(err, 'failed to fetch campaign calls'));
    }
});
// GET /:id/export.xlsx — campaign details + call list as a two-sheet workbook
campaignsRouter.get('/:id/export.xlsx', async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
        res.status(400).json({ error: 'invalid campaign id' });
        return;
    }
    try {
        const campaigns = rowsFrom(await db.execute(sql `
      SELECT id, name, description, status, max_attempts, retry_interval_hours,
             order_by_monthly_payment_desc, skip_next_day_after_success,
             run_weekdays, run_window_start, run_window_end,
             run_start_date::text, run_end_date::text,
             total_customers, completed_calls, successful_calls,
             created_at
      FROM campaigns
      WHERE id = ${campaignId}
      LIMIT 1
    `));
        if (campaigns.length === 0) {
            res.status(404).json({ error: 'campaign not found' });
            return;
        }
        const c = campaigns[0];
        const callRows = rowsFrom(await db.execute(sql `
      SELECT
        concat_ws(' ', c.name, c.surname, c.father_name) AS "customerName",
        c.fin AS "fin",
        coalesce(c.mobile_phone, c.phone) AS phone,
        cc.status,
        cc.attempt_number AS "attemptNumber",
        cc.updated_at AS "updatedAt",
        lc.summary AS "lastCallSummary",
        lc.description AS "lastCallDescription"
      FROM campaign_calls cc
      LEFT JOIN customers c ON c.id = cc.customer_id
      LEFT JOIN LATERAL (
        SELECT ca.summary, ca.description
        FROM calls ca
        WHERE ca.customer_id = cc.customer_id
        ORDER BY ca.started_at DESC, ca.id DESC
        LIMIT 1
      ) lc ON true
      WHERE cc.campaign_id = ${campaignId}
      ORDER BY cc.updated_at DESC, cc.id DESC
    `));
        const dayLabels = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
        const runWeekdays = String(c.run_weekdays || '').split(',').map((d) => d.trim()).filter(Boolean);
        const runDaysLabel = runWeekdays.length ? runWeekdays.map((d) => dayLabels[d] || d).join(', ') : 'All days';
        const failedCalls = Math.max(0, Number(c.completed_calls || 0) - Number(c.successful_calls || 0));
        const yesNo = (value) => (value === true || value === 't' ? 'Yes' : 'No');
        const formatDateCell = (value) => {
            if (!value)
                return '';
            const text = String(value);
            return text.includes('T') ? text.replace('T', ' ').slice(0, 19) : text;
        };
        const header = (values) => values.map((value) => ({ value, style: HEADER_STYLE }));
        const campaignRows = [
            header(['Field', 'Value']),
            ['Name', String(c.name || '')],
            ['Description', String(c.description || '')],
            ['Status', String(c.status || '')],
            ['Total Customers', Number(c.total_customers || 0)],
            ['Completed Calls', Number(c.completed_calls || 0)],
            ['Successful Calls', Number(c.successful_calls || 0)],
            ['Failed Calls', failedCalls],
            ['Max Attempts', Number(c.max_attempts || 0)],
            ['Retry Interval (hours)', Number(c.retry_interval_hours || 0)],
            ['Run Window', `${c.run_window_start || ''} - ${c.run_window_end || ''}`],
            ['Run Days', runDaysLabel],
            ['Run Start Date', String(c.run_start_date || '')],
            ['Run End Date', String(c.run_end_date || '')],
            ['Skip Next Day After Success', yesNo(c.skip_next_day_after_success)],
            ['Order By Payment Desc', yesNo(c.order_by_monthly_payment_desc)],
            ['Created At', formatDateCell(c.created_at)],
        ];
        const callSheetRows = [
            header(['Customer', 'FIN', 'Phone', 'Status', 'Attempt', 'Result', 'Last Attempt']),
            ...callRows.map((row) => [
                String(row.customerName || ''),
                String(row.fin || ''),
                String(row.phone || ''),
                String(row.status || ''),
                Number(row.attemptNumber || 0),
                String(row.lastCallSummary || row.lastCallDescription || ''),
                formatDateCell(row.updatedAt),
            ]),
        ];
        const workbook = buildWorkbook([
            { name: 'Campaign', rows: campaignRows, widths: [26, 40] },
            { name: 'Calls', rows: callSheetRows, widths: [26, 14, 16, 12, 10, 40, 20] },
        ]);
        const safeName = String(c.name || `campaign-${campaignId}`).replace(/[^0-9A-Za-z_-]+/g, '_').slice(0, 60);
        const filename = `campaign-${campaignId}-${safeName}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', String(workbook.length));
        res.send(workbook);
    }
    catch (err) {
        res.status(500).json(buildRouteError(err, 'failed to export campaign'));
    }
});
// POST create campaign
campaignsRouter.post('/', requireRole('admin', 'campaign_manager'), async (req, res) => {
    const name = cleanText(req.body?.name);
    if (!name) {
        res.status(400).json({ error: 'name is required' });
        return;
    }
    const status = ['draft', 'active', 'paused', 'completed', 'cancelled'].includes(String(req.body?.status || ''))
        ? String(req.body?.status)
        : 'draft';
    const maxAttempts = Math.max(1, Math.min(Number(req.body?.maxAttempts || 3), 10));
    const retryIntervalHours = Math.max(1, Math.min(Number(req.body?.retryIntervalHours || 24), 24 * 14));
    const orderByMonthlyPaymentDesc = parseBooleanInput(req.body?.orderByMonthlyPaymentDesc) ?? false;
    const skipNextDayAfterSuccess = parseBooleanInput(req.body?.skipNextDayAfterSuccess) ?? false;
    const dailyCustomerRefresh = parseBooleanInput(req.body?.dailyCustomerRefresh) ?? false;
    const runWeekdays = Array.isArray(req.body?.runWeekdays)
        ? req.body.runWeekdays.filter(Boolean).slice(0, 7).join(',')
        : '';
    const runWindowStart = cleanText(req.body?.runWindowStart) || '09:00';
    const runWindowEnd = cleanText(req.body?.runWindowEnd) || '19:00';
    const runStartDate = cleanText(req.body?.runStartDate) || null;
    const runEndDate = cleanText(req.body?.runEndDate) || null;
    if (runStartDate && runEndDate && runEndDate < runStartDate) {
        res.status(400).json({ error: 'runEndDate must be on or after runStartDate' });
        return;
    }
    const description = cleanText(req.body?.description) || null;
    const baseTemplateId = req.body?.baseTemplateId || null;
    const agentId = req.body?.agentId || null;
    const trunkId = req.body?.trunkId || null;
    const trunkIds = Array.isArray(req.body?.trunkIds)
        ? req.body.trunkIds.filter(Boolean).slice(0, 50).join(',')
        : null;
    try {
        const inserted = rowsFrom(await db.execute(sql `
      INSERT INTO campaigns (
        name, description, status, max_attempts, retry_interval_hours,
        order_by_monthly_payment_desc, skip_next_day_after_success, daily_customer_refresh,
        run_weekdays, run_window_start, run_window_end, run_start_date, run_end_date,
        base_template_id, agent_id, trunk_id, trunk_ids,
        total_customers, completed_calls, successful_calls, created_at, updated_at
      ) VALUES (
        ${name}, ${description}, ${status}, ${maxAttempts}, ${retryIntervalHours},
        ${orderByMonthlyPaymentDesc}, ${skipNextDayAfterSuccess}, ${dailyCustomerRefresh},
        ${runWeekdays}, ${runWindowStart}, ${runWindowEnd}, ${runStartDate}::date, ${runEndDate}::date,
        ${baseTemplateId}, ${agentId}, ${trunkId}, ${trunkIds},
        0, 0, 0, now(), now()
      )
      RETURNING id, name, description, status, max_attempts, retry_interval_hours,
                order_by_monthly_payment_desc, skip_next_day_after_success, daily_customer_refresh,
                run_weekdays, run_window_start, run_window_end, run_start_date::text, run_end_date::text,
                base_template_id, agent_id, trunk_id, trunk_ids,
                total_customers, completed_calls, successful_calls,
                created_at, updated_at
    `));
        if (inserted.length === 0) {
            res.status(500).json({ error: 'failed to create campaign' });
            return;
        }
        const c = inserted[0];
        res.status(201).json({
            id: c.id,
            name: c.name,
            description: c.description,
            status: c.status,
            maxAttempts: c.max_attempts,
            retryIntervalHours: c.retry_interval_hours,
            orderByMonthlyPaymentDesc: asBooleanCell(c.order_by_monthly_payment_desc),
            skipNextDayAfterSuccess: asBooleanCell(c.skip_next_day_after_success),
            dailyCustomerRefresh: asBooleanCell(c.daily_customer_refresh),
            runWeekdays: String(c.run_weekdays || '').split(',').map((day) => day.trim()).filter(Boolean),
            runWindowStart: c.run_window_start,
            runWindowEnd: c.run_window_end,
            runStartDate: c.run_start_date,
            runEndDate: c.run_end_date,
            baseTemplateId: c.base_template_id,
            agentId: c.agent_id,
            trunkId: c.trunk_id,
            trunkIds: String(c.trunk_ids || '').split(',').map((t) => t.trim()).filter(Boolean),
            totalCustomers: c.total_customers,
            completedCalls: c.completed_calls,
            successfulCalls: c.successful_calls,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
        });
    }
    catch (err) {
        res.status(500).json(buildRouteError(err, 'failed to create campaign'));
    }
});
// PUT update campaign
campaignsRouter.put('/:id', requireRole('admin', 'campaign_manager'), async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
        res.status(400).json({ error: 'invalid campaign id' });
        return;
    }
    const name = req.body?.name !== undefined ? cleanText(req.body.name) : null;
    const description = req.body?.description !== undefined ? cleanText(req.body.description) : null;
    const status = req.body?.status !== undefined ? String(req.body.status) : null;
    const maxAttempts = req.body?.maxAttempts !== undefined ? Math.max(1, Math.min(Number(req.body.maxAttempts), 10)) : null;
    const retryIntervalHours = req.body?.retryIntervalHours !== undefined ? Math.max(1, Math.min(Number(req.body.retryIntervalHours), 24 * 14)) : null;
    const orderByMonthlyPaymentDesc = req.body?.orderByMonthlyPaymentDesc !== undefined
        ? parseBooleanInput(req.body.orderByMonthlyPaymentDesc)
        : null;
    const skipNextDayAfterSuccess = req.body?.skipNextDayAfterSuccess !== undefined
        ? parseBooleanInput(req.body.skipNextDayAfterSuccess)
        : null;
    const dailyCustomerRefresh = req.body?.dailyCustomerRefresh !== undefined
        ? parseBooleanInput(req.body.dailyCustomerRefresh)
        : null;
    const runWeekdays = Array.isArray(req.body?.runWeekdays) ? req.body.runWeekdays.filter(Boolean).slice(0, 7).join(',') : null;
    const runWindowStart = req.body?.runWindowStart !== undefined ? cleanText(req.body.runWindowStart) : null;
    const runWindowEnd = req.body?.runWindowEnd !== undefined ? cleanText(req.body.runWindowEnd) : null;
    const runStartDate = req.body?.runStartDate !== undefined ? cleanText(req.body.runStartDate) : null;
    const runEndDate = req.body?.runEndDate !== undefined ? cleanText(req.body.runEndDate) : null;
    const baseTemplateId = req.body?.baseTemplateId !== undefined ? req.body.baseTemplateId : null;
    const agentId = req.body?.agentId !== undefined ? req.body.agentId : null;
    const trunkId = req.body?.trunkId !== undefined ? req.body.trunkId : null;
    const trunkIds = req.body?.trunkIds !== undefined
        ? (Array.isArray(req.body.trunkIds) ? req.body.trunkIds.filter(Boolean).slice(0, 50).join(',') : null)
        : null;
    if (name === null
        && description === null
        && status === null
        && maxAttempts === null
        && retryIntervalHours === null
        && orderByMonthlyPaymentDesc === null
        && skipNextDayAfterSuccess === null
        && dailyCustomerRefresh === null
        && runWeekdays === null
        && runWindowStart === null
        && runWindowEnd === null
        && runStartDate === null
        && runEndDate === null
        && baseTemplateId === null
        && agentId === null
        && trunkId === null
        && trunkIds === null) {
        res.status(400).json({ error: 'no fields to update' });
        return;
    }
    if (runStartDate && runEndDate && runEndDate < runStartDate) {
        res.status(400).json({ error: 'runEndDate must be on or after runStartDate' });
        return;
    }
    try {
        const updated = rowsFrom(await db.execute(sql `
      UPDATE campaigns
      SET name = coalesce(${name}, name),
          description = coalesce(${description}, description),
          status = coalesce(${status}, status),
          max_attempts = coalesce(${maxAttempts}, max_attempts),
          retry_interval_hours = coalesce(${retryIntervalHours}, retry_interval_hours),
              order_by_monthly_payment_desc = coalesce(${orderByMonthlyPaymentDesc}, order_by_monthly_payment_desc),
              skip_next_day_after_success = coalesce(${skipNextDayAfterSuccess}, skip_next_day_after_success),
              daily_customer_refresh = coalesce(${dailyCustomerRefresh}, daily_customer_refresh),
          run_weekdays = coalesce(${runWeekdays}, run_weekdays),
          run_window_start = coalesce(${runWindowStart}, run_window_start),
          run_window_end = coalesce(${runWindowEnd}, run_window_end),
          run_start_date = coalesce(${runStartDate}::date, run_start_date),
          run_end_date = coalesce(${runEndDate}::date, run_end_date),
          base_template_id = coalesce(${baseTemplateId}::uuid, base_template_id),
          agent_id = coalesce(${agentId}::integer, agent_id),
          trunk_id = coalesce(${trunkId}, trunk_id),
          trunk_ids = coalesce(${trunkIds}, trunk_ids),
          updated_at = now()
      WHERE id = ${campaignId}
      RETURNING id, name, description, status, max_attempts, retry_interval_hours,
                order_by_monthly_payment_desc, skip_next_day_after_success, daily_customer_refresh,
                run_weekdays, run_window_start, run_window_end, run_start_date::text, run_end_date::text,
                base_template_id, agent_id, trunk_id, trunk_ids,
                total_customers, completed_calls, successful_calls,
                created_at, updated_at
    `));
        if (updated.length === 0) {
            res.status(404).json({ error: 'campaign not found' });
            return;
        }
        const c = updated[0];
        res.json({
            id: c.id,
            name: c.name,
            description: c.description,
            status: c.status,
            maxAttempts: c.max_attempts,
            retryIntervalHours: c.retry_interval_hours,
            orderByMonthlyPaymentDesc: asBooleanCell(c.order_by_monthly_payment_desc),
            skipNextDayAfterSuccess: asBooleanCell(c.skip_next_day_after_success),
            dailyCustomerRefresh: asBooleanCell(c.daily_customer_refresh),
            runWeekdays: String(c.run_weekdays || '').split(',').map((day) => day.trim()).filter(Boolean),
            runWindowStart: c.run_window_start,
            runWindowEnd: c.run_window_end,
            runStartDate: c.run_start_date,
            runEndDate: c.run_end_date,
            baseTemplateId: c.base_template_id,
            agentId: c.agent_id,
            trunkId: c.trunk_id,
            trunkIds: String(c.trunk_ids || '').split(',').map((t) => t.trim()).filter(Boolean),
            totalCustomers: c.total_customers,
            completedCalls: c.completed_calls,
            successfulCalls: c.successful_calls,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
        });
    }
    catch (err) {
        res.status(500).json(buildRouteError(err, 'failed to update campaign'));
    }
});
// DELETE campaign
campaignsRouter.delete('/:id', requireRole('admin', 'campaign_manager'), async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
        res.status(400).json({ error: 'invalid campaign id' });
        return;
    }
    try {
        await db.execute(sql `DELETE FROM campaigns WHERE id = ${campaignId}`);
        res.json({ success: true, campaignId });
    }
    catch (err) {
        res.status(500).json(buildRouteError(err, 'failed to delete campaign'));
    }
});
campaignsRouter.post('/:id/import/pks/preview', requireRole('admin', 'campaign_manager'), async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
        res.status(400).json({ error: 'invalid campaign id' });
        return;
    }
    const filters = parseFilters(req.body?.filters);
    const filterMode = parseFilterMode(req.body?.filterMode);
    const groupedFilters = parseGroupedFilters(req.body?.groupedFilters);
    const pageSize = Math.max(1, Math.min(Number(req.body?.pageSize || 100), 20000));
    const sampleSize = Math.max(1, Math.min(Number(req.body?.sampleSize || 20), 100));
    try {
        const result = await queryPksPreviewWithMode(filters, filterMode, groupedFilters, pageSize);
        res.json({
            campaignId,
            filters,
            filterMode,
            groupedFilters,
            totalRows: result.totalRows,
            totalPages: result.totalPages,
            pageSize: result.pageSize,
            queryTimeMs: result.queryTimeMs,
            sample: result.data.slice(0, sampleSize),
        });
    }
    catch (err) {
        res.status(400).json(buildRouteError(err, 'preview failed'));
    }
});
export async function runPksImportPipeline(campaignId, request, onProgress) {
    const { filters, filterMode, groupedFilters, pageSize, maxPages, campaignsTableReady, canAttachToCampaign, campaignSeed } = request;
    if (campaignsTableReady && !(await ensureCampaignExistsOrCreate(campaignId, campaignSeed))) {
        throw new Error('campaign not found');
    }
    let orderByMonthlyPaymentDesc = parseBooleanInput(campaignSeed?.orderByMonthlyPaymentDesc) ?? false;
    let skipNextDayAfterSuccess = parseBooleanInput(campaignSeed?.skipNextDayAfterSuccess) ?? false;
    if (campaignsTableReady) {
        const campaignRows = rowsFrom(await db.execute(sql `
      SELECT order_by_monthly_payment_desc, skip_next_day_after_success
      FROM campaigns
      WHERE id = ${campaignId}
      LIMIT 1
    `));
        if (campaignRows[0]) {
            orderByMonthlyPaymentDesc = asBooleanCell(campaignRows[0].order_by_monthly_payment_desc);
            skipNextDayAfterSuccess = asBooleanCell(campaignRows[0].skip_next_day_after_success);
        }
    }
    let createdCustomers = 0;
    let updatedCustomers = 0;
    let attached = 0;
    let alreadyAttachedRows = 0;
    let skippedBySuccessfulCallYesterday = 0;
    const fetched = await fetchPksRowsForExecute(filters, filterMode, groupedFilters, pageSize, maxPages, (pagesDone, rowsDone) => onProgress?.({ pagesFetched: pagesDone, rowsFetched: rowsDone }));
    const rowsToProcess = [...fetched.rows];
    if (orderByMonthlyPaymentDesc) {
        rowsToProcess.sort((a, b) => decimalNumber(b.odenis_ayliq) - decimalNumber(a.odenis_ayliq));
    }
    const nowIso = new Date().toISOString();
    const allMeta = dedupePksRowBatchMeta(buildPksRowBatchMeta(rowsToProcess));
    // Phase 1 — resolve all existing customers (3 batched queries)
    const existingMap = await batchResolveExistingCustomers(allMeta);
    // Phase 2 — separate into updates and inserts
    const updatesByCustomer = new Map();
    const inserts = [];
    for (const m of allMeta) {
        const existingId = existingMap.get(m.idx);
        if (existingId !== undefined) {
            const prev = updatesByCustomer.get(existingId);
            if (!prev || m.idx > prev.idx)
                updatesByCustomer.set(existingId, m);
        }
        else {
            inserts.push(m);
        }
    }
    // Chunked batch UPDATE
    const updateEntries = [...updatesByCustomer.entries()];
    await batchUpdateCustomers(updateEntries, nowIso);
    updatedCustomers = updateEntries.length;
    onProgress?.({ customersUpdated: updatedCustomers });
    // Chunked batch INSERT
    const insertedIds = await batchInsertCustomers(inserts, nowIso);
    createdCustomers = insertedIds.length;
    onProgress?.({ customersCreated: createdCustomers });
    const imported = createdCustomers + updatedCustomers;
    // Build queue for campaign attachment (preserve original order by idx)
    const customerResults = [];
    for (const [customerId, m] of updateEntries) {
        customerResults.push({
            customerId,
            monthlyPayment: decimalNumber(m.row.odenis_ayliq),
            idx: m.idx,
        });
    }
    // Map inserted IDs to their rows by position (INSERT order matches inserts[] order)
    for (let j = 0; j < inserts.length && j < insertedIds.length; j++) {
        customerResults.push({
            customerId: insertedIds[j],
            monthlyPayment: decimalNumber(inserts[j].row.odenis_ayliq),
            idx: inserts[j].idx,
        });
    }
    customerResults.sort((a, b) => a.idx - b.idx);
    // Phase 3 — batch campaign attachment
    if (canAttachToCampaign) {
        // Build unique customer queue (dedup by customerId)
        const byCustomer = new Map();
        for (const r of customerResults) {
            const prev = byCustomer.get(r.customerId);
            if (orderByMonthlyPaymentDesc
                ? !prev || r.monthlyPayment > prev.monthlyPayment
                : !prev) {
                byCustomer.set(r.customerId, {
                    monthlyPayment: r.monthlyPayment,
                    idx: r.idx,
                });
            }
        }
        let uniqueIds = [...byCustomer.entries()].map(([customerId, v]) => ({
            customerId,
            monthlyPayment: v.monthlyPayment,
        }));
        if (orderByMonthlyPaymentDesc) {
            uniqueIds.sort((a, b) => b.monthlyPayment - a.monthlyPayment);
        }
        else {
            uniqueIds.sort((a, b) => a.customerId - b.customerId);
        }
        const allCustomerIds = uniqueIds.map((u) => u.customerId);
        // Batch check for successful calls yesterday
        let eligibleIds = allCustomerIds;
        if (skipNextDayAfterSuccess) {
            const successSet = await batchHadSuccessfulCallYesterday(allCustomerIds);
            skippedBySuccessfulCallYesterday = allCustomerIds.filter((id) => successSet.has(id)).length;
            eligibleIds = allCustomerIds.filter((id) => !successSet.has(id));
        }
        // Batch attach eligible customers
        attached = await batchAttachToCampaign(campaignId, eligibleIds);
        alreadyAttachedRows = eligibleIds.length - attached;
        onProgress?.({ attachedRows: attached });
    }
    // Persist the filters used for this import so the daily customer-data refresh (see
    // customer-refresh-scheduler.ts) and the "new matches" check can replay the same query.
    if (campaignsTableReady) {
        await db.execute(sql `
      UPDATE campaigns
      SET pks_import_filters = ${JSON.stringify({ filters, filterMode, groupedFilters })}::jsonb,
          updated_at = now()
      WHERE id = ${campaignId}
    `);
    }
    // Update the campaign's total_customers counter
    if (canAttachToCampaign) {
        await db.execute(sql `
      UPDATE campaigns
      SET total_customers = (
        SELECT COUNT(*) FROM campaign_calls WHERE campaign_id = ${campaignId}
      ),
      updated_at = now()
      WHERE id = ${campaignId}
    `);
    }
    return {
        campaignId,
        filters,
        filterMode,
        groupedFilters,
        pageSize,
        importedRows: imported,
        createdCustomers,
        updatedCustomers,
        attachedRows: attached,
        alreadyAttachedRows,
        skippedBySuccessfulCallYesterday,
        pagesProcessed: fetched.pagesProcessed,
        cappedByMaxPages: fetched.cappedByMaxPages,
        campaignTrackingEnabled: canAttachToCampaign,
        orderByMonthlyPaymentDesc,
        skipNextDayAfterSuccess,
    };
}
// ===========================================================================
// POST /:id/import/pks/execute — creates an async job (fire-and-poll)
// ===========================================================================
campaignsRouter.post('/:id/import/pks/execute', requireRole('admin', 'campaign_manager'), async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
        res.status(400).json({ error: 'invalid campaign id' });
        return;
    }
    const campaignsTableReady = await hasTable('campaigns');
    const campaignCallsTableReady = await hasTable('campaign_calls');
    const canAttachToCampaign = campaignsTableReady && campaignCallsTableReady;
    if (campaignsTableReady && !(await ensureCampaignExistsOrCreate(campaignId, req.body?.campaign))) {
        res.status(404).json({ error: 'campaign not found' });
        return;
    }
    const filters = parseFilters(req.body?.filters);
    const filterMode = parseFilterMode(req.body?.filterMode);
    const groupedFilters = parseGroupedFilters(req.body?.groupedFilters);
    const pageSize = Math.max(1, Math.min(Number(req.body?.pageSize || 500), 20000));
    const maxPages = Number.MAX_SAFE_INTEGER;
    const previewConfirmed = req.body?.previewConfirmed === true;
    if (!previewConfirmed) {
        res.status(400).json({ error: 'preview must be confirmed before execute' });
        return;
    }
    try {
        // Guard against duplicate submits: if there's already a queued/running job for
        // this campaign, return the existing jobId so the frontend can resume polling.
        const active = rowsFrom(await db.execute(sql `
      SELECT id FROM pks_import_jobs
      WHERE campaign_id = ${campaignId} AND status IN ('queued', 'running')
      ORDER BY id DESC LIMIT 1
    `));
        if (active[0]) {
            res.status(409).json({ error: 'an import is already in progress for this campaign', jobId: Number(active[0].id) });
            return;
        }
        const createdBy = req.user?.id ?? null;
        const totalPages = Number.isFinite(Number(req.body?.totalPages)) ? Number(req.body.totalPages) : null;
        const jobRequest = {
            filters, filterMode, groupedFilters, pageSize, maxPages,
            campaignsTableReady, canAttachToCampaign,
            campaignSeed: req.body?.campaign ?? null,
        };
        const [job] = rowsFrom(await db.execute(sql `
      INSERT INTO pks_import_jobs (campaign_id, request, total_pages, created_by)
      VALUES (${campaignId}, ${JSON.stringify(jobRequest)}::jsonb, ${totalPages ?? null}, ${createdBy})
      RETURNING id
    `));
        res.status(202).json({ jobId: Number(job.id), campaignId, status: 'queued' });
    }
    catch (err) {
        res.status(400).json(buildRouteError(err, 'import failed'));
    }
});
// ===========================================================================
// GET /:id/import/pks/jobs/:jobId — poll import job status
// ===========================================================================
campaignsRouter.get('/:id/import/pks/jobs/:jobId', requireRole('admin', 'campaign_manager'), async (req, res) => {
    const campaignId = Number(req.params.id);
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(campaignId) || campaignId <= 0 || !Number.isInteger(jobId) || jobId <= 0) {
        res.status(400).json({ error: 'invalid id' });
        return;
    }
    try {
        const rows = rowsFrom(await db.execute(sql `
      SELECT id, campaign_id, status, result, total_pages,
             pages_fetched, rows_fetched, customers_created, customers_updated,
             attached_rows, last_error, created_at, started_at, completed_at
      FROM pks_import_jobs
      WHERE id = ${jobId} AND campaign_id = ${campaignId}
      LIMIT 1
    `));
        const job = rows[0];
        if (!job) {
            res.status(404).json({ error: 'job not found' });
            return;
        }
        res.json({
            jobId: Number(job.id),
            campaignId: Number(job.campaign_id),
            status: job.status,
            totalPages: job.total_pages ? Number(job.total_pages) : null,
            pagesFetched: Number(job.pages_fetched) || 0,
            rowsFetched: Number(job.rows_fetched) || 0,
            customersCreated: Number(job.customers_created) || 0,
            customersUpdated: Number(job.customers_updated) || 0,
            attachedRows: Number(job.attached_rows) || 0,
            lastError: job.last_error ?? null,
            result: job.result ?? null,
            createdAt: job.created_at,
            startedAt: job.started_at ?? null,
            completedAt: job.completed_at ?? null,
        });
    }
    catch (err) {
        res.status(400).json(buildRouteError(err, 'failed to fetch job status'));
    }
});
// One-click import of customers newly matching this campaign's original PKS filters
// (see new_customer_matches_count, computed daily by customer-refresh-scheduler.ts).
// Live-replays the stored filters, then only inserts/attaches rows that don't already
// correspond to a customer attached to this campaign — never touches existing ones.
campaignsRouter.post('/:id/pks/import-new-matches', requireRole('admin', 'campaign_manager'), async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
        res.status(400).json({ error: 'invalid campaign id' });
        return;
    }
    try {
        const campaignRows = rowsFrom(await db.execute(sql `
      SELECT pks_import_filters, order_by_monthly_payment_desc, skip_next_day_after_success
      FROM campaigns
      WHERE id = ${campaignId}
      LIMIT 1
    `));
        const campaignRow = campaignRows[0];
        if (!campaignRow) {
            res.status(404).json({ error: 'campaign not found' });
            return;
        }
        if (!campaignRow.pks_import_filters) {
            res.status(400).json({ error: 'this campaign has no PKS import filters to replay (it was not built from a PKS import)' });
            return;
        }
        const stored = typeof campaignRow.pks_import_filters === 'string'
            ? JSON.parse(campaignRow.pks_import_filters)
            : campaignRow.pks_import_filters;
        const filters = parseFilters(stored?.filters);
        const filterMode = parseFilterMode(stored?.filterMode);
        const groupedFilters = parseGroupedFilters(stored?.groupedFilters);
        const orderByMonthlyPaymentDesc = asBooleanCell(campaignRow.order_by_monthly_payment_desc);
        const skipNextDayAfterSuccess = asBooleanCell(campaignRow.skip_next_day_after_success);
        const fetched = await fetchPksRowsForExecute(filters, filterMode, groupedFilters, 500, Number.MAX_SAFE_INTEGER);
        const rowsToProcess = [...fetched.rows];
        if (orderByMonthlyPaymentDesc) {
            rowsToProcess.sort((a, b) => decimalNumber(b.odenis_ayliq) - decimalNumber(a.odenis_ayliq));
        }
        const nowIso = new Date().toISOString();
        const allMeta = dedupePksRowBatchMeta(buildPksRowBatchMeta(rowsToProcess));
        const existingMap = await batchResolveExistingCustomers(allMeta);
        // "New" = doesn't resolve to a customer already attached to this campaign (any status).
        const existingIds = [...new Set(existingMap.values())];
        const attachment = await campaignAttachmentStatusMap(campaignId, existingIds);
        const newMeta = allMeta.filter((m) => {
            const existingId = existingMap.get(m.idx);
            return existingId === undefined || !attachment.has(existingId);
        });
        if (newMeta.length === 0) {
            await db.execute(sql `
        UPDATE campaigns
        SET new_customer_matches_count = 0, new_customer_matches_checked_at = now(), updated_at = now()
        WHERE id = ${campaignId}
      `);
            res.json({
                campaignId,
                newMatchesFound: 0,
                createdCustomers: 0,
                updatedCustomers: 0,
                attachedRows: 0,
                alreadyAttachedRows: 0,
                skippedBySuccessfulCallYesterday: 0,
                pagesProcessed: fetched.pagesProcessed,
                cappedByMaxPages: fetched.cappedByMaxPages,
            });
            return;
        }
        const updatesByCustomer = new Map();
        const inserts = [];
        for (const m of newMeta) {
            const existingId = existingMap.get(m.idx);
            if (existingId !== undefined) {
                const prev = updatesByCustomer.get(existingId);
                if (!prev || m.idx > prev.idx)
                    updatesByCustomer.set(existingId, m);
            }
            else {
                inserts.push(m);
            }
        }
        const updateEntries = [...updatesByCustomer.entries()];
        await batchUpdateCustomers(updateEntries, nowIso);
        const insertedIds = await batchInsertCustomers(inserts, nowIso);
        const customerResults = [];
        for (const [customerId, m] of updateEntries) {
            customerResults.push({ customerId, monthlyPayment: decimalNumber(m.row.odenis_ayliq), idx: m.idx });
        }
        for (let j = 0; j < inserts.length && j < insertedIds.length; j++) {
            customerResults.push({ customerId: insertedIds[j], monthlyPayment: decimalNumber(inserts[j].row.odenis_ayliq), idx: inserts[j].idx });
        }
        customerResults.sort((a, b) => a.idx - b.idx);
        const byCustomer = new Map();
        for (const r of customerResults) {
            const prev = byCustomer.get(r.customerId);
            if (orderByMonthlyPaymentDesc ? !prev || r.monthlyPayment > prev.monthlyPayment : !prev) {
                byCustomer.set(r.customerId, { monthlyPayment: r.monthlyPayment });
            }
        }
        let uniqueIds = [...byCustomer.entries()].map(([customerId, v]) => ({ customerId, monthlyPayment: v.monthlyPayment }));
        uniqueIds = orderByMonthlyPaymentDesc
            ? uniqueIds.sort((a, b) => b.monthlyPayment - a.monthlyPayment)
            : uniqueIds.sort((a, b) => a.customerId - b.customerId);
        const allCustomerIds = uniqueIds.map((u) => u.customerId);
        let eligibleIds = allCustomerIds;
        let skippedBySuccessfulCallYesterday = 0;
        if (skipNextDayAfterSuccess) {
            const successSet = await batchHadSuccessfulCallYesterday(allCustomerIds);
            skippedBySuccessfulCallYesterday = allCustomerIds.filter((id) => successSet.has(id)).length;
            eligibleIds = allCustomerIds.filter((id) => !successSet.has(id));
        }
        const attached = await batchAttachToCampaign(campaignId, eligibleIds);
        const alreadyAttachedRows = eligibleIds.length - attached;
        await db.execute(sql `
      UPDATE campaigns
      SET total_customers = (SELECT COUNT(*) FROM campaign_calls WHERE campaign_id = ${campaignId}),
          new_customer_matches_count = 0,
          new_customer_matches_checked_at = now(),
          updated_at = now()
      WHERE id = ${campaignId}
    `);
        res.json({
            campaignId,
            newMatchesFound: newMeta.length,
            createdCustomers: insertedIds.length,
            updatedCustomers: updateEntries.length,
            attachedRows: attached,
            alreadyAttachedRows,
            skippedBySuccessfulCallYesterday,
            pagesProcessed: fetched.pagesProcessed,
            cappedByMaxPages: fetched.cappedByMaxPages,
        });
    }
    catch (err) {
        res.status(400).json(buildRouteError(err, 'import of new matches failed'));
    }
});
// POST import existing customers from database
campaignsRouter.post('/:id/import/database', requireRole('admin', 'campaign_manager'), async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
        res.status(400).json({ error: 'invalid campaign id' });
        return;
    }
    const campaignsTableReady = await hasTable('campaigns');
    const campaignCallsTableReady = await hasTable('campaign_calls');
    const canAttachToCampaign = campaignsTableReady && campaignCallsTableReady;
    if (campaignsTableReady && !(await ensureCampaignExistsOrCreate(campaignId, req.body?.campaign))) {
        res.status(404).json({ error: 'campaign not found' });
        return;
    }
    try {
        const customerIds = Array.isArray(req.body?.customerIds)
            ? req.body.customerIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
            : [];
        if (customerIds.length === 0) {
            res.status(400).json({ error: 'no valid customer IDs provided' });
            return;
        }
        // Verify all customers exist by checking database
        let validCustomerIds = [];
        try {
            for (const id of customerIds) {
                const found = rowsFrom(await db.execute(sql `
          SELECT id FROM customers WHERE id = ${id} LIMIT 1
        `));
                if (found.length > 0) {
                    validCustomerIds.push(id);
                }
            }
        }
        catch (queryErr) {
            console.error('Error checking customers:', queryErr);
            res.status(400).json({ error: 'Failed to verify customers in database' });
            return;
        }
        if (validCustomerIds.length === 0) {
            res.status(400).json({ error: 'none of the provided customer IDs exist' });
            return;
        }
        let attached = 0;
        let alreadyAttachedRows = 0;
        if (canAttachToCampaign) {
            for (const customerId of validCustomerIds) {
                const wasAttached = await attachToCampaign(campaignId, customerId);
                if (wasAttached) {
                    attached += 1;
                }
                else {
                    alreadyAttachedRows += 1;
                }
            }
        }
        // Update the campaign's total_customers counter
        if (canAttachToCampaign) {
            await db.execute(sql `
        UPDATE campaigns
        SET total_customers = (
          SELECT COUNT(*) FROM campaign_calls WHERE campaign_id = ${campaignId}
        ),
        updated_at = now()
        WHERE id = ${campaignId}
      `);
        }
        res.json({
            campaignId,
            importedRows: validCustomerIds.length,
            attachedRows: attached,
            alreadyAttachedRows,
            campaignTrackingEnabled: canAttachToCampaign,
        });
    }
    catch (err) {
        res.status(400).json(buildRouteError(err, 'database import failed'));
    }
});
