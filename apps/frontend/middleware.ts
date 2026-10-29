import { NextRequest, NextResponse } from 'next/server';

// Public marketing landing page at "/" for logged-out visitors — served from
// public/landing.html (a static, self-contained copy of www/robocall-landing/index.html).
// Anyone with a robocall_session cookie skips straight through to the app's own "/"
// handler (app/page.tsx), which redirects to /calls (or /login if the session turns
// out to be invalid/expired).
export function middleware(request: NextRequest) {
  if (!request.cookies.has('robocall_session')) {
    return NextResponse.rewrite(new URL('/landing.html', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: '/',
};
