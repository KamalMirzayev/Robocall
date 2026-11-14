// Partner knowledge base (Group Motors): GET {origin}/credit/kb/{token}?brand=&q=&limit=
// returns { chunks: [{ id, brand, model, trim, category, title, content, valid_until }] }.
// The whole base is pulled into memory (brand by brand, since one call returns at most
// `limit` chunks) and refreshed in the background, so a live call searches it locally
// without waiting on the network. The token is a secret: it only comes from the .env.

export interface KbChunk {
  id: string | number;
  brand: string | null;
  model: string | null;
  trim: string | null;
  category: string | null;
  title: string | null;
  content: string;
  valid_until: string | null;
}

const REFRESH_MS = Math.max(5, Number(process.env.PARTNER_KB_REFRESH_MINUTES || 30)) * 60_000;
const FETCH_TIMEOUT_MS = 15_000;
const KNOWN_BRANDS = ['byd', 'toyota', 'mitsubishi', 'mazda', 'common'];
// Brands the partner only services; the bot must never offer them for sale.
const SERVICE_ONLY_BRANDS = (process.env.PARTNER_KB_SERVICE_ONLY_BRANDS || 'ford,honda,subaru')
  .split(',')
  .map((b) => b.trim().toLowerCase())
  .filter(Boolean);

const state: { chunks: KbChunk[]; loadedAt: Date | null; error: string | null; loading: Promise<void> | null } = {
  chunks: [],
  loadedAt: null,
  error: null,
  loading: null,
};

