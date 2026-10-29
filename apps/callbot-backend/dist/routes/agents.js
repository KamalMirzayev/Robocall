import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agents, campaigns, calls, telephonyJobs } from '../db/schema.js';
import { requireRole } from '../auth.js';
export const agentsRouter = Router();
function requestUser(req) {
    return req.user;
}
const agentReturnFields = {
    id: agents.id,
    name: agents.name,
    role: agents.role,
    phoneWhatsapp: agents.phoneWhatsapp,
    companyName: agents.companyName,
    gender: agents.gender,
    tone: agents.tone,
    toneTemplateId: agents.toneTemplateId,
    description: agents.description,
    enabled: agents.enabled,
    createdByUserId: agents.createdByUserId,
};
agentsRouter.get('/', async (req, res) => {
    const user = requestUser(req);
    if (!user) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const rows = await db
        .select({
        ...agentReturnFields,
    })
        .from(agents)
        .orderBy(agents.name);
    res.json(rows);
});
// Agent configuration is AI-engineering work, reserved for admins; everyone authenticated can read
// the shared agent catalog (e.g. to pick one when building a campaign).
agentsRouter.post('/', requireRole('admin'), async (req, res) => {
    const user = requestUser(req);
    if (!user) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const { name, phoneWhatsapp, companyName, gender, tone, toneTemplateId, description, enabled } = req.body;
    if (!name) {
        res.status(400).json({ error: 'name required' });
        return;
    }
    try {
        const [agent] = await db
            .insert(agents)
            .values({
            name,
            phoneWhatsapp: phoneWhatsapp ?? null,
            companyName: companyName ?? null,
            gender: gender ?? null,
            tone: tone ?? null,
            toneTemplateId: toneTemplateId ?? null,
            description: description ?? null,
            enabled: enabled ? 1 : 0,
            createdByUserId: user.id,
        })
            .returning({
            ...agentReturnFields,
        });
        res.status(201).json(agent);
    }
    catch {
        res.status(500).json({ error: 'Agent yaradılmadı' });
    }
});
agentsRouter.put('/:id', requireRole('admin'), async (req, res) => {
    const id = Number(req.params.id);
    const { name, phoneWhatsapp, companyName, gender, tone, toneTemplateId, description, enabled } = req.body;
    if (!name) {
        res.status(400).json({ error: 'name required' });
        return;
    }
    try {
        const [agent] = await db
            .update(agents)
            .set({
            name,
            phoneWhatsapp: phoneWhatsapp ?? null,
            companyName: companyName ?? null,
            gender: gender ?? null,
            tone: tone ?? null,
            toneTemplateId: toneTemplateId ?? null,
            description: description ?? null,
            enabled: enabled ? 1 : 0,
        })
            .where(eq(agents.id, id))
            .returning({
            ...agentReturnFields,
        });
        if (!agent) {
            res.status(404).json({ error: 'Agent tapılmadı' });
            return;
        }
        res.json(agent);
    }
    catch {
        res.status(500).json({ error: 'Agent yenilənmədi' });
    }
});
agentsRouter.delete('/:id', requireRole('admin'), async (req, res) => {
    const id = Number(req.params.id);
    try {
        const agents_list = await db
            .select({ id: agents.id, createdByUserId: agents.createdByUserId, name: agents.name })
            .from(agents)
            .where(eq(agents.id, id))
            .limit(1);
        const agent = agents_list[0];
        if (!agent) {
            res.status(404).json({ error: 'Agent not found' });
            return;
        }
        // Check for related records in other tables
        const relatedCampaigns = await db
            .select({ id: campaigns.id })
            .from(campaigns)
            .where(eq(campaigns.agentId, id))
            .limit(1);
        const relatedCalls = await db
            .select({ id: calls.id })
            .from(calls)
            .where(eq(calls.agentId, id))
            .limit(1);
        const relatedJobs = await db
            .select({ id: telephonyJobs.id })
            .from(telephonyJobs)
            .where(eq(telephonyJobs.agentId, id))
            .limit(1);
        if (relatedCampaigns.length > 0) {
            res.status(400).json({ error: `Cannot delete agent "${agent.name}" - it has active campaigns` });
            return;
        }
        if (relatedCalls.length > 0) {
            res.status(400).json({ error: `Cannot delete agent "${agent.name}" - it has call history` });
            return;
        }
        if (relatedJobs.length > 0) {
            res.status(400).json({ error: `Cannot delete agent "${agent.name}" - it has active or pending telephony jobs` });
            return;
        }
        await db.delete(agents).where(eq(agents.id, id));
        res.status(204).send();
    }
    catch (err) {
        console.error('Failed to delete agent:', err);
        res.status(500).json({ error: 'Failed to delete agent' });
    }
});
