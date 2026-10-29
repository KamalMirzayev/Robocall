import { NextRequest, NextResponse } from 'next/server';

/**
 * Telephony Logout Endpoint
 * Clears session with the telephony backend
 */
export async function POST(request: NextRequest) {
  try {
    const backendUrl = `${process.env.NEXT_PUBLIC_TELEPHONY_API}/logout`;
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        Cookie: request.headers.get('cookie') || '',
      },
      redirect: 'manual',
    });

    const res = NextResponse.json({ success: true }, { status: 200 });

    // Clear the session cookie on client
    res.headers.append(
      'Set-Cookie',
      'robocall_crm_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 UTC;'
    );

    return res;
  } catch (error) {
    console.error('Telephony logout error:', error);
    // Still return success since we're clearing client-side anyway
    const res = NextResponse.json({ success: true }, { status: 200 });
    res.headers.append(
      'Set-Cookie',
      'robocall_crm_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 UTC;'
    );
    return res;
  }
}
