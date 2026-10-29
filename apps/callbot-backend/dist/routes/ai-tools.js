import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agents, customers } from '../db/schema.js';
import { executeAiTool, isAiToolName } from '../ai-tools/index.js';
export const aiToolsRouter = Router();
function requestUser(req) {
    return req.user;
}
function requireAdmin(req, res) {
    const user = requestUser(req);
    if (!user) {
        res.status(401).json({ error: 'unauthorized' });
        return null;
    }
    if (user.role !== 'admin') {
        res.status(403).json({ error: 'admin required' });
        return null;
    }
    return user;
}
function defaultArgs(toolName, customerPhone) {
    if (toolName === 'request_callback') {
        return {
            agent_type: 'collection_agent',
            preferred_time: 'today evening',
            reason: 'customer requested callback',
            customer_notes: 'test simulation',
        };
    }
    if (toolName === 'send_whatsapp_msg') {
        return {
            template: 'all_debts_summary',
            phone: customerPhone || '0502003993',
        };
    }
    if (toolName === 'search_knowledge_base') {
        return {
            query: 'Kreditverənin hüququ nədir?',
            limit: 3,
        };
    }
    return {
        category: 'Ödənişə söz verib',
        note: 'Test qeydi: bu gün 50 manat ödəyəcəyini bildirdi',
        customer_id: customerPhone || '0502003993',
    };
}
aiToolsRouter.get('/test/samples', (_req, res) => {
    res.json({
        request_callback: defaultArgs('request_callback', null),
        send_whatsapp_msg: defaultArgs('send_whatsapp_msg', '0502003993'),
        search_knowledge_base: defaultArgs('search_knowledge_base', null),
        update_status: defaultArgs('update_status', '0502003993'),
    });
});
aiToolsRouter.post('/test', async (req, res) => {
    const user = requireAdmin(req, res);
    if (!user)
        return;
    const toolNameRaw = String(req.body.toolName || '').trim();
    if (!isAiToolName(toolNameRaw)) {
        res.status(400).json({
            error: 'Invalid toolName',
            allowed: ['request_callback', 'send_whatsapp_msg', 'search_knowledge_base', 'update_status'],
        });
        return;
    }
    const customerId = Number(req.body.customerId || 0);
    const agentId = Number(req.body.agentId || 0);
    const telephonyJobId = Number(req.body.telephonyJobId || 0) || null;
    const dryRun = req.body.dryRun !== false;
    const [customer] = customerId > 0
        ? await db.select().from(customers).where(eq(customers.id, customerId)).limit(1)
        : await db.select().from(customers).limit(1);
    const [agent] = agentId > 0
        ? await db.select().from(agents).where(eq(agents.id, agentId)).limit(1)
        : await db.select().from(agents).limit(1);
    if (!customer || !agent) {
        res.status(400).json({ error: 'Cannot load sample customer/agent. Please create at least one customer and one agent.' });
        return;
    }
    const args = req.body.args && typeof req.body.args === 'object'
        ? req.body.args
        : defaultArgs(toolNameRaw, customer.phone);
    try {
        const output = await executeAiTool(toolNameRaw, args, {
            customer: {
                id: customer.id,
                name: customer.name,
                surname: customer.surname,
                phone: customer.phone,
            },
            agent: {
                id: agent.id,
                name: agent.name,
                companyName: agent.companyName,
                phoneWhatsapp: agent.phoneWhatsapp,
            },
            telephonyJobId,
            dryRun,
        });
        res.json({
            ok: true,
            toolName: toolNameRaw,
            dryRun,
            args,
            context: {
                customerId: customer.id,
                agentId: agent.id,
                telephonyJobId,
            },
            output,
        });
    }
    catch (error) {
        res.status(500).json({
            ok: false,
            toolName: toolNameRaw,
            dryRun,
            error: error instanceof Error ? error.message : 'Tool execution failed',
        });
    }
});