function baseUrl(): string | null {
  const raw = String(process.env.PARTNER_KB_URL || '').trim();
  const token = String(process.env.PARTNER_KB_TOKEN || '').trim();
  if (!raw || !token) return null;
  try {
    // Accept either the bare origin or the partner's webhook URL; only the origin is used.
    return `${new URL(raw).origin}/credit/kb/${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}

export function partnerKbConfigured(): boolean {
  return baseUrl() !== null;
}

async function fetchChunks(base: string, params: Record<string, string>): Promise<KbChunk[]> {
  const res = await fetch(`${base}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { chunks?: unknown };
  return Array.isArray(body.chunks) ? (body.chunks as KbChunk[]).filter((c) => c && typeof c.content === 'string') : [];
}

function isExpired(chunk: KbChunk, now = new Date()): boolean {
  if (!chunk.valid_until) return false;
  return new Date(`${chunk.valid_until}T23:59:59+04:00`) < now;
}

export async function refreshPartnerKb(): Promise<void> {
  const base = baseUrl();
  if (!base) {
    state.chunks = [];
    state.loadedAt = null;
    state.error = null;
    return;
  }
  if (state.loading) return state.loading;
  state.loading = (async () => {
    try {
      const first = await fetchChunks(base, { limit: '500' });
      const brands = new Set([...KNOWN_BRANDS, ...first.map((c) => String(c.brand || '').toLowerCase())]);
      brands.delete('');
      const byId = new Map(first.map((c) => [String(c.id), c]));
      for (const brand of brands) {
        for (const c of await fetchChunks(base, { brand, limit: '500' })) byId.set(String(c.id), c);
      }
      state.chunks = [...byId.values()];
      state.loadedAt = new Date();
      state.error = null;
      console.log(`[partner-kb] loaded ${state.chunks.length} chunks`);
    } catch (err) {
      state.error = (err as Error)?.name === 'TimeoutError' ? 'timeout' : (err as Error)?.message || 'failed';
      console.error(`[partner-kb] refresh failed: ${state.error}`);
    } finally {
      state.loading = null;
    }
  })();
  return state.loading;
}

// Always scheduled: the URL and token can be entered in the panel at any time.
export function startPartnerKbRefresher(): void {
  if (partnerKbConfigured()) void refreshPartnerKb();
  setInterval(() => {
    if (partnerKbConfigured()) void refreshPartnerKb();
  }, REFRESH_MS).unref();
}

export function partnerKbStatus() {
  return {
    configured: partnerKbConfigured(),
    chunks: state.chunks.length,
    loadedAt: state.loadedAt?.toISOString() ?? null,
    error: state.error,
  };
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/ə/g, 'e')
    .replace(/ı/g, 'i')
    .replace(/[öô]/g, 'o')
    .replace(/[üû]/g, 'u')
    .replace(/ç/g, 'c')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g');

function terms(query: string): string[] {
  return [...new Set(fold(query).split(/[^\p{L}\p{N}-]+/u).filter((t) => t.length >= 2))];
}

function liveChunks(): KbChunk[] {
  const now = new Date();
  return state.chunks.filter((c) => !isExpired(c, now));
}

// Simple keyword ranking: title/model/brand hits weigh more than body hits. Good enough
// for a few hundred chunks and fast enough to run inside a live call.
export async function searchPartnerKb(query: string, opts: { brand?: string; limit?: number } = {}) {
  if (!state.loadedAt && partnerKbConfigured()) await refreshPartnerKb();
  const limit = Math.max(1, Math.min(opts.limit ?? 5, 10));
  const brand = String(opts.brand || '').trim().toLowerCase();
  const qs = terms(query);
  const scored = liveChunks()
    .filter((c) => !brand || String(c.brand || '').toLowerCase() === brand || String(c.brand || '').toLowerCase() === 'common')
    .map((c) => {
      const head = fold([c.brand, c.model, c.trim, c.title].filter(Boolean).join(' '));
      const body = fold(c.content);
      let score = 0;
      for (const t of qs) {
        if (head.includes(t)) score += 3;
        if (body.includes(t)) score += 1;
      }
      if (c.category === 'price' && qs.some((t) => /qiym|price|цен|azn|manat/.test(t))) score += 2;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return {
    results: scored.map(({ c }) => ({
      brand: c.brand,
      model: c.model,
      trim: c.trim,
      category: c.category,
      title: c.title,
      content: c.content.length > 1500 ? `${c.content.slice(0, 1500)}…` : c.content,
    })),
    total: scored.length,
    note: state.error && !state.loadedAt ? 'Knowledge base is unavailable right now' : undefined,
  };
}

// Brand -> models on sale, for the system prompt, so the bot knows the range before any
// tool call. Prices and details still come from search_knowledge_base.
export function partnerKbOverview(): string {
  const byBrand = new Map<string, Set<string>>();
  for (const c of liveChunks()) {
    const brand = String(c.brand || '').toLowerCase();
    if (!brand || brand === 'common' || SERVICE_ONLY_BRANDS.includes(brand)) continue;
    const models = byBrand.get(brand) ?? new Set<string>();
    if (c.model) {
      models.add(String(c.model).trim());
    } else if (c.category === 'price') {
      // Brand-wide price list: "• Seal 6 DM-i 128km Active (2026) — 38 300 AZN" -> "Seal 6".
      for (const line of c.content.split('\n')) {
        const m = line.match(/^\s*[•*-]\s*(.+?)\s*(?:\(\d{4}\)|:|[—–])/);
        if (m) models.add(m[1].split(/\s+/).slice(0, 2).join(' '));
      }
    }
    if (models.size) byBrand.set(brand, models);
  }
  return [...byBrand.entries()]
    .map(([brand, models]) => `- ${brand.toUpperCase()}: ${[...models].slice(0, 25).join(', ')}`)
    .join('\n');
}

export function partnerKbInstruction(): string {
  if (!partnerKbConfigured()) return '';
  const overview = partnerKbOverview();
  return `

Bilik bazası (avtomobillər, qiymətlər, lizinq şərtləri):
- Avtomobil, model, komplektasiya, qiymət, ilkin ödəniş, aylıq ödəniş, müddət, sənədlər, filial və ya şərtlərlə bağlı HƏR sualda əvvəlcə search_knowledge_base alətini çağır və yalnız oradan gələn məlumatla cavab ver.
- Bazada olmayan qiyməti, modeli və ya şərti uydurma; tapılmasa "dəqiqləşdirib sizə geri dönəcəyik" de.
- Müştəriyə faiz dərəcəsini və komissiyanı heç vaxt demə; yalnız ilkin ödəniş, aylıq ödəniş və müddət haqqında danış.
- ${SERVICE_ONLY_BRANDS.map((b) => b[0].toUpperCase() + b.slice(1)).join(', ')} yalnız servis xidmətidir, bu markaları satış üçün təklif etmə.
- Qiyməti səsli deyəndə rəqəmi aydın oxu (məs. "qırx beş min doqquz yüz manat").${overview ? `\nSatışda olan modellər:\n${overview}` : ''}`;
}
