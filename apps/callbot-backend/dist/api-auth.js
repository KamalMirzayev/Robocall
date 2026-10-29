import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { apiClients } from './db/schema.js';
// Same technique as auth.ts's session tokens: the raw key is only ever shown to the caller
// once at creation time (see routes/api-clients.ts); we store and compare its SHA-256 hash.
function hashApiKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
}
export function generateApiKey() {
    return `rck_${crypto.randomBytes(32).toString('base64url')}`;
}
export { hashApiKey };
function requestApiClient(req) {
    return req.apiClient;
}
// Auth for external server-to-server callers (e.g. a customer's mobile-app backend), distinct
// from both the cookie-based session auth in auth.ts and the single shared
// TELEPHONY_WORKER_TOKEN — each caller gets its own revocable, rate-limitable identity.
export async function requireApiKey(req, res, next) {
    try {
        const header = req.get('authorization') ?? '';
        const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
        if (!key) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        const keyHash = hashApiKey(key);
        const [row] = await db
            .select({
            id: apiClients.id,
            name: apiClients.name,
            defaultAgentId: apiClients.defaultAgentId,
            defaultWebhookUrl: apiClients.defaultWebhookUrl,
            active: apiClients.active,
        })
            .from(apiClients)
            .where(eq(apiClients.keyHash, keyHash))
            .limit(1);
        if (!row || !row.active) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        req.apiClient = {
            id: row.id,
            name: row.name,
            defaultAgentId: row.defaultAgentId,
            defaultWebhookUrl: row.defaultWebhookUrl,
        };
        db.update(apiClients).set({ lastUsedAt: new Date() }).where(eq(apiClients.id, row.id)).catch(() => { });
        next();
    }
    catch (err) {
        console.error('API key auth error', err);
        res.status(500).json({ error: 'internal server error' });
    }
}
export function currentApiClient(req) {
    const client = requestApiClient(req);
    if (!client)
        throw new Error('requireApiKey must run before currentApiClient is used');
    return client;
}
