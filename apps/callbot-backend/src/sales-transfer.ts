import { WebSocket } from 'ws';
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';

// Connects a customer who agrees to the offer to a live sales rep without dropping the call.
//
// The customer's channel already sits in a mixing bridge with the bot's externalMedia channel
// (built by the telephony service). We dial the rep through the same trunk into our own ARI
// app (robocall-transfer), and when the rep answers we add that channel to the same bridge.
// The bot goes quiet but its media channel stays, so the telephony service keeps the call up;
// when either side hangs up the whole call ends.
//
// Reps are grouped by car brand (SALES_TRANSFER_GROUPS, "BYD: 161,162; Toyota: 334,305; Mitsubishi/Mazda: 514").
// They are tried in order of fewest robocall transfers answered today, then longest idle.

const ARI_APP = 'robocall-transfer';
const ariHost = process.env.ASTERISK_ARI_HOST || '127.0.0.1';
const ariPort = Number(process.env.ASTERISK_ARI_PORT || 8088);
const ariUser = process.env.ASTERISK_ARI_USER || 'robocallari';
const ariSecret = process.env.ASTERISK_ARI_SECRET || 'robocallAriSecret2026';
const ringSeconds = Math.max(8, Math.min(Number(process.env.SALES_TRANSFER_RING_SECONDS || 18), 60));
const maxAttempts = Math.max(1, Math.min(Number(process.env.SALES_TRANSFER_MAX_ATTEMPTS || 3), 10));

export const DEFAULT_SALES_GROUPS = 'BYD: 161,162,125,163; Toyota: 334,305,324,306,325; Mitsubishi/Mazda: 514,241,220';

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(rows) ? rows : [];
}

async function ari<T = any>(pathname: string, method = 'GET'): Promise<T> {
  const res = await fetch(`http://${ariHost}:${ariPort}/ari${pathname}`, {
    method,
    headers: { Authorization: `Basic ${Buffer.from(`${ariUser}:${ariSecret}`).toString('base64')}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`ARI ${res.status}: ${await res.text()}`);
  return (res.status === 204 ? null : await res.json()) as T;
}

export function parseSalesGroups(text: string): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const part of text.split(/[;\n]/)) {
    const [name, list] = part.split(':');
    if (!name || !list) continue;
    const exts = list.split(/[,\s]+/).map((x) => x.trim()).filter((x) => /^[0-9*#]{2,15}$/.test(x));
    // "Mitsubishi/Mazda: ..." gives both brands the same reps.
    if (exts.length) for (const n of name.split('/')) if (n.trim()) groups.set(n.trim().toLowerCase(), exts);
  }
  return groups;
}

export function salesExtensionsFor(brand: string | null | undefined): string[] {
  const groups = parseSalesGroups(process.env.SALES_TRANSFER_GROUPS || DEFAULT_SALES_GROUPS);
  const b = String(brand || '').trim().toLowerCase();
  if (!b) return [];
  for (const [name, exts] of groups) {
    if (b === name || b.includes(name) || name.includes(b)) return exts;
  }
  return [];
}

// A customer can be pinned to particular reps (arzoom_data.sales_ext = "306"), e.g. for tests.
export function pinnedExtensions(data: unknown): string[] {
  const raw = (data as { sales_ext?: unknown } | null)?.sales_ext;
  return String(raw ?? '').split(/[,\s]+/).map((x) => x.trim()).filter((x) => /^[0-9*#]{2,15}$/.test(x));
}

export async function ensureSalesTransferSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sales_transfers (
      id serial PRIMARY KEY,
      telephony_job_id integer,
      customer_id integer,
      brand varchar(80),
      extension varchar(20) NOT NULL,
      status varchar(20) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      ended_at timestamptz
    )
  `);
}

// Fewest answered transfers today first, then the one whose last transfer is oldest.
async function orderByLoad(exts: string[]): Promise<string[]> {
  const rows = rowsFrom(await db.execute(sql`
    SELECT extension,
      count(*) FILTER (WHERE status = 'answered' AND created_at >= date_trunc('day', now()))::int AS today,
      max(created_at) FILTER (WHERE status = 'answered') AS last_at,
      bool_or(status = 'answered' AND ended_at IS NULL AND created_at > now() - interval '2 hours') AS busy
    FROM sales_transfers WHERE extension = ANY(${`{${exts.join(',')}}`}::text[]) GROUP BY extension
  `));
  const stat = new Map(rows.map((r) => [String(r.extension), r]));
  const shuffled = [...exts].sort(() => Math.random() - 0.5);
  return shuffled
    .filter((e) => !stat.get(e)?.busy)
    .sort((a, b) => {
      const sa = stat.get(a);
      const sb = stat.get(b);
      const d = Number(sa?.today ?? 0) - Number(sb?.today ?? 0);
      if (d) return d;
      return new Date(String(sa?.last_at ?? 0)).getTime() - new Date(String(sb?.last_at ?? 0)).getTime();
    });
}

// ---- ARI event connection for our app --------------------------------------------------

type Waiter = (event: { type: string; cause?: string }) => void;
const waiters = new Map<string, Waiter>();
let socket: WebSocket | null = null;
let socketReady: Promise<void> | null = null;

function connect(): Promise<void> {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve();
  if (socketReady) return socketReady;
  socketReady = new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(
      `ws://${ariHost}:${ariPort}/ari/events?app=${ARI_APP}&api_key=${encodeURIComponent(`${ariUser}:${ariSecret}`)}`
    );
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('ARI connection timeout'));
    }, 5000);
    ws.on('open', () => {
      clearTimeout(timer);
      socket = ws;
      console.log('[sales-transfer] ARI app connected');
      resolve();
    });
    ws.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString());
        const id = event.channel?.id;
        if (!id) return;
        const waiter = waiters.get(id);
        if (waiter) waiter({ type: event.type, cause: event.cause_txt });
      } catch {}
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (socket === ws) socket = null;
      socketReady = null;
      reject(new Error('ARI connection closed'));
    });
    ws.on('error', (err) => console.warn('[sales-transfer] ARI websocket error', err.message));
  }).finally(() => {
    socketReady = null;
  });
  return socketReady;
}

