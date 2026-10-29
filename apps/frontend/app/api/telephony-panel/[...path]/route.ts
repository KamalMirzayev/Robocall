import { NextRequest, NextResponse } from 'next/server';

/**
 * API Proxy for Telephony Backend
 * Forwards requests from /api/telephony-panel/* to NEXT_PUBLIC_TELEPHONY_API/api/*
 * Uses a server-side session so the browser never needs its own telephony cookie.
 * Auto-authenticates (and re-authenticates on 401) using TELEPHONY_ADMIN_* env vars.
 *
 * The telephony backend (Asterisk/PBX: SIP trunks, dialplan, IVR, logs) has no per-user
 * roles of its own — it's a single shared service session. Role enforcement therefore
 * happens here, by resolving the caller's robocall.az session against the callbot
 * backend before forwarding anything. Only 'admin' gets full access; 'campaign_manager'
 * gets a redacted read of the trunk list only (needed for the campaign form's trunk
 * dropdown), stripped of host/secret/username so PBX credentials never reach the
 * browser for that role. 'viewer' and unauthenticated requests get nothing.
 */

type RobocallUser = { id: number; role: string };

async function resolveUser(request: NextRequest): Promise<RobocallUser | null> {
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_CALLBOT_API}/api/auth/me`, {
      headers: { Cookie: cookie },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.user ?? null;
  } catch (err) {
    console.error('telephony proxyauth resolution failed:', err);
    return null;
  }
}

const TRUNK_LIST_PATH = 'state';

type Authorization =
  | { ok: true; redactTrunksOnly: boolean }
  | { ok: false; status: number; error: string };

async function authorize(request: NextRequest, method: string, path: string): Promise<Authorization> {
  const user = await resolveUser(request);
  if (!user) return { ok: false, status: 401, error: 'unauthorized' };
  if (user.role === 'admin') return { ok: true, redactTrunksOnly: false };
  if (user.role === 'campaign_manager' && method === 'GET' && path === TRUNK_LIST_PATH) {
    return { ok: true, redactTrunksOnly: true };
  }
  return { ok: false, status: 403, error: 'forbidden' };
}

function redactState(data: unknown) {
  const trunks = Array.isArray((data as { trunks?: unknown[] })?.trunks)
    ? (data as { trunks: Array<Record<string, unknown>> }).trunks.map((t) => ({
        id: t.id,
        name: t.name,
        trunk_type: t.trunk_type,
        enabled: t.enabled,
      }))
    : [];
  return { accounts: [], trunks, ivrs: [], rules: [] };
}

// ── Server-side session cache ─────────────────────────────────────────────────
let cachedTelephonyCookie: string | null = null;

async function loginToTelephony(): Promise<string | null> {
  const base = process.env.NEXT_PUBLIC_TELEPHONY_API;
  const username = process.env.TELEPHONY_ADMIN_USERNAME || 'admin';
  const password = process.env.TELEPHONY_ADMIN_PASSWORD || '';
  if (!base || !password) return null;
  try {
    const body = new URLSearchParams();
    body.append('username', username);
    body.append('password', password);
    const res = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'manual',
    });
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('robocall_crm_session'));
    if (setCookie) {
      const cookieValue = setCookie.split(';')[0];
      cachedTelephonyCookie = cookieValue;
      return cookieValue;
    }
  } catch (err) {
    console.error('Telephony server-side login failed:', err);
  }
  return null;
}

async function getSessionCookie(): Promise<string> {
  return cachedTelephonyCookie ?? (await loginToTelephony()) ?? '';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function buildProxyResponse(response: Response, redactTrunksOnly: boolean): Promise<NextResponse> {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const data = await response.json();
    return NextResponse.json(redactTrunksOnly ? redactState(data) : data, { status: response.status });
  }

  const text = await response.text();
  return NextResponse.json(
    {
      error: response.ok ? 'Unexpected non-JSON response from telephony backend' : text,
      status: response.status,
    },
    { status: response.status }
  );
}

async function proxyRequest(
  method: string,
  url: string,
  body?: string,
): Promise<Response> {
  const cookie = await getSessionCookie();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Cookie: cookie };
  const res = await fetch(url, { method, headers, body });
  if (res.status === 401) {
    // Session expired — re-login once and retry
    cachedTelephonyCookie = null;
    const freshCookie = await loginToTelephony();
    if (freshCookie) {
      return fetch(url, { method, headers: { ...headers, Cookie: freshCookie }, body });
    }
  }
  return res;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    const authz = await authorize(request, 'GET', path);
    if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

    const query = request.nextUrl.search;
    const backendUrl = `${process.env.NEXT_PUBLIC_TELEPHONY_API}/api/${path}${query}`;
    const response = await proxyRequest('GET', backendUrl);
    return await buildProxyResponse(response, authz.redactTrunksOnly);
  } catch (error) {
    console.error('telephony proxyGET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch from telephony backend' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    const authz = await authorize(request, 'POST', path);
    if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

    const backendUrl = `${process.env.NEXT_PUBLIC_TELEPHONY_API}/api/${path}`;
    let bodyStr: string | undefined;
    const contentType = request.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      try { bodyStr = JSON.stringify(await request.json()); } catch { /* empty body */ }
    }
    const response = await proxyRequest('POST', backendUrl, bodyStr);
    return await buildProxyResponse(response, false);
  } catch (error) {
    console.error('telephony proxyPOST error:', error);
    return NextResponse.json({ error: 'Failed to fetch from telephony backend' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    const authz = await authorize(request, 'PUT', path);
    if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

    const backendUrl = `${process.env.NEXT_PUBLIC_TELEPHONY_API}/api/${path}`;
    let bodyStr: string | undefined;
    const contentType = request.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      try { bodyStr = JSON.stringify(await request.json()); } catch { /* empty body */ }
    }
    const response = await proxyRequest('PUT', backendUrl, bodyStr);
    return await buildProxyResponse(response, false);
  } catch (error) {
    console.error('telephony proxyPUT error:', error);
    return NextResponse.json({ error: 'Failed to fetch from telephony backend' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    const authz = await authorize(request, 'DELETE', path);
    if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

    const backendUrl = `${process.env.NEXT_PUBLIC_TELEPHONY_API}/api/${path}`;
    const response = await proxyRequest('DELETE', backendUrl);
    return NextResponse.json({}, { status: response.status });
  } catch (error) {
    console.error('telephony proxyDELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete from telephony backend' }, { status: 500 });
  }
}
