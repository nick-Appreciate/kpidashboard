'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import PublicNav from '../../components/public/PublicNav';
import PublicFooter from '../../components/public/PublicFooter';
import PropertyCard from '../../components/public/PropertyCard';
import {
  groupByProperty,
  TENANT_PORTAL_URL,
  type Listing,
  type Property,
} from '../../lib/listings';
import { getDictionary, type Locale } from '../../lib/i18n';

// Leaflet pulls in `window` synchronously, so the map is SSR-excluded.
// Map is lazy-loaded from inside the default export so we can access the
// current locale for the loading fallback string.
type SortKey = 'recent' | 'price_asc' | 'price_desc' | 'bedrooms';

interface Props {
  listings: Listing[];
  locale: Locale;
}

export default function ListingsClient({ listings, locale }: Props) {
  const t = getDictionary(locale);

  // Map component is dynamic() — the loading fallback reads t.map.loading via closure.
  const PropertyMap = useMemo(
    () =>
      dynamic(() => import('../../components/public/PropertyMap'), {
        ssr: false,
        loading: () => (
          <div className="h-[480px] rounded-2xl bg-[#F1F0EC] flex items-center justify-center text-[#0A0A0A]/45 text-[13px]">
            {t.map.loading}
          </div>
        ),
      }),
    [t.map.loading],
  );

  const [sort, setSort] = useState<SortKey>('recent');
  const [minBeds, setMinBeds] = useState<number | 'any'>('any');
  const [maxRent, setMaxRent] = useState<number | 'any'>('any');
  const [petsOk, setPetsOk] = useState(false);

  const properties = useMemo(() => {
    let units: Listing[] = [...listings];

    if (minBeds !== 'any') units = units.filter(l => l.bedrooms >= minBeds);
    if (maxRent !== 'any') units = units.filter(l => l.rent <= maxRent);
    if (petsOk) units = units.filter(l => /cat|dog/i.test(l.pet_policy));

    const grouped = groupByProperty(units);

    switch (sort) {
      case 'price_asc':
        grouped.sort((a, b) => a.minRent - b.minRent);
        break;
      case 'price_desc':
        grouped.sort((a, b) => b.maxRent - a.maxRent);
        break;
      case 'bedrooms':
        grouped.sort((a, b) => {
          const maxA = Math.max(...a.units.map(u => u.bedrooms));
          const maxB = Math.max(...b.units.map(u => u.bedrooms));
          return maxB - maxA;
        });
        break;
      case 'recent':
      default:
        grouped.sort((a, b) => {
          if (!a.nextAvailable && !b.nextAvailable) return 0;
          if (!a.nextAvailable) return 1;
          if (!b.nextAvailable) return -1;
          return a.nextAvailable.localeCompare(b.nextAvailable);
        });
    }

    return grouped;
  }, [listings, sort, minBeds, maxRent, petsOk]);

  return (
    <main className="min-h-screen bg-[#FAFAF7] text-[#0A0A0A]">
      <PublicNav locale={locale} />

      {/* HERO */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-12 pb-10 md:pt-20 md:pb-14">
        <div className="grid md:grid-cols-12 gap-8 md:gap-14 items-center">
          <div className="md:col-span-7">
            <p className="text-[12px] uppercase tracking-[0.18em] text-[#0A0A0A]/50 mb-5">
              {t.hero.tagline}
            </p>
            <h1 className="font-[var(--font-fraunces)] text-[52px] md:text-[84px] leading-[0.92] tracking-[-0.025em] text-[#0A0A0A] mb-8">
              {t.hero.headingPre}
              <br />
              <span className="italic text-[#06b6d4]">{t.hero.headingHome}</span>
              {t.hero.headingPost}
            </h1>
            <div className="flex flex-wrap gap-3">
              <a
                href="#grid"
                className="inline-flex items-center justify-center px-6 py-3.5 rounded-full bg-[#0A0A0A] text-white text-[14px] font-medium hover:bg-[#06b6d4] transition-colors"
              >
                {t.hero.ctaSeeListings}
              </a>
              <a
                href={TENANT_PORTAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-6 py-3.5 rounded-full border border-[#0A0A0A]/15 text-[#0A0A0A] text-[14px] font-medium hover:bg-[#0A0A0A] hover:text-white transition-colors"
              >
                {t.hero.ctaPortal}
              </a>
            </div>
          </div>
          <div className="md:col-span-5 md:pl-4">
            <div className="relative aspect-[4/5] md:aspect-[4/5] rounded-3xl overflow-hidden bg-[#F1F0EC]">
              <Image
                src="/hero-building.webp"
                alt="1411 W Maple Avenue — Independence, MO"
                fill
                sizes="(max-width: 768px) 100vw, 45vw"
                className="object-cover"
                priority
              />
            </div>
          </div>
        </div>
      </section>

      {/* FILTER BAR */}
      <section
        id="grid"
        className="sticky top-16 z-40 bg-[#FAFAF7]/95 backdrop-blur-md border-y border-black/5"
      >
        <div className="max-w-[1280px] mx-auto px-6 lg:px-10 py-4 flex flex-wrap items-center gap-3">
          <FilterSelect
            label={t.filters.bedrooms}
            value={String(minBeds)}
            onChange={v => setMinBeds(v === 'any' ? 'any' : Number(v))}
            options={[
              { v: 'any', l: t.filters.any },
              { v: '1', l: t.filters.bed1plus },
              { v: '2', l: t.filters.bed2plus },
              { v: '3', l: t.filters.bed3plus },
              { v: '4', l: t.filters.bed4plus },
            ]}
          />
          <FilterSelect
            label={t.filters.maxRent}
            value={String(maxRent)}
            onChange={v => setMaxRent(v === 'any' ? 'any' : Number(v))}
            options={[
              { v: 'any', l: t.filters.any },
              { v: '900', l: '$900' },
              { v: '1000', l: '$1,000' },
              { v: '1200', l: '$1,200' },
              { v: '1500', l: '$1,500' },
              { v: '2000', l: '$2,000' },
            ]}
          />
          <label className="flex items-center gap-2 px-4 py-2 rounded-full border border-black/10 cursor-pointer hover:bg-black/[0.03] transition-colors">
            <input
              type="checkbox"
              checked={petsOk}
              onChange={e => setPetsOk(e.target.checked)}
              className="w-3.5 h-3.5 accent-[#06b6d4]"
            />
            <span className="text-[13px]">{t.filters.petsOk}</span>
          </label>

          <div className="ml-auto">
            <FilterSelect
              label={t.filters.sort}
              value={sort}
              onChange={v => setSort(v as SortKey)}
              options={[
                { v: 'recent', l: t.filters.sortAvailableSoonest },
                { v: 'price_asc', l: t.filters.sortRentLowHigh },
                { v: 'price_desc', l: t.filters.sortRentHighLow },
                { v: 'bedrooms', l: t.filters.sortMostBedrooms },
              ]}
            />
          </div>
        </div>
      </section>

      {/* GRID */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-10 py-10">
        {properties.length === 0 ? (
          <div className="text-center py-24 text-[#0A0A0A]/50">
            <p className="font-[var(--font-fraunces)] text-[24px] text-[#0A0A0A] mb-2">
              {listings.length === 0 ? t.empty.noneTitle : t.empty.filteredTitle}
            </p>
            <p className="text-[14px]">
              {listings.length === 0 ? t.empty.noneBody : t.empty.filteredBody}
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
            {properties.map((p: Property) => (
              <PropertyCard key={p.key} property={p} locale={locale} />
            ))}
          </div>
        )}
      </section>

      {/* MAP — below the grid */}
      {properties.length > 0 && (
        <section className="max-w-[1280px] mx-auto px-6 lg:px-10 py-10">
          <div className="flex items-end justify-between mb-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.15em] text-[#0A0A0A]/50 mb-1.5">
                {t.map.overlineLocations}
              </p>
              <h2 className="font-[var(--font-fraunces)] text-[28px] md:text-[34px] leading-tight text-[#0A0A0A]">
                {t.map.sectionHeading}
              </h2>
            </div>
          </div>
          <PropertyMap properties={properties} height="520px" locale={locale} />
          <p className="text-[11px] text-[#0A0A0A]/50 mt-3">
            {t.map.geoHint}
          </p>
        </section>
      )}

      <PublicFooter locale={locale} />
    </main>
  );
}

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}

function FilterSelect({ label, value, onChange, options }: FilterSelectProps) {
  return (
    <label className="flex items-center gap-2 px-4 py-2 rounded-full border border-black/10 hover:bg-black/[0.03] transition-colors">
      <span className="text-[12px] uppercase tracking-wider text-[#0A0A0A]/50">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-transparent text-[13px] font-medium text-[#0A0A0A] focus:outline-none cursor-pointer"
      >
        {options.map(o => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
    </label>
  );
}