export function startSalesTransferApp(): void {
  // Keep the app registered so originate into it always works; reconnect when Asterisk restarts.
  const keep = () => {
    connect().catch(() => {}).finally(() => {
      if (socket) socket.once('close', () => setTimeout(keep, 3000));
      else setTimeout(keep, 10000);
    });
  };
  keep();
}

// ---- One transfer -----------------------------------------------------------------------

export interface TransferHandle {
  cancel(): Promise<void>;
}

export interface TransferCallbacks {
  onConnected(ext: string): void;
  onFailed(reason: string): void;
  onRepHangup(): void;
}

export async function startSalesTransfer(
  params: { telephonyJobId: number | null; customerId: number; brand: string | null; callerId: string | null; extensions?: string[] },
  cb: TransferCallbacks
): Promise<TransferHandle> {
  let cancelled = false;
  let repChannelId: string | null = null;
  let transferRowId: number | null = null;
  let bridgeId: string | null = null;

  const hangupRep = async () => {
    if (repChannelId) {
      const id = repChannelId;
      repChannelId = null;
      waiters.delete(id);
      await ari(`/channels/${encodeURIComponent(id)}`, 'DELETE').catch(() => {});
    }
    if (transferRowId) {
      await db.execute(sql`UPDATE sales_transfers SET ended_at = now() WHERE id = ${transferRowId} AND ended_at IS NULL`).catch(() => {});
    }
  };
  const stopMoh = async () => {
    if (bridgeId) await ari(`/bridges/${encodeURIComponent(bridgeId)}/moh`, 'DELETE').catch(() => {});
  };

  const handle: TransferHandle = {
    async cancel() {
      cancelled = true;
      await hangupRep();
    },
  };

  void (async () => {
    try {
      const exts = params.extensions?.length ? params.extensions : salesExtensionsFor(params.brand);
      if (!exts.length) throw new Error(`no sales reps set for brand "${params.brand || '-'}"`);
      if (!params.telephonyJobId) throw new Error('no telephony job');
      const [job] = rowsFrom(await db.execute(sql`SELECT channel_id FROM telephony_jobs WHERE id = ${params.telephonyJobId}`));
      const customerChannelId = String(job?.channel_id || '');
      if (!customerChannelId) throw new Error('customer channel unknown');
      const channel = await ari<{ name: string }>(`/channels/${encodeURIComponent(customerChannelId)}`);
      // "PJSIP/trunk-<id>-0000001a" -> dial reps through the same trunk the customer is on.
      const endpoint = String(channel.name || '').replace(/^PJSIP\//, '').replace(/-[0-9a-f]{8}$/i, '');
      if (!endpoint) throw new Error('trunk of the customer channel unknown');
      const bridges = await ari<Array<{ id: string; channels: string[] }>>('/bridges');
      bridgeId = bridges.find((b) => b.channels?.includes(customerChannelId))?.id || null;
      if (!bridgeId) throw new Error('call bridge not found');
      await connect();

      const order = (await orderByLoad(exts)).slice(0, maxAttempts);
      if (!order.length) throw new Error('all sales reps are busy');
      await ari(`/bridges/${encodeURIComponent(bridgeId)}/moh`, 'POST').catch(() => {});

      for (const ext of order) {
        if (cancelled) return;
        const qs = new URLSearchParams({
          endpoint: `PJSIP/${ext}@${endpoint}`,
          app: ARI_APP,
          timeout: String(ringSeconds),
        });
        if (params.callerId) qs.set('callerId', params.callerId);
        let rep: { id: string };
        try {
          rep = await ari<{ id: string }>(`/channels?${qs.toString()}`, 'POST');
        } catch (err) {
          console.warn(`[sales-transfer] dial ${ext} failed`, (err as Error).message);
          continue;
        }
        repChannelId = rep.id;
        const answered = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => {
            waiters.delete(rep.id);
            resolve(false);
          }, (ringSeconds + 4) * 1000);
          waiters.set(rep.id, (event) => {
            if (event.type === 'StasisStart') {
              clearTimeout(timer);
              resolve(true);
            } else if (['ChannelDestroyed', 'StasisEnd', 'ChannelHangupRequest'].includes(event.type)) {
              clearTimeout(timer);
              waiters.delete(rep.id);
              resolve(false);
            }
          });
        });
        if (cancelled) {
          await hangupRep();
          return;
        }
        if (!answered) {
          await ari(`/channels/${encodeURIComponent(rep.id)}`, 'DELETE').catch(() => {});
          repChannelId = null;
          await db.execute(sql`
            INSERT INTO sales_transfers (telephony_job_id, customer_id, brand, extension, status, ended_at)
            VALUES (${params.telephonyJobId}, ${params.customerId}, ${params.brand}, ${ext}, 'no_answer', now())
          `).catch(() => {});
          continue;
        }

        await stopMoh();
        await ari(`/bridges/${encodeURIComponent(bridgeId)}/addChannel?channel=${encodeURIComponent(rep.id)}`, 'POST');
        const [row] = rowsFrom(await db.execute(sql`
          INSERT INTO sales_transfers (telephony_job_id, customer_id, brand, extension, status)
          VALUES (${params.telephonyJobId}, ${params.customerId}, ${params.brand}, ${ext}, 'answered') RETURNING id
        `));
        transferRowId = row ? Number(row.id) : null;
        // From now on the rep hanging up ends the call.
        waiters.set(rep.id, (event) => {
          if (['ChannelDestroyed', 'StasisEnd', 'ChannelHangupRequest'].includes(event.type)) {
            waiters.delete(rep.id);
            repChannelId = null;
            void hangupRep();
            cb.onRepHangup();
          }
        });
        console.log(`[sales-transfer] job ${params.telephonyJobId} connected to ${ext}`);
        cb.onConnected(ext);
        return;
      }
      await stopMoh();
      if (!cancelled) cb.onFailed('no sales rep answered');
    } catch (err) {
      await stopMoh();
      console.warn('[sales-transfer] failed', (err as Error).message);
      if (!cancelled) cb.onFailed((err as Error).message);
    }
  })();

  return handle;
}
