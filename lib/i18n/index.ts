// Tiny i18n foundation for the public listings site.
//
// The site ships in two locales: English at /listings and Spanish at
// /es/listings. Components take a `locale: Locale` prop and look up strings
// via getDictionary(locale) from ./dictionaries. Routes built from string
// literals MUST go through getListingPath(locale, id?) so the locale prefix
// is applied consistently everywhere.
//
// If you add a third locale, extend SUPPORTED_LOCALES and the dictionaries;
// the path helper generalizes automatically.

export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(x: string | null | undefined): x is Locale {
  return x !== null && x !== undefined && (SUPPORTED_LOCALES as readonly string[]).includes(x);
}

/**
 * Build a path to the listings grid or a specific listing, prefixed with
 * the locale for non-default locales.
 *
 *   getListingPath('en')              → '/listings'
 *   getListingPath('en', 'abc123')    → '/listings/abc123'
 *   getListingPath('es')              → '/es/listings'
 *   getListingPath('es', 'abc123')    → '/es/listings/abc123'
 */
export function getListingPath(locale: Locale, id?: string): string {
  const base = locale === DEFAULT_LOCALE ? '/listings' : `/${locale}/listings`;
  return id ? `${base}/${id}` : base;
}

/**
 * Given the current pathname and locale, return the equivalent path on the
 * OTHER locale. Used by the language switcher in the nav.
 *
 *   ('/listings', 'en')          → '/es/listings'
 *   ('/listings/abc', 'en')      → '/es/listings/abc'
 *   ('/es/listings', 'es')       → '/listings'
 *   ('/es/listings/abc', 'es')   → '/listings/abc'
 *   ('/es', 'es')                → '/listings' (lands on English root)
 *
 * For unknown pathnames the function falls back to the grid on the other
 * locale so the switcher link is never broken.
 */
export function getAlternatePath(pathname: string, currentLocale: Locale): string {
  const otherLocale: Locale = currentLocale === 'en' ? 'es' : 'en';

  if (currentLocale === 'en') {
    // English → Spanish. Prefix with /es if we're on a known listings path.
    if (pathname === '/listings' || pathname === '/listings/') {
      return '/es/listings';
    }
    if (pathname.startsWith('/listings/')) {
      const id = pathname.slice('/listings/'.length);
      return `/es/listings/${id}`;
    }
    return getListingPath(otherLocale);
  }

  // currentLocale === 'es': strip the /es prefix if present.
  if (pathname === '/es' || pathname === '/es/') return '/listings';
  if (pathname === '/es/listings' || pathname === '/es/listings/') return '/listings';
  if (pathname.startsWith('/es/listings/')) {
    const id = pathname.slice('/es/listings/'.length);
    return `/listings/${id}`;
  }
  return getListingPath(otherLocale);
}

export { getDictionary, translateAmenity } from './dictionaries';
export type { Dictionary } from './dictionaries';
