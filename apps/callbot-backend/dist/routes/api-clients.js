import crypto from 'node:crypto';
import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { apiClients } from '../db/schema.js';
import { requireRole } from '../auth.js';
import { generateApiKey, hashApiKey } from '../api-auth.js';
export const apiClientsRouter = Router();
const listFields = {
    id: apiClients.id,
    name: apiClients.name,
    defaultAgentId: apiClients.defaultAgentId,
    defaultWebhookUrl: apiClients.defaultWebhookUrl,
    active: apiClients.active,
    createdAt: apiClients.createdAt,
    lastUsedAt: apiClients.lastUsedAt,
};
// Onboarding a new external integration (e.g. a customer's mobile-app backend) is a
// privileged, security-sensitive action, so this whole router is admin-only.
apiClientsRouter.get('/', requireRole('admin'), async (_req, res) => {
    const rows = await db.select(listFields).from(apiClients).orderBy(apiClients.id);
    res.json(rows);
});
// The raw key is generated here and returned exactly once — only its hash is ever stored.
// If it's lost, the only recovery is revoking this client and creating a new one.
apiClientsRouter.post('/', requireRole('admin'), async (req, res) => {
    const name = String(req.body.name ?? '').trim();
    if (!name) {
        res.status(400).json({ error: 'name required' });
        return;
    }
    const defaultAgentId = Number(req.body.defaultAgentId);
    const defaultWebhookUrl = String(req.body.defaultWebhookUrl ?? '').trim() || null;
    const key = generateApiKey();
    const webhookSecret = crypto.randomBytes(32).toString('hex');
    const [client] = await db.insert(apiClients).values({
        name,
        keyHash: hashApiKey(key),
        webhookSecret,
        defaultAgentId: Number.isInteger(defaultAgentId) && defaultAgentId > 0 ? defaultAgentId : null,
        defaultWebhookUrl,
    }).returning(listFields);
    res.status(201).json({ ...client, apiKey: key, webhookSecret });
});
apiClientsRouter.put('/:id', requireRole('admin'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'invalid id' });
        return;
    }
    const name = String(req.body.name ?? '').trim();
    const defaultAgentId = Number(req.body.defaultAgentId);
    const defaultWebhookUrl = String(req.body.defaultWebhookUrl ?? '').trim() || null;
    const active = req.body.active !== false;
    if (!name) {
        res.status(400).json({ error: 'name required' });
        return;
    }
    const [client] = await db.update(apiClients).set({
        name,
        defaultAgentId: Number.isInteger(defaultAgentId) && defaultAgentId > 0 ? defaultAgentId : null,
        defaultWebhookUrl,
        active,
    }).where(eq(apiClients.id, id)).returning(listFields);
    if (!client) {
        res.status(404).json({ error: 'not found' });
        return;
    }
    res.json(client);
});
// Revoke by deactivating rather than deleting, so external_call_requests audit rows keep a
// valid api_client_id to join against.
apiClientsRouter.delete('/:id', requireRole('admin'), async (req, res) => {
    const id = Number(req.params.id);
    const [client] = await db.update(apiClients).set({ active: false }).where(eq(apiClients.id, id)).returning(listFields);
    if (!client) {
        res.status(404).json({ error: 'not found' });
        return;
    }
    res.json(client);
});
