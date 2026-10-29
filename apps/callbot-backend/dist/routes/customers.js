import { Router } from 'express';
import { requireRole } from '../auth.js';
import { db } from '../db/index.js';
import { customers } from '../db/schema.js';
import { desc, eq, ilike, or, sql } from 'drizzle-orm';
export const customersRouter = Router();
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
function rowsFrom(result) {
    if (Array.isArray(result))
        return result;
    const maybeRows = result.rows;
    return Array.isArray(maybeRows) ? maybeRows : [];
}
function uniqueStrings(values) {
    if (!Array.isArray(values))
        return [];
    const seen = new Set();
    for (const item of values) {
        const next = cleanText(item);
        if (!next)
            continue;
        seen.add(next);
    }
    return Array.from(seen);
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
async function deleteCustomerGraph(customerIds) {
    if (customerIds.length === 0) {
        return {
            deletedCampaignCalls: 0,
            deletedAiTokenUsage: 0,
            deletedCalls: 0,
            deletedTelephonyJobs: 0,
            deletedCustomers: 0,
        };
    }
    const idsSql = sql.join(customerIds.map((id) => sql `${id}`), sql `, `);
    const [campaignCallsTableReady, callsTableReady, telephonyJobsTableReady, aiTokenUsageTableReady] = await Promise.all([
        hasTable('campaign_calls'),
        hasTable('calls'),
        hasTable('telephony_jobs'),
        hasTable('ai_token_usage'),
    ]);
    let deletedCampaignCalls = 0;
    if (campaignCallsTableReady) {
        const removed = rowsFrom(await db.execute(sql `
      DELETE FROM campaign_calls
      WHERE customer_id IN (${idsSql})
      RETURNING id
    `));
        deletedCampaignCalls = removed.length;
    }
    let deletedCalls = 0;
    let deletedAiTokenUsage = 0;
    if (callsTableReady) {
        if (aiTokenUsageTableReady) {
            const removedUsage = rowsFrom(await db.execute(sql `
        DELETE FROM ai_token_usage atu
        WHERE atu.call_id IN (
          SELECT c.id FROM calls c WHERE c.customer_id IN (${idsSql})
        )
        RETURNING id
      `));
            deletedAiTokenUsage = removedUsage.length;
        }
        const removed = rowsFrom(await db.execute(sql `
      DELETE FROM calls
      WHERE customer_id IN (${idsSql})
      RETURNING id
    `));
        deletedCalls = removed.length;
    }
    let deletedTelephonyJobs = 0;
    if (telephonyJobsTableReady) {
        const removed = rowsFrom(await db.execute(sql `
      DELETE FROM telephony_jobs
      WHERE customer_id IN (${idsSql})
      RETURNING id
    `));
        deletedTelephonyJobs = removed.length;
    }
    const removedCustomers = rowsFrom(await db.execute(sql `
    DELETE FROM customers
    WHERE id IN (${idsSql})
    RETURNING id
  `));
    return {
        deletedCampaignCalls,
        deletedAiTokenUsage,
        deletedCalls,
        deletedTelephonyJobs,
        deletedCustomers: removedCustomers.length,
    };
}
function customerPayload(body) {
    return {
        name: cleanText(body.name),
        surname: cleanText(body.surname),
        fatherName: cleanText(body.fatherName),
        debtAmount: cleanDecimal(body.debtAmount) ?? cleanDecimal(body.debt_amount) ?? '0.00',
        overdueDays: cleanInt(body.overdueDays) ?? cleanInt(body.overdue_days) ?? 0,
        daysDue: cleanInt(body.daysDue) ?? cleanInt(body.days_due) ?? 0,
        phone: cleanText(body.phone),
        organization: cleanText(body.organization),
        contractNo: cleanText(body.contractNo) ?? cleanText(body.contract_no),
        sourceFullName: cleanText(body.sourceFullName) ?? cleanText(body.source_full_name),
        fin: cleanText(body.fin),
        monthlyPayment: cleanDecimal(body.monthlyPayment) ?? cleanDecimal(body.monthly_payment),
        employeeCode: cleanText(body.employeeCode) ?? cleanText(body.employee_code),
        reference: cleanText(body.reference),
        branch: cleanText(body.branch),
        category: cleanText(body.category),
        pksStatus: cleanText(body.pksStatus) ?? cleanText(body.pks_status),
        pksComment: cleanText(body.pksComment) ?? cleanText(body.pks_comment),
        commentTemplateName: cleanText(body.commentTemplateName) ?? cleanText(body.comment_template_name),
        pksStatusCategory: cleanText(body.pksStatusCategory) ?? cleanText(body.pks_status_category),
        activeContractCount: cleanInt(body.activeContractCount) ?? cleanInt(body.active_contract_count),
        last3PaymentDates: cleanText(body.last3PaymentDates) ?? cleanText(body.last_3_payment_dates),
        last3PaymentAmounts: cleanText(body.last3PaymentAmounts) ?? cleanText(body.last_3_payment_amounts),
        totalPaidLast90Days: cleanDecimal(body.totalPaidLast90Days) ?? cleanDecimal(body.total_paid_last_90_days),
        keptPromiseCount90d: cleanInt(body.keptPromiseCount90d) ?? cleanInt(body.kept_promise_count_90d),
        brokenPromiseCount90d: cleanInt(body.brokenPromiseCount90d) ?? cleanInt(body.broken_promise_count_90d),
        collectorOrganization: cleanText(body.collectorOrganization) ?? cleanText(body.collector_organization),
        sourceOrganization: cleanText(body.sourceOrganization) ?? cleanText(body.source_organization),
        lastPaymentDate: cleanText(body.lastPaymentDate) ?? cleanText(body.last_payment_date),
        lastPaymentAmount: cleanDecimal(body.lastPaymentAmount) ?? cleanDecimal(body.last_payment_amount),
        mobilePhone: cleanText(body.mobilePhone) ?? cleanText(body.mobile_phone),
        sourceSystem: cleanText(body.sourceSystem) ?? cleanText(body.source_system),
        sourceRecordKey: cleanText(body.sourceRecordKey) ?? cleanText(body.source_record_key),
        sourcePayloadHash: cleanText(body.sourcePayloadHash) ?? cleanText(body.source_payload_hash),
    };
}
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;
function searchCondition(search) {
    const q = search.trim();
    if (!q)
        return undefined;
    const like = `%${q}%`;
    const conditions = [
        ilike(customers.name, like),
        ilike(customers.surname, like),
        ilike(customers.sourceFullName, like),
        ilike(customers.phone, like),
        ilike(customers.mobilePhone, like),
        ilike(customers.contractNo, like),
        ilike(customers.fin, like),
    ];
    // Phone columns are stored in mixed formats (e.g. +994502003993 vs 0502003993 vs
    // 502003993), so a plain ILIKE substring match misses a query typed in a different format
    // than what's stored (same normalization approach as telephony.ts's /resolve endpoint). A
    // local number's leading trunk "0" has no counterpart in the E.164 form, so "0502003993"
    // is never literally a substring of "994502003993" — strip it (and any "994" country-code
    // prefix) before matching, so it works however the user typed it, including mid-typing.
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 3) {
        const variants = new Set([digits]);
        if (digits.startsWith('0'))
            variants.add(digits.slice(1));
        if (digits.startsWith('994'))
            variants.add(digits.slice(3));
        for (const variant of variants) {
            const digitsLike = `%${variant}%`;
            conditions.push(sql `regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g') LIKE ${digitsLike}`);
            conditions.push(sql `regexp_replace(coalesce(${customers.mobilePhone}, ''), '[^0-9]', '', 'g') LIKE ${digitsLike}`);
        }
    }
    return or(...conditions);
}
// Backward compatible: with no page/pageSize query params this still returns the full
// unpaginated array, as before, for existing callers (statistics aggregation,
// campaigns/page.tsx) that need the whole list. Pass page/pageSize to get a
// { data, total, page, pageSize } page instead — used by the customers list page (which was
// rendering all ~33k rows unpaginated) and CustomerSearchSelect's async search (which passes
// `search` too, so InitiateCallForm's dropdown doesn't need to fetch everyone either).
customersRouter.get('/', async (req, res) => {
    const search = String(req.query.search ?? '');
    const where = searchCondition(search);
    const hasPaging = req.query.page != null || req.query.pageSize != null;
    if (!hasPaging && !where) {
        const all = await db.select().from(customers).orderBy(desc(customers.createdAt));
        res.json(all);
        return;
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || DEFAULT_PAGE_SIZE));
    const baseQuery = db.select().from(customers).orderBy(desc(customers.createdAt));
    const countQuery = db.select({ count: sql `count(*)::int` }).from(customers);
    const [rows, [{ count }]] = await Promise.all([
        (where ? baseQuery.where(where) : baseQuery).limit(pageSize).offset((page - 1) * pageSize),
        where ? countQuery.where(where) : countQuery,
    ]);
    res.json({ data: rows, total: count, page, pageSize });
});
customersRouter.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid id' });
        return;
    }
    const [customer] = await db.select().from(customers).where(eq(customers.id, id));
    if (!customer) {
        res.status(404).json({ error: 'Customer not found' });
        return;
    }
    res.json(customer);
});
customersRouter.post('/', requireRole('admin', 'campaign_manager'), async (req, res) => {
    const payload = customerPayload(req.body || {});
    const { name, surname } = payload;
    if (!name || !surname) {
        res.status(400).json({ error: 'name and surname required' });
        return;
    }
    const [customer] = await db
        .insert(customers)
        .values({
        ...payload,
        name,
        surname,
    })
        .returning();
    res.status(201).json(customer);
});
customersRouter.post('/delete/batch', requireRole('admin', 'campaign_manager'), async (req, res) => {
    try {
        const importedDaysRaw = req.body?.importedDays;
        const importedDays = importedDaysRaw == null || importedDaysRaw === ''
            ? null
            : Number(importedDaysRaw);
        if (importedDays != null && (!Number.isInteger(importedDays) || importedDays <= 0 || importedDays > 3650)) {
            res.status(400).json({ error: 'importedDays must be a positive integer between 1 and 3650' });
            return;
        }
        const organizations = uniqueStrings(req.body?.organizations);
        const campaignIdRaw = req.body?.campaignId;
        const campaignId = campaignIdRaw == null || campaignIdRaw === '' ? null : Number(campaignIdRaw);
        if (campaignId != null && (!Number.isInteger(campaignId) || campaignId <= 0)) {
            res.status(400).json({ error: 'campaignId must be a positive integer' });
            return;
        }
        if (importedDays == null && organizations.length === 0 && campaignId == null) {
            res.status(400).json({ error: 'at least one filter is required (importedDays, organizations, or campaignId)' });
            return;
        }
        const conditions = [];
        if (importedDays != null) {
            conditions.push(sql `coalesce(c.imported_at, c.created_at) >= now() - (${importedDays} * interval '1 day')`);
        }
        if (organizations.length > 0) {
            conditions.push(sql `c.organization IN (${sql.join(organizations.map((org) => sql `${org}`), sql `, `)})`);
        }
        const campaignCallsTableReady = await hasTable('campaign_calls');
        if (campaignId != null) {
            if (!campaignCallsTableReady) {
                res.status(400).json({ error: 'campaign filter unavailable: campaign_calls table not found' });
                return;
            }
            conditions.push(sql `EXISTS (
        SELECT 1 FROM campaign_calls cc
        WHERE cc.customer_id = c.id AND cc.campaign_id = ${campaignId}
      )`);
        }
        const whereClause = sql.join(conditions, sql ` AND `);
        const matchedRows = rowsFrom(await db.execute(sql `
      SELECT c.id
      FROM customers c
      WHERE ${whereClause}
    `));
        const ids = matchedRows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
        if (ids.length === 0) {
            res.json({
                matchedCount: 0,
                deletedCustomers: 0,
                deletedCampaignCalls: 0,
                deletedAiTokenUsage: 0,
                deletedCalls: 0,
                deletedTelephonyJobs: 0,
            });
            return;
        }
        const deletion = await deleteCustomerGraph(ids);
        res.json({
            matchedCount: ids.length,
            deletedCustomers: deletion.deletedCustomers,
            deletedCampaignCalls: deletion.deletedCampaignCalls,
            deletedAiTokenUsage: deletion.deletedAiTokenUsage,
            deletedCalls: deletion.deletedCalls,
            deletedTelephonyJobs: deletion.deletedTelephonyJobs,
            filters: {
                importedDays,
                organizations,
                campaignId,
            },
        });
    }
    catch (error) {
        console.error('Batch customer delete failed', error);
        res.status(500).json({ error: 'Batch customer delete failed' });
    }
});
customersRouter.put('/:id', requireRole('admin', 'campaign_manager'), async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid id' });
        return;
    }
    const payload = customerPayload(req.body || {});
    const { name, surname } = payload;
    if (!name || !surname) {
        res.status(400).json({ error: 'name and surname required' });
        return;
    }
    const [customer] = await db
        .update(customers)
        .set({
        ...payload,
        name,
        surname,
    })
        .where(eq(customers.id, id))
        .returning();
    if (!customer) {
        res.status(404).json({ error: 'Customer not found' });
        return;
    }
    res.json(customer);
});
customersRouter.delete('/:id', requireRole('admin', 'campaign_manager'), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            res.status(400).json({ error: 'Invalid id' });
            return;
        }
        const deletion = await deleteCustomerGraph([id]);
        if (deletion.deletedCustomers === 0) {
            res.status(404).json({ error: 'Customer not found' });
            return;
        }
        res.json({
            deletedCustomers: deletion.deletedCustomers,
            deletedCampaignCalls: deletion.deletedCampaignCalls,
            deletedAiTokenUsage: deletion.deletedAiTokenUsage,
            deletedCalls: deletion.deletedCalls,
            deletedTelephonyJobs: deletion.deletedTelephonyJobs,
        });
    }
    catch (error) {
        console.error('Single customer delete failed', error);
        res.status(500).json({ error: 'Single customer delete failed' });
    }
});
