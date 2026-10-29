import { unlink } from 'node:fs/promises';
import { Router } from 'express';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agents, calls, customers, telephonyJobs } from '../db/schema.js';
import { createRecordingStream, recordingFileInfo, recordingPath } from '../recording.js';
import { requireRole } from '../auth.js';

export const recordingsRouter = Router();

function customerDisplayName(name: string | null, surname: string | null, fatherName: string | null) {
  return [surname, name, fatherName].filter(Boolean).join(' ').trim();
}

function toIso(value: Date | string | null) {
  return value ? new Date(value).toISOString() : null;
}

async function recordingRows() {
  return db
    .select({
      jobId: telephonyJobs.id,
      status: telephonyJobs.status,
      phone: telephonyJobs.phone,
      answeredAt: telephonyJobs.answeredAt,
      completedAt: telephonyJobs.completedAt,
      createdAt: telephonyJobs.createdAt,
      durationSeconds: telephonyJobs.durationSeconds,
      agentId: agents.id,
      agentName: agents.name,
      agentPhone: agents.phoneWhatsapp,
      customerId: customers.id,
      customerName: customers.name,
      customerSurname: customers.surname,
      customerFatherName: customers.fatherName,
      customerPhone: customers.phone,
      summary: calls.summary,
      description: calls.description,
    })
    .from(telephonyJobs)
    .leftJoin(agents, eq(telephonyJobs.agentId, agents.id))
    .leftJoin(customers, eq(telephonyJobs.customerId, customers.id))
    .leftJoin(calls, eq(calls.telephonyJobId, telephonyJobs.id))
    .where(sql`${telephonyJobs.status} in ('answered', 'ended')`)
    .orderBy(desc(telephonyJobs.completedAt), desc(telephonyJobs.answeredAt), desc(telephonyJobs.createdAt))
    .limit(300);
}

recordingsRouter.get('/', async (_req, res) => {
  try {
    const rows = await recordingRows();
    const withFiles = await Promise.all(rows.map(async (row) => {
      const file = await recordingFileInfo(row.jobId);
      if (!file) return null;
      return {
        jobId: row.jobId,
        status: row.status,
        source: {
          agentId: row.agentId,
          name: row.agentName || `Agent ${row.agentId ?? ''}`.trim(),
          number: row.agentPhone || '',
        },
        destination: {
          customerId: row.customerId,
          name: customerDisplayName(row.customerName, row.customerSurname, row.customerFatherName) || `Client ${row.customerId ?? ''}`.trim(),
          number: row.customerPhone || row.phone || '',
        },
        startedAt: toIso(row.answeredAt || row.createdAt),
        endedAt: toIso(row.completedAt),
        durationSeconds: row.durationSeconds,
        summary: row.summary || null,
        description: row.description || null,
        size: file.size,
        recordingUrl: `/api/recordings/${row.jobId}/audio`,
        downloadUrl: `/api/recordings/${row.jobId}/download`,
      };
    }));
    res.json(withFiles.filter(Boolean));
  } catch (err) {
    console.error('Recordings list error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

recordingsRouter.get('/summaries', async (_req, res) => {
  try {
    const rows = await db
      .select({
        jobId: calls.telephonyJobId,
        status: telephonyJobs.status,
        phone: telephonyJobs.phone,
        startedAt: calls.startedAt,
        endedAt: calls.endedAt,
        createdAt: telephonyJobs.createdAt,
        answeredAt: telephonyJobs.answeredAt,
        completedAt: telephonyJobs.completedAt,
        durationSeconds: calls.durationSeconds,
        agentId: agents.id,
        agentName: agents.name,
        agentPhone: agents.phoneWhatsapp,
        customerId: customers.id,
        customerName: customers.name,
        customerSurname: customers.surname,
        customerFatherName: customers.fatherName,
        customerPhone: customers.phone,
        summary: calls.summary,
        description: calls.description,
      })
      .from(calls)
      .leftJoin(telephonyJobs, eq(calls.telephonyJobId, telephonyJobs.id))
      .leftJoin(agents, eq(calls.agentId, agents.id))
      .leftJoin(customers, eq(calls.customerId, customers.id))
      .where(sql`${calls.telephonyJobId} is not null and (coalesce(${calls.summary}, '') <> '' or coalesce(${calls.description}, '') <> '')`)
      .orderBy(desc(calls.startedAt))
      .limit(1000);

    res.json(rows.filter((row) => row.jobId && (row.summary || row.description)).map((row) => ({
      jobId: row.jobId,
      status: row.status || 'unknown',
      source: {
        agentId: row.agentId,
        name: row.agentName || `Agent ${row.agentId ?? ''}`.trim(),
        number: row.agentPhone || '',
      },
      destination: {
        customerId: row.customerId,
        name: customerDisplayName(row.customerName, row.customerSurname, row.customerFatherName) || `Client ${row.customerId ?? ''}`.trim(),
        number: row.customerPhone || row.phone || '',
      },
      startedAt: toIso(row.startedAt || row.answeredAt || row.createdAt),
      endedAt: toIso(row.endedAt || row.completedAt),
      durationSeconds: row.durationSeconds || 0,
      summary: row.summary || null,
      description: row.description || null,
      size: 0,
      recordingUrl: null,
      downloadUrl: null,
    })));
  } catch (err) {
    console.error('Recording summaries error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function streamRecording(req: any, res: any, disposition: 'inline' | 'attachment') {
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    res.status(400).json({ error: 'Invalid job id' });
    return;
  }
  const file = await recordingFileInfo(jobId);
  if (!file) {
    res.status(404).json({ error: 'Recording not found' });
    return;
  }
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Length', String(file.size));
  res.setHeader('Content-Disposition', `${disposition}; filename="call-${jobId}.mp3"`);
  const stream = createRecordingStream(jobId);
  stream.on('error', (err) => {
    console.error('Recording stream error', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    else res.destroy();
  });
  // Client disconnects (e.g. player abort) must not leave the stream writing
  // to a dead socket and crash the process with an unhandled EPIPE.
  res.on('close', () => {
    stream.destroy();
  });
  stream.pipe(res);
}

recordingsRouter.get('/:jobId/audio', (req, res) => {
  streamRecording(req, res, 'inline').catch((err) => {
    console.error('Recording stream error', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  });
});

recordingsRouter.get('/:jobId/download', (req, res) => {
  streamRecording(req, res, 'attachment').catch((err) => {
    console.error('Recording download error', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  });
});

recordingsRouter.delete('/:jobId', requireRole('admin'), async (req, res) => {
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    res.status(400).json({ error: 'Invalid job id' });
    return;
  }
  const file = await recordingFileInfo(jobId);
  if (!file) {
    res.json({ ok: true, deleted: false });
    return;
  }
  try {
    await unlink(recordingPath(jobId));
    res.json({ ok: true, deleted: true });
  } catch (err) {
    console.error('Recording delete error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
