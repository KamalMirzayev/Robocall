import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';

const sessionCookieName = process.env.AUTH_COOKIE_NAME || 'robocall_session';
const idleTimeoutMinutes = Number(process.env.AUTH_IDLE_TIMEOUT_MINUTES || 240);
const sessionMaxDays = Number(process.env.AUTH_SESSION_MAX_DAYS || 14);
const secureCookie = process.env.AUTH_COOKIE_SECURE !== 'false';
// Avoid extending the idle window on every single request; only bump it once per throttle window.
const idleRefreshThrottleMs = Math.min(5 * 60 * 1000, Math.floor((idleTimeoutMinutes * 60 * 1000) / 2));

export type AppRole = 'admin' | 'campaign_manager' | 'viewer';

export type AppUser = {
  id: number;
  username: string;
  displayName: string;
  role: AppRole;
  active: boolean;
};

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const maybeRows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(maybeRows) ? maybeRows : [];
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeRole(value: unknown): AppRole {
  const role = cleanText(value);
  if (role === 'admin' || role === 'campaign_manager') return role;
  return 'viewer';
}

function publicUser(row: Record<string, unknown>): AppUser {
  return {
    id: Number(row.id),
    username: String(row.username ?? ''),
    displayName: String(row.display_name ?? row.displayName ?? row.username ?? ''),
    role: normalizeRole(row.role),
    active: row.active === true || row.active === 'true',
  };
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie || '';
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')): string {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: unknown): boolean {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(sessionCookieName, token, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'lax',
    path: '/',
    // Cookie lives up to the absolute cap; the idle timeout is enforced server-side against app_sessions.
    maxAge: sessionMaxDays * 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res: Response) {
  res.clearCookie(sessionCookieName, { httpOnly: true, secure: secureCookie, sameSite: 'lax', path: '/' });
}

