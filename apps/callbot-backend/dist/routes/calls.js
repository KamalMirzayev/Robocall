import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { calls, agents, customers } from '../db/schema.js';
export const callsRouter = Router();
function rowsFrom(result) {
    if (Array.isArray(result))
        return result;
    const maybeRows = result.rows;
    return Array.isArray(maybeRows) ? maybeRows : [];
}
// Upper bound raised from 100 to 1000: the calls/page.tsx Intentions tab needs the full
// table to group by customer (see getCalls() on the frontend, which pages through
// everything) — at 100/page that's dozens of sequential requests; at 1000 it's a handful.
function pageParams(query) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.max(5, Math.min(1000, Number(query.pageSize || 10)));
    const offset = (page - 1) * pageSize;
    const q = String(query.q || '').trim();
    const agentId = Number(query.agentId || 0) || null;
    const customerId = Number(query.customerId || 0) || null;
    return { page, pageSize, offset, q, agentId, customerId };
}
callsRouter.get('/', async (req, res) => {
    try {
        const { page, pageSize, offset, q, agentId, customerId } = pageParams(req.query);
        const like = `%${q}%`;
        const filters = [];
        if (q)
            filters.push(sql `concat_ws(' ', c.name, c.surname, c.phone, a.name, ca.summary, ca.description) ILIKE ${like}`);
        if (agentId)
            filters.push(sql `ca.agent_id = ${agentId}`);
        if (customerId)
            filters.push(sql `ca.customer_id = ${customerId}`);
        const where = filters.length > 0
            ? sql `WHERE ${sql.join(filters, sql ` AND `)}`
            : sql ``;
        const [countRow] = rowsFrom(await db.execute(sql `
      SELECT count(*)::int AS total
      FROM calls ca
      LEFT JOIN agents a ON ca.agent_id = a.id
      LEFT JOIN customers c ON ca.customer_id = c.id
      ${where}
    `));
        const rows = rowsFrom(await db.execute(sql `
      SELECT ca.id, ca.agent_id AS "agentId", a.name AS "agentName", ca.customer_id AS "customerId",
             c.name AS "customerName", c.surname AS "customerSurname", c.fin AS "customerFin",
             c.contract_no AS "customerContractNo", c.mobile_phone AS "customerMobilePhone",
             ca.started_at AS "startedAt",
             ca.ended_at AS "endedAt", ca.duration_seconds AS "durationSeconds", ca.summary,
             ca.description
      FROM calls ca
      LEFT JOIN agents a ON ca.agent_id = a.id
      LEFT JOIN customers c ON ca.customer_id = c.id
      ${where}
      ORDER BY ca.started_at DESC, ca.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `));
        res.json({ items: rows, total: Number(countRow?.total || 0), page, pageSize });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// One-query aggregate for the statistics page, which previously fetched every call (via
// the frontend paging through the full list) just to compute these three counts. 'active'
// mirrors the same ended_at-based definition getCalls() already derives client-side
// (no ended_at yet = still in progress). Registered before GET /:id so 'stats' doesn't get
// parsed as an id.
callsRouter.get('/stats', async (_req, res) => {
    try {
        const [row] = rowsFrom(await db.execute(sql `
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE ended_at IS NULL)::int AS active,
             count(*) FILTER (WHERE ended_at IS NOT NULL)::int AS completed
      FROM calls
    `));
        res.json({
            total: Number(row?.total || 0),
            active: Number(row?.active || 0),
            completed: Number(row?.completed || 0),
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
callsRouter.get('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!id) {
        res.status(400).json({ error: 'Invalid id' });
        return;
    }
    try {
        const [row] = await db
            .select({
            id: calls.id,
            agentId: calls.agentId,
            agentName: agents.name,
            customerId: calls.customerId,
            customerName: customers.name,
            customerSurname: customers.surname,
            startedAt: calls.startedAt,
            endedAt: calls.endedAt,
            durationSeconds: calls.durationSeconds,
            transcript: calls.transcript,
            summary: calls.summary,
            description: calls.description,
            descriptionUpdatedAt: calls.descriptionUpdatedAt,
        })
            .from(calls)
            .leftJoin(agents, eq(calls.agentId, agents.id))
            .leftJoin(customers, eq(calls.customerId, customers.id))
            .where(eq(calls.id, id));
        if (!row) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json(row);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
