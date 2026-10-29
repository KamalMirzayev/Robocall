import 'dotenv/config';
import express from 'express';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import WebSocket, { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const port = Number(process.env.PORT || 8080);
const rtpHost = process.env.CALLBOT_RTP_HOST || '127.0.0.1';
const rtpPort = Number(process.env.CALLBOT_RTP_PORT || 10000);
const rtpFrameBytes = 160;
const rtpFrameIntervalMs = 20;
const rtpSilenceFrame = Buffer.alloc(rtpFrameBytes, 0xff);
const rtpMaxQueuedPackets = Number(process.env.CALLBOT_RTP_MAX_QUEUE_PACKETS || 1200);
const rtpPlaybackBufferPackets = Number(process.env.CALLBOT_RTP_PLAYBACK_BUFFER_PACKETS || 12);
const inboundSpeechRmsThreshold = Number(process.env.CALLBOT_INBOUND_SPEECH_RMS || 700);
const inboundSpeechMinFrames = Number(process.env.CALLBOT_INBOUND_SPEECH_MIN_FRAMES || 5);
const inboundSpeechReleaseMs = Number(process.env.CALLBOT_INBOUND_SPEECH_RELEASE_MS || 650);
const inboundNoiseMultiplier = Number(process.env.CALLBOT_INBOUND_NOISE_MULTIPLIER || 2.6);
const inboundZcrMin = Number(process.env.CALLBOT_INBOUND_ZCR_MIN || 0.01);
const inboundZcrMax = Number(process.env.CALLBOT_INBOUND_ZCR_MAX || 0.38);
const inboundPrebufferFrames = Number(process.env.CALLBOT_INBOUND_PREBUFFER_FRAMES || 40);
const inboundDialogueGateEnabled = process.env.CALLBOT_INBOUND_DIALOGUE_GATE !== 'off';
const inboundBargeInHoldMs = Number(process.env.CALLBOT_BARGE_IN_HOLD_MS || 500);
const inboundBargeInRmsThreshold = Number(process.env.CALLBOT_BARGE_IN_RMS || 1000);
const inboundBargeInMinFrames = Number(process.env.CALLBOT_BARGE_IN_MIN_FRAMES || 11);
const inboundBargeInNoiseMultiplier = Number(process.env.CALLBOT_BARGE_IN_NOISE_MULTIPLIER || 4.1);
const inboundVoiceProfileEnabled = process.env.CALLBOT_INBOUND_VOICE_PROFILE !== 'off';
const inboundVoiceProfileMinFrames = Number(process.env.CALLBOT_INBOUND_VOICE_PROFILE_MIN_FRAMES || 25);
const inboundBargeInCooldownMs = Number(process.env.CALLBOT_BARGE_IN_COOLDOWN_MS || 1200);
const inboundBargeInAgentGraceMs = Number(process.env.CALLBOT_BARGE_IN_AGENT_GRACE_MS || 300);
const autoEndMinDelayMs = Number(process.env.CALLBOT_AUTO_END_MIN_DELAY_MS || 1500);
const autoEndMaxDelayMs = Number(process.env.CALLBOT_AUTO_END_MAX_DELAY_MS || 1500);
const agentInitialDelayMs = Number(process.env.CALLBOT_AGENT_INITIAL_DELAY_MS || 1800);
const agentAfterSpeechDelayMs = Number(process.env.CALLBOT_AGENT_AFTER_SPEECH_DELAY_MS || 700);
const wsPendingAudioFrames = Number(process.env.CALLBOT_WS_PENDING_AUDIO_FRAMES || 600);
const ariHost = process.env.ASTERISK_ARI_HOST || '127.0.0.1';
const ariPort = Number(process.env.ASTERISK_ARI_PORT || 8088);
const ariUser = process.env.ASTERISK_ARI_USER || 'robocallari';
const ariSecret = process.env.ASTERISK_ARI_SECRET || 'robocallAriSecret2026';
const configDir = process.env.ASTERISK_CONFIG_DIR || path.resolve(__dirname, '../../../infra/asterisk/custom');
const asteriskLogDir = process.env.ASTERISK_LOG_DIR || '/var/log/asterisk';
const asteriskLogDefaultFile = process.env.ASTERISK_LOG_FILE || 'messages.log';
const asteriskLogAllowedFiles = new Set(['messages.log', 'full', 'queue_log']);
const telephonyQueueBaseUrl = cleanEnvUrl(process.env.TELEPHONY_QUEUE_BASE_URL || '');
// Was previously an admin-editable DB row (ai_settings.callbot_ws_url); that page and its
// broken inbound-call handling were removed (see startCallbotAriCall below). Outbound calls
// (campaigns, manual dial, the external API) always pass explicit agentId/customerId, so
// this URL is just the connection target, not a per-call config source.
const callbotWsUrl = process.env.CALLBOT_WS_URL
  || `${(telephonyQueueBaseUrl || 'http://127.0.0.1:4000').replace(/^http/, 'ws')}/ws/gemini`;
const telephonyWorkerToken = process.env.TELEPHONY_WORKER_TOKEN || '';
const telephonyWorkerId = process.env.TELEPHONY_WORKER_ID || 'robocall-asterisk';
const telephonyPollIntervalMs = Number(process.env.TELEPHONY_POLL_INTERVAL_MS || 3000);
const telephonyMaxConcurrentCalls = Math.max(1, Number(process.env.TELEPHONY_MAX_CONCURRENT_CALLS || 10));
const telephonyOriginateTimeoutMs = Number(process.env.TELEPHONY_ORIGINATE_TIMEOUT_MS || 25000);
const recordingsDir = process.env.CRM_RECORDINGS_DIR || path.resolve(__dirname, '../../../recordings');
const recordingsIndexPath = path.join(recordingsDir, 'index.json');
const recordingsSyncIntervalMs = Number(process.env.CRM_RECORDINGS_SYNC_INTERVAL_MS || 60000);
const authUsername = process.env.CRM_ADMIN_USERNAME || 'admin';
const authPassword = process.env.CRM_ADMIN_PASSWORD || '';
const authSessionSecret = process.env.CRM_SESSION_SECRET || '';
const authCookieName = process.env.AUTH_COOKIE_NAME || 'robocall_crm_session';
const authCookieSecure = process.env.CRM_AUTH_COOKIE_SECURE !== 'off';
const authSessionTtlMs = Number(process.env.CRM_AUTH_SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const outboundCallerName = cleanText(process.env.CRM_OUTBOUND_CALLER_NAME || 'AllAll Finance');
let authSessionVersion = 0;
let storedAuthConfigured = false;
const deleteRemoteRecordings = process.env.CALLBOT_DELETE_REMOTE_RECORDINGS === 'on';
const earlyMediaRecordingEnabled = process.env.CALLBOT_EARLY_MEDIA_RECORDING !== 'off';
const earlyMediaAsteriskDir = process.env.ASTERISK_EARLY_MEDIA_DIR || '/etc/asterisk/custom/early-media';
const earlyMediaLocalDir = process.env.CRM_EARLY_MEDIA_DIR || path.join(configDir, 'early-media');
const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.get('/login', (req, res) => {
  if (isAuthenticated(req)) {
    res.redirect('/');
    return;
  }
  res.type('html').send(loginPage(req.query.error));
});

app.post('/login', async (req, res, next) => {
  try {
  if (!authSessionSecret || (!authPassword && !storedAuthConfigured)) {
    res.status(503).type('html').send(loginPage('Auth is not configured'));
    return;
  }

  const username = cleanText(req.body.username);
  const password = String(req.body.password || '');
  if (safeEqual(username, authUsername) && await verifyAdminPassword(password)) {
    res.setHeader('Set-Cookie', buildSessionCookie());
    res.redirect('/');
    return;
  }

  res.status(401).type('html').send(loginPage('Invalid username or password'));
  } catch (error) {
    next(error);
  }
});

app.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.redirect('/login');
});

app.use(requireAuth);
app.use(express.static(path.resolve(__dirname, '../public')));

const tables = {
  accounts: 'sip_accounts',
  trunks: 'sip_trunks',
  ivrs: 'ivr_menus',
  rules: 'dialplan_rules'
};

function cleanEnvUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function boolValue(value) {
  return value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

async function readLastText(filePath, maxBytes = 2 * 1024 * 1024) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    const error = new Error('Log path is not a file');
    error.status = 400;
    throw error;
  }

  const start = Math.max(0, stat.size - maxBytes);
  const length = Math.max(0, stat.size - start);
  const handle = await fs.open(filePath, 'r');
  try {
    if (!length) return '';
    const chunk = Buffer.alloc(length);
    await handle.read(chunk, 0, length, start);
    let text = chunk.toString('utf8');
    if (start > 0) {
      const firstBreak = text.indexOf('\n');
      text = firstBreak >= 0 ? text.slice(firstBreak + 1) : '';
    }
    return text;
  } finally {
    await handle.close();
  }
}

async function resolveAsteriskLogFile(requestedFile) {
  const candidates = [];
  const normalized = cleanText(requestedFile) || asteriskLogDefaultFile;

  if (asteriskLogAllowedFiles.has(normalized)) {
    candidates.push(normalized);
  }

  if (normalized === 'full') {
    candidates.push('messages.log');
  } else if (normalized === 'messages.log') {
    candidates.push('full');
  }

  for (const candidate of asteriskLogAllowedFiles) {
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }

  for (const candidate of candidates) {
    const filePath = path.join(asteriskLogDir, candidate);
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        return { file: candidate, filePath };
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return { file: normalized, filePath: path.join(asteriskLogDir, normalized) };
}

function parseAsteriskLogTimestamp(raw) {
  const match = String(raw || '').match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})$/);
  if (!match) return null;
  const monthMap = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const month = monthMap[match[1]];
  if (month === undefined) return null;
  const day = Number(match[2]);
  const [hour, minute, second] = match[3].split(':').map(Number);
  const now = new Date();
  const timestamp = new Date(
    now.getFullYear(),
    month,
    day,
    hour,
    minute,
    second,
    0
  );
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
}

function parseAsteriskLogLine(line) {
  const text = String(line || '');
  const match = text.match(/^\[([^\]]+)\]\s+([A-Z]+)\[(\d+)\]\s+([^:]+):\s*(.*)$/);
  if (!match) {
    return {
      timestamp: null,
      level: '',
      pid: '',
      source: '',
      message: text,
      raw: text,
    };
  }

  return {
    timestamp: parseAsteriskLogTimestamp(match[1]),
    level: match[2],
    pid: match[3],
    source: cleanText(match[4]),
    message: cleanText(match[5]),
    raw: text,
  };
}

