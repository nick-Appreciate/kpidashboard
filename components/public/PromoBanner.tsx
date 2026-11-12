'use client';

import { useEffect, useState } from 'react';
import { LEASING_PHONE } from '../../lib/listings';
import { getDictionary, type Locale } from '../../lib/i18n';
import { fetchCurrentSpecial, specialDetails, specialName, type LeasingSpecial } from '../../lib/leasingSpecial';
import PhoneLink from './PhoneLink';

const Snowflake = () => (
  <svg aria-hidden className="promo-flake w-3.5 h-3.5 shrink-0 text-white/90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
    <path d="M12 2v20M4.9 6.5l14.2 11M4.9 17.5l14.2-11M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5" />
  </svg>
);

// Dismissal is per special, so a new special shows again for visitors who
// dismissed the last one.
const dismissKey = (id: string) => `promo-dismissed:${id}`;

/**
 * Slim announcement bar above the public nav for the current leasing special
 * (leasing_specials, edited on Leasing Automations). A frosty gradient, a soft
 * glimmer every few seconds and a slowly turning snowflake catch the eye
 * without flashing; it can be dismissed for the rest of the visit. No active
 * special → no banner.
 */
export default function PromoBanner({ locale }: { locale: Locale }) {
  const t = getDictionary(locale).promo;
  const [special, setSpecial] = useState<LeasingSpecial | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let live = true;
    fetchCurrentSpecial().then((s) => {
      if (!live || !s) return;
      try {
        if (sessionStorage.getItem(dismissKey(s.id))) setHidden(true);
      } catch {
        // Storage blocked — just keep showing the banner.
      }
      setSpecial(s);
    });
    return () => { live = false; };
  }, []);

  if (!special || hidden) return null;
  const message = t.askAbout(specialName(special, locale));
  const details = specialDetails(special, locale);

  const dismiss = () => {
    setHidden(true);
    try {
      sessionStorage.setItem(dismissKey(special.id), '1');
    } catch {
      // Ignore; it stays hidden until the next page load.
    }
  };

  return (
    <div className="relative overflow-hidden bg-gradient-to-r from-[#0e7490] via-[#0891b2] to-[#06b6d4] text-white">
      <span aria-hidden className="promo-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3" />
      {/* Phones: the whole message is the tap-to-call link, so the text keeps
          the full width. Wider screens add a separate "Call (number)" pill. */}
      <PhoneLink
        locale={locale}
        className="sm:hidden relative h-9 pl-4 pr-10 flex items-center justify-center gap-2 text-[12px] font-medium"
      >
        <Snowflake />
        <span className="truncate">{message}</span>
        <span aria-hidden>→</span>
      </PhoneLink>
      <div className="hidden sm:flex relative max-w-[1280px] mx-auto px-12 h-9 items-center justify-center gap-2.5 text-[13px]">
        <Snowflake />
        <span className="font-medium tracking-[0.01em] truncate">{message}</span>
        {details && <span className="hidden md:inline text-white/80 truncate">· {details}</span>}
        <PhoneLink
          locale={locale}
          className="inline-flex items-center gap-1 ml-1 px-2.5 py-0.5 rounded-full bg-white/15 hover:bg-white/25 font-medium transition-colors whitespace-nowrap"
        >
          {t.callCta} {LEASING_PHONE} →
        </PhoneLink>
      </div>
      <button
        onClick={dismiss}
        aria-label={t.dismiss}
        className="absolute right-2 lg:right-4 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/15 transition-colors"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}
