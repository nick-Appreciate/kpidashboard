'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getAlternatePath, getDictionary, type Locale } from '../../lib/i18n';

/**
 * Small text link in the nav that flips between the English and Spanish
 * versions of the current page. On /listings/<id> it lands on
 * /es/listings/<id> and vice versa, so the visitor stays on the same
 * property when they switch languages.
 */
export default function LanguageSwitcher({ locale }: { locale: Locale }) {
  const pathname = usePathname() ?? '/';
  const href = getAlternatePath(pathname, locale);
  const t = getDictionary(locale).languageSwitcher;

  return (
    <Link
      href={href}
      hrefLang={locale === 'en' ? 'es' : 'en'}
      aria-label={t.ariaLabel}
      className="inline-flex items-center justify-center px-3.5 py-2 text-[12px] font-medium rounded-full bg-black/[0.06] text-[#0A0A0A]/70 hover:bg-black/[0.1] hover:text-[#0A0A0A] transition-colors"
    >
      {t.switchTo}
    </Link>
  );
}
