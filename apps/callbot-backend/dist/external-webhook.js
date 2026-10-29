import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { apiClients, customers, externalCallRequests } from './db/schema.js';
// Notifies the external caller (mobile-app backend) that a call it triggered via
// POST /api/external/v1/calls has reached a terminal state. Distinct from the
// internal postWebhook() in ai-tools/index.ts (which posts in-call tool events to a
// single global WEBHOOK_URL) — this is per-api-client, HMAC-signed, and only fires
// for jobs that originated from the external call-trigger API.
export async function notifyExternalCallback(telephonyJobId, status, opts = {}) {
    const [row] = await db
        .select({
        id: externalCallRequests.id,
        callbackUrl: externalCallRequests.callbackUrl,
        clientWebhookSecret: apiClients.webhookSecret,
        clientDefaultWebhookUrl: apiClients.defaultWebhookUrl,
        externalConsumerId: customers.sourceRecordKey,
    })
        .from(externalCallRequests)
        .innerJoin(apiClients, eq(apiClients.id, externalCallRequests.apiClientId))
        .innerJoin(customers, eq(customers.id, externalCallRequests.customerId))
        .where(eq(externalCallRequests.telephonyJobId, telephonyJobId))
        .limit(1);
    if (!row)
        return; // not an externally-triggered call — nothing to notify
    const failureReason = status === 'failed' ? (opts.failureReason ?? 'call_failed').slice(0, 60) : null;
    await db.update(externalCallRequests).set({
        status,
        failureReason,
        updatedAt: new Date(),
    }).where(eq(externalCallRequests.id, row.id));
    const callbackUrl = row.callbackUrl || row.clientDefaultWebhookUrl;
    if (!callbackUrl)
        return;
    const body = JSON.stringify({
        externalConsumerId: row.externalConsumerId,
        callId: telephonyJobId,
        status,
        failureReason,
        durationSeconds: opts.durationSeconds ?? null,
        timestamp: new Date().toISOString(),
    });
    const signature = crypto.createHmac('sha256', row.clientWebhookSecret).update(body).digest('hex');
    try {
        await fetch(callbackUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Robocall-Signature': `sha256=${signature}`,
            },
            body,
        });
    }
    catch (err) {
        console.error(`External callback POST to ${callbackUrl} failed for job ${telephonyJobId}:`, err);
    }
}
