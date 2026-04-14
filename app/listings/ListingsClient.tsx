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

// Leaflet pulls in `window` synchronously, so the map is SSR-excluded.
const PropertyMap = dynamic(() => import('../../components/public/PropertyMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[480px] rounded-2xl bg-[#F1F0EC] flex items-center justify-center text-[#0A0A0A]/45 text-[13px]">
      Loading map…
    </div>
  ),
});

type SortKey = 'recent' | 'price_asc' | 'price_desc' | 'bedrooms';

export default function ListingsClient({ listings }: { listings: Listing[] }) {
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

  const totalUnits = properties.reduce((s, p) => s + p.units.length, 0);

  return (
    <main className="min-h-screen bg-[#FAFAF7] text-[#0A0A0A]">
      <PublicNav />

      {/* HERO */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-12 pb-10 md:pt-20 md:pb-14">
        <div className="grid md:grid-cols-12 gap-8 md:gap-14 items-center">
          <div className="md:col-span-7">
            <p className="text-[12px] uppercase tracking-[0.18em] text-[#0A0A0A]/50 mb-5">
              Kansas City · Columbia · Independence
            </p>
            <h1 className="font-[var(--font-fraunces)] text-[52px] md:text-[84px] leading-[0.92] tracking-[-0.025em] text-[#0A0A0A] mb-6">
              Find your next
              <br />
              <span className="italic text-[#06b6d4]">home</span>.
            </h1>
            <p className="text-[17px] md:text-[19px] leading-[1.5] text-[#0A0A0A]/65 max-w-[540px] mb-8">
              {totalUnits} {totalUnits === 1 ? 'rental' : 'rentals'} across{' '}
              {properties.length} {properties.length === 1 ? 'property' : 'properties'} — updated
              hourly as units come and go. Browse, filter, and apply in minutes.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="#grid"
                className="inline-flex items-center justify-center px-6 py-3.5 rounded-full bg-[#0A0A0A] text-white text-[14px] font-medium hover:bg-[#06b6d4] transition-colors"
              >
                See listings ↓
              </a>
              <a
                href={TENANT_PORTAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-6 py-3.5 rounded-full border border-[#0A0A0A]/15 text-[#0A0A0A] text-[14px] font-medium hover:bg-[#0A0A0A] hover:text-white transition-colors"
              >
                Tenant Portal ↗
              </a>
            </div>
          </div>
          <div className="md:col-span-5 md:pl-4">
            <div className="relative aspect-[4/5] md:aspect-[4/5] rounded-3xl overflow-hidden bg-[#F1F0EC]">
              <Image
                src="/hero-building.jpg"
                alt="Apartment building"
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
            label="Bedrooms"
            value={String(minBeds)}
            onChange={v => setMinBeds(v === 'any' ? 'any' : Number(v))}
            options={[
              { v: 'any', l: 'Any' },
              { v: '1', l: '1+' },
              { v: '2', l: '2+' },
              { v: '3', l: '3+' },
              { v: '4', l: '4+' },
            ]}
          />
          <FilterSelect
            label="Max rent"
            value={String(maxRent)}
            onChange={v => setMaxRent(v === 'any' ? 'any' : Number(v))}
            options={[
              { v: 'any', l: 'Any' },
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
            <span className="text-[13px]">Pets OK</span>
          </label>

          <div className="ml-auto">
            <FilterSelect
              label="Sort"
              value={sort}
              onChange={v => setSort(v as SortKey)}
              options={[
                { v: 'recent', l: 'Available soonest' },
                { v: 'price_asc', l: 'Rent: low to high' },
                { v: 'price_desc', l: 'Rent: high to low' },
                { v: 'bedrooms', l: 'Most bedrooms' },
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
              {listings.length === 0
                ? 'No rentals available right now.'
                : 'Nothing matches those filters.'}
            </p>
            <p className="text-[14px]">
              {listings.length === 0
                ? 'Check back soon — our portfolio updates hourly.'
                : 'Try widening your criteria.'}
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
            {properties.map((p: Property) => (
              <PropertyCard key={p.key} property={p} />
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
                Where we have rentals
              </p>
              <h2 className="font-[var(--font-fraunces)] text-[28px] md:text-[34px] leading-tight text-[#0A0A0A]">
                Our properties on the map
              </h2>
            </div>
          </div>
          <PropertyMap properties={properties} height="520px" />
          <p className="text-[11px] text-[#0A0A0A]/50 mt-3">
            If you allow location access, the map zooms to properties near you.
          </p>
        </section>
      )}

      <PublicFooter />
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
