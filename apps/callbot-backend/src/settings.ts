import { sql } from 'drizzle-orm';
import { db } from './db/index.js';

// Keys and tokens an admin enters in the panel (Admin -> Integrations) instead of the .env.
// Saved values live in app_settings and are applied to process.env, so the code that already
// reads process.env.X at call time picks them up without a restart. A panel value wins over
// the .env value; clearing it in the panel falls back to the .env value again.

export interface SettingDef {
  key: string;
  group: 'ai' | 'knowledge' | 'arzoom' | 'whatsapp' | 'webhook' | 'pks';
  secret: boolean;
  url?: boolean;
  placeholder?: string;
}

export const SETTINGS: SettingDef[] = [
  { key: 'GEMINI_API_KEY', group: 'ai', secret: true },
  { key: 'PARTNER_KB_URL', group: 'knowledge', secret: false, url: true },
  { key: 'PARTNER_KB_TOKEN', group: 'knowledge', secret: true },
  { key: 'RAG_SEARCH_URL', group: 'knowledge', secret: false, url: true },
  { key: 'ARZOOM_API_URL', group: 'arzoom', secret: false, url: true },
  { key: 'ARZOOM_API_TOKEN', group: 'arzoom', secret: true },
  // Sales reps a customer who agrees is connected to, by car brand: "BYD: 161,162; Toyota: 334,305".
  { key: 'SALES_TRANSFER_GROUPS', group: 'arzoom', secret: false, placeholder: 'BYD: 161,162,125,163; Toyota: 334,305,324,306,325; Mitsubishi/Mazda: 514,241,220' },
  { key: 'EVOLUTION_API_URL', group: 'whatsapp', secret: false, url: true },
  { key: 'EVOLUTION_API_KEY', group: 'whatsapp', secret: true },
  { key: 'EVOLUTION_INSTANCE_NAME', group: 'whatsapp', secret: false },
  { key: 'WEBHOOK_URL', group: 'webhook', secret: false, url: true },
  { key: 'WEBHOOK_SECRET', group: 'webhook', secret: true },
  { key: 'PKS_DB_QUERY_URL', group: 'pks', secret: false, url: true },
  { key: 'PKS_DB_QUERY_API_KEY', group: 'pks', secret: true },
];

const byKey = new Map(SETTINGS.map((s) => [s.key, s]));
// The .env values as they were at startup, to fall back to when a panel value is cleared.
const envDefaults = new Map(SETTINGS.map((s) => [s.key, process.env[s.key] ?? '']));
const meta = new Map<string, { updatedAt: string; updatedBy: string | null }>();

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(rows) ? rows : [];
}

export function isSettingKey(key: string): boolean {
  return byKey.has(key);
}

export async function loadSettings(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS app_settings (
      key varchar(100) PRIMARY KEY,
      value text NOT NULL,
      updated_by varchar(80),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const rows = rowsFrom(await db.execute(sql`SELECT key, value, updated_by, updated_at FROM app_settings`));
  for (const row of rows) {
    const key = String(row.key);
    if (!byKey.has(key)) continue;
    process.env[key] = String(row.value);
    meta.set(key, { updatedAt: new Date(row.updated_at as string).toISOString(), updatedBy: (row.updated_by as string) ?? null });
  }
}

export function validateSetting(key: string, value: string): string | null {
  const def = byKey.get(key);
  if (!def) return 'unknown setting';
  if (value.length > 2000) return 'value is too long';
  if (def.url && value) {
    try {
      const u = new URL(value);
      // Internal services (PKS, Evolution) may sit on plain http inside the network.
      if (!['https:', 'http:'].includes(u.protocol)) return 'URL must start with https://';
    } catch {
      return 'URL is not valid';
    }
  }
  return null;
}

// Empty value removes the panel value and falls back to the .env value.
export async function saveSetting(key: string, value: string, username: string | null): Promise<void> {
  if (value) {
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_by, updated_at)
      VALUES (${key}, ${value}, ${username}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
    `);
    process.env[key] = value;
    meta.set(key, { updatedAt: new Date().toISOString(), updatedBy: username });
  } else {
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${key}`);
    process.env[key] = envDefaults.get(key) ?? '';
    meta.delete(key);
  }
}

// What the panel may see: never a secret's value, only that it is set and its last 4 chars.
export function describeSettings() {
  return SETTINGS.map((def) => {
    const value = process.env[def.key] ?? '';
    const fromPanel = meta.get(def.key);
    return {
      key: def.key,
      group: def.group,
      secret: def.secret,
      placeholder: def.placeholder ?? null,
      set: Boolean(value),
      source: fromPanel ? 'panel' : value ? 'env' : null,
      value: def.secret ? null : value,
      hint: def.secret && value ? `••••${value.slice(-4)}` : null,
      updatedAt: fromPanel?.updatedAt ?? null,
      updatedBy: fromPanel?.updatedBy ?? null,
    };
  });
}
