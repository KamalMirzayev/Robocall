import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { eq, sql } from 'drizzle-orm';
import { customersRouter } from './routes/customers.js';
import { agentsRouter } from './routes/agents.js';
import { callsRouter } from './routes/calls.js';
import { telephonyRouter } from './routes/telephony.js';
import { recordingsRouter } from './routes/recordings.js';
import { campaignsRouter } from './routes/campaigns.js';
import { aiToolsRouter } from './routes/ai-tools.js';
import { instructionTemplatesRouter } from './routes/instruction-templates.js';
import { usageRouter } from './routes/usage.js';
import { handleGeminiProxy } from './proxy/gemini.js';
import { addMonitor } from './monitor.js';
import { db } from './db/index.js';
import { customers, agents, telephonyJobs } from './db/schema.js';
import { authRouter, currentUser, ensureAuthSchema, requireAuth, requireAuthOrWorker } from './auth.js';
import { aiUsageRouter } from './ai-usage.js';
import { startCampaignScheduler } from './campaign-scheduler.js';
import { startPksImportJobProcessor } from './pks-import-jobs.js';
import { apiClientsRouter } from './routes/api-clients.js';
import { externalCallsRouter } from './routes/external-calls.js';
import { dynamicContextCodesRouter } from './routes/dynamic-context-codes.js';
import { requireApiKey } from './api-auth.js';
import { baseTemplateExists } from './templates.js';
import { finalizeFailedJob } from './routes/telephony.js';
// Stopgap: a single socket error (e.g. EPIPE when a client disconnects
// mid-stream) must not take down the whole API. Log and keep serving.
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception (process kept alive)', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection (process kept alive)', reason);
});
await ensureAuthSchema();
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '3mb' }));
app.use('/api/auth', authRouter);
app.use('/api/customers', requireAuth, customersRouter);
app.use('/api/agents', requireAuth, agentsRouter);
app.use('/api/calls', requireAuth, callsRouter);
app.use('/api/campaigns', requireAuth, campaignsRouter);
app.use('/api/telephony', telephonyRouter);
app.use('/api/recordings', requireAuthOrWorker, recordingsRouter);
app.use('/api/ai-usage', requireAuth, aiUsageRouter);
app.use('/api/usage', requireAuth, usageRouter);
app.use('/api/ai-tools', requireAuth, aiToolsRouter);
app.use('/api/instruction-templates', requireAuth, instructionTemplatesRouter);
app.use('/api/api-clients', requireAuth, apiClientsRouter);
app.use('/api/dynamic-context-codes', requireAuth, dynamicContextCodesRouter);
app.use('/api/external/v1', requireApiKey, externalCallsRouter);
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/', (_req, res) => res.json({
    name: 'Callbot Backend API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
        health: '/health',
        auth: '/api/auth/login',
        agents: '/api/agents',
        calls: '/api/calls',
        campaigns: '/api/campaigns',
        customers: '/api/customers',
        recordings: '/api/recordings',
        telephony: '/api/telephony',
        aiUsage: '/api/ai-usage'
    }
}));
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
const monitorWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const target = pathname === '/ws/gemini' ? wss : pathname === '/ws/monitor' ? monitorWss : null;
    if (!target) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
    }
    if (target === monitorWss) {
        currentUser(req).then((user) => {
            if (!user) {
                socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
                socket.destroy();
                return;
            }
            target.handleUpgrade(req, socket, head, (ws) => {
                target.emit('connection', ws, req);
            });
        }).catch(() => {
            socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n');
            socket.destroy();
        });
        return;
    }
    target.handleUpgrade(req, socket, head, (ws) => {
        target.emit('connection', ws, req);
    });
});
wss.on('connection', async (ws, req) => {
    ws.on('error', (err) => {
        console.warn('Gemini client WS error', err?.message);
    });
    const qs = req.url?.split('?')[1] ?? '';
    const params = new URLSearchParams(qs);
    const customerId = Number(params.get('customerId'));
    const agentId = Number(params.get('agentId'));
    const jobId = Number(params.get('jobId')) || null;
    if (!customerId || !agentId) {
        ws.close(1008, 'customerId and agentId required');
        return;
    }
    const [[customer], [agent]] = await Promise.all([
        db.select().from(customers).where(eq(customers.id, customerId)),
        db.select().from(agents).where(eq(agents.id, agentId)),
    ]);
    if (!customer) {
        ws.close(1008, 'customer not found');
        return;
    }
    if (!agent) {
        ws.close(1008, 'agent not found');
        return;
    }
    let baseTemplateId = null;
    let dynamicContext = null;
    // A job with its own base_template_id (set by the external call-trigger API, see
    // routes/external-calls.ts) takes absolute precedence — no falling back to a campaign's or
    // the global active template (schema.ts's telephonyJobs.baseTemplateId comment explains
    // why). GET /jobs/next already checked this before the job could be claimed/dialed; this
    // is the connect-time defense-in-depth recheck for the race window between claim and here.
    const [job] = jobId
        ? await db.select({ baseTemplateId: telephonyJobs.baseTemplateId, dynamicContext: telephonyJobs.dynamicContext })
            .from(telephonyJobs).where(eq(telephonyJobs.id, jobId)).limit(1)
        : [];
    if (job?.baseTemplateId) {
        const resolvable = await baseTemplateExists(job.baseTemplateId);
        if (!resolvable) {
            console.error(`Job ${jobId} references unresolvable base_template_id ${job.baseTemplateId}; refusing to connect`);
            await finalizeFailedJob({ id: jobId }, 'base_template_unavailable').catch((err) => {
                console.error(`Failed to finalize job ${jobId} after template check failure`, err);
            });
            ws.close(1011, 'base template unavailable');
            return;
        }
        baseTemplateId = job.baseTemplateId;
        dynamicContext = job.dynamicContext ?? null;
    }
    else {
        // Look up the campaign linked to this customer+agent to get its base template.
        // campaign_calls records which campaign a customer belongs to; campaigns holds the template ID.
        const campaignRows = await db.execute(sql `
      SELECT c.base_template_id
      FROM campaigns c
      JOIN campaign_calls cc ON cc.campaign_id = c.id
      WHERE cc.customer_id = ${customerId}
        AND c.agent_id = ${agentId}
        AND cc.status = 'attempting'
      ORDER BY cc.updated_at DESC
      LIMIT 1
    `);
        const campaignRow = Array.isArray(campaignRows)
            ? campaignRows[0]
            : campaignRows.rows?.[0];
        baseTemplateId = campaignRow?.base_template_id ?? null;
    }
    handleGeminiProxy(ws, customer, agent, jobId, baseTemplateId, dynamicContext).catch((err) => {
        console.error('Proxy unhandled error', err);
        ws.close();
    });
});
monitorWss.on('connection', (ws, req) => {
    ws.on('error', (err) => {
        console.warn('Monitor client WS error', err?.message);
    });
    const qs = req.url?.split('?')[1] ?? '';
    const params = new URLSearchParams(qs);
    const jobId = Number(params.get('jobId'));
    if (!Number.isInteger(jobId) || jobId <= 0) {
        ws.close(1008, 'jobId required');
        return;
    }
    addMonitor(jobId, ws);
    ws.send(JSON.stringify({ type: 'connected' }));
});
const PORT = process.env.PORT ?? 4000;
server.listen(PORT, () => {
    console.log(`Backend on port ${PORT}`);
    startCampaignScheduler();
    startPksImportJobProcessor();
});