function cleanCallerIdName(value) {
  return cleanText(value).replace(/["\r\n]/g, '').slice(0, 64);
}

function cleanCallerIdNumber(value) {
  return cleanText(value).replace(/[^\d+]/g, '').slice(0, 32);
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function signSession(payload) {
  return crypto.createHmac('sha256', authSessionSecret).update(payload).digest('base64url');
}

function sessionToken() {
  const payload = base64Url(JSON.stringify({
    sub: authUsername,
    exp: Date.now() + authSessionTtlMs,
    ver: authSessionVersion,
    nonce: crypto.randomBytes(12).toString('hex'),
  }));
  return `${payload}.${signSession(payload)}`;
}

function buildSessionCookie() {
  const parts = [
    `${authCookieName}=${encodeURIComponent(sessionToken())}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(authSessionTtlMs / 1000)}`,
  ];
  if (authCookieSecure) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie() {
  const parts = [
    `${authCookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (authCookieSecure) parts.push('Secure');
  return parts.join('; ');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const key = crypto.scryptSync(String(password), salt, 64).toString('base64url');
  return `scrypt$${salt}$${key}`;
}

function verifyPasswordHash(password, hash) {
  const [scheme, salt, key] = String(hash || '').split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function adminAuthRow() {
  try {
    const [row] = await query('SELECT * FROM robocall_admin_auth WHERE id = 1');
    return row || null;
  } catch {
    return null;
  }
}

async function verifyAdminPassword(password) {
  const row = await adminAuthRow();
  if (row?.password_hash) return verifyPasswordHash(password, row.password_hash);
  return Boolean(authPassword) && safeEqual(password, authPassword);
}

async function refreshAuthState() {
  const row = await adminAuthRow();
  storedAuthConfigured = Boolean(row?.password_hash);
  authSessionVersion = Number(row?.session_version || 0);
}

function isAuthenticated(req) {
  if (!authSessionSecret || (!authPassword && !storedAuthConfigured)) return false;
  const token = parseCookies(req.headers.cookie)[authCookieName];
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature || !safeEqual(signature, signSession(payload))) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.sub === authUsername
      && Number(session.exp || 0) > Date.now()
      && Number(session.ver || 0) === authSessionVersion;
  } catch {
    return false;
  }
}

function isPublicRequest(req) {
  return req.path === '/login' || req.path === '/api/telephony/webhook' || req.path === '/api/render';
}

function requireAuth(req, res, next) {
  if (isPublicRequest(req) || isAuthenticated(req)) {
    next();
    return;
  }
  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  res.redirect('/login');
}

function loginPage(error) {
  const message = cleanText(error);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Robocall Login</title>
    <style>
      :root { color-scheme: light; --ink:#17212b; --muted:#617080; --line:#d9e0e7; --accent:#176b87; --accent-strong:#0f4f66; --danger:#a83232; }
      * { box-sizing: border-box; }
      body { margin:0; min-height:100vh; display:grid; place-items:center; background:#f4f6f8; color:var(--ink); font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width:min(420px, calc(100vw - 32px)); background:#fff; border:1px solid var(--line); border-radius:8px; padding:28px; box-shadow:0 18px 50px rgba(16,35,45,.12); }
      h1 { margin:0; font-size:24px; }
      p { margin:6px 0 22px; color:var(--muted); }
      label { display:grid; gap:7px; margin-top:14px; color:var(--muted); font-size:13px; font-weight:650; }
      input { width:100%; min-height:42px; border:1px solid var(--line); border-radius:6px; padding:0 11px; color:var(--ink); font:inherit; }
      button { width:100%; min-height:42px; margin-top:20px; border:0; border-radius:6px; background:var(--accent); color:#fff; font-weight:700; cursor:pointer; }
      button:hover { background:var(--accent-strong); }
      .error { margin:0 0 16px; border:1px solid #e2b4b4; background:#fff0f0; color:var(--danger); border-radius:6px; padding:10px 12px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Robocall Telephony</h1>
      <p>Sign in to continue.</p>
      ${message ? `<div class="error">${htmlEscape(message)}</div>` : ''}
      <form method="post" action="/login">
        <label>Username <input name="username" autocomplete="username" required autofocus></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  </body>
</html>`;
}

function excelText(value) {
  return cleanText(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function recordingDateValue(item) {
  const value = item?.startedAt || item?.endedAt;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function parseDateOnly(value) {
  const match = cleanText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfWeek(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - day + 1);
  return start;
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function buildDateRange(queryParams = {}) {
  const period = cleanText(queryParams.period);
  const base = parseDateOnly(queryParams.date) || parseDateOnly(queryParams.from) || new Date();
  if (period === 'weekly') {
    const from = startOfWeek(base);
    return { from, to: addDays(from, 7), label: `${isoDate(from)} - ${isoDate(addDays(from, 6))}` };
  }
  if (period === 'monthly') {
    const from = startOfMonth(base);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    return { from, to, label: `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, '0')}` };
  }

  const from = parseDateOnly(queryParams.from) || new Date(Date.UTC(1970, 0, 1));
  const toDate = parseDateOnly(queryParams.to);
  const to = toDate ? addDays(toDate, 1) : new Date(Date.UTC(3000, 0, 1));
  return { from, to, label: `${isoDate(from)} - ${toDate ? isoDate(toDate) : 'today'}` };
}

function recordingsInRange(items, range) {
  return items.filter((item) => {
    const date = recordingDateValue(item);
    return date && date >= range.from && date < range.to;
  });
}

function recordingAgentName(item) {
  return cleanText(item?.source?.name) || 'Unknown agent';
}

function recordingCustomerName(item) {
  const destination = item?.destination || {};
  return cleanText(destination.name) || cleanText(destination.number) || 'Unknown customer';
}

function recordingSummaryText(item) {
  return Array.isArray(item?.summary) ? item.summary.filter(Boolean).join('; ') : cleanText(item?.summary);
}

function recordingDescriptionText(item) {
  return cleanText(item?.description);
}

function summaryCategories(item) {
  return recordingSummaryText(item)
    .split(/[;\n]+/)
    .map((part) => cleanText(part))
    .filter(Boolean);
}

function formatReportDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function formatReportDuration(seconds) {
  const total = Number(seconds || 0);
  if (!total) return '';
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function countBy(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = cleanText(getKey(item)) || 'Unknown';
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function durationStats(items) {
  const durations = items.map((item) => Number(item.durationSeconds || 0)).filter((value) => value > 0);
  const totalSeconds = durations.reduce((sum, value) => sum + value, 0);
  return {
    totalSeconds,
    averageSeconds: durations.length ? Math.round(totalSeconds / durations.length) : 0,
    maxSeconds: durations.length ? Math.max(...durations) : 0,
  };
}

function xmlEscape(value) {
  return excelText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const mod = (value - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    value = Math.floor((value - mod) / 26);
  }
  return name;
}

function worksheetXml(rows, widths = []) {
  const cols = widths.length
    ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((cell, colIndex) => {
      const ref = `${columnName(colIndex)}${rowIndex + 1}`;
      const value = cell?.value ?? cell ?? '';
      const style = cell?.style ? ` s="${cell.style}"` : '';
      if (typeof value === 'number' && Number.isFinite(value)) {
        return `<c r="${ref}"${style}><v>${value}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
${cols}
<sheetData>${rowXml}</sheetData>
</worksheet>`;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function zipStore(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = dosDateTime();

  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(now.dosTime, 10);
    local.writeUInt16LE(now.dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(now.dosTime, 12);
    central.writeUInt16LE(now.dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function buildWorkbook(sheets) {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name).slice(0, 31)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>
</workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F7F79"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>
</styleSheet>`;

  return zipStore([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/styles.xml', data: styles },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: worksheetXml(sheet.rows, sheet.widths) })),
  ]);
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => !cleanText(body[field]));
  if (missing.length) {
    const error = new Error(`Missing fields: ${missing.join(', ')}`);
    error.status = 400;
    throw error;
  }
}

async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS robocall_admin_auth (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      username TEXT NOT NULL DEFAULT 'admin',
      password_hash TEXT NOT NULL DEFAULT '',
      session_version INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // instruction_templates moved to the callbot database (AI/campaign content).
  await query("INSERT INTO robocall_admin_auth (id, username) VALUES (1, $1) ON CONFLICT (id) DO NOTHING", [authUsername]);
  await query(`
    ALTER TABLE sip_trunks
      ADD COLUMN IF NOT EXISTS dial_format TEXT NOT NULL DEFAULT 'local'
  `);
  // ai_settings (the removed /ai-api page's config table) is intentionally left alone here —
  // not dropped, not migrated further. It's no longer read anywhere; see callbotWsUrl/rtpHost/
  // rtpPort/telephonyQueueBaseUrl and startCallbotAriCall for what replaced it.
  await refreshAuthState();
}

async function ensureProdDefaults() {
  await query(
    "INSERT INTO sip_trunks (name, trunk_type, host, port, username, secret, inbound_context, codecs) "
    + "SELECT 'TG200 GSM Gateway', 'gsm_gateway', '192.168.38.230', 5060, 'admin', 'password', 'from-trunk', 'ulaw,alaw' "
    + "WHERE NOT EXISTS (SELECT 1 FROM sip_trunks WHERE host = '192.168.38.230')"
  );
  await query(
    `INSERT INTO sip_trunks
      (name, trunk_type, host, port, username, secret, from_user, from_domain, inbound_context, codecs)
     SELECT 'Bakcell SIP Trunk', 'provider', '109.235.199.68', 5060, '123113045', 'S8tr0ngPa55w0rd',
      '123113045', '109.235.199.68', 'from-trunk', 'alaw,ulaw'
     WHERE NOT EXISTS (SELECT 1 FROM sip_trunks WHERE host = '109.235.199.68' AND username = '123113045')`
  );
}

async function getState() {
  const [accounts, trunks, ivrs, options, rules] = await Promise.all([
    query('SELECT * FROM sip_accounts ORDER BY extension'),
    query('SELECT * FROM sip_trunks ORDER BY name'),
    query('SELECT * FROM ivr_menus ORDER BY extension'),
    query('SELECT * FROM ivr_options ORDER BY digit'),
    query('SELECT * FROM dialplan_rules ORDER BY priority, pattern')
  ]);

  const ivrOptions = new Map();
  for (const option of options) {
    const list = ivrOptions.get(option.ivr_id) || [];
    list.push(option);
    ivrOptions.set(option.ivr_id, list);
  }

  return {
    accounts,
    trunks,
    ivrs: ivrs.map((ivr) => ({ ...ivr, options: ivrOptions.get(ivr.id) || [] })),
    rules
  };
}

function pjsipAccount(account) {
  const id = account.extension;
  const codecs = account.codecs || 'ulaw,alaw';
  const callerId = account.caller_id || account.name;
  return `
[${id}]
type=endpoint
transport=transport-${account.transport || 'udp'}
context=${account.context || 'from-internal'}
disallow=all
allow=${codecs}
auth=${id}-auth
aors=${id}
callerid="${callerId}" <${id}>
direct_media=no
force_rport=yes
rewrite_contact=yes

[${id}-auth]
type=auth
auth_type=userpass
username=${id}
password=${account.secret}

[${id}]
type=aor
max_contacts=2
remove_existing=yes
`;
}

function pjsipTrunk(trunk) {
  const codecs = trunk.codecs || 'ulaw,alaw';
  const identifyName = `${trunk.name.replace(/[^a-zA-Z0-9_-]/g, '_')}-identify`;
  const endpoint = `trunk-${trunk.id}`;
  const isGsmGateway = trunk.trunk_type === 'gsm_gateway';
  const isProvider = trunk.trunk_type === 'provider';
  const isIpProvider = isProvider && !cleanText(trunk.username);
  const user = trunk.from_user || trunk.username;
  const domain = trunk.from_domain || trunk.host;
  const callerName = cleanCallerIdName(outboundCallerName);
  const callerNumber = cleanCallerIdNumber(user);
  const registrationBlock = isProvider && trunk.username ? `
[${endpoint}-registration]
type=registration
outbound_auth=${endpoint}-auth
server_uri=sip:${trunk.host}:${trunk.port || 5060}
client_uri=sip:${trunk.username}@${domain}:${trunk.port || 5060}
retry_interval=60
contact_user=${trunk.username}
` : '';
  const authBlock = trunk.username ? `
[${endpoint}-auth]
type=auth
auth_type=userpass
username=${trunk.username}
password=${trunk.secret}
` : '';

  return `
${registrationBlock}
[${endpoint}]
type=endpoint
transport=transport-udp
context=${trunk.inbound_context || 'from-trunk'}
disallow=all
allow=${codecs}
aors=${endpoint}-aor
direct_media=no
force_rport=yes
rewrite_contact=yes
rtp_symmetric=yes
${isProvider ? 'rtp_keepalive=2' : ''}
dtmf_mode=${isProvider ? 'auto' : 'rfc4733'}
${(isGsmGateway || isIpProvider) ? 'allow_unauthenticated_options=yes' : ''}
${isGsmGateway && trunk.username ? `auth=${endpoint}-auth` : ''}
${trunk.username ? `outbound_auth=${endpoint}-auth` : ''}
${user ? `from_user=${user}` : ''}
${domain ? `from_domain=${domain}` : ''}
${isProvider && callerNumber ? `callerid="${callerName}" <${callerNumber}>` : ''}
${isProvider ? 'trust_id_outbound=yes' : ''}
${isProvider ? 'send_pai=yes' : ''}
${isProvider ? 'send_rpid=yes' : ''}
${isProvider ? 'user_eq_phone=yes' : ''}

[${endpoint}-aor]
type=aor
contact=sip:${trunk.host}:${trunk.port || 5060}
${isGsmGateway ? 'qualify_frequency=30' : ''}
${isProvider ? 'qualify_frequency=60' : ''}
${authBlock}
[${identifyName}]
type=identify
endpoint=${endpoint}
match=${trunk.host}
`;
}

function dialPattern(pattern) {
  return pattern.startsWith('_') ? pattern : pattern;
}

function routeLines(rule, priority = 1, trunksById = new Map()) {
  const target = rule.route_target || '';
  const first = `exten => ${dialPattern(rule.pattern)},${priority},NoOp(${rule.description || rule.route_type})`;
  const prefix = priority === 1 ? ' same => n,' : ' same => n,';

  if (rule.route_type === 'extension') {
    return [first, `${prefix}Dial(PJSIP/${target || '${EXTEN}'},30)`, `${prefix}Hangup()`];
  }
  if (rule.route_type === 'trunk') {
    const trunk = trunksById.get(target);
    const callerName = cleanCallerIdName(outboundCallerName);
    const callerNumber = cleanCallerIdNumber(trunk?.from_user || trunk?.username || '');
    return [
      first,
      callerName ? `${prefix}Set(CALLERID(name)=${callerName})` : '',
      callerNumber ? `${prefix}Set(CALLERID(num)=${callerNumber})` : '',
      `${prefix}Dial(PJSIP/\${EXTEN}@trunk-${target},60)`,
      `${prefix}Hangup()`
    ].filter(Boolean);
  }
  if (rule.route_type === 'ivr') {
    return [first, `${prefix}Goto(ivr-${target},s,1)`];
  }
  if (rule.route_type === 'ai_agent') {
    return [
      first,
      `${prefix}Answer()`,
      `${prefix}NoOp(AI handoff via ARI ExternalMedia ${target || 'default settings'})`,
      `${prefix}Stasis(robocall-callbot)`,
      `${prefix}Hangup()`
    ];
  }
  return [first, `${prefix}Hangup()`];
}

function ivrBlock(ivr) {
  const lines = [
    `[ivr-${ivr.extension}]`,
    'exten => s,1,Answer()',
    ` same => n,Set(TIMEOUT(digit)=${ivr.timeout_seconds || 5})`,
    ` same => n,Background(${ivr.prompt || 'demo-congrats'})`,
    ' same => n,WaitExten()'
  ];

  for (const option of ivr.options || []) {
    const target = option.target || '';
    lines.push(`exten => ${option.digit},1,NoOp(${option.label || `IVR ${option.digit}`})`);
    if (option.target_type === 'extension') {
      lines.push(` same => n,Dial(PJSIP/${target},30)`);
    } else if (option.target_type === 'ivr') {
      lines.push(` same => n,Goto(ivr-${target},s,1)`);
    } else if (option.target_type === 'ai_agent') {
      lines.push(' same => n,Answer()');
      lines.push(` same => n,NoOp(AI IVR handoff via ARI ExternalMedia ${target || 'default settings'})`);
      lines.push(' same => n,Stasis(robocall-callbot)');
      lines.push(' same => n,Hangup()');
    } else {
      lines.push(' same => n,Hangup()');
    }
  }

  lines.push('exten => i,1,Playback(pbx-invalid)');
  lines.push(' same => n,Goto(s,1)');
  lines.push('exten => t,1,Hangup()');
  return lines.join('\n');
}

function amiConfig() {
  return {
    host: process.env.ASTERISK_AMI_HOST || '127.0.0.1',
    port: Number(process.env.ASTERISK_AMI_PORT || 5038),
    username: process.env.ASTERISK_AMI_USER || 'robocalladmin',
    secret: process.env.ASTERISK_AMI_SECRET || 'robocallAmiSecret2026',
  };
}

function amiCommand(commandBuilder, timeoutMs = 3000) {
  const { host, port, username, secret } = amiConfig();

  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: timeoutMs });
    let data = '';
    let loggedIn = false;
    let commandsSent = false;
    let finished = false;
    const finish = (ok, message) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve({ ok, message, data });
    };
    socket.on('data', (chunk) => {
      data += chunk.toString();
      const challenge = data.match(/Challenge:\s*([^\r\n]+)/i)?.[1];
      if (challenge && !loggedIn) {
        loggedIn = true;
        const key = crypto.createHash('md5').update(`${challenge}${secret}`).digest('hex');
        socket.write(`Action: Login\r\nAuthType: MD5\r\nUsername: ${username}\r\nKey: ${key}\r\nEvents: off\r\n\r\n`);
      }
      if (/Authentication accepted/i.test(data) && !commandsSent) {
        commandsSent = true;
        socket.write(commandBuilder());
        socket.write('Action: Logoff\r\n\r\n');
        setTimeout(() => finish(!/Response:\s*Error/i.test(data), /Response:\s*Error/i.test(data) ? 'AMI command failed' : 'AMI command sent'), 500);
      }
      if (/Authentication failed/i.test(data)) {
        finish(false, 'AMI authentication failed');
      }
    });
    socket.on('connect', () => {
      socket.write('Action: Challenge\r\nAuthType: MD5\r\n\r\n');
    });
    socket.on('error', (error) => finish(false, error.message));
    socket.on('end', () => {
      const failed = /Response:\s*Error/i.test(data) || /Authentication failed/i.test(data);
      finish(!failed, failed ? 'AMI command failed' : 'AMI command sent');
    });
    socket.on('timeout', () => finish(false, 'AMI timeout'));
  });
}

function parseAmiEvent(block) {
  const event = {};
  for (const line of String(block || '').split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) event[match[1].trim().toLowerCase()] = match[2].trim();
  }
  return event;
}

function amiField(event, name) {
  return event[String(name || '').toLowerCase()] || '';
}

function amiOriginateCommand(commandBuilder, options = {}) {
  const { host, port, username, secret } = amiConfig();
  const timeoutMs = Number(options.timeoutMs || 65000);
  const earlyMediaFile = cleanText(options.earlyMediaFile);
  const waitForAnswer = options.waitForAnswer === true;

  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: timeoutMs });
    let data = '';
    let loggedIn = false;
    let commandsSent = false;
    let finished = false;
    let processedBlocks = 0;
    let originateUniqueId = '';
    let lastDialStatus = '';
    let lastHangupCause = '';
    let lastHangupCauseText = '';
    let lastAmiEvent = '';
    let pendingFailure = null;
    let originateAccepted = false;
    let failureTimer = null;
    let monitoredChannel = '';
    let mixMonitorRequested = false;
    let mixMonitorStopped = false;
    const actionId = `robocall-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const failureDetails = () => {
      const reasonText = originateFailureReason({
        reason: pendingFailure?.reason,
        dialStatus: lastDialStatus,
        hangupCause: lastHangupCause,
        hangupCauseText: lastHangupCauseText,
      });
      return {
        message: reasonText || 'call failed, exact reason not provided',
        details: {
          response: pendingFailure?.response || '',
          reason: pendingFailure?.reason || '',
          dialStatus: lastDialStatus,
          hangupCause: lastHangupCause,
          hangupCauseText: lastHangupCauseText,
          originateUniqueId,
          actionId,
          lastAmiEvent,
        },
      };
    };
    const scheduleFailureFinish = () => {
      if (failureTimer) clearTimeout(failureTimer);
      failureTimer = setTimeout(() => {
        const failure = failureDetails();
        finish(false, failure.message, failure.details);
      }, Number(process.env.TELEPHONY_FAILURE_SETTLE_MS || 250));
    };
    const finish = (ok, message, details = {}) => {
      if (finished) return;
      finished = true;
      if (failureTimer) clearTimeout(failureTimer);
      const settle = () => {
        socket.destroy();
        resolve({ ok, message, data, actionId, ...details });
      };
      if (earlyMediaFile && mixMonitorRequested && monitoredChannel && !mixMonitorStopped && !socket.destroyed) {
        mixMonitorStopped = true;
        try {
          socket.write([
            'Action: StopMixMonitor',
            `ActionID: ${actionId}-stopmixmonitor`,
            `Channel: ${monitoredChannel}`,
            '',
            '',
          ].join('\r\n'));
        } catch {}
        setTimeout(settle, Number(process.env.CALLBOT_EARLY_MEDIA_STOP_DELAY_MS || 700));
        return;
      }
      settle();
    };
    socket.on('data', (chunk) => {
      data += chunk.toString();
      const challenge = data.match(/Challenge:\s*([^\r\n]+)/i)?.[1];
      if (challenge && !loggedIn) {
        loggedIn = true;
        const key = crypto.createHash('md5').update(`${challenge}${secret}`).digest('hex');
        socket.write(`Action: Login\r\nAuthType: MD5\r\nUsername: ${username}\r\nKey: ${key}\r\nEvents: on\r\n\r\n`);
      }
      if (/Authentication accepted/i.test(data) && !commandsSent) {
        commandsSent = true;
        socket.write(commandBuilder(actionId));
      }
      if (/Authentication failed/i.test(data)) {
        finish(false, 'AMI authentication failed');
      }

      const blocks = data.split(/\r?\n\r?\n/);
      const completeBlocks = blocks.slice(0, Math.max(0, blocks.length - 1));
      for (const block of completeBlocks.slice(processedBlocks)) {
        const event = parseAmiEvent(block);
        const eventName = amiField(event, 'Event').toLowerCase();
        const uniqueId = amiField(event, 'Uniqueid') || amiField(event, 'DestUniqueid');
        const linkedId = amiField(event, 'Linkedid') || amiField(event, 'DestLinkedid');
        const channelName = amiField(event, 'Channel') || amiField(event, 'DestChannel');
        const actionMatch = amiField(event, 'ActionID') === actionId;
        const uniqueMatch = originateUniqueId && (uniqueId === originateUniqueId || linkedId === originateUniqueId);
        if (['originateresponse', 'dialbegin', 'dialend', 'hangup'].includes(eventName) && (actionMatch || uniqueMatch || !originateUniqueId)) {
          const marker = cleanText(
            amiField(event, 'DialStatus') ||
            amiField(event, 'Cause-txt') ||
            amiField(event, 'Response') ||
            amiField(event, 'SubEvent') ||
            ''
          );
          const ch = cleanText(channelName);
          lastAmiEvent = [eventName, marker, ch].filter(Boolean).join(' | ');
        }
        if (earlyMediaFile && !monitoredChannel && /^PJSIP\//i.test(channelName)) {
          monitoredChannel = channelName;
          mixMonitorRequested = true;
          console.log(`Early media recording ${actionId}: MixMonitor ${monitoredChannel} -> ${earlyMediaFile}`);
          socket.write([
            'Action: MixMonitor',
            `ActionID: ${actionId}-mixmonitor`,
            `Channel: ${monitoredChannel}`,
            `File: ${earlyMediaFile}`,
            '',
            '',
          ].join('\r\n'));
        }
        if (amiField(event, 'ActionID') === `${actionId}-mixmonitor` && amiField(event, 'Response')) {
          console.log(`Early media recording ${actionId}: MixMonitor ${amiField(event, 'Response')} ${amiField(event, 'Message')}`);
        }
        if (amiField(event, 'ActionID') === `${actionId}-stopmixmonitor` && amiField(event, 'Response')) {
          console.log(`Early media recording ${actionId}: StopMixMonitor ${amiField(event, 'Response')} ${amiField(event, 'Message')}`);
        }
        if (eventName === 'originateresponse' && actionMatch) {
          originateUniqueId = amiField(event, 'Uniqueid') || originateUniqueId;
        }
        if ((eventName === 'dialend' && (uniqueMatch || actionMatch)) || (eventName === 'dialend' && !originateUniqueId)) {
          lastDialStatus = amiField(event, 'DialStatus') || lastDialStatus;
          const dialStatus = cleanText(lastDialStatus).toUpperCase();
          if (waitForAnswer && dialStatus === 'ANSWER') {
            finish(true, 'call answered', { response: 'Success', reason: '', dialStatus });
          } else if (waitForAnswer && dialStatus) {
            pendingFailure = pendingFailure || { response: originateAccepted ? 'Success' : 'Failure', reason: '' };
            scheduleFailureFinish();
          } else if (pendingFailure) {
            scheduleFailureFinish();
          }
        }
        if ((eventName === 'hangup' && (uniqueMatch || actionMatch)) || (eventName === 'hangup' && !originateUniqueId)) {
          lastHangupCause = amiField(event, 'Cause') || lastHangupCause;
          lastHangupCauseText = amiField(event, 'Cause-txt') || amiField(event, 'Cause-txt') || lastHangupCauseText;
          if (waitForAnswer) {
            pendingFailure = pendingFailure || { response: originateAccepted ? 'Success' : 'Failure', reason: '' };
            scheduleFailureFinish();
          } else if (pendingFailure) {
            scheduleFailureFinish();
          }
        }
        if (eventName !== 'originateresponse' || !actionMatch) continue;
        const response = amiField(event, 'Response');
        const reason = amiField(event, 'Reason');
        const ok = /^Success$/i.test(response);
        if (ok) {
          originateAccepted = true;
          if (!waitForAnswer) finish(true, 'AMI originate success', { response, reason });
        } else {
          if (earlyMediaFile && !mixMonitorRequested) {
            console.warn(`Early media recording ${actionId}: no PJSIP channel event before originate failure`);
          }
          pendingFailure = { response, reason };
          scheduleFailureFinish();
        }
      }
      processedBlocks = completeBlocks.length;
    });
    socket.on('connect', () => {
      socket.write('Action: Challenge\r\nAuthType: MD5\r\n\r\n');
    });
    socket.on('error', (error) => finish(false, error.message));
    socket.on('end', () => {
      if (!finished && pendingFailure) {
        const failure = failureDetails();
        finish(false, failure.message, failure.details);
      } else if (!finished) {
        finish(false, 'AMI connection closed before originate response');
      }
    });
    socket.on('timeout', () => {
      if (pendingFailure) {
        const failure = failureDetails();
        finish(false, failure.message, failure.details);
      } else {
        finish(false, 'AMI originate timeout');
      }
    });
  });
}

function originateFailureReason({ reason, dialStatus, hangupCause, hangupCauseText } = {}) {
  const status = cleanText(dialStatus).toUpperCase();
  const cause = Number(hangupCause);
  const causeText = cleanText(hangupCauseText).toLowerCase();
  const reasonValue = cleanText(reason);
  const reasonCode = reasonValue ? Number(reasonValue) : null;

  if (status === 'BUSY' || cause === 17 || reasonCode === 5 || /\bbusy\b|user busy/.test(causeText)) return 'busy';
  if ([1, 2, 3, 22, 28].includes(cause) || /unallocated|unassigned|no route|number changed|invalid number format|address incomplete/.test(causeText)) {
    return 'number does not exist or is invalid';
  }
  if (status === 'NOANSWER' || cause === 19 || reasonCode === 1 || /no answer|not answered/.test(causeText)) return 'no answer';
  if ([20, 27, 34, 38, 41, 42, 44, 47].includes(cause) || reasonCode === 8 || /subscriber absent|destination out of order|network out|temporary failure|congestion|unavailable|channel unavailable/.test(causeText)) {
    return 'phone unavailable or switched off';
  }
  if (status === 'CANCEL' || cause === 16) return 'call cancelled';
  if (status) return `dial status ${status.toLowerCase()}`;
  if (cause || causeText) return `hangup cause ${cause || ''} ${hangupCauseText || ''}`.trim();
  if (reasonCode) return `originate failed, reason ${reasonCode}`;
  return '';
}

function statusItem(ok, message = '', details = {}) {
  return {
    ok: Boolean(ok),
    status: ok ? 'online' : 'offline',
    message: cleanText(message),
    ...details,
  };
}

function commandOutput(data) {
  return String(data || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^Output:\s*/i, '').trimEnd())
    .filter((line) => line && !/^(Asterisk Call Manager|Response:|ActionID:|Message:|Privilege:|EventList:|Challenge:|--END COMMAND--)/i.test(line))
    .join('\n')
    .trim();
}

async function checkTelephonyStatus() {
  try {
    await query('SELECT 1');
    return statusItem(true, 'API and database are online');
  } catch (error) {
    return statusItem(false, error.message || 'CRM database check failed');
  }
}

async function checkAsteriskStatus() {
  const result = await amiCommand(() => 'Action: Command\r\nCommand: core show uptime\r\n\r\n', 1800);
  return statusItem(result.ok, result.ok ? 'AMI is online' : result.message, {
    output: commandOutput(result.data),
  });
}

function gsmAorStatus(output) {
  const text = String(output || '');
  if (/Unable to find|No objects found|not found/i.test(text)) return 'missing';
  if (/\b(Unavail|Unavailable|Rejected|Removed)\b/i.test(text)) return 'offline';
  if (/\b(Avail|Available|Reachable|NonQual)\b/i.test(text)) return 'online';
  return '';
}

async function checkGsmStatus(asteriskOnline = true) {
  const [trunk] = await query(
    `SELECT * FROM sip_trunks WHERE trunk_type='gsm_gateway' AND enabled=true ORDER BY created_at LIMIT 1`
  );
  if (!trunk) return statusItem(false, 'No enabled GSM gateway trunk');
  if (!asteriskOnline) {
    return statusItem(false, 'Asterisk is offline', {
      host: trunk.host,
      port: trunk.port,
      trunk: trunk.name,
    });
  }

  const aor = `trunk-${trunk.id}-aor`;
  const result = await amiCommand(() => `Action: Command\r\nCommand: pjsip show aor ${aor}\r\n\r\n`, 2200);
  const output = commandOutput(result.data);
  const parsed = gsmAorStatus(output);
  const online = result.ok && parsed === 'online';
  return statusItem(online, online ? `${trunk.name} is reachable` : (parsed === 'missing' ? 'GSM AOR is not loaded in Asterisk' : result.message || 'GSM gateway is offline'), {
    host: trunk.host,
    port: trunk.port,
    trunk: trunk.name,
    aor,
    output,
  });
}

function normalizeOutboundNumber(value, outboundChannel = 'provider', dialFormat = '') {
  const raw = cleanText(value);
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  const providerDialFormat = String(dialFormat || process.env.CALLBOT_PROVIDER_DIAL_FORMAT || 'local').toLowerCase();

  const toLocal = () => {
    if (digits.startsWith('994') && digits.length === 12) return `0${digits.slice(3)}`;
    if (digits.length === 9) return `0${digits}`;
    return digits;
  };

  const toIntl = () => {
    if (digits.startsWith('994') && digits.length === 12) return digits;
    if (digits.startsWith('0') && digits.length === 10) return `994${digits.slice(1)}`;
    if (digits.length === 9) return `994${digits}`;
    return digits;
  };

  // Provider trunks usually expect international format (994XXXXXXXXX),
  // while GSM gateway trunks typically expect local format (0XXXXXXXXX).
  // A trunk's own dial_format (if set) always wins over that default.
  if (outboundChannel === 'gsm_gateway' && !dialFormat) {
    return toLocal();
  }

  return providerDialFormat === 'intl' ? toIntl() : toLocal();
}

function normalizeOutboundChannel(value) {
  const channel = cleanText(value);
  return ['provider', 'gsm_gateway'].includes(channel) ? channel : '';
}

async function ensureEarlyMediaDirectoryPermissions() {
  if (!earlyMediaRecordingEnabled) return;
  await fs.mkdir(earlyMediaLocalDir, { recursive: true, mode: 0o2775 });
  try {
    await fs.chmod(earlyMediaLocalDir, 0o2775);
  } catch (error) {
    console.warn(`Failed to set early media directory permissions: ${error.message}`);
  }
}

async function originateAiCall({ phone, agentId, customerId, jobId, outboundChannel, trunkId, waitForResult = false } = {}) {
  const selectedChannel = normalizeOutboundChannel(outboundChannel);

  let trunk;
  if (trunkId) {
    try {
      [trunk] = await query(
        `SELECT * FROM sip_trunks WHERE id=$1 AND enabled=true LIMIT 1`,
        [trunkId]
      );
    } catch (queryError) {
      // sip_trunks.id is a uuid -- a malformed value (wrong type, not a uuid at all) throws a
      // raw Postgres cast error here instead of just finding no row. Without this catch that
      // error has no .status, so the queue worker's retry-vs-fail check falls through to
      // "retryable" and the job retries forever on an id that will never become valid.
      console.warn(`Trunk lookup failed for trunkId=${trunkId}: ${queryError.message}`);
      trunk = null;
    }
    if (!trunk) {
      const error = new Error(`selected trunk not found or disabled: ${trunkId}`);
      error.status = 400;
      throw error;
    }
  } else {
    [trunk] = selectedChannel
      ? await query(
        `SELECT * FROM sip_trunks
         WHERE trunk_type=$1 AND enabled=true
         ORDER BY created_at
         LIMIT 1`,
        [selectedChannel]
      )
      : await query(
        `SELECT * FROM sip_trunks
         WHERE trunk_type IN ('provider', 'gsm_gateway') AND enabled=true
         ORDER BY CASE WHEN trunk_type='provider' THEN 0 ELSE 1 END, created_at
         LIMIT 1`
      );
    if (!trunk) {
      const error = new Error(selectedChannel ? `enabled ${selectedChannel} trunk not found` : 'enabled provider or gsm_gateway trunk not found');
      error.status = 400;
      throw error;
    }
  }

  const outnum = normalizeOutboundNumber(phone, trunk.trunk_type, trunk.dial_format);
  if (!outnum) {
    const error = new Error('phone is required');
    error.status = 400;
    throw error;
  }

  const endpoint = `trunk-${trunk.id}`;
  const variables = [
    `Variable: CALLBOT_CUSTOMER_PHONE=${outnum}`,
    agentId ? `Variable: CALLBOT_AGENT_ID=${Number(agentId)}` : '',
    customerId ? `Variable: CALLBOT_CUSTOMER_ID=${Number(customerId)}` : '',
    jobId ? `Variable: CALLBOT_JOB_ID=${Number(jobId)}` : '',
  ].filter(Boolean).join('\r\n');

  rememberPendingTelephonyJob({ phone: outnum, agentId, customerId, jobId });
  const earlyMediaPaths = earlyMediaRecordingEnabled && waitForResult ? earlyMediaRecordingPaths(jobId) : null;
  if (earlyMediaPaths) {
    await ensureEarlyMediaDirectoryPermissions();
    await fs.unlink(earlyMediaPaths.localPath).catch(() => {});
  }

  // Channels created via Originate (rather than dialplan Dial()) don't pick
  // up the endpoint's static pjsip.conf callerid — without an explicit
  // CallerID here the channel's caller ID is unset, which providers like
  // Bakcell reject outright (SIP 403) because the From header renders as
  // "Anonymous". Mirror the same name/number pjsipTrunk() bakes into the
  // endpoint config so the two stay consistent.
  const originateCallerName = cleanCallerIdName(outboundCallerName);
  const originateCallerNumber = cleanCallerIdNumber(trunk.from_user || trunk.username);
  const callerIdLine = originateCallerNumber
    ? `CallerID: "${originateCallerName}" <${originateCallerNumber}>`
    : '';

  const commandBuilder = (actionId) => [
    'Action: Originate',
    actionId ? `ActionID: ${actionId}` : '',
    `Channel: PJSIP/${outnum}@${endpoint}`,
    'Application: Stasis',
    'Data: robocall-callbot',
    'EarlyMedia: true',
    'Async: true',
    `Timeout: ${telephonyOriginateTimeoutMs}`,
    callerIdLine,
    variables,
  ].filter((line) => line !== '').join('\r\n') + '\r\n\r\n';

  const result = waitForResult
    ? await amiOriginateCommand(commandBuilder, {
      earlyMediaFile: earlyMediaPaths?.asteriskPath,
      waitForAnswer: true,
      timeoutMs: telephonyOriginateTimeoutMs + 5000,
    })
    : await amiCommand(() => commandBuilder(''));

  return {
    ...result,
    phone: outnum,
    trunk: endpoint,
    outboundChannel: trunk.trunk_type,
    earlyMediaPath: earlyMediaPaths?.localPath || null,
    earlyMediaMp3Path: earlyMediaPaths?.mp3Path || null,
  };
}

async function reloadAsterisk() {
  const { host, port: amiPort, username, secret } = amiConfig();

  return new Promise((resolve) => {
    const socket = net.connect({ host, port: amiPort, timeout: 1500 });
    let data = '';
    let loggedIn = false;
    let commandsSent = false;
    let finished = false;
    const finish = (ok, message) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve({ ok, message, data });
    };
    socket.on('data', (chunk) => {
      data += chunk.toString();
      const challenge = data.match(/Challenge:\s*([^\r\n]+)/i)?.[1];
      if (challenge && !loggedIn) {
        loggedIn = true;
        const key = crypto.createHash('md5').update(`${challenge}${secret}`).digest('hex');
        socket.write(`Action: Login\r\nAuthType: MD5\r\nUsername: ${username}\r\nKey: ${key}\r\nEvents: off\r\n\r\n`);
      }
      if (/Authentication accepted/i.test(data) && !commandsSent) {
        commandsSent = true;
        socket.write('Action: Command\r\nCommand: pjsip reload\r\n\r\n');
        socket.write('Action: Command\r\nCommand: dialplan reload\r\n\r\n');
        socket.write('Action: Logoff\r\n\r\n');
        setTimeout(() => finish(true, 'Reload requested'), 300);
      }
      if (/Authentication failed/i.test(data)) {
        finish(false, 'AMI authentication failed');
      }
    });
    socket.on('connect', () => {
      socket.write('Action: Challenge\r\nAuthType: MD5\r\n\r\n');
    });
    socket.on('error', (error) => finish(false, error.message));
    socket.on('end', () => {
      const failed = /Response:\s*Error/i.test(data) || /Authentication failed/i.test(data);
      finish(!failed, failed ? 'AMI command failed' : 'Reload requested');
    });
    socket.on('timeout', () => {
      finish(false, 'AMI timeout');
    });
  });
}

function pcm16ToBase64(buffer) {
  return Buffer.from(buffer).toString('base64');
}

function base64ToPcm16(value) {
  return Buffer.from(value, 'base64');
}

function resamplePcm16(input, fromRate, toRate) {
  if (fromRate === toRate || !input.length) return input;
  const samples = input.length / 2;
  const outputSamples = Math.max(1, Math.round(samples * toRate / fromRate));
  const output = Buffer.alloc(outputSamples * 2);
  const ratio = fromRate / toRate;

  for (let i = 0; i < outputSamples; i += 1) {
    const source = i * ratio;
    const index = Math.floor(source);
    const frac = source - index;
    const current = input.readInt16LE(Math.min(index, samples - 1) * 2);
    const next = input.readInt16LE(Math.min(index + 1, samples - 1) * 2);
    output.writeInt16LE(Math.round(current + ((next - current) * frac)), i * 2);
  }

  return output;
}

function buildCallbotUrl(ids = {}) {
  const url = new URL(callbotWsUrl);
  url.searchParams.set('agentId', String(ids.agentId || 1));
  url.searchParams.set('customerId', String(ids.customerId || 1));
  if (ids.jobId) url.searchParams.set('jobId', String(ids.jobId));
  return url.toString();
}

// Outbound calls (campaigns, manual dial, the external API) always arrive here with an
// explicit agentId/customerId (from telephony_jobs, via CALLBOT_* channel variables — see
// originateAiCall/startCallbotAriCall) — the ai_settings-based inbound fallback that used to
// live here was removed along with the /ai-api page; a call with no explicit ids now just
// resolves to whatever /api/telephony/resolve or buildCallbotUrl's own bare defaults produce.
async function resolveCallbotUrl(call = {}) {
  const resolveUrl = new URL('/api/telephony/resolve', telephonyQueueBaseUrl || 'http://127.0.0.1:4000');
  const body = {
    callerPhone: cleanText(call.callerPhone),
    calledNumber: cleanText(call.calledNumber),
    channelId: cleanText(call.channelId),
    agentId: Number(call.agentId || 0) || undefined,
    jobId: Number(call.jobId || 0) || undefined,
  };

  if (Number(call.customerId || 0) > 0) {
    body.customerId = Number(call.customerId);
  }

  const fallbackUrl = buildCallbotUrl({
    agentId: body.agentId,
    customerId: body.customerId,
    jobId: body.jobId,
  });

  try {
    const response = await fetch(resolveUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2500),
    });

    if (!response.ok) {
      console.warn(`Callbot telephony resolve failed: HTTP ${response.status}`);
      return fallbackUrl;
    }

    const resolved = await response.json();
    if (resolved.wsUrl) return resolved.wsUrl;
    if (resolved.customerId && resolved.agentId) {
      return buildCallbotUrl({ customerId: resolved.customerId, agentId: resolved.agentId, jobId: body.jobId });
    }
  } catch (error) {
    console.warn('Callbot telephony resolve error', error.message);
  }

  return fallbackUrl;
}

const ulawDecodeTable = Int16Array.from({ length: 256 }, (_, i) => {
  const value = ~i & 0xff;
  const sign = value & 0x80;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
});

function linearToUlaw(sample) {
  const bias = 0x84;
  const clip = 32635;
  let sign = 0;
  let value = sample;
  if (value < 0) {
    value = -value;
    sign = 0x80;
  }
  if (value > clip) value = clip;
  value += bias;
  let exponent = 7;
  for (let mask = 0x4000; (value & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent -= 1;
  }
  const mantissa = (value >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function ulawToPcm16(payload) {
  const output = Buffer.alloc(payload.length * 2);
  for (let i = 0; i < payload.length; i += 1) {
    output.writeInt16LE(ulawDecodeTable[payload[i]], i * 2);
  }
  return output;
}

function pcm16ToUlaw(payload) {
  const output = Buffer.alloc(payload.length / 2);
  for (let i = 0; i < output.length; i += 1) {
    output[i] = linearToUlaw(payload.readInt16LE(i * 2));
  }
  return output;
}

function pcm16VoiceStats(payload) {
  if (payload.length < 2) return { rms: 0, peak: 0, zcr: 0 };
  let sum = 0;
  let peak = 0;
  let crossings = 0;
  let previous = payload.readInt16LE(0);
  const samples = payload.length / 2;

  for (let offset = 0; offset < payload.length; offset += 2) {
    const value = payload.readInt16LE(offset);
    const abs = Math.abs(value);
    if (abs > peak) peak = abs;
    sum += value * value;
    if (offset > 0 && ((value >= 0 && previous < 0) || (value < 0 && previous >= 0))) crossings += 1;
    previous = value;
  }

  return {
    rms: Math.sqrt(sum / samples),
    peak,
    zcr: crossings / Math.max(1, samples - 1),
  };
}

function pcm16Rms(payload) {
  if (payload.length < 2) return 0;
  let sum = 0;
  const samples = payload.length / 2;
  for (let offset = 0; offset < payload.length; offset += 2) {
    const value = payload.readInt16LE(offset);
    sum += value * value;
  }
  return Math.sqrt(sum / samples);
}


function isLikelyInboundVoice(call, pcm8k) {
  const stats = pcm16VoiceStats(pcm8k);
  const noiseFloor = Number(call.inboundNoiseFloor || 180);
  const dynamicThreshold = Math.max(inboundSpeechRmsThreshold, noiseFloor * inboundNoiseMultiplier);
  const peakRatio = stats.rms > 0 ? stats.peak / stats.rms : 0;
  const shapedLikeSpeech = stats.zcr >= inboundZcrMin
    && stats.zcr <= inboundZcrMax
    && peakRatio >= 1.25
    && peakRatio <= 18;
  const candidate = stats.rms >= dynamicThreshold && shapedLikeSpeech;

  if (candidate) {
    call.inboundSpeechFrames = Math.min(20, (call.inboundSpeechFrames || 0) + 1);
  } else {
    call.inboundSpeechFrames = Math.max(0, (call.inboundSpeechFrames || 0) - 1);
    if (stats.rms > 0 && stats.rms < dynamicThreshold) {
      call.inboundNoiseFloor = Math.max(80, Math.min(1200, (noiseFloor * 0.95) + (stats.rms * 0.05)));
    }
  }

  const confirmed = (call.inboundSpeechFrames || 0) >= inboundSpeechMinFrames;
  if (confirmed) call.inboundSpeechUntil = Date.now() + inboundSpeechReleaseMs;
  return { active: confirmed || Date.now() < (call.inboundSpeechUntil || 0), confirmed, stats };
}



function isAgentSpeakingForInputGate(call) {
  const now = Date.now();
  return call.rtpPlaybackActive
    || call.rtpQueue.length >= rtpPlaybackBufferPackets
    || now - (call.lastAgentAudioAt || 0) <= inboundBargeInAgentGraceMs;
}

function inboundVoiceFeature(stats) {
  const rms = Number(stats?.rms || 0);
  return {
    rms,
    zcr: Number(stats?.zcr || 0),
    peakRatio: rms > 0 ? Number(stats?.peak || 0) / rms : 0,
  };
}

function learnInboundVoiceProfile(call, stats) {
  if (!inboundVoiceProfileEnabled) return;
  const feature = inboundVoiceFeature(stats);
  if (feature.rms <= 0 || feature.peakRatio < 1.2 || feature.peakRatio > 18) return;
  if (feature.zcr < inboundZcrMin || feature.zcr > inboundZcrMax) return;

  const profile = call.inboundVoiceProfile || { frames: 0, rms: feature.rms, zcr: feature.zcr, peakRatio: feature.peakRatio };
  const alpha = profile.frames > 0 ? 0.08 : 1;
  profile.rms = (profile.rms * (1 - alpha)) + (feature.rms * alpha);
  profile.zcr = (profile.zcr * (1 - alpha)) + (feature.zcr * alpha);
  profile.peakRatio = (profile.peakRatio * (1 - alpha)) + (feature.peakRatio * alpha);
  profile.frames = Math.min(1000, (profile.frames || 0) + 1);
  call.inboundVoiceProfile = profile;
}

function inboundVoiceProfileMatches(call, stats) {
  if (!inboundVoiceProfileEnabled) return true;
  const profile = call.inboundVoiceProfile;
  if (!profile || (profile.frames || 0) < inboundVoiceProfileMinFrames) return false;

  const feature = inboundVoiceFeature(stats);
  const zcrTolerance = Math.max(0.045, profile.zcr * 0.9);
  const peakRatioTolerance = Math.max(2.8, profile.peakRatio * 1.1);
  const enoughEnergyForKnownSpeaker = feature.rms >= Math.max(inboundBargeInRmsThreshold, profile.rms * 0.35);

  return enoughEnergyForKnownSpeaker
    && Math.abs(feature.zcr - profile.zcr) <= zcrTolerance
    && Math.abs(feature.peakRatio - profile.peakRatio) <= peakRatioTolerance;
}

function shouldTriggerInboundBargeIn(call, speech) {
  const now = Date.now();
  const agentSpeaking = isAgentSpeakingForInputGate(call);

  if (!agentSpeaking || now < (call.inboundBargeInCooldownUntil || 0)) {
    call.inboundBargeInFrames = 0;
    return false;
  }

  const stats = speech.stats || {};
  const noiseFloor = Number(call.inboundNoiseFloor || 180);
  const dynamicThreshold = Math.max(inboundBargeInRmsThreshold, noiseFloor * inboundBargeInNoiseMultiplier);
  const peakRatio = stats.rms > 0 ? stats.peak / stats.rms : 0;
  const profileMatch = inboundVoiceProfileMatches(call, stats);
  const strongSpeechFallback = !profileMatch
    && stats.rms >= Math.max(inboundBargeInRmsThreshold * 1.25, noiseFloor * (inboundBargeInNoiseMultiplier + 0.8));
  const speechLike = speech.confirmed
    && (profileMatch || strongSpeechFallback)
    && stats.rms >= dynamicThreshold
    && stats.zcr >= Math.max(inboundZcrMin, 0.012)
    && stats.zcr <= Math.min(inboundZcrMax, 0.34)
    && peakRatio >= 1.35
    && peakRatio <= 8.5;

  if (speechLike) {
    call.inboundBargeInFrames = Math.min(inboundBargeInMinFrames + 4, (call.inboundBargeInFrames || 0) + 1);
  } else {
    call.inboundBargeInFrames = Math.max(0, (call.inboundBargeInFrames || 0) - 1);
  }

  if ((call.inboundBargeInFrames || 0) < inboundBargeInMinFrames) return false;
  call.inboundBargeInFrames = 0;
  call.inboundBargeInCooldownUntil = now + inboundBargeInCooldownMs;
  return true;
}

function sendCustomerAudioToCallbot(call, data) {
  if (call.ws.readyState === WebSocket.OPEN) {
    call.ws.send(JSON.stringify({ type: 'audio', data }));
    return;
  }
  if (call.ws.readyState === WebSocket.CONNECTING) {
    call.wsPendingAudio.push(data);
    while (call.wsPendingAudio.length > wsPendingAudioFrames) call.wsPendingAudio.shift();
  }
}

function flushPendingCustomerAudio(call) {
  if (call.ws.readyState !== WebSocket.OPEN) return;
  while (call.wsPendingAudio.length > 0) {
    call.ws.send(JSON.stringify({ type: 'audio', data: call.wsPendingAudio.shift() }));
  }
}

function buildRtpPacket(call, payload) {
  const header = Buffer.alloc(12);
  header[0] = 0x80;
  header[1] = 0x00;
  header.writeUInt16BE(call.rtpSeq & 0xffff, 2);
  header.writeUInt32BE(call.rtpTimestamp >>> 0, 4);
  header.writeUInt32BE(call.rtpSsrc >>> 0, 8);
  call.rtpSeq = (call.rtpSeq + 1) & 0xffff;
  call.rtpTimestamp = (call.rtpTimestamp + payload.length) >>> 0;
  return Buffer.concat([header, payload]);
}


function requestAutoEndCall(call, reason = "ai_requested") {
  if (call.cleaning || call.autoEndRequested) return;
  const now = Date.now();
  call.autoEndRequested = true;
  call.autoEndReason = cleanText(reason) || "ai_requested";
  call.autoEndNotBefore = now + autoEndMinDelayMs;
  call.autoEndDeadline = now + autoEndMaxDelayMs;
  ensureRtpSender(call);
}

function holdInitialAgentOutput(call, holdMs) {
  if (!call || call.initialAgentOutputReleased) return;
  const delay = Math.max(0, Number(holdMs || 0));
  if (!delay) return;
  call.initialAgentOutputUntil = Math.max(
    Number(call.initialAgentOutputUntil || 0),
    Date.now() + delay
  );
}

function initialAgentOutputHeld(call) {
  if (!call || call.initialAgentOutputReleased) return false;
  const until = Number(call.initialAgentOutputUntil || 0);
  if (until && Date.now() < until) return true;
  call.initialAgentOutputReleased = true;
  return false;
}

function maybeAutoEndCall(call) {
  if (!call.autoEndRequested || call.cleaning) return;
  const now = Date.now();
  const audioDrained = call.rtpQueue.length === 0 && call.rtpPending.length === 0 && !call.rtpPlaybackActive;
  if ((audioDrained && now >= call.autoEndNotBefore) || now >= call.autoEndDeadline) {
    console.log(`AI requested call end for ${call.channelId}: ${call.autoEndReason || "ai_requested"}`);
    cleanupAriCall(call).catch((error) => console.error("AI auto end cleanup error", error));
  }
}

function ensureRtpSender(call) {
  if (call.rtpTimer) return;

  call.rtpTimer = setInterval(() => {
    if (!call.rtpRemote) {
      maybeAutoEndCall(call);
      return;
    }
    if (initialAgentOutputHeld(call)) {
      call.rtpSocket.send(buildRtpPacket(call, rtpSilenceFrame), call.rtpRemote.port, call.rtpRemote.address);
      maybeAutoEndCall(call);
      return;
    }
    if (!call.rtpPlaybackActive && call.rtpQueue.length > 0 && call.rtpQueue.length < rtpPlaybackBufferPackets) {
      call.rtpSocket.send(buildRtpPacket(call, rtpSilenceFrame), call.rtpRemote.port, call.rtpRemote.address);
      return;
    }

    const hasAudio = call.rtpQueue.length > 0;
    if (!hasAudio) call.rtpPlaybackActive = false;
    if (hasAudio) {
      call.rtpPlaybackActive = true;
      call.lastAgentAudioAt = Date.now();
    }
    const payload = hasAudio ? call.rtpQueue.shift() : rtpSilenceFrame;
    call.rtpSocket.send(buildRtpPacket(call, payload), call.rtpRemote.port, call.rtpRemote.address);
    if (hasAudio && call.ws.readyState === WebSocket.OPEN) {
      const monitorAudio = pcm16ToBase64(resamplePcm16(ulawToPcm16(payload), 8000, 16000));
      broadcastLiveAudio(call, 'agent', monitorAudio);
      call.ws.send(JSON.stringify({
        type: 'monitor_agent',
        rate: 16000,
        data: monitorAudio
      }));
    }
    maybeAutoEndCall(call);
  }, rtpFrameIntervalMs);
}

function enqueueRtpAudio(call, ulaw) {
  if (Date.now() < (call.suppressOutputUntil || 0)) return false;

  const audio = call.rtpPending.length > 0 ? Buffer.concat([call.rtpPending, ulaw]) : ulaw;
  const fullLength = Math.floor(audio.length / rtpFrameBytes) * rtpFrameBytes;
  for (let offset = 0; offset < fullLength; offset += rtpFrameBytes) {
    call.rtpQueue.push(audio.subarray(offset, offset + rtpFrameBytes));
  }
  call.rtpPending = audio.subarray(fullLength);

  if (call.rtpQueue.length > rtpMaxQueuedPackets) {
    const dropped = call.rtpQueue.length - rtpMaxQueuedPackets;
    call.rtpQueue.splice(0, dropped);
    console.warn(`RTP output queue overflow: dropped ${dropped} packets`);
  }

  ensureRtpSender(call);
  return true;
}


const ariCalls = new Map();
const pendingTelephonyJobs = [];
const liveMonitorClients = new Map();

function liveCallInfo(call) {
  const startedAt = call?.answeredAt || call?.createdAt || new Date();
  return {
    channelId: call.channelId,
    bridgeId: call.bridgeId,
    externalChannelId: call.externalChannelId,
    jobId: call.telephonyJobId,
    phone: call.customerPhone || '',
    agentId: call.agentId || null,
    customerId: call.customerId || null,
    calledNumber: call.calledNumber || '',
    startedAt: startedAt instanceof Date ? startedAt.toISOString() : new Date(startedAt).toISOString(),
    durationSeconds: Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)),
    rtpConnected: Boolean(call.rtpRemote),
    monitorCount: liveMonitorClients.get(call.channelId)?.size || 0,
  };
}

function activeLiveCalls() {
  return [...ariCalls.values()]
    .filter((call) => !call.cleaning)
    .map(liveCallInfo)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

function sendLiveMonitorEvent(call, event) {
  const clients = liveMonitorClients.get(call.channelId);
  if (!clients?.size) return;
  const payload = JSON.stringify({
    channelId: call.channelId,
    jobId: call.telephonyJobId,
    ...event,
  });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function broadcastLiveAudio(call, role, pcm16Base64, rate = 16000) {
  sendLiveMonitorEvent(call, {
    type: 'audio',
    role,
    rate,
    data: pcm16Base64,
  });
}

function closeLiveMonitorClients(call, reason = 'ended') {
  const clients = liveMonitorClients.get(call.channelId);
  if (!clients?.size) return;
  sendLiveMonitorEvent(call, { type: 'call_ended', reason });
  for (const client of clients) client.close(1000, reason);
  liveMonitorClients.delete(call.channelId);
}

function rememberPendingTelephonyJob(job) {
  const id = Number(job?.jobId || job?.id || 0) || null;
  if (!id) return;
  const now = Date.now();
  pendingTelephonyJobs.push({
    id,
    phone: normalizeOutboundNumber(job.phone),
    agentId: Number(job.agentId || 0) || null,
    customerId: Number(job.customerId || 0) || null,
    createdAt: now,
  });
  while (pendingTelephonyJobs.length > 20 || (pendingTelephonyJobs[0] && now - pendingTelephonyJobs[0].createdAt > 180000)) {
    pendingTelephonyJobs.shift();
  }
}

function claimPendingTelephonyJob({ jobId, phone } = {}) {
  const id = Number(jobId || 0) || null;
  const normalizedPhone = normalizeOutboundNumber(phone);
  const index = pendingTelephonyJobs.findIndex((job) => (id && job.id === id) || (normalizedPhone && job.phone === normalizedPhone));
  if (index >= 0) return pendingTelephonyJobs.splice(index, 1)[0];

  const now = Date.now();
  const freshJobs = pendingTelephonyJobs.filter((job) => now - job.createdAt <= 180000);
  if (!id && !normalizedPhone && freshJobs.length === 1) {
    const fallbackIndex = pendingTelephonyJobs.indexOf(freshJobs[0]);
    return pendingTelephonyJobs.splice(fallbackIndex, 1)[0];
  }

  return null;
}

function phoneFromAriChannel(channel) {
  const candidates = [
    channel?.name,
    channel?.connected?.number,
    channel?.caller?.number,
    channel?.dialplan?.exten,
  ];

  for (const candidate of candidates) {
    const value = cleanText(candidate);
    if (!value) continue;
    const pjsipName = value.toUpperCase().startsWith("PJSIP/") ? value.slice(6).split("/")[0].split(String.fromCharCode(64))[0].split("-")[0] : "";
    const normalized = normalizeOutboundNumber(pjsipName || value);
    if (normalized && normalized !== "600") return normalized;
  }

  return "";
}

function activeCallForRtp(rinfo) {
  for (const call of ariCalls.values()) {
    if (call.rtpRemote && call.rtpRemote.address === rinfo.address && call.rtpRemote.port === rinfo.port) {
      return call;
    }
  }
  for (const call of ariCalls.values()) {
    if (!call.rtpRemote) {
      call.rtpRemote = { address: rinfo.address, port: rinfo.port };
      return call;
    }
  }
  return null;
}

function startRtpBridge() {
  const socket = dgram.createSocket('udp4');

  socket.on('message', (packet, rinfo) => {
    if (packet.length <= 12) return;
    const call = activeCallForRtp(rinfo);
    if (!call || call.ws.readyState >= WebSocket.CLOSING) return;
    const pcm8k = ulawToPcm16(packet.subarray(12));
    const customerAudio = pcm16ToBase64(resamplePcm16(pcm8k, 8000, 16000));
    broadcastLiveAudio(call, 'customer', customerAudio);
    const speech = isLikelyInboundVoice(call, pcm8k);
    const agentSpeaking = isAgentSpeakingForInputGate(call);
    if (!agentSpeaking && speech.confirmed) learnInboundVoiceProfile(call, speech.stats);
    if (speech.confirmed) holdInitialAgentOutput(call, agentAfterSpeechDelayMs);

    if (!inboundDialogueGateEnabled) {
      if (!agentSpeaking) {
        sendCustomerAudioToCallbot(call, customerAudio);
        call.inboundTalkoverActive = false;
        call.inboundTalkoverPrebuffer.length = 0;
      } else {
        call.inboundTalkoverPrebuffer.push(customerAudio);
        while (call.inboundTalkoverPrebuffer.length > inboundPrebufferFrames) call.inboundTalkoverPrebuffer.shift();

        if (!call.inboundTalkoverActive && shouldTriggerInboundBargeIn(call, speech)) {
          call.suppressOutputUntil = Date.now() + inboundBargeInHoldMs;
          call.rtpQueue.length = 0;
          call.rtpPending = Buffer.alloc(0);
          call.rtpPlaybackActive = false;
          call.lastAgentAudioAt = 0;
          call.inboundTalkoverActive = true;
          for (const pendingAudio of call.inboundTalkoverPrebuffer) sendCustomerAudioToCallbot(call, pendingAudio);
          call.inboundTalkoverPrebuffer.length = 0;
          call.ws.send(JSON.stringify({ type: 'barge_in', holdMs: inboundBargeInHoldMs }));
        } else if (call.inboundTalkoverActive && speech.active) {
          sendCustomerAudioToCallbot(call, customerAudio);
          call.inboundTalkoverPrebuffer.length = 0;
        } else if (!speech.active) {
          call.inboundTalkoverActive = false;
        }
      }
    } else {
      call.inboundPrebuffer.push(customerAudio);
      while (call.inboundPrebuffer.length > inboundPrebufferFrames) call.inboundPrebuffer.shift();

      if (speech.confirmed && !call.inboundDialogueActive) {
        for (const pendingAudio of call.inboundPrebuffer) sendCustomerAudioToCallbot(call, pendingAudio);
        call.inboundPrebuffer.length = 0;
        call.inboundDialogueActive = true;
      } else if (speech.active && call.inboundDialogueActive) {
        sendCustomerAudioToCallbot(call, customerAudio);
        call.inboundPrebuffer.length = 0;
      } else if (!speech.active) {
        call.inboundDialogueActive = false;
      }
    }
    call.inboundWasSpeechActive = speech.active;
  });

  socket.on('error', (error) => {
    console.error('RTP bridge error', error);
  });

  socket.bind(rtpPort, '0.0.0.0', () => {
    console.log(`RTP bridge listening on ${rtpPort}/udp`);
  });

  return socket;
}

function ariBaseUrl() {
  return `http://${ariHost}:${ariPort}/ari`;
}

function ariWsUrl() {
  return `ws://${ariHost}:${ariPort}/ari/events?app=robocall-callbot&api_key=${encodeURIComponent(`${ariUser}:${ariSecret}`)}`;
}

async function ariGetChannelVariable(channelId, variable) {
  try {
    const result = await ariRequest(`/channels/${encodeURIComponent(channelId)}/variable?variable=${encodeURIComponent(variable)}`);
    return cleanText(result.value);
  } catch {
    return '';
  }
}

async function ariRequest(pathname, options = {}) {
  const response = await fetch(`${ariBaseUrl()}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Basic ${Buffer.from(`${ariUser}:${ariSecret}`).toString('base64')}`,
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ARI ${response.status}: ${body}`);
  }
  return response.status === 204 ? null : response.json();
}

async function sendTelephonyJobEvent(jobId, event) {
  if (!jobId) return;
  const payload = {
    ...event,
    channelId: cleanText(event.channelId),
  };
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await telephonyQueueRequest(`/api/telephony/jobs/${jobId}/event`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return;
    } catch (error) {
      console.error(`Telephony job ${jobId} ${payload.status} event error attempt ${attempt}`, error.message);
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
    }
  }
}

async function cleanupAriCall(call) {
  if (call.cleaning) return;
  call.cleaning = true;
  ariCalls.delete(call.channelId);
  closeLiveMonitorClients(call);
  try {
    if (call.telephonyJobId && call.answeredAt && !call.endedEventSent) {
      call.endedEventSent = true;
      await sendTelephonyJobEvent(call.telephonyJobId, {
        status: 'ended',
        channelId: call.channelId,
        endedAt: new Date().toISOString(),
      });
    }
    if (call.rtpTimer) {
      clearInterval(call.rtpTimer);
      call.rtpTimer = null;
    }
    if (call.channelWatchTimer) {
      clearInterval(call.channelWatchTimer);
      call.channelWatchTimer = null;
    }
    call.rtpQueue.length = 0;
    call.rtpPending = Buffer.alloc(0);
    if (call.ws.readyState === WebSocket.OPEN) {
      call.ws.send(JSON.stringify({ type: 'call_ended' }));
      call.ws.close();
    } else if (call.ws.readyState === WebSocket.CONNECTING) {
      call.ws.close();
    }
  } catch {}
  for (const channelId of [call.externalChannelId, call.channelId]) {
    if (!channelId) continue;
    try {
      await ariRequest(`/channels/${encodeURIComponent(channelId)}`, { method: 'DELETE' });
    } catch {}
  }
  if (call.bridgeId) {
    try {
      await ariRequest(`/bridges/${encodeURIComponent(call.bridgeId)}`, { method: 'DELETE' });
    } catch {}
  }
}


function startChannelWatchdog(call) {
  if (call.channelWatchTimer) return;
  call.channelWatchTimer = setInterval(async () => {
    if (call.cleaning) return;
    try {
      const channel = await ariRequest(`/channels/${encodeURIComponent(call.channelId)}`);
      const state = cleanText(channel?.state).toLowerCase();
      if (state === 'down') {
        console.log(`ARI channel ${call.channelId} is down, cleaning call`);
        await cleanupAriCall(call);
      }
    } catch (error) {
      if (String(error?.message || '').includes('ARI 404')) {
        console.log(`ARI channel ${call.channelId} disappeared, cleaning call`);
        await cleanupAriCall(call);
      }
    }
  }, 1000);
}

async function startCallbotAriCall(channel, rtpSocket) {
  const [customerPhoneVar, agentIdVar, customerIdVar, jobIdVar] = await Promise.all([
    ariGetChannelVariable(channel.id, 'CALLBOT_CUSTOMER_PHONE'),
    ariGetChannelVariable(channel.id, 'CALLBOT_AGENT_ID'),
    ariGetChannelVariable(channel.id, 'CALLBOT_CUSTOMER_ID'),
    ariGetChannelVariable(channel.id, 'CALLBOT_JOB_ID'),
  ]);
  const channelPhone = phoneFromAriChannel(channel);
  const pendingJob = claimPendingTelephonyJob({ jobId: jobIdVar, phone: customerPhoneVar || channelPhone });
  const effectiveJobId = Number(jobIdVar || pendingJob?.id || 0) || null;
  console.log("Callbot ARI call " + channel.id + ": job=" + (effectiveJobId || "none") + ", phone=" + (customerPhoneVar || channelPhone || "unknown"));
  const effectiveAgentId = agentIdVar || pendingJob?.agentId || '';
  const effectiveCustomerId = customerIdVar || pendingJob?.customerId || '';
  const effectiveCustomerPhone = customerPhoneVar || pendingJob?.phone || channelPhone || '';

  const callbotUrl = await resolveCallbotUrl({
    callerPhone: customerPhoneVar || pendingJob?.phone || channel.caller?.number,
    calledNumber: channel.dialplan?.exten,
    channelId: channel.id,
    agentId: effectiveAgentId,
    customerId: effectiveCustomerId,
    jobId: effectiveJobId,
  });
  const ws = new WebSocket(callbotUrl, { perMessageDeflate: false });
  const call = {
    channelId: channel.id,
    bridgeId: null,
    externalChannelId: null,
    rtpRemote: null,
    rtpSeq: Math.floor(Math.random() * 65535),
    rtpTimestamp: 0,
    rtpSsrc: crypto.randomBytes(4).readUInt32BE(0),
    rtpSocket,
    ws,
    rtpQueue: [],
    rtpPending: Buffer.alloc(0),
    wsPendingAudio: [],
    rtpTimer: null,
    rtpPlaybackActive: false,
    lastAgentAudioAt: 0,
    suppressOutputUntil: 0,
    telephonyJobId: effectiveJobId,
    createdAt: new Date(),
    answeredAt: new Date(),
    customerPhone: effectiveCustomerPhone,
    agentId: effectiveAgentId ? Number(effectiveAgentId) : null,
    customerId: effectiveCustomerId ? Number(effectiveCustomerId) : null,
    calledNumber: channel.dialplan?.exten || '',
    endedEventSent: false,
    channelWatchTimer: null,
    cleaning: false,
    inboundSpeechFrames: 0,
    inboundSpeechUntil: 0,
    inboundBargeInFrames: 0,
    inboundBargeInCooldownUntil: 0,
    inboundWasSpeechActive: false,
    inboundDialogueActive: false,
    inboundTalkoverActive: false,
    inboundTalkoverPrebuffer: [],
    inboundNoiseFloor: 180,
    inboundVoiceProfile: null,
    inboundPrebuffer: [],
    autoEndRequested: false,
    autoEndReason: '',
    autoEndNotBefore: 0,
    autoEndDeadline: 0,
    initialAgentOutputUntil: Date.now() + Math.max(0, agentInitialDelayMs),
    initialAgentOutputReleased: false
  };
  ariCalls.set(channel.id, call);
  startChannelWatchdog(call);

  ws.on('open', () => {
    flushPendingCustomerAudio(call);
  });

  ws.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === 'end_call') {
        requestAutoEndCall(call, message.reason);
        return;
      }
      if (message.type !== 'audio' || !message.data) return;
      const pcm24k = base64ToPcm16(message.data);
      const pcm8k = resamplePcm16(pcm24k, 24000, 8000);
      const ulaw = pcm16ToUlaw(pcm8k);
      enqueueRtpAudio(call, ulaw);
    } catch (error) {
      console.error('Callbot ARI bad websocket message', error);
    }
  });

  ws.on('error', (error) => {
    console.error('Callbot ARI websocket error', error.message);
  });

  ws.on('close', (code, reasonBuffer) => {
    const reason = cleanText(reasonBuffer?.toString ? reasonBuffer.toString() : '');
    console.warn(`Callbot ARI websocket closed for channel ${call.channelId}: code=${code}${reason ? ` reason=${reason}` : ''}`);
    cleanupAriCall(call).catch((error) => console.error('Callbot ARI cleanup error', error));
  });

  await ariRequest(`/channels/${encodeURIComponent(channel.id)}/answer`, { method: 'POST' });
  call.answeredAt = new Date();
  call.initialAgentOutputUntil = Date.now() + Math.max(0, agentInitialDelayMs);
  await sendTelephonyJobEvent(call.telephonyJobId, {
    status: 'answered',
    channelId: channel.id,
    answeredAt: call.answeredAt.toISOString(),
  });
  const bridge = await ariRequest('/bridges?type=mixing', { method: 'POST' });
  call.bridgeId = bridge.id;
  await ariRequest(`/bridges/${encodeURIComponent(call.bridgeId)}/addChannel?channel=${encodeURIComponent(channel.id)}`, { method: 'POST' });
  const externalHost = `${rtpHost}:${rtpPort}`;
  const external = await ariRequest(`/channels/externalMedia?app=robocall-callbot&external_host=${encodeURIComponent(externalHost)}&format=ulaw&direction=both`, { method: 'POST' });
  call.externalChannelId = external.id;
  // Asterisk reports the actual local RTP port/address it allocated for this
  // UnicastRTP channel via channelvars on the creation response. Use it to seed
  // call.rtpRemote immediately instead of waiting to "learn" it from Asterisk's
  // first inbound packet — otherwise, if the far-end caller never sends any
  // audio (dead air, one-way media, etc.), Asterisk has nothing to relay to us,
  // never sends us anything either, we never learn a remote peer, and the bot's
  // greeting sits queued forever even though it's ready to go. The bot should
  // be able to speak first regardless of what the caller's leg is doing.
  const localPort = Number(external.channelvars?.UNICASTRTP_LOCAL_PORT || 0);
  const localAddress = cleanText(external.channelvars?.UNICASTRTP_LOCAL_ADDRESS);
  if (localPort && localAddress) {
    call.rtpRemote = { address: localAddress, port: localPort };
    ensureRtpSender(call);
  }
  // Asterisk can take a moment to register the just-created externalMedia channel into the
  // Stasis app; addChannel immediately after creation can 422 with "Channel not in Stasis
  // application" if it loses that race. Retry a few times before giving up.
  const addExternalChannelUrl = `/bridges/${encodeURIComponent(call.bridgeId)}/addChannel?channel=${encodeURIComponent(call.externalChannelId)}`;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await ariRequest(addExternalChannelUrl, { method: 'POST' });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      console.warn(`addChannel for externalMedia ${call.externalChannelId} failed (attempt ${attempt}/4): ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 200));
    }
  }
}

function startAriApp(rtpSocket) {
  const connect = () => {
    const ws = new WebSocket(ariWsUrl());
    ws.on('open', () => console.log('ARI app connected'));
    ws.on('message', async (raw) => {
      try {
        const event = JSON.parse(raw.toString());
        if (event.type === 'StasisStart' && event.channel?.name && !event.channel.name.startsWith('UnicastRTP/')) {
          await startCallbotAriCall(event.channel, rtpSocket);
        }
        if (['StasisEnd', 'ChannelHangupRequest', 'ChannelDestroyed'].includes(event.type)) {
          const call = ariCalls.get(event.channel?.id)
            || [...ariCalls.values()].find((item) => item.externalChannelId === event.channel?.id);
          if (call) {
            const eventChannelId = cleanText(event.channel?.id);
            const eventChannelName = cleanText(event.channel?.name);
            const eventCause = cleanText(event.cause_txt || event.cause || '');
            console.warn(`ARI ${event.type} for call channel=${call.channelId} eventChannel=${eventChannelId || 'n/a'} name=${eventChannelName || 'n/a'}${eventCause ? ` cause=${eventCause}` : ''}`);
            await cleanupAriCall(call);
          }
        }
      } catch (error) {
        console.error('ARI app event error', error);
      }
    });
    ws.on('close', () => {
      console.warn('ARI app disconnected, retrying');
      setTimeout(connect, 3000);
    });
    ws.on('error', (error) => {
      console.error('ARI app websocket error', error.message);
    });
  };
  connect();
}

async function renderConfig({ reload = true } = {}) {
  const state = await getState();
  const enabledTrunks = state.trunks.filter((item) => item.enabled);
  console.log(`[renderConfig] Enabled trunks: ${enabledTrunks.length}, Accounts: ${state.accounts.filter(a => a.enabled).length}`);
  
  const pjsip = [
    '; Generated by Robocall. Manual edits can be overwritten.',
    ...state.accounts.filter((item) => item.enabled).map(pjsipAccount),
    ...enabledTrunks.map(pjsipTrunk)
  ].join('\n');
  
  console.log(`[renderConfig] PJSIP config size: ${pjsip.length} bytes`);
  
  const enabledRules = state.rules.filter((item) => item.enabled);
  const hasCatchAll = enabledRules.some((rule) => rule.pattern === '_X.');
  const trunksById = new Map(state.trunks.map((trunk) => [String(trunk.id), trunk]));

  const dialplan = [
    '; Generated by Robocall. Manual edits can be overwritten.',
    '[robocall-dialplan]',
    ...enabledRules.flatMap((rule) => routeLines(rule, 1, trunksById)),
    ...(hasCatchAll ? [] : [
      'exten => _X.,1,NoOp(No CRM dialplan rule matched for ${EXTEN})',
      ' same => n,Answer()',
      ' same => n,Playback(vm-goodbye)',
      ' same => n,Hangup()'
    ]),
    '',
    ...state.ivrs.filter((item) => item.enabled).map(ivrBlock)
  ].join('\n');

  console.log(`[renderConfig] Dialplan config size: ${dialplan.length} bytes`);
  console.log(`[renderConfig] Writing to ${configDir}`);
  
  await fs.mkdir(configDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(configDir, 'pjsip_dynamic.conf'), pjsip),
    fs.writeFile(path.join(configDir, 'extensions_dynamic.conf'), dialplan)
  ]);
  
  console.log(`[renderConfig] Files written successfully`);

  const reloadResult = reload ? await reloadAsterisk() : { ok: true, message: 'Reload skipped' };
  console.log(`[renderConfig] Reload result: ${JSON.stringify(reloadResult)}`);
  return { ...state, reload: reloadResult };
}

app.get('/api/state', async (_req, res, next) => {
  try {
    res.json(await getState());
  } catch (error) {
    next(error);
  }
});

app.get('/api/system-status', async (_req, res) => {
  const telephony = await checkTelephonyStatus();
  let asterisk = statusItem(false, 'Not checked');
  let gsm = statusItem(false, 'Not checked');

  try {
    asterisk = await checkAsteriskStatus();
  } catch (error) {
    asterisk = statusItem(false, error.message || 'Asterisk check failed');
  }

  try {
    gsm = await checkGsmStatus(asterisk.ok);
  } catch (error) {
    gsm = statusItem(false, error.message || 'GSM check failed');
  }

  res.json({
    checkedAt: new Date().toISOString(),
    telephony,
    asterisk,
    gsm,
  });
});

app.get('/api/asterisk/logs', async (req, res, next) => {
  try {
    const requestedFile = cleanText(req.query.file || asteriskLogDefaultFile) || asteriskLogDefaultFile;
    if (!asteriskLogAllowedFiles.has(requestedFile)) {
      res.status(400).json({
        error: 'Invalid log file',
        allowedFiles: Array.from(asteriskLogAllowedFiles),
      });
      return;
    }

    const level = cleanText(req.query.level).toUpperCase();
    const q = cleanText(req.query.q).toLowerCase();
    const source = cleanText(req.query.source).toLowerCase();
    const limit = clampNumber(req.query.limit, 1, 1000, 200);
    const maxBytes = clampNumber(req.query.maxBytes, 64 * 1024, 8 * 1024 * 1024, 2 * 1024 * 1024);
    const sinceMinutes = clampNumber(req.query.sinceMinutes, 0, 7 * 24 * 60, 0);
    const sinceEpochMs = sinceMinutes > 0 ? Date.now() - (sinceMinutes * 60 * 1000) : 0;

    const { file, filePath } = await resolveAsteriskLogFile(requestedFile);
    const text = await readLastText(filePath, maxBytes);
    const lines = text.split(/\r?\n/).filter(Boolean);
    const filtered = [];

    for (let index = lines.length - 1; index >= 0 && filtered.length < limit; index -= 1) {
      const item = parseAsteriskLogLine(lines[index]);
      if (level && level !== 'ALL' && item.level !== level) continue;
      if (sinceEpochMs) {
        if (!item.timestamp) continue;
        if (Date.parse(item.timestamp) < sinceEpochMs) continue;
      }
      if (source) {
        const sourceText = `${item.source} ${item.raw}`.toLowerCase();
        if (!sourceText.includes(source)) continue;
      }
      if (q && !item.raw.toLowerCase().includes(q)) continue;
      filtered.push(item);
    }

    filtered.reverse();
    res.json({
      file,
      filePath,
      requestedFile,
      count: filtered.length,
      scannedLineCount: lines.length,
      filters: { file: requestedFile, level: level || 'ALL', q, source, limit, maxBytes, sinceMinutes },
      items: filtered,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      res.status(404).json({ error: 'Asterisk log file not found' });
      return;
    }
    next(error);
  }
});

app.post('/api/render', async (_req, res, next) => {
  try {
    res.json(await renderConfig());
  } catch (error) {
    next(error);
  }
});

app.post('/api/originate', async (req, res, next) => {
  try {
    const result = await originateAiCall(req.body);
    res.status(result.ok ? 202 : 502).json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/password', async (req, res, next) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current password and new password are required' });
      return;
    }
    if (newPassword.length < 12) {
      res.status(400).json({ error: 'New password must be at least 12 characters' });
      return;
    }
    if (!await verifyAdminPassword(currentPassword)) {
      res.status(403).json({ error: 'Current password is incorrect' });
      return;
    }

    const nextVersion = authSessionVersion + 1;
    await query(
      `INSERT INTO robocall_admin_auth (id, username, password_hash, session_version, updated_at)
       VALUES (1, $1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE
       SET username = EXCLUDED.username,
           password_hash = EXCLUDED.password_hash,
           session_version = EXCLUDED.session_version,
           updated_at = now()`,
      [authUsername, passwordHash(newPassword), nextVersion]
    );
    await refreshAuthState();
    res.setHeader('Set-Cookie', buildSessionCookie());
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});


app.post('/api/accounts', async (req, res, next) => {
  try {
    requireFields(req.body, ['name', 'extension', 'secret', 'account_type']);
    const rows = await query(
      `INSERT INTO sip_accounts (name, extension, secret, account_type, caller_id, host, transport, context, codecs, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        cleanText(req.body.name),
        cleanText(req.body.extension),
        cleanText(req.body.secret),
        cleanText(req.body.account_type),
        cleanText(req.body.caller_id),
        cleanText(req.body.host) || 'dynamic',
        cleanText(req.body.transport) || 'udp',
        cleanText(req.body.context) || 'from-internal',
        cleanText(req.body.codecs) || 'ulaw,alaw',
        boolValue(req.body.enabled ?? true)
      ]
    );
    await renderConfig();
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.put('/api/accounts/:id', async (req, res, next) => {
  try {
    const rows = await query(
      `UPDATE sip_accounts SET name=$1, extension=$2, secret=$3, account_type=$4, caller_id=$5,
       host=$6, transport=$7, context=$8, codecs=$9, enabled=$10, updated_at=now()
       WHERE id=$11 RETURNING *`,
      [
        cleanText(req.body.name),
        cleanText(req.body.extension),
        cleanText(req.body.secret),
        cleanText(req.body.account_type),
        cleanText(req.body.caller_id),
        cleanText(req.body.host) || 'dynamic',
        cleanText(req.body.transport) || 'udp',
        cleanText(req.body.context) || 'from-internal',
        cleanText(req.body.codecs) || 'ulaw,alaw',
        boolValue(req.body.enabled),
        req.params.id
      ]
    );
    await renderConfig();
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/:kind/:id', async (req, res, next) => {
  try {
    const table = tables[req.params.kind];
    if (!table) {
      res.status(404).json({ error: 'Unknown resource' });
      return;
    }
    await query(`DELETE FROM ${table} WHERE id=$1`, [req.params.id]);
    await renderConfig();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/trunks', async (req, res, next) => {
  try {
    requireFields(req.body, ['name', 'trunk_type', 'host']);
    const dialFormat = cleanText(req.body.dial_format) || 'local';
    if (!['local', 'intl'].includes(dialFormat)) {
      res.status(400).json({ error: 'dial_format must be one of: local, intl' });
      return;
    }
    const rows = await query(
      `INSERT INTO sip_trunks (name, trunk_type, host, port, username, secret, from_user, from_domain,
       inbound_context, outbound_prefix, codecs, enabled, dial_format)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        cleanText(req.body.name),
        cleanText(req.body.trunk_type),
        cleanText(req.body.host),
        Number(req.body.port || 5060),
        cleanText(req.body.username),
        cleanText(req.body.secret),
        cleanText(req.body.from_user),
        cleanText(req.body.from_domain),
        cleanText(req.body.inbound_context) || 'from-trunk',
        cleanText(req.body.outbound_prefix),
        cleanText(req.body.codecs) || 'ulaw,alaw',
        boolValue(req.body.enabled ?? true),
        dialFormat
      ]
    );
    await renderConfig();
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.put('/api/trunks/:id', async (req, res, next) => {
  try {
    const dialFormat = cleanText(req.body.dial_format) || 'local';
    if (!['local', 'intl'].includes(dialFormat)) {
      res.status(400).json({ error: 'dial_format must be one of: local, intl' });
      return;
    }
    const rows = await query(
      `UPDATE sip_trunks SET name=$1, trunk_type=$2, host=$3, port=$4, username=$5, secret=$6,
       from_user=$7, from_domain=$8, inbound_context=$9, outbound_prefix=$10, codecs=$11,
       enabled=$12, dial_format=$13, updated_at=now() WHERE id=$14 RETURNING *`,
      [
        cleanText(req.body.name),
        cleanText(req.body.trunk_type),
        cleanText(req.body.host),
        Number(req.body.port || 5060),
        cleanText(req.body.username),
        cleanText(req.body.secret),
        cleanText(req.body.from_user),
        cleanText(req.body.from_domain),
        cleanText(req.body.inbound_context) || 'from-trunk',
        cleanText(req.body.outbound_prefix),
        cleanText(req.body.codecs) || 'ulaw,alaw',
        boolValue(req.body.enabled),
        dialFormat,
        req.params.id
      ]
    );
    await renderConfig();
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.post('/api/rules', async (req, res, next) => {
  try {
    requireFields(req.body, ['pattern', 'route_type']);
    const rows = await query(
      `INSERT INTO dialplan_rules (priority, pattern, route_type, route_target, description, enabled)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        Number(req.body.priority || 100),
        cleanText(req.body.pattern),
        cleanText(req.body.route_type),
        cleanText(req.body.route_target),
        cleanText(req.body.description),
        boolValue(req.body.enabled ?? true)
      ]
    );
    await renderConfig();
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.put('/api/rules/:id', async (req, res, next) => {
  try {
    const rows = await query(
      `UPDATE dialplan_rules SET priority=$1, pattern=$2, route_type=$3, route_target=$4,
       description=$5, enabled=$6, updated_at=now() WHERE id=$7 RETURNING *`,
      [
        Number(req.body.priority || 100),
        cleanText(req.body.pattern),
        cleanText(req.body.route_type),
        cleanText(req.body.route_target),
        cleanText(req.body.description),
        boolValue(req.body.enabled),
        req.params.id
      ]
    );
    await renderConfig();
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.post('/api/ivrs', async (req, res, next) => {
  const client = await pool.connect();
  try {
    requireFields(req.body, ['name', 'extension']);
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO ivr_menus (name, extension, prompt, timeout_seconds, invalid_target, enabled)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        cleanText(req.body.name),
        cleanText(req.body.extension),
        cleanText(req.body.prompt) || 'demo-congrats',
        Number(req.body.timeout_seconds || 5),
        cleanText(req.body.invalid_target) || 'hangup',
        boolValue(req.body.enabled ?? true)
      ]
    );
    for (const option of req.body.options || []) {
      if (!cleanText(option.digit)) continue;
      await client.query(
        `INSERT INTO ivr_options (ivr_id, digit, target_type, target, label) VALUES ($1,$2,$3,$4,$5)`,
        [result.rows[0].id, cleanText(option.digit), cleanText(option.target_type), cleanText(option.target), cleanText(option.label)]
      );
    }
    await client.query('COMMIT');
    await renderConfig();
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

app.put('/api/ivrs/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE ivr_menus SET name=$1, extension=$2, prompt=$3, timeout_seconds=$4,
       invalid_target=$5, enabled=$6, updated_at=now() WHERE id=$7 RETURNING *`,
      [
        cleanText(req.body.name),
        cleanText(req.body.extension),
        cleanText(req.body.prompt) || 'demo-congrats',
        Number(req.body.timeout_seconds || 5),
        cleanText(req.body.invalid_target) || 'hangup',
        boolValue(req.body.enabled),
        req.params.id
      ]
    );
    await client.query('DELETE FROM ivr_options WHERE ivr_id=$1', [req.params.id]);
    for (const option of req.body.options || []) {
      if (!cleanText(option.digit)) continue;
      await client.query(
        `INSERT INTO ivr_options (ivr_id, digit, target_type, target, label) VALUES ($1,$2,$3,$4,$5)`,
        [req.params.id, cleanText(option.digit), cleanText(option.target_type), cleanText(option.target), cleanText(option.label)]
      );
    }
    await client.query('COMMIT');
    await renderConfig();
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

// PUT /api/ai (the /ai-api admin page's save endpoint) removed along with that page — it
// configured a broken/unused inbound-call fallback (ai_settings). See callbotWsUrl,
// resolveCallbotUrl, and startCallbotAriCall for how outbound calls resolve their config now.

// instruction_templates endpoints removed: the table now lives in the callbot
// database (AI/campaign content, unrelated to Asterisk/CRM telephony config).


async function telephonyQueueRequest(pathname, options = {}) {
  if (!telephonyQueueBaseUrl || !telephonyWorkerToken) {
    throw new Error('TELEPHONY_QUEUE_BASE_URL and TELEPHONY_WORKER_TOKEN are required');
  }

  const response = await fetch(`${telephonyQueueBaseUrl}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${telephonyWorkerToken}`,
      ...(options.headers || {}),
    },
  });

  if (response.status === 204) return null;

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Telephony queue HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function jobField(job, camelName, snakeName) {
  return job?.[camelName] ?? job?.[snakeName];
}

async function completeTelephonyJob(job) {
  const id = jobField(job, 'id', 'id');
  const claimToken = jobField(job, 'claimToken', 'claim_token');
  await telephonyQueueRequest(`/api/telephony/jobs/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ claimToken }),
  });
}

async function failTelephonyJob(job, error, retry = true) {
  const id = jobField(job, 'id', 'id');
  const claimToken = jobField(job, 'claimToken', 'claim_token');
  await telephonyQueueRequest(`/api/telephony/jobs/${id}/fail`, {
    method: 'POST',
    body: JSON.stringify({
      claimToken,
      retry,
      error: error?.message || String(error),
    }),
  });
}

async function classifyEarlyMediaFailure(result) {
  const filePath = cleanText(result?.earlyMediaPath);
  if (!filePath) return null;
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.CALLBOT_EARLY_MEDIA_FILE_DELAY_MS || 2500)));
  let info = null;
  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile() && stat.size > 1200) info = stat;
  } catch {}
  if (!info) return null;

  try {
    const audio = await fs.readFile(filePath);
    const body = await telephonyQueueRequest('/api/telephony/classify-audio', {
      method: 'POST',
      body: JSON.stringify({
        mimeType: 'audio/wav',
        audioBase64: audio.toString('base64'),
      }),
    });
    const reason = cleanText(body?.reason);
    const transcript = cleanText(body?.transcript).slice(0, 500);
    const confidence = Number(body?.confidence || 0);
    if (!reason || confidence < 0.35) return { transcript, confidence, reason: '' };
    return { reason, transcript, confidence };
  } catch (error) {
    console.warn('Early media classification request failed', error.message);
    return null;
  }
}

async function convertEarlyMediaToMp3(result) {
  const wavPath = cleanText(result?.earlyMediaPath);
  const mp3Path = cleanText(result?.earlyMediaMp3Path);
  if (!wavPath || !mp3Path) return 0;

  try {
    const wav = await fs.stat(wavPath);
    if (!wav.isFile() || wav.size <= 1200) return 0;
  } catch {
    return 0;
  }

  await fs.mkdir(path.dirname(mp3Path), { recursive: true });
  await fs.unlink(mp3Path).catch(() => {});
  await new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', wavPath,
      '-vn',
      '-codec:a', 'libmp3lame',
      '-b:a', process.env.CRM_EARLY_MEDIA_MP3_BITRATE || '64k',
      mp3Path,
    ]);
    let stderr = '';
    ffmpeg.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });

  try {
    const mp3 = await fs.stat(mp3Path);
    if (mp3.isFile() && mp3.size > 0) {
      console.log(`Early media recording converted to MP3: ${mp3Path} (${mp3.size} bytes)`);
      return mp3.size;
    }
  } catch {}
  return 0;
}

function startTelephonyQueueWorker() {
  if (!telephonyQueueBaseUrl || !telephonyWorkerToken) {
    console.log('Telephony queue worker disabled: TELEPHONY_QUEUE_BASE_URL or TELEPHONY_WORKER_TOKEN is not set');
    return;
  }

  // Each in-flight call occupies one slot; the backend's per-trunk claim
  // exclusivity spreads slots across the campaign's trunks.
  console.log(`Telephony queue worker started (max ${telephonyMaxConcurrentCalls} concurrent calls)`);
  let activeCalls = 0;
  let pausedUntil = 0;
  const poll = async () => {
    if (activeCalls >= telephonyMaxConcurrentCalls || Date.now() < pausedUntil) return;
    let claimedJob = null;
    activeCalls += 1;
    try {
      const qs = new URLSearchParams({ workerId: telephonyWorkerId });
      const body = await telephonyQueueRequest(`/api/telephony/jobs/next?${qs.toString()}`);
      const job = body?.job;
      if (!job) return;
      claimedJob = job;
      await completeTelephonyJob(job);

      // Fill the remaining slots immediately instead of waiting for the next
      // interval tick (each spawned poll claims one more job if available).
      if (activeCalls < telephonyMaxConcurrentCalls) {
        poll().catch((error) => console.error('Telephony queue worker error', error.message));
      }

      const result = await originateAiCall({
        phone: jobField(job, 'phone', 'phone'),
        agentId: jobField(job, 'agentId', 'agent_id'),
        customerId: jobField(job, 'customerId', 'customer_id'),
        jobId: jobField(job, 'id', 'id'),
        outboundChannel: jobField(job, 'outboundChannel', 'outbound_channel'),
        trunkId: jobField(job, 'trunkId', 'trunk_id'),
        waitForResult: true,
      });

      if (!result.ok) {
        const details = [
          result.message || 'AMI originate failed',
          result.actionId ? `actionId=${result.actionId}` : '',
          result.originateUniqueId ? `originateUniqueId=${result.originateUniqueId}` : '',
          result.lastAmiEvent ? `lastAmiEvent=${result.lastAmiEvent}` : '',
          result.dialStatus ? `dialStatus=${result.dialStatus}` : '',
          result.hangupCause ? `hangupCause=${result.hangupCause}` : '',
          result.hangupCauseText ? `hangupCauseText=${result.hangupCauseText}` : '',
          result.reason ? `reason=${result.reason}` : '',
        ].filter(Boolean).join('; ');
        await failTelephonyJob(job, new Error(details), false);
        classifyEarlyMediaFailure(result)
          .then(async () => convertEarlyMediaToMp3(result))
          .catch((error) => console.warn('Early media post-failure processing failed', error.message));
        claimedJob = null;
        return;
      }

      console.log(`Telephony queue job ${jobField(job, 'id', 'id')} originated to ${result.phone}`);
    } catch (error) {
      console.error('Telephony queue worker error', error.message);
      if (error.status === 401 || error.status === 503) {
        pausedUntil = Date.now() + 60000;
      }
      if (claimedJob) {
        try {
          // originateAiCall() marks permanent config problems (bad/missing trunk, no phone)
          // with status=400 -- those retry forever otherwise, since nothing about them
          // changes between polls. That leaves an external-API caller polling GET /calls/:id
          // for a call that will never dial (finalizeFailedJob/notifyExternalCallback only
          // fire once a job reaches a terminal, non-retry failure).
          const retryable = error.status !== 400;
          await failTelephonyJob(claimedJob, error, retryable);
        } catch (failError) {
          console.error('Telephony queue fail callback error', failError.message);
        }
      }
    } finally {
      activeCalls -= 1;
    }
  };

  setInterval(poll, Math.max(1000, telephonyPollIntervalMs));
  poll().catch((error) => console.error('Telephony queue initial poll failed', error.message));
}

app.post('/api/telephony/webhook', (req, res) => {
  console.log('AI telephony webhook', JSON.stringify(req.body));
  res.json({ ok: true });
});

async function callbotBaseUrl() {
  return cleanEnvUrl(telephonyQueueBaseUrl || 'https://robocall.az');
}

async function callbotPublicRequest(pathname, options = {}) {
  const baseUrl = await callbotBaseUrl();
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(10000),
    // The callbot API requires session auth; the telephony worker token is
    // accepted on the endpoints this worker consumes (recordings sync).
    headers: {
      Authorization: `Bearer ${telephonyWorkerToken}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error || `Callbot HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response;
}

app.get('/api/ai-token-status', async (_req, res, next) => {
  try {
    const response = await callbotPublicRequest('/api/ai-usage?period=today', {
      signal: AbortSignal.timeout(5000),
    });
    res.json(await response.json());
  } catch (error) {
    next(error);
  }
});

app.get('/api/callbot/recordings', async (_req, res, next) => {
  try {
    const response = await callbotPublicRequest('/api/recordings');
    res.json(await response.json());
  } catch (error) {
    next(error);
  }
});

async function proxyCallbotRecording(req, res, next, mode) {
  try {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      res.status(400).json({ error: 'Invalid job id' });
      return;
    }
    const response = await callbotPublicRequest(`/api/recordings/${jobId}/${mode}`);
    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    const contentLength = response.headers.get('content-length');
    const disposition = response.headers.get('content-disposition');
    res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (disposition) res.setHeader('Content-Disposition', disposition);
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    next(error);
  }
}

app.get('/api/callbot/recordings/:jobId/audio', (req, res, next) => {
  proxyCallbotRecording(req, res, next, 'audio');
});

app.get('/api/callbot/recordings/:jobId/download', (req, res, next) => {
  proxyCallbotRecording(req, res, next, 'download');
});

async function readRecordingsIndex() {
  try {
    const data = await fs.readFile(recordingsIndexPath, 'utf8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeRecordingsIndex(items) {
  await fs.mkdir(recordingsDir, { recursive: true });
  const sorted = [...items].sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
  await fs.writeFile(recordingsIndexPath, JSON.stringify(sorted, null, 2));
  return sorted;
}

function localRecordingPath(jobId) {
  return path.join(recordingsDir, `telephony-job-${jobId}.mp3`);
}

function earlyMediaRecordingPaths(jobId) {
  const id = Number(jobId || 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  const filename = `telephony-job-${id}-early.wav`;
  return {
    asteriskPath: `${earlyMediaAsteriskDir.replace(/\/+$/, '')}/${filename}`,
    localPath: path.join(earlyMediaLocalDir, filename),
    mp3Path: localRecordingPath(id),
  };
}

async function localRecordingInfo(jobId) {
  const candidates = [
    { filePath: localRecordingPath(jobId), contentType: 'audio/mpeg', filename: `call-${jobId}.mp3` },
  ].filter((item) => item.filePath);
  for (const candidate of candidates) {
    try {
      const info = await fs.stat(candidate.filePath);
      if (info.isFile() && info.size > 0) return { ...candidate, size: info.size };
    } catch {}
  }
  return null;
}

async function localRecordingExists(jobId) {
  const info = await localRecordingInfo(jobId);
  return info?.size || 0;
}

async function deleteCallbotRecording(jobId) {
  try {
    await callbotPublicRequest(`/api/recordings/${jobId}`, { method: 'DELETE' });
    return true;
  } catch (error) {
    console.warn(`Callbot recording ${jobId} delete failed`, error.message);
    return false;
  }
}

async function syncCallbotRecordingSummaries(byId) {
  try {
    const response = await callbotPublicRequest('/api/recordings/summaries');
    const remoteItems = await response.json();
    for (const item of Array.isArray(remoteItems) ? remoteItems : []) {
      const jobId = Number(item.jobId);
      const summary = cleanText(item.summary);
      const description = cleanText(item.description);
      if (!Number.isInteger(jobId) || jobId <= 0 || (!summary && !description)) continue;
      const previous = byId.get(jobId) || {};
      const localSize = await localRecordingExists(jobId);
      byId.set(jobId, {
        ...previous,
        ...item,
        jobId,
        summary: summary || previous.summary || null,
        description: description || previous.description || null,
        size: Number(previous.size || localSize || item.size || 0),
        storage: previous.storage || (Number(localSize || item.size || 0) ? 'robocall' : 'callbot-summary'),
        recordingUrl: previous.recordingUrl || (localSize ? `/api/recordings/${jobId}/audio` : item.recordingUrl || null),
        downloadUrl: previous.downloadUrl || (localSize ? `/api/recordings/${jobId}/download` : item.downloadUrl || null),
      });
    }
  } catch (error) {
    console.warn('Callbot recording summaries sync failed', error.message);
  }
}

async function syncCallbotRecordings() {
  await fs.mkdir(recordingsDir, { recursive: true });
  const existing = await readRecordingsIndex();
  const byId = new Map(existing.map((item) => [Number(item.jobId), item]));
  const response = await callbotPublicRequest('/api/recordings');
  const remoteItems = await response.json();

  for (const item of Array.isArray(remoteItems) ? remoteItems : []) {
    const jobId = Number(item.jobId);
    if (!Number.isInteger(jobId) || jobId <= 0) continue;
    const previous = byId.get(jobId) || {};
    const filePath = localRecordingPath(jobId);
    let size = await localRecordingExists(jobId);
    if (!size) {
      const audio = await callbotPublicRequest(`/api/recordings/${jobId}/download`);
      await fs.writeFile(filePath, Buffer.from(await audio.arrayBuffer()));
      size = await localRecordingExists(jobId);
    }
    if (size) {
      if (deleteRemoteRecordings) await deleteCallbotRecording(jobId);
    }
    byId.set(jobId, {
      ...previous,
      ...item,
      summary: cleanText(item.summary) || previous.summary || null,
      description: cleanText(item.description) || previous.description || null,
      size,
      storage: 'robocall',
      recordingUrl: `/api/recordings/${jobId}/audio`,
      downloadUrl: `/api/recordings/${jobId}/download`,
    });
  }

  await syncCallbotRecordingSummaries(byId);
  return writeRecordingsIndex([...byId.values()]);
}

async function currentRecordings() {
  try {
    return await syncCallbotRecordings();
  } catch (error) {
    console.warn('Callbot recordings sync failed, serving local cache', error.message);
    return readRecordingsIndex();
  }
}

function filterRecordings(items, queryParams = {}) {
  const range = buildDateRange(queryParams);
  const agent = cleanText(queryParams.agent).toLowerCase();
  const customer = cleanText(queryParams.customer).toLowerCase();
  const category = cleanText(queryParams.category).toLowerCase();
  const search = cleanText(queryParams.search).toLowerCase();
  const ranged = recordingsInRange(items, range);
  return {
    range,
    items: ranged.filter((item) => {
      if (agent && recordingAgentName(item).toLowerCase() !== agent) return false;
      if (customer && recordingCustomerName(item).toLowerCase() !== customer) return false;
      if (category && !summaryCategories(item).some((value) => value.toLowerCase() === category)) return false;
      if (search) {
        const haystack = [
          item.jobId,
          recordingAgentName(item),
          recordingCustomerName(item),
          item?.source?.number,
          item?.destination?.number,
          recordingSummaryText(item),
          recordingDescriptionText(item),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    }),
  };
}

function buildStatistics(items, allItems, range, queryParams = {}) {
  const durations = durationStats(items);
  const selectedAgent = cleanText(queryParams.agent).toLowerCase();
  const selectedCustomer = cleanText(queryParams.customer).toLowerCase();
  const customerFilterItems = selectedAgent
    ? allItems.filter((item) => recordingAgentName(item).toLowerCase() === selectedAgent)
    : allItems;
  const categoryFilterItems = allItems.filter((item) => {
    if (selectedAgent && recordingAgentName(item).toLowerCase() !== selectedAgent) return false;
    if (selectedCustomer && recordingCustomerName(item).toLowerCase() !== selectedCustomer) return false;
    return true;
  });
  const byDayMap = new Map();
  for (const item of items) {
    const date = recordingDateValue(item);
    if (!date) continue;
    const key = isoDate(date);
    const previous = byDayMap.get(key) || { date: key, count: 0, totalSeconds: 0, customers: [] };
    previous.count += 1;
    previous.totalSeconds += Number(item.durationSeconds || 0);
    const customerName = recordingCustomerName(item);
    if (!previous.customers.includes(customerName)) previous.customers.push(customerName);
    byDayMap.set(key, previous);
  }
  const byDay = [...byDayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const byAgent = countBy(items, recordingAgentName).map((row) => ({
    ...row,
    totalSeconds: items.filter((item) => recordingAgentName(item) === row.name).reduce((sum, item) => sum + Number(item.durationSeconds || 0), 0),
  }));
  const categoryRows = countBy(items.flatMap((item) => summaryCategories(item).map((category) => ({ category }))), (item) => item.category).slice(0, 20);

  return {
    range: {
      from: isoDate(range.from),
      to: isoDate(addDays(range.to, -1)),
      label: range.label,
    },
    totals: {
      calls: items.length,
      uniqueAgents: new Set(items.map(recordingAgentName)).size,
      uniqueCustomers: new Set(items.map(recordingCustomerName)).size,
      totalSeconds: durations.totalSeconds,
      averageSeconds: durations.averageSeconds,
      maxSeconds: durations.maxSeconds,
    },
    filters: {
      agents: countBy(allItems, recordingAgentName).map((item) => item.name),
      customers: countBy(customerFilterItems, recordingCustomerName).map((item) => item.name).slice(0, 300),
      categories: countBy(categoryFilterItems.flatMap((item) => summaryCategories(item).map((categoryName) => ({ categoryName }))), (item) => item.categoryName).map((item) => item.name),
    },
    byDay,
    byAgent,
    byCustomer: countBy(items, recordingCustomerName).slice(0, 20),
    byStatus: countBy(items, (item) => cleanText(item.status) || 'unknown'),
    byCategory: categoryRows,
  };
}

function reportWorkbook(items, range, period) {
  const stats = buildStatistics(items, items, range);
  const header = (values) => values.map((value) => ({ value, style: 1 }));
  const summaryRows = [
    header(['Report', 'Value']),
    ['Period', period || 'custom'],
    ['Range', range.label],
    ['Total calls', stats.totals.calls],
    ['Unique agent names', stats.totals.uniqueAgents],
    ['Unique customers', stats.totals.uniqueCustomers],
    ['Total duration', formatReportDuration(stats.totals.totalSeconds)],
    ['Average duration', formatReportDuration(stats.totals.averageSeconds)],
    [],
    header(['Agent name', 'Calls', 'Total duration']),
    ...stats.byAgent.map((item) => [item.name, item.count, formatReportDuration(item.totalSeconds)]),
    [],
    header(['Summary category', 'Calls']),
    ...stats.byCategory.map((item) => [item.name, item.count]),
  ];
  const callRows = [
    header(['Call ID', 'Started', 'Ended', 'Duration', 'Agent name', 'Agent number', 'Customer', 'Customer number', 'Status', 'Summary', 'Description']),
    ...items.map((item) => [
      Number(item.jobId || 0),
      formatReportDate(item.startedAt),
      formatReportDate(item.endedAt),
      formatReportDuration(item.durationSeconds),
      recordingAgentName(item),
      cleanText(item?.source?.number),
      recordingCustomerName(item),
      cleanText(item?.destination?.number),
      cleanText(item.status),
      { value: recordingSummaryText(item), style: 2 },
      { value: recordingDescriptionText(item), style: 2 },
    ]),
  ];
  return buildWorkbook([
    { name: 'Summary', rows: summaryRows, widths: [28, 34, 18] },
    { name: 'Calls', rows: callRows, widths: [10, 20, 20, 12, 22, 18, 28, 18, 12, 42, 70] },
  ]);
}

app.post('/api/recordings/sync', async (_req, res, next) => {
  try {
    res.json(await syncCallbotRecordings());
  } catch (error) {
    next(error);
  }
});

app.get('/api/recordings', async (_req, res, next) => {
  try {
    res.json(await currentRecordings());
  } catch (error) {
    next(error);
  }
});

app.get('/api/recordings/report.xlsx', async (req, res, next) => {
  try {
    const allItems = await currentRecordings();
    const { range, items } = filterRecordings(allItems, req.query);
    const period = cleanText(req.query.period) || 'custom';
    const workbook = reportWorkbook(items, range, period);
    const filename = `robocall-${period}-calls-${range.label.replace(/[^0-9A-Za-z_-]+/g, '_')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(workbook.length));
    res.send(workbook);
  } catch (error) {
    next(error);
  }
});

app.get('/api/statistics', async (req, res, next) => {
  try {
    const allItems = await currentRecordings();
    const { range, items } = filterRecordings(allItems, req.query);
    res.json(buildStatistics(items, allItems, range, req.query));
  } catch (error) {
    next(error);
  }
});

app.get('/api/live-calls', (_req, res) => {
  res.json(activeLiveCalls());
});

async function streamLocalRecording(req, res, disposition) {
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    res.status(400).json({ error: 'Invalid job id' });
    return;
  }
  const file = await localRecordingInfo(jobId);
  if (!file) {
    res.status(404).json({ error: 'Recording not found on robocall server' });
    return;
  }
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Length', String(file.size));
  res.setHeader('Content-Disposition', `${disposition}; filename="${file.filename}"`);
  createReadStream(file.filePath).pipe(res);
}

app.get('/api/recordings/:jobId/audio', (req, res, next) => {
  streamLocalRecording(req, res, 'inline').catch(next);
});

app.get('/api/recordings/:jobId/download', (req, res, next) => {
  streamLocalRecording(req, res, 'attachment').catch(next);
});

function startRecordingsSyncWorker() {
  let running = false;
  const sync = async () => {
    if (running) return;
    running = true;
    try {
      await syncCallbotRecordings();
    } catch (error) {
      console.warn('Recordings background sync failed', error.message);
    } finally {
      running = false;
    }
  };
  setInterval(sync, Math.max(10000, recordingsSyncIntervalMs));
  sync().catch((error) => console.warn('Recordings initial sync failed', error.message));
}

const liveMonitorServer = new WebSocketServer({ noServer: true });

liveMonitorServer.on('connection', (ws, request) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const channelId = cleanText(url.searchParams.get('channelId'));
  const call = channelId ? ariCalls.get(channelId) : null;

  if (!call || call.cleaning) {
    ws.send(JSON.stringify({ type: 'error', error: 'Call is not active' }));
    ws.close(1008, 'Call is not active');
    return;
  }

  const clients = liveMonitorClients.get(channelId) || new Set();
  clients.add(ws);
  liveMonitorClients.set(channelId, clients);
  ws.send(JSON.stringify({ type: 'connected', call: liveCallInfo(call) }));

  ws.on('close', () => {
    const current = liveMonitorClients.get(channelId);
    if (!current) return;
    current.delete(ws);
    if (!current.size) liveMonitorClients.delete(channelId);
  });
});

httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws/live-monitor') {
    socket.destroy();
    return;
  }
  liveMonitorServer.handleUpgrade(request, socket, head, (ws) => {
    liveMonitorServer.emit('connection', ws, request);
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || 'Internal error' });
});

httpServer.listen(port, async () => {
  console.log(`Robocall telephony panel listening on ${port}`);
  try {
    await ensureSchema();
    await ensureProdDefaults();
    await renderConfig({ reload: false });
    const rtpSocket = startRtpBridge();
    startAriApp(rtpSocket);
    startTelephonyQueueWorker();
    startRecordingsSyncWorker();
  } catch (error) {
    console.error('Initial render failed', error);
  }
});
