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
 *    public site: `/` rewrites to `/preview/listings` so unauthenticated
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

  // Public hosts: redirect the root URL to the listings page. We use redirect
  // (not rewrite) so the client-side `usePathname()` matches the rendered
  // route — otherwise AuthContext sees pathname `/` and triggers its admin
  // login redirect even though middleware already picked the public route.
  if (!isAdminHost && pathname === '/') {
    const url = req.nextUrl.clone();
    url.pathname = '/preview/listings';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
