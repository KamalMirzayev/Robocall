import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { TEMPLATE_VARIABLES } from '../template-variables.js';
import { clearTemplateCache } from '../templates.js';
import { requireRole } from '../auth.js';
function rowsFrom(result) {
    if (Array.isArray(result))
        return result;
    const maybeRows = result.rows;
    return Array.isArray(maybeRows) ? maybeRows : [];
}
function optionalText(value) {
    const text = String(value ?? '').trim();
    return text ? text : null;
}
function pgErrorCode(err) {
    const e = err;
    return e?.code || e?.cause?.code;
}
export const instructionTemplatesRouter = Router();
// GET /api/instruction-templates/variables
// Returns list of available template variables
instructionTemplatesRouter.get('/variables', (req, res) => {
    res.json(TEMPLATE_VARIABLES);
});
// GET /api/instruction-templates?tenant_id=&q=&limit=
instructionTemplatesRouter.get('/', async (req, res) => {
    try {
        const tenantId = String(req.query.tenant_id || '').trim();
        const q = String(req.query.q || '').trim();
        let limit = Number(req.query.limit);
        if (!Number.isFinite(limit) || limit < 1)
            limit = 200;
        limit = Math.min(Math.floor(limit), 500);
        const conditions = [];
        if (tenantId)
            conditions.push(sql `tenant_id = ${tenantId}`);
        if (q) {
            const like = `%${q}%`;
            conditions.push(sql `(name ILIKE ${like} OR description ILIKE ${like} OR content ILIKE ${like})`);
        }
        const where = conditions.length ? sql ` WHERE ${sql.join(conditions, sql ` AND `)}` : sql ``;
        const rows = rowsFrom(await db.execute(sql `
      SELECT id, tenant_id, version, name, description, content, template_type, is_active,
             created_at, updated_at, created_by, customer_category, external_key
      FROM instruction_templates
      ${where}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ${limit}
    `));
        res.json(rows);
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'failed to fetch instruction templates' });
    }
});
// POST /api/instruction-templates
// Editing AI prompt content is admin-only; GETs above stay open so campaign_manager/viewer
// can browse templates (e.g. picking a base template when building a campaign).
instructionTemplatesRouter.post('/', requireRole('admin'), async (req, res) => {
    try {
        const body = req.body || {};
        const name = String(body.name || '').trim();
        const content = String(body.content || '').trim();
        if (!name || !content) {
            res.status(400).json({ error: 'name and content are required' });
            return;
        }
        const tenantId = String(body.tenant_id || '').trim() || 'default';
        const version = String(body.version || '').trim() || 'v1.0';
        const description = optionalText(body.description);
        const isActive = body.is_active === true || body.is_active === 'true';
        const customerCategory = optionalText(body.customer_category);
        const createdBy = optionalText(body.created_by);
        const templateType = String(body.template_type || '').trim() || 'base';
        const externalKey = optionalText(body.external_key);
        // Validate template_type
        if (!['base', 'tone', 'system'].includes(templateType)) {
            res.status(400).json({ error: 'template_type must be one of: base, tone, system' });
            return;
        }
        const inserted = await db.transaction(async (tx) => {
            // Templates addressed by external_key (used by the mobile-app call-trigger API,
            // routes/external-calls.ts) are individually selected by key, not by "the one active
            // row of this type" — many can be active at once, so they're exempt from the
            // single-active-per-type rule below.
            if (isActive && !externalKey) {
                await tx.execute(sql `
          UPDATE instruction_templates SET is_active = false, updated_at = now()
          WHERE template_type = ${templateType} AND is_active = true AND external_key IS NULL
        `);
            }
            return rowsFrom(await tx.execute(sql `
        INSERT INTO instruction_templates
          (tenant_id, version, name, description, content, template_type, is_active, created_by, customer_category, external_key, updated_at)
        VALUES (${tenantId}, ${version}, ${name}, ${description}, ${content}, ${templateType}, ${isActive}, ${createdBy}, ${customerCategory}, ${externalKey}, now())
        RETURNING id, tenant_id, version, name, description, content, template_type, is_active,
                  created_at, updated_at, created_by, customer_category, external_key
      `));
        });
        clearTemplateCache();
        res.status(201).json(inserted[0]);
    }
    catch (err) {
        if (pgErrorCode(err) === '23505') {
            res.status(409).json({ error: 'Template already exists for this tenant/category' });
            return;
        }
        res.status(500).json({ error: err?.message || 'failed to create instruction template' });
    }
});
// PUT /api/instruction-templates/:id
instructionTemplatesRouter.put('/:id', requireRole('admin'), async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        if (!id) {
            res.status(400).json({ error: 'id is required' });
            return;
        }
        const body = req.body || {};
        const name = String(body.name || '').trim();
        const content = String(body.content || '').trim();
        if (!name || !content) {
            res.status(400).json({ error: 'name and content are required' });
            return;
        }
        const description = optionalText(body.description);
        const isActive = body.is_active === true || body.is_active === 'true';
        const customerCategory = optionalText(body.customer_category);
        const version = optionalText(body.version);
        const templateType = optionalText(body.template_type) || 'base';
        const externalKey = optionalText(body.external_key);
        // Validate template_type
        if (!['base', 'tone', 'system'].includes(templateType)) {
            res.status(400).json({ error: 'template_type must be one of: base, tone, system' });
            return;
        }
        const updated = await db.transaction(async (tx) => {
            // See the matching comment in POST '/' above: externally-keyed templates are exempt
            // from the single-active-per-type rule.
            if (isActive && !externalKey) {
                await tx.execute(sql `
          UPDATE instruction_templates SET is_active = false, updated_at = now()
          WHERE template_type = ${templateType} AND is_active = true AND external_key IS NULL AND id != ${id}
        `);
            }
            return rowsFrom(await tx.execute(sql `
        UPDATE instruction_templates
        SET name = ${name},
            description = ${description},
            content = ${content},
            template_type = ${templateType},
            is_active = ${isActive},
            customer_category = ${customerCategory},
            version = ${version},
            external_key = ${externalKey},
            updated_at = now()
        WHERE id = ${id}
        RETURNING id, tenant_id, version, name, description, content, template_type, is_active,
                  created_at, updated_at, created_by, customer_category, external_key
      `));
        });
        if (updated.length === 0) {
            res.status(404).json({ error: 'Template not found' });
            return;
        }
        clearTemplateCache();
        res.json(updated[0]);
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'failed to update instruction template' });
    }
});
