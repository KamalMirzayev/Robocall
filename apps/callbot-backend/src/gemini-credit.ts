import { GoogleGenAI } from '@google/genai';

// Google gives no API for the Gemini prepay balance, but when it runs out every request
// fails with 402 Payment Required or 429 "prepayment credits are depleted". We watch for
// that: the live call proxy reports such errors here, the campaign scheduler stops dialing
// (a customer would otherwise get a silent call), and a tiny probe request every few
// minutes clears the flag as soon as credits are back.
const PROBE_MS = 3 * 60_000;
const PROBE_MODEL = process.env.GEMINI_CREDIT_PROBE_MODEL || 'gemini-2.5-flash-lite';

let depletedAt: Date | null = null;
let lastError = '';
let lastProbeAt: Date | null = null;

export function isCreditError(value: unknown): boolean {
  const text = String((value as { message?: unknown })?.message ?? value ?? '');
  return /prepay|prepayment|credits? (are|is) (depleted|exhausted)|payment required|\b402\b|billing (account|is)|insufficient (funds|balance|credit)/i.test(text);
}

export function reportGeminiError(value: unknown): void {
  if (!isCreditError(value)) return;
  if (!depletedAt) console.error('[gemini-credit] Gemini credits look depleted; campaign dialing paused until they are back');
  depletedAt = new Date();
  lastError = String((value as { message?: unknown })?.message ?? value ?? '').slice(0, 300);
}

export function reportGeminiOk(): void {
  if (depletedAt) console.log('[gemini-credit] Gemini works again; campaign dialing resumed');
  depletedAt = null;
  lastError = '';
}

export function geminiCreditsDepleted(): boolean {
  return depletedAt !== null;
}

export function geminiCreditStatus() {
  return {
    depleted: depletedAt !== null,
    depletedAt: depletedAt?.toISOString() ?? null,
    lastError: lastError || null,
    lastProbeAt: lastProbeAt?.toISOString() ?? null,
  };
}

async function probe(): Promise<void> {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) return;
  lastProbeAt = new Date();
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    await ai.models.generateContent({
      model: PROBE_MODEL,
      contents: [{ role: 'user', parts: [{ text: 'ok' }] }],
      config: { maxOutputTokens: 1, temperature: 0 },
    });
    reportGeminiOk();
  } catch (err) {
    if (isCreditError(err)) reportGeminiError(err);
    // Other errors (network, rate limit) say nothing about credits: leave the flag as it is.
  }
}

export function startGeminiCreditWatch(): void {
  setTimeout(() => void probe(), 15_000).unref?.();
  setInterval(() => void probe(), PROBE_MS).unref?.();
}
