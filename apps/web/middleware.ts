import { NextRequest, NextResponse } from "next/server";

// Cheap, edge-safe gate: only checks the session cookie is present, not that
// it's still valid — that real verification happens server-side, in
// auth.controller.ts#me, against JWT_SECRET. A stale/expired cookie gets
// past this redirect but every data fetch behind it will 401 from the API.
const SESSION_COOKIE = "crm_session";

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
