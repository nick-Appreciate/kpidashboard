import { NextRequest, NextResponse } from 'next/server';

/**
 * Public-site routing.
 *
 * Single domain, path-based split:
 *   /           → public landing (redirects to /listings)
 *   /listings   → public listings grid
 *   /dashboard  → admin dashboard (auth required)
 *   /admin/*    → admin pages (auth required)
 *   /login      → auth page
 *
 * Middleware only handles the root redirect. AuthContext + AppLayout handle
 * the admin auth gate on dashboard / admin paths.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === '/') {
    const url = req.nextUrl.clone();
    url.pathname = '/listings';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/'],
};
