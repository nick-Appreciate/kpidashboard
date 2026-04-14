import { NextRequest, NextResponse } from 'next/server';

/**
 * Hostname-based routing for the appreciate.io / app.appreciate.io split.
 *
 * Phase C work — the real hostname config happens via Vercel domain settings,
 * but this middleware is the routing glue:
 *
 *  - `app.appreciate.io` and `localhost:*` → admin app (default Next routing,
 *    `/` renders the dashboard as today).
 *  - Every other host (appreciate.io, the Vercel preview URL, etc.) →
 *    public site: `/` rewrites to `/listings` so unauthenticated
 *    visitors land on the listings page instead of the login redirect.
 *
 * Direct admin paths (`/admin/*`, `/bookkeeping`, etc.) still flow through
 * untouched — AuthContext handles the login redirect for those when the
 * visitor isn't signed in.
 */
export function middleware(req: NextRequest) {
  const host = req.headers.get('host') || '';
  const { pathname } = req.nextUrl;

  // Fast skip for infra/static/auth paths
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/auth/') ||
    pathname === '/login' ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  const isAdminHost = host.startsWith('app.') || host.startsWith('localhost:');

  // Public hosts: redirect the root URL to `/listings`. A rewrite would keep
  // the URL at `/` but Next's `usePathname()` / AppLayout still see the
  // browser URL, so the admin chrome tries to render — breaking the public
  // render. Redirecting makes pathname match the page (`/listings`) so the
  // existing public-page bypasses in AppLayout/AuthContext kick in cleanly.
  // Trade-off: the URL bar reads `appreciate.io/listings` rather than `/` —
  // a pattern every major rental site uses (airbnb, zillow, trulia).
  if (!isAdminHost && pathname === '/') {
    const url = req.nextUrl.clone();
    url.pathname = '/listings';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
