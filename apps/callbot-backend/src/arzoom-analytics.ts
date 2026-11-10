import { computeCallAnalytics } from './call-analytics.js';

// Pushes a call-analytics snapshot (today / 7 days / 30 days, ARZOOM customers only) to
// ARZOOM, so the ARZOOM panel shows the same numbers and conversation outcomes as the
// ArzoomCall dashboard. Sent shortly after every call ends and every few minutes as a
// heartbeat. ARZOOM keeps the latest snapshot; older ones are simply replaced.
const FETCH_TIMEOUT_MS = 20_000;
const DEBOUNCE_MS = 20_000;
const RECENT_CALLS_LIMIT = 1000;
const HEARTBEAT_MS = 5 * 60_000;
const MISSING_ENDPOINT_BACKOFF_MS = 30 * 60_000;

let timer: NodeJS.Timeout | null = null;
let running: Promise<void> | null = null;
let pausedUntil = 0;

function endpoint(): { url: string; token: string } | null {
  const raw = String(process.env.ARZOOM_API_URL || '').trim();
  const token = String(process.env.ARZOOM_API_TOKEN || '').trim();
  if (!raw || !token) return null;
  try {
    return { url: `${new URL(raw).origin}/api/integrations/robocall/analytics`, token };
  } catch {
    return null;
  }
}

// Keeps the snapshot well under ARZOOM's 3 MB body limit even with 1000 conversations.
function clip(value: unknown, max: number): string | null {
  const text = value == null ? '' : String(value);
  return text ? (text.length > max ? `${text.slice(0, max - 1)}…` : text) : null;
}

export async function buildArzoomAnalyticsSnapshot() {
  const [today, week, all] = await Promise.all([
    computeCallAnalytics({ days: 1, arzoomOnly: true, recentLimit: 0 }),
    computeCallAnalytics({ days: 7, arzoomOnly: true, recentLimit: 0 }),
    computeCallAnalytics({ days: 90, arzoomOnly: true, recentLimit: RECENT_CALLS_LIMIT }),
  ]);
  const strip = ({ recent: _r, campaigns: _c, ...rest }: typeof today) => rest;
  return {
    source: 'arzoomcall',
    generated_at: new Date().toISOString(),
    periods: { today: strip(today), week: strip(week), month: strip(await computeCallAnalytics({ days: 30, arzoomOnly: true, recentLimit: 0 })) },
    // Every conversation of the last 90 days (newest first, up to RECENT_CALLS_LIMIT) with the
    // outcome, the reason the bot recorded and the AI summary, so older ones show up too.
    recent_calls: all.recent.map((r) => ({
      ...r,
      reason: clip(r.reason, 800),
      summary: clip(r.summary, 800),
    })),
  };
}

async function pushNow(): Promise<void> {
  const ep = endpoint();
  if (!ep || Date.now() < pausedUntil) return;
  const body = await buildArzoomAnalyticsSnapshot();
  const res = await fetch(ep.url, {
    method: 'POST',
    headers: { 'X-Integration-Token': ep.token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 404 || res.status === 405) {
    pausedUntil = Date.now() + MISSING_ENDPOINT_BACKOFF_MS;
    console.warn('[arzoom-analytics] ARZOOM has no analytics endpoint yet; retrying in 30 minutes');
    return;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export function pushArzoomAnalytics(): Promise<void> {
  if (running) return running;
  running = pushNow()
    .catch((err) => console.error('[arzoom-analytics] push failed', (err as Error)?.message || err))
    .finally(() => {
      running = null;
    });
  return running;
}

// Called whenever a call ends or feedback is recorded; several calls in a row collapse into one push.
export function scheduleArzoomAnalyticsPush(): void {
  if (!endpoint()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void pushArzoomAnalytics();
  }, DEBOUNCE_MS);
}

export function startArzoomAnalyticsPush(): void {
  setInterval(() => void pushArzoomAnalytics(), HEARTBEAT_MS).unref?.();
  setTimeout(() => void pushArzoomAnalytics(), 30_000).unref?.();
}
