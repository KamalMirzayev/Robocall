import { Router, type Request } from 'express';
import { requireRole, type AppUser } from '../auth.js';
import { describeSettings, isSettingKey, saveSetting, validateSetting } from '../settings.js';
import { partnerKbStatus, refreshPartnerKb } from '../partner-kb.js';
import { arzoomStatus, resetArzoomCursor, syncArzoom } from '../arzoom-sync.js';

export const settingsRouter = Router();

settingsRouter.use(requireRole('admin'));

settingsRouter.get('/', async (_req, res) => {
  res.json({ settings: describeSettings(), knowledgeBase: partnerKbStatus(), arzoom: await arzoomStatus() });
});

settingsRouter.put('/:key', async (req, res) => {
  const key = String(req.params.key || '');
  if (!isSettingKey(key)) {
    res.status(404).json({ error: 'unknown setting' });
    return;
  }
  const value = String(req.body?.value ?? '').trim();
  const invalid = validateSetting(key, value);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  try {
    const user = (req as Request & { user?: AppUser }).user;
    await saveSetting(key, value, user?.username ?? null);
    if (key.startsWith('PARTNER_KB_')) await refreshPartnerKb();
    if (key === 'ARZOOM_API_URL') await resetArzoomCursor();
    // The first pull can take a while; it runs in the background.
    if (key.startsWith('ARZOOM_')) void syncArzoom();
    res.json({ settings: describeSettings(), knowledgeBase: partnerKbStatus(), arzoom: await arzoomStatus() });
  } catch (err) {
    res.status(500).json({ error: (err as Error)?.message || 'failed to save setting' });
  }
});

// Checks the saved Gemini key against Google without spending tokens (lists models).
settingsRouter.post('/test/gemini', async (_req, res) => {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) {
    res.json({ ok: false, error: 'not set' });
    return;
  }
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(10_000),
    });
    res.json(r.ok ? { ok: true } : { ok: false, error: `HTTP ${r.status}` });
  } catch (err) {
    res.json({ ok: false, error: (err as Error)?.message || 'request failed' });
  }
});

settingsRouter.post('/test/knowledge-base', async (_req, res) => {
  await refreshPartnerKb();
  res.json(partnerKbStatus());
});

// Pulls new and changed ARZOOM applications now instead of waiting for the next run.
settingsRouter.post('/test/arzoom', async (_req, res) => {
  await syncArzoom();
  res.json(await arzoomStatus());
});
