import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dynamicContextCodes } from '../db/schema.js';
import { requireRole } from '../auth.js';
export const dynamicContextCodesRouter = Router();
const columns = {
    id: dynamicContextCodes.id,
    code: dynamicContextCodes.code,
    phrase: dynamicContextCodes.phrase,
    description: dynamicContextCodes.description,
    active: dynamicContextCodes.active,
    createdAt: dynamicContextCodes.createdAt,
    updatedAt: dynamicContextCodes.updatedAt,
};
// Read is open to any authenticated role (picking a code when building a mobile-app
// integration request is a reasonable thing for non-admins to look up); writes are
// admin-only, matching instruction-templates' content-editing convention.
dynamicContextCodesRouter.get('/', async (_req, res) => {
    const rows = await db.select(columns).from(dynamicContextCodes).orderBy(dynamicContextCodes.code);
    res.json(rows);
});
dynamicContextCodesRouter.post('/', requireRole('admin'), async (req, res) => {
    const code = String(req.body.code ?? '').trim();
    const phrase = String(req.body.phrase ?? '').trim();
    if (!code || !phrase) {
        res.status(400).json({ error: 'code and phrase are required' });
        return;
    }
    const description = String(req.body.description ?? '').trim() || null;
    const active = req.body.active !== false;
    try {
        const [row] = await db.insert(dynamicContextCodes).values({ code, phrase, description, active }).returning(columns);
        res.status(201).json(row);
    }
    catch (err) {
        const pgCode = err?.code || err?.cause?.code;
        if (pgCode === '23505') {
            res.status(409).json({ error: `code "${code}" already exists` });
            return;
        }
        console.error('Create dynamic context code error', err);
        res.status(500).json({ error: 'failed to create code' });
    }
});
dynamicContextCodesRouter.put('/:id', requireRole('admin'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'invalid id' });
        return;
    }
    const code = String(req.body.code ?? '').trim();
    const phrase = String(req.body.phrase ?? '').trim();
    if (!code || !phrase) {
        res.status(400).json({ error: 'code and phrase are required' });
        return;
    }
    const description = String(req.body.description ?? '').trim() || null;
    const active = req.body.active !== false;
    try {
        const [row] = await db.update(dynamicContextCodes)
            .set({ code, phrase, description, active, updatedAt: new Date() })
            .where(eq(dynamicContextCodes.id, id))
            .returning(columns);
        if (!row) {
            res.status(404).json({ error: 'not found' });
            return;
        }
        res.json(row);
    }
    catch (err) {
        const pgCode = err?.code || err?.cause?.code;
        if (pgCode === '23505') {
            res.status(409).json({ error: `code "${code}" already exists` });
            return;
        }
        console.error('Update dynamic context code error', err);
        res.status(500).json({ error: 'failed to update code' });
    }
});
