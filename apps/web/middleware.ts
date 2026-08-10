import { NextRequest, NextResponse } from "next/server";

// NOTE: the real session cookie (crm_session) is set by the API on a
// different domain (onrender.com) — the browser never attaches it to
// requests made to this app's own domain, so middleware can't read it
// directly here. This checks a lightweight marker cookie set on THIS
// domain by LoginForm.tsx after a successful login instead. Real
// verification of crm_session still happens server-side, in
// auth.controller.ts#me.
const SESSION_COOKIE = "has_session";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);

  if (pathname === "/login") {
    if (hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|gif)$).*)"],
};
