'use client';

import Link from 'next/link';
import { TENANT_PORTAL_URL } from '../../lib/listings';
import { getDictionary, getListingPath, type Locale } from '../../lib/i18n';

export default function PublicFooter({ locale }: { locale: Locale }) {
  const t = getDictionary(locale).footer;
  const listingsHref = getListingPath(locale);

  return (
    <footer className="border-t border-black/5 mt-24 bg-[#FAFAF7]">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
        <div className="col-span-2">
          <p className="font-[var(--font-fraunces)] text-xl text-[#0A0A0A] mb-2">
            {t.brand}
          </p>
          <p className="text-[13px] text-[#0A0A0A]/60 max-w-sm leading-relaxed">
            {t.tagline}
          </p>
        </div>
        <div>
          <p className="text-[12px] uppercase tracking-wider text-[#0A0A0A]/50 mb-3">{t.colProspective}</p>
          <ul className="space-y-2 text-[13px] text-[#0A0A0A]/75">
            <li><Link href={listingsHref} className="hover:text-[#0A0A0A]">{t.availableRentals}</Link></li>
            <li><a href={TENANT_PORTAL_URL} target="_blank" rel="noopener noreferrer" className="hover:text-[#0A0A0A]">{t.applyOnline}</a></li>
          </ul>
        </div>
        <div>
          <p className="text-[12px] uppercase tracking-wider text-[#0A0A0A]/50 mb-3">{t.colCurrent}</p>
          <ul className="space-y-2 text-[13px] text-[#0A0A0A]/75">
            <li><a href={TENANT_PORTAL_URL} target="_blank" rel="noopener noreferrer" className="hover:text-[#0A0A0A]">{t.tenantPortal}</a></li>
            <li><a href={TENANT_PORTAL_URL} target="_blank" rel="noopener noreferrer" className="hover:text-[#0A0A0A]">{t.payRent}</a></li>
            <li><a href={TENANT_PORTAL_URL} target="_blank" rel="noopener noreferrer" className="hover:text-[#0A0A0A]">{t.maintenance}</a></li>
          </ul>
        </div>
      </div>
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10 py-5 border-t border-black/5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-[12px] text-[#0A0A0A]/50">
        <p>{t.copyright(new Date().getFullYear())}</p>
        <p>{t.locations}</p>
      </div>
    </footer>
  );
}
