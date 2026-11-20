// Group Motors CRM (Bitrix24) through their voice API ("trigger" mode): our bot runs the
// conversation, their middleware creates and moves the lead. Off unless GM_VOICE_API_KEY is set.
//   GM_VOICE_API_KEY      key from Group Motors (never logged)
//   GM_VOICE_API_URL      default https://gm-bot-production.up.railway.app
//   GM_VOICE_TEST_PHONES  optional comma list: only these numbers go to the CRM (pilot)
import crypto from 'node:crypto';

const BRANDS: Record<string, string> = { toyota: 'Toyota', byd: 'BYD', mazda: 'Mazda', mitsubishi: 'Mitsubishi', gm: 'GM' };

const key = () => String(process.env.GM_VOICE_API_KEY || '').trim();
const baseUrl = () => String(process.env.GM_VOICE_API_URL || 'https://gm-bot-production.up.railway.app').trim().replace(/\/+$/, '');
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

export function gmBrand(raw: unknown): string | null {
  const t = String(raw ?? '').toLowerCase();
  if (/toyota|tayota|тойота/.test(t)) return 'Toyota';
  if (/\bbyd\b|^byd/.test(t)) return 'BYD';
  if (/mazda|мазда/.test(t)) return 'Mazda';
  if (/mitsub|мицуб/.test(t)) return 'Mitsubishi';
  return BRANDS[t.trim()] ?? null;
}

function phoneAllowed(phone: string): boolean {
  const list = String(process.env.GM_VOICE_TEST_PHONES || '').split(',').map(digits).filter(Boolean);
  if (!list.length) return true;
  const p = digits(phone);
  return list.some((x) => p.endsWith(x.slice(-9)));
}

async function request(path: string, body: unknown | null, timeoutMs: number): Promise<any> {
  const raw = body == null ? '' : JSON.stringify(body);
  const sig = crypto.createHmac('sha256', key()).update(raw).digest('hex');
  const res = await fetch(`${baseUrl()}${path}`, {
    method: body == null ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': `sha256=${sig}` },
    body: body == null ? undefined : raw,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}${json?.error ? `: ${String(json.error).slice(0, 200)}` : ''}`);
  return json;
}

export type GmOutcome = 'answered' | 'no_answer' | 'busy' | 'rejected' | 'wrong_number' | 'voicemail' | 'callback' | 'transferred' | 'failed';

export class GmCall {
  private sessionId: string | null = null;
  private ready: Promise<void>;
  private leadDone: Promise<void> | null = null;
  private handedOver = false;
  private lost = false;
  private finished = false;
  outcome: GmOutcome = 'answered';

  constructor(private readonly callId: string, private readonly phone: string, readonly brand: string, private readonly info: { name?: string; model?: string; campaign?: string; direction?: 'in' | 'out' }) {
    this.ready = request('/voice/session', {
      call_id: callId, phone: digits(phone), brand,
      name: info.name || undefined, model: info.model || undefined, lang: 'az',
      direction: info.direction || 'out', campaign: info.campaign || undefined,
    }, 10000).then((r) => {
      this.sessionId = r?.session_id || null;
      console.log(`[GM CRM] ${callId}: session opened${r?.known_client ? ', known client' : ''}${r?.lead_id ? `, lead ${r.lead_id}` : ''}`);
    }).catch((err) => console.warn(`[GM CRM] ${callId}: session failed: ${(err as Error).message}`));
  }

  private async call(path: string, body: Record<string, unknown>, timeoutMs = 10000): Promise<any> {
    await this.ready;
    if (!this.sessionId) return null;
    try {
      return await request(path, { session_id: this.sessionId, ...body }, timeoutMs);
    } catch (err) {
      console.warn(`[GM CRM] ${this.callId}: ${path} ${String(body.trigger || '')} failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** The lead of the request: found by number or created. Once the talk is about business. */
  ensureLead(): Promise<void> {
    if (!this.leadDone) this.leadDone = this.call('/voice/lead', { create: true }).then(() => undefined);
    return this.leadDone;
  }

  async trigger(name: string, args: Record<string, unknown>, timeoutMs = 10000): Promise<any> {
    if (name !== 'search_knowledge_base') await this.ensureLead();
    const r = await this.call('/voice/trigger', { trigger: name, args }, timeoutMs);
    if (r) console.log(`[GM CRM] ${this.callId}: ${name} ok`);
    return r;
  }

  /** Their knowledge base (prices, trims, dealer info). Short timeout: the customer is waiting. */
  async searchKb(query: string, model?: string): Promise<unknown> {
    // The customer hears silence while this runs: never wait more than 3 s in total (session included).
    const r = await Promise.race([
      this.trigger('search_knowledge_base', { query, brand: this.brand, model: model || undefined }, 3000),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    return r?.result ?? null;
  }

  async handoff(requestType: 'purchase' | 'trade_in' | 'consultation', summary: string, model?: string) {
    if (this.handedOver) return;
    this.handedOver = true;
    await this.trigger('handoff_to_consultant', { request_type: requestType, summary: summary.slice(0, 1000), client_phone: digits(this.phone), model: model || undefined, client_name: this.info.name || undefined });
  }

  /** A service matter (repair, maintenance, the free-service campaign): their service pipeline. */
  async escalateService(summary: string) {
    if (this.handedOver) return;
    this.handedOver = true;
    await this.trigger('escalate_to_operator', { reason: 'service', summary: summary.slice(0, 1000), client_phone: digits(this.phone), client_name: this.info.name || undefined });
  }

  async markLost(reason: 'finance' | 'car_not_available' | 'competitor' | 'postponed' | 'just_looking' | 'spam' | 'no_contact', clientWords: string) {
    if (this.lost || this.handedOver) return;
    this.lost = true;
    await this.trigger('mark_lead_lost', { reason, client_words: clientWords.slice(0, 500) });
  }

  async finish(durationSeconds: number, transcriptLines: string[]) {
    if (this.finished) return;
    this.finished = true;
    const lines = transcriptLines
      .map((l) => {
        const m = /^(A|C):\s*(.*)$/s.exec(l);
        return m && m[2].trim() ? { role: m[1] === 'A' ? 'bot' : 'client', text: m[2].trim() } : null;
      })
      .filter(Boolean);
    const r = await this.call('/voice/finish', { outcome: this.outcome, duration_seconds: durationSeconds, lines });
    if (r) console.log(`[GM CRM] ${this.callId}: finished (${this.outcome})`);
  }
}

export function startGmCall(opts: { callId: string; phone: string | null | undefined; brand: unknown; name?: string; model?: string; campaign?: string; direction?: 'in' | 'out' }): GmCall | null {
  if (!key() || !opts.phone) return null;
  const brand = gmBrand(opts.brand);
  if (!brand || !phoneAllowed(opts.phone)) return null;
  return new GmCall(opts.callId, opts.phone, brand, opts);
}

/** For the settings check: reachability and the key, without exposing it. */
export async function gmPing(): Promise<unknown> {
  if (!key()) return { configured: false };
  return request('/voice/ping', null, 8000);
}
