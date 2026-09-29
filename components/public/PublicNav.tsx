'use client';

import Link from 'next/link';
import { useState } from 'react';
import { TENANT_PORTAL_URL, LEASING_PHONE } from '../../lib/listings';
import PhoneLink from './PhoneLink';
import { getDictionary, getListingPath, type Locale } from '../../lib/i18n';
import LanguageSwitcher from './LanguageSwitcher';

export default function PublicNav({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const t = getDictionary(locale).nav;
  const listingsHref = getListingPath(locale);

  return (
    <header className="sticky top-0 z-50 bg-[#FAFAF7]/85 backdrop-blur-md border-b border-black/5">
      <nav className="max-w-[1280px] mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
        <Link
          href={listingsHref}
          className="font-[var(--font-fraunces)] text-[20px] font-medium tracking-tight text-[#0A0A0A] leading-none"
        >
          {t.brand}
        </Link>

        <div className="hidden md:flex items-center gap-2">
          <LanguageSwitcher locale={locale} />
          <PhoneLink
            locale={locale}
            ariaLabel={t.call(LEASING_PHONE)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium rounded-full text-[#0A0A0A] hover:bg-black/[0.06] transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 5.5c0-1 .8-1.8 1.8-1.8h2.1c.8 0 1.5.5 1.7 1.3l.9 3a1.8 1.8 0 0 1-.5 1.8l-1.2 1.2a12 12 0 0 0 5.7 5.7l1.2-1.2a1.8 1.8 0 0 1 1.8-.5l3 .9c.8.2 1.3.9 1.3 1.7v2.1c0 1-.8 1.8-1.8 1.8h-.7C10.1 21.3 2.7 13.9 2.5 6.2v-.7Z" />
            </svg>
            {LEASING_PHONE}
          </PhoneLink>
          <a
            href={TENANT_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-4 py-2 text-[13px] font-medium rounded-full bg-[#0A0A0A] text-white hover:bg-[#06b6d4] transition-colors"
          >
            {t.tenantPortal}
          </a>
          {/* /dashboard is admin-gated — AuthContext bounces unauthenticated
              clicks through /login first and back here on success. */}
          <a
            href="/dashboard"
            className="inline-flex items-center justify-center px-3.5 py-2 text-[12px] font-medium rounded-full bg-black/[0.06] text-[#0A0A0A]/70 hover:bg-black/[0.1] hover:text-[#0A0A0A] transition-colors"
          >
            {t.admin}
          </a>
        </div>

        <button
          className="md:hidden w-10 h-10 flex flex-col items-center justify-center gap-1.5"
          onClick={() => setOpen(v => !v)}
          aria-label={t.toggleMenu}
        >
          <span className={`block w-5 h-[1.5px] bg-[#0A0A0A] transition-transform ${open ? 'translate-y-[6px] rotate-45' : ''}`} />
          <span className={`block w-5 h-[1.5px] bg-[#0A0A0A] transition-opacity ${open ? 'opacity-0' : ''}`} />
          <span className={`block w-5 h-[1.5px] bg-[#0A0A0A] transition-transform ${open ? '-translate-y-[6px] -rotate-45' : ''}`} />
        </button>
      </nav>

      {open && (
        <div className="md:hidden border-t border-black/5 px-6 py-5 flex flex-col gap-3 bg-[#FAFAF7]">
          <LanguageSwitcher locale={locale} />
          <PhoneLink
            locale={locale}
            className="inline-flex items-center justify-center px-4 py-2.5 text-[13px] font-medium rounded-full border border-[#0A0A0A]/15 text-[#0A0A0A] w-fit"
          >
            {t.call(LEASING_PHONE)}
          </PhoneLink>
          <a
            href={TENANT_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-4 py-2.5 text-[13px] font-medium rounded-full bg-[#0A0A0A] text-white w-fit"
          >
            {t.tenantPortal} ↗
          </a>
          <a
            href="/dashboard"
            className="inline-flex items-center justify-center px-4 py-2 text-[12px] font-medium rounded-full bg-black/[0.06] text-[#0A0A0A]/70 w-fit"
          >
            {t.admin}
          </a>
        </div>
      )}
    </header>
  );
}
