import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { NextFunction, Request, Response } from 'express';

// Network-level guards for endpoints that only the local telephony worker may reach
// (it runs on the same host and calls without a token), plus small in-memory rate limits.

function normalizeIp(raw: string | undefined | null): string {
  const ip = String(raw ?? '').trim();
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function isLocalOrPrivate(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.')) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  // Docker bridge networks (172.16.0.0/12) and 10.0.0.0/8 / 192.168.0.0/16 on the host.
  return (a === 172 && b >= 16 && b <= 31) || a === 10 || (a === 192 && b === 168);
}

// A request is "internal" when it comes straight from this host (loopback) AND did not pass
// through a reverse proxy. Caddy and our own Next.js proxy always add
// X-Forwarded-For, so anything relayed from the internet is never internal.
export function isInternalRequest(req: IncomingMessage): boolean {
  const h = req.headers;
  if (h['x-forwarded-for'] || h['forwarded'] || h['x-real-ip'] || h['x-robocall-proxy']) return false;
  const ip = normalizeIp(req.socket?.remoteAddress);
  return ip === '::1' || ip.startsWith('127.');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function hasWorkerToken(token: string | null | undefined): boolean {
  const expected = process.env.TELEPHONY_WORKER_TOKEN;
  return Boolean(expected && token && safeEqual(String(token), expected));
}

export function requestWorkerToken(req: Request): string | null {
  const header = req.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : (req.get('x-telephony-token') ?? null);
}

// Express guard: internal callers or the telephony worker token only.
export function internalOrWorker(req: Request, res: Response, next: NextFunction) {
  if (isInternalRequest(req) || hasWorkerToken(requestWorkerToken(req))) {
    next();
    return;
  }
  console.warn(`[security] blocked ${req.method} ${req.originalUrl} from ${clientIp(req)}`);
  res.status(403).json({ error: 'forbidden' });
}

// Real client address: the first X-Forwarded-For hop when the request came through a local
// proxy (Caddy / Next.js), otherwise the socket address.
export function clientIp(req: IncomingMessage): string {
  const remote = normalizeIp(req.socket?.remoteAddress);
  const fwd = req.headers['x-forwarded-for'];
  if (fwd && isLocalOrPrivate(remote)) {
    const first = normalizeIp(String(Array.isArray(fwd) ? fwd[0] : fwd).split(',')[0]);
    if (first) return first;
  }
  return remote || 'unknown';
}

// Fixed-window in-memory counter. Enough for one API process.
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly limit: number, private readonly windowMs: number) {
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    }, Math.min(windowMs, 60_000)).unref?.();
  }

  // Returns seconds to wait when over the limit, otherwise 0.
  hit(key: string): number {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, e);
    }
    e.count += 1;
    return e.count > this.limit ? Math.ceil((e.resetAt - now) / 1000) : 0;
  }

  blocked(key: string): number {
    const e = this.hits.get(key);
    if (!e || e.resetAt <= Date.now()) return 0;
    return e.count >= this.limit ? Math.ceil((e.resetAt - Date.now()) / 1000) : 0;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}

export function rateLimit(limit: number, windowMs: number, keyOf: (req: Request) => string = clientIp) {
  const limiter = new RateLimiter(limit, windowMs);
  return (req: Request, res: Response, next: NextFunction) => {
    const wait = limiter.hit(keyOf(req));
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      res.status(429).json({ error: 'too many requests' });
      return;
    }
    next();
  };
}