export async function ensureAuthSchema() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app_users (
      id serial PRIMARY KEY,
      username varchar(80) NOT NULL UNIQUE,
      display_name varchar(160) NOT NULL,
      password_hash text NOT NULL,
      role varchar(20) NOT NULL DEFAULT 'viewer',
      active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app_sessions (
      token_hash text PRIMARY KEY,
      user_id integer NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      created_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now(),
      expires_at timestamp NOT NULL,
      absolute_expires_at timestamp NOT NULL DEFAULT now() + interval '14 days'
    )
  `);
  // Migrate sessions created before idle-timeout/absolute-cap support existed.
  await db.execute(sql`ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamp NOT NULL DEFAULT now()`);
  await db.execute(sql`ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS absolute_expires_at timestamp`);
  await db.execute(sql`
    UPDATE app_sessions
    SET absolute_expires_at = created_at + (${sessionMaxDays} || ' days')::interval
    WHERE absolute_expires_at IS NULL
  `);
  await db.execute(sql`ALTER TABLE app_sessions ALTER COLUMN absolute_expires_at SET NOT NULL`);

  // Migrate the old binary admin/operator role scheme to admin/campaign_manager/viewer.
  await db.execute(sql`UPDATE app_users SET role = 'campaign_manager' WHERE role = 'operator'`);
  await db.execute(sql`ALTER TABLE app_users ALTER COLUMN role SET DEFAULT 'viewer'`);

  // PKS import async job table — created here so it exists before any import is enqueued.
  // Mirrors the app_users/app_sessions pattern: raw SQL at boot, declared in schema.ts
  // so drizzle-kit push never proposes dropping it.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pks_import_jobs (
      id serial PRIMARY KEY,
      campaign_id integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      status varchar(20) NOT NULL DEFAULT 'queued',
      request jsonb NOT NULL,
      result jsonb,
      total_pages integer,
      pages_fetched integer NOT NULL DEFAULT 0,
      rows_fetched integer NOT NULL DEFAULT 0,
      customers_created integer NOT NULL DEFAULT 0,
      customers_updated integer NOT NULL DEFAULT 0,
      attached_rows integer NOT NULL DEFAULT 0,
      last_error text,
      created_by integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      completed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const existing = rowsFrom(await db.execute(sql`SELECT count(*)::int AS count FROM app_users`));
  if (Number(existing[0]?.count ?? 0) === 0) {
    const username = cleanText(process.env.AUTH_INITIAL_USERNAME || 'admin');
    const password = cleanText(process.env.AUTH_INITIAL_PASSWORD);
    if (!password) {
      console.warn('No app users exist and AUTH_INITIAL_PASSWORD is not set; login is disabled until a user is created.');
      return;
    }
    await db.execute(sql`
      INSERT INTO app_users (username, display_name, password_hash, role, active)
      VALUES (${username}, 'Administrator', ${hashPassword(password)}, 'admin', true)
    `);
    console.log(`Initial admin user created: ${username}`);
  }
}

export async function currentUser(req: Request): Promise<AppUser | null> {
  const token = parseCookies(req)[sessionCookieName];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const rows = rowsFrom(await db.execute(sql`
    SELECT u.id, u.username, u.display_name, u.role, u.active, s.last_seen_at
    FROM app_sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash}
      AND s.expires_at > now()
      AND s.absolute_expires_at > now()
      AND u.active = true
    LIMIT 1
  `));
  const row = rows[0];
  if (!row) return null;

  const lastSeenAt = new Date(String(row.last_seen_at)).getTime();
  if (Number.isNaN(lastSeenAt) || Date.now() - lastSeenAt > idleRefreshThrottleMs) {
    await db.execute(sql`
      UPDATE app_sessions
      SET last_seen_at = now(),
          expires_at = LEAST(now() + (${idleTimeoutMinutes} || ' minutes')::interval, absolute_expires_at)
      WHERE token_hash = ${tokenHash}
    `);
  }

  return publicUser(row);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await currentUser(req);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user?: AppUser }).user = user;
    next();
  } catch (err) {
    console.error('Auth middleware error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Session auth OR telephony worker token. The telephony backend
// syncs recordings from this API every 60s but has no session — it authenticates
// with the same TELEPHONY_WORKER_TOKEN it uses for the job queue.
export async function requireAuthOrWorker(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await currentUser(req);
    if (user) {
      (req as Request & { user?: AppUser }).user = user;
      next();
      return;
    }
    const expected = process.env.TELEPHONY_WORKER_TOKEN;
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.get('x-telephony-token');
    if (expected && token && token === expected) {
      next();
      return;
    }
    res.status(401).json({ error: 'unauthorized' });
  } catch (err) {
    console.error('Auth middleware error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Must run after requireAuth (relies on req.user being set).
export function requireRole(...roles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { user?: AppUser }).user;
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}

function requireAdmin(req: Request, res: Response): AppUser | null {
  const user = (req as Request & { user?: AppUser }).user;
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'admin required' });
    return null;
  }
  return user;
}

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const username = cleanText(req.body.username).toLowerCase();
  const password = String(req.body.password ?? '');
  if (!username || !password) {
    res.status(400).json({ error: 'username and password required' });
    return;
  }

  const rows = rowsFrom(await db.execute(sql`
    SELECT id, username, display_name, role, active, password_hash
    FROM app_users
    WHERE lower(username) = ${username}
    LIMIT 1
  `));
  const row = rows[0];
  if (!row || row.active !== true || !verifyPassword(password, row.password_hash)) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }

  const token = crypto.randomBytes(32).toString('base64url');
  await db.execute(sql`
    INSERT INTO app_sessions (token_hash, user_id, expires_at, absolute_expires_at)
    VALUES (
      ${hashToken(token)},
      ${Number(row.id)},
      now() + (${idleTimeoutMinutes} || ' minutes')::interval,
      now() + (${sessionMaxDays} || ' days')::interval
    )
  `);
  setSessionCookie(res, token);
  res.json({ user: publicUser(row) });
});

authRouter.post('/logout', async (req, res) => {
  const token = parseCookies(req)[sessionCookieName];
  if (token) await db.execute(sql`DELETE FROM app_sessions WHERE token_hash = ${hashToken(token)}`);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: (req as Request & { user?: AppUser }).user });
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const actor = (req as Request & { user?: AppUser }).user!;
  const currentPassword = String(req.body.currentPassword ?? '');
  const newPassword = String(req.body.newPassword ?? '');
  if (!currentPassword || newPassword.length < 8) {
    res.status(400).json({ error: 'currentPassword and newPassword (min 8 characters) are required' });
    return;
  }
  const rows = rowsFrom(await db.execute(sql`
    SELECT password_hash FROM app_users WHERE id = ${actor.id} LIMIT 1
  `));
  if (!rows[0] || !verifyPassword(currentPassword, rows[0].password_hash)) {
    res.status(401).json({ error: 'current password is incorrect' });
    return;
  }
  await db.execute(sql`
    UPDATE app_users SET password_hash = ${hashPassword(newPassword)}, updated_at = now()
    WHERE id = ${actor.id}
  `);
  res.json({ ok: true });
});

authRouter.get('/users', requireAuth, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const rows = rowsFrom(await db.execute(sql`
    SELECT id, username, display_name, role, active, created_at, updated_at
    FROM app_users
    ORDER BY id ASC
  `));
  res.json(rows.map(publicUser));
});

authRouter.post('/users', requireAuth, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const username = cleanText(req.body.username).toLowerCase();
  const displayName = cleanText(req.body.displayName || req.body.display_name || username);
  const password = String(req.body.password ?? '');
  const role = normalizeRole(req.body.role);
  if (!username || password.length < 8) {
    res.status(400).json({ error: 'username and password with at least 8 characters are required' });
    return;
  }
  try {
    const rows = rowsFrom(await db.execute(sql`
      INSERT INTO app_users (username, display_name, password_hash, role, active)
      VALUES (${username}, ${displayName}, ${hashPassword(password)}, ${role}, ${req.body.active !== false})
      RETURNING id, username, display_name, role, active
    `));
    res.status(201).json(publicUser(rows[0]));
  } catch (err) {
    console.error('Create user error', err);
    res.status(409).json({ error: 'user already exists or cannot be created' });
  }
});

authRouter.put('/users/:id', requireAuth, async (req, res) => {
  const actor = requireAdmin(req, res);
  if (!actor) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid user id' });
    return;
  }
  const displayName = cleanText(req.body.displayName || req.body.display_name || req.body.username);
  const role = normalizeRole(req.body.role);
  const active = req.body.active !== false;
  const password = cleanText(req.body.password);
  if (!displayName) {
    res.status(400).json({ error: 'displayName required' });
    return;
  }
  if (actor.id === id && (!active || role !== 'admin')) {
    res.status(400).json({ error: 'cannot remove your own admin access' });
    return;
  }

  const rows = password
    ? rowsFrom(await db.execute(sql`
        UPDATE app_users
        SET display_name = ${displayName}, role = ${role}, active = ${active}, password_hash = ${hashPassword(password)}, updated_at = now()
        WHERE id = ${id}
        RETURNING id, username, display_name, role, active
      `))
    : rowsFrom(await db.execute(sql`
        UPDATE app_users
        SET display_name = ${displayName}, role = ${role}, active = ${active}, updated_at = now()
        WHERE id = ${id}
        RETURNING id, username, display_name, role, active
      `));
  if (!rows[0]) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  res.json(publicUser(rows[0]));
});

authRouter.delete('/users/:id', requireAuth, async (req, res) => {
  const actor = requireAdmin(req, res);
  if (!actor) return;
  const id = Number(req.params.id);
  if (actor.id === id) {
    res.status(400).json({ error: 'cannot delete your own user' });
    return;
  }
  await db.execute(sql`DELETE FROM app_users WHERE id = ${id}`);
  res.status(204).end();
});
