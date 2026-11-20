import { NextRequest, NextResponse } from 'next/server';

// Logged-out visitors to "/" go straight to the staff login: in the Arzoom deployment
// this panel is an internal tool, so the public marketing page (public/landing.html)
// is not shown. Anyone with a robocall_session cookie skips straight through to the
// app's own "/" handler (app/page.tsx), which redirects to /calls (or /login if the
// session turns out to be invalid/expired).
export function middleware(request: NextRequest) {
  if (!request.cookies.has('robocall_session')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: '/',
};
