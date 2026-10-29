import { NextRequest, NextResponse } from 'next/server';

/**
 * API Proxy for Callbot Backend
 * Forwards requests from /api/callbot/* to NEXT_PUBLIC_CALLBOT_API/api/*
 * Handles session cookies for authentication persistence
 */

function forwardCookies(response: Response, res: NextResponse): void {
  const setCookieHeaders = response.headers.getSetCookie();
  setCookieHeaders.forEach(cookie => {
    res.headers.append('Set-Cookie', cookie);
  });
}

async function buildProxyResponse(response: Response): Promise<NextResponse> {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const data = await response.json();
    const res = NextResponse.json(data, { status: response.status });
    forwardCookies(response, res);
    return res;
  }

  // Pass through successful non-JSON payloads (audio/download streams).
  if (response.ok) {
    const body = await response.arrayBuffer();
    const res = new NextResponse(body, { status: response.status });
    const passthroughHeaders = [
      'content-type',
      'content-length',
      'content-disposition',
      'accept-ranges',
      'cache-control',
      'last-modified',
      'etag',
    ];
    passthroughHeaders.forEach((header) => {
      const value = response.headers.get(header);
      if (value) res.headers.set(header, value);
    });
    forwardCookies(response, res);
    return res;
  }

  const text = await response.text();
  const res = NextResponse.json(
    {
      error: response.ok ? 'Unexpected non-JSON response from Callbot backend' : text,
      status: response.status,
    },
    { status: response.status }
  );
  forwardCookies(response, res);
  return res;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    const query = request.nextUrl.search;
    const backendUrl = `${process.env.NEXT_PUBLIC_CALLBOT_API}/api/${path}${query}`;

    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Cookie: request.headers.get('cookie') || '',
      },
    });

    return await buildProxyResponse(response);
  } catch (error) {
    console.error('Callbot GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch from Callbot backend' },
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
    const backendUrl = `${process.env.NEXT_PUBLIC_CALLBOT_API}/api/${path}`;
    
    let body: any = undefined;
    const contentType = request.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        body = await request.json();
      } catch (e) {
        // If body is empty or invalid JSON, continue without body
      }
    }

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: request.headers.get('cookie') || '',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    return await buildProxyResponse(response);
  } catch (error) {
    console.error('Callbot POST error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch from Callbot backend' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    const backendUrl = `${process.env.NEXT_PUBLIC_CALLBOT_API}/api/${path}`;
    
    let body: any = undefined;
    const contentType = request.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        body = await request.json();
      } catch (e) {
        // If body is empty or invalid JSON, continue without body
      }
    }

    const response = await fetch(backendUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: request.headers.get('cookie') || '',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    return await buildProxyResponse(response);
  } catch (error) {
    console.error('Callbot PUT error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch from Callbot backend' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const path = params.path.join('/');
    const backendUrl = `${process.env.NEXT_PUBLIC_CALLBOT_API}/api/${path}`;

    const response = await fetch(backendUrl, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Cookie: request.headers.get('cookie') || '',
      },
    });

    return await buildProxyResponse(response);
  } catch (error) {
    console.error('Callbot DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to delete from Callbot backend' },
      { status: 500 }
    );
  }
}
