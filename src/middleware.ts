import { NextRequest, NextResponse } from "next/server";
import { safeReturnTo } from "@/lib/safe-return-to";

/**
 * Phase 6A edge middleware — page-level redirect gate. Presence of the session
 * cookie decides whether app pages are reachable; it does NOT authorize: every
 * API route re-verifies the session and ownership server-side against the
 * database. Deep links to protected pages bounce to /login with a returnTo
 * path; authenticated users on /login or /register go to the dashboard.
 */
const SESSION_COOKIE = "ail_session";

const PUBLIC_PAGES = new Set(["/", "/login", "/register"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  // Static assets and Next internals pass through untouched.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt"
  ) {
    return NextResponse.next();
  }

  if (PUBLIC_PAGES.has(pathname)) {
    if (hasSessionCookie && (pathname === "/login" || pathname === "/register")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    // MEDIUM-10: the returnTo handed to the login page is always a
    // same-origin path, never a protocol-relative URL.
    loginUrl.searchParams.set("returnTo", safeReturnTo(pathname, "/"));
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
