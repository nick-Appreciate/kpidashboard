import type { MetadataRoute } from 'next';
import { fetchActiveListings } from '../lib/listings';

// Regenerate hourly so newly-scraped listings show up in the sitemap as
// soon as they're live. Next.js caches generated sitemaps per the
// `revalidate` setting below.
export const revalidate = 3600;

const SITE_URL = 'https://www.appreciate.io';

/**
 * Generate the public sitemap. Includes:
 *   - /listings (English grid)       + /es/listings (Spanish grid)
 *   - /listings/<id> (English detail) + /es/listings/<id> (each listing)
 *
 * Every entry emits both-language `alternates` so Google knows these are
 * translations of the same content and serves the right locale per user.
 *
 * Intentionally omits admin routes (/dashboard, /admin/*, /login) — they're
 * auth-gated and have no business in the public index.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const listings = await fetchActiveListings();
  const now = new Date();

  // Static grid pages — high priority, changes every hour as new listings
  // come and go.
  // Note: `alternates` was added to MetadataRoute.Sitemap in Next.js 14.2+.
  // We use an untyped intermediate array and cast at the return so the
  // hreflang data is preserved in the output without TypeScript errors.
  const gridPages = [
    {
      url: `${SITE_URL}/listings`,
      lastModified: now,
      changeFrequency: 'hourly',
      priority: 1.0,
      alternates: {
        languages: {
          en: `${SITE_URL}/listings`,
          es: `${SITE_URL}/es/listings`,
        },
      },
    },
    {
      url: `${SITE_URL}/es/listings`,
      lastModified: now,
      changeFrequency: 'hourly',
      priority: 1.0,
      alternates: {
        languages: {
          en: `${SITE_URL}/listings`,
          es: `${SITE_URL}/es/listings`,
        },
      },
    },
  ];

  // Per-listing pages. Emit one entry per locale per listing so Google can
  // index each locale separately and cross-reference them via alternates.
  const detailPages = listings.flatMap(l => [
    {
      url: `${SITE_URL}/listings/${l.id}`,
      lastModified: now,
      changeFrequency: 'daily' as const,
      priority: 0.8,
      alternates: {
        languages: {
          en: `${SITE_URL}/listings/${l.id}`,
          es: `${SITE_URL}/es/listings/${l.id}`,
        },
      },
    },
    {
      url: `${SITE_URL}/es/listings/${l.id}`,
      lastModified: now,
      changeFrequency: 'daily' as const,
      priority: 0.8,
      alternates: {
        languages: {
          en: `${SITE_URL}/listings/${l.id}`,
          es: `${SITE_URL}/es/listings/${l.id}`,
        },
      },
    },
  ]);

  return [...gridPages, ...detailPages] as unknown as MetadataRoute.Sitemap;
}
