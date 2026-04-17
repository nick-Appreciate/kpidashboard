import { NextRequest, NextResponse } from 'next/server';

/**
 * Public-site routing.
 *
 * Single domain, path-based split:
 *   /             → public landing (redirects to /listings)
 *   /listings     → public listings grid (English)
 *   /es           → Spanish entry (redirects to /es/listings)
 *   /es/listings  → public listings grid (Spanish)
 *   /dashboard    → admin dashboard (auth required)
 *   /admin/*      → admin pages (auth required)
 *   /login        → auth page
 *
 * Middleware only handles the root-level locale redirects. AuthContext +
 * AppLayout handle the admin auth gate on dashboard / admin paths.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === '/') {
    const url = req.nextUrl.clone();
    url.pathname = '/listings';
    return NextResponse.redirect(url);
  }

  if (pathname === '/es' || pathname === '/es/') {
    const url = req.nextUrl.clone();
    url.pathname = '/es/listings';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/es', '/es/'],
};
