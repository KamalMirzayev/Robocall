import { NextRequest, NextResponse } from 'next/server';

/**
 * Telephony Login Endpoint
 * Handles authentication with the telephony backend which uses form-based login
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password required' },
        { status: 400 }
      );
    }

    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);

    const backendUrl = `${process.env.NEXT_PUBLIC_TELEPHONY_API}/login`;
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
      redirect: 'manual',
    });

    // Extract and forward session cookie
    const setCookieHeader = response.headers.getSetCookie();
    const res = NextResponse.json(
      {
        success: response.status === 302,
        status: response.status,
      },
      { status: 200 }
    );

    // Forward all cookies to client
    setCookieHeader.forEach(cookie => {
      res.headers.append('Set-Cookie', cookie);
    });

    return res;
  } catch (error) {
    console.error('Telephony login error:', error);
    return NextResponse.json(
      { error: 'Failed to authenticate with telephony backend' },
      { status: 500 }
    );
  }
}
