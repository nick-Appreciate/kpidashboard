import type { MetadataRoute } from 'next';

const SITE_URL = 'https://www.appreciate.io';

/**
 * robots.txt
 *
 * Allow Google/Bing/etc. to crawl the public site, disallow the admin
 * surface (/dashboard, /admin/*, /login, /auth/*). Pointing at the
 * dynamic sitemap so crawlers discover every /listings/<id> URL.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/listings', '/listings/', '/es', '/es/listings', '/es/listings/'],
        disallow: [
          '/dashboard',
          '/admin',
          '/admin/',
          '/login',
          '/auth',
          '/auth/',
          '/api',
          '/api/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
