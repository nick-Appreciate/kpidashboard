'use client';

import { useMemo, useState } from 'react';
import PublicNav from '../../../components/public/PublicNav';
import PublicFooter from '../../../components/public/PublicFooter';
import ListingCard from '../../../components/public/ListingCard';
import { SAMPLE_LISTINGS, Listing } from '../../../components/public/sampleListings';

type SortKey = 'recent' | 'price_asc' | 'price_desc' | 'bedrooms';

export default function ListingsPage() {
  const [sort, setSort] = useState<SortKey>('recent');
  const [minBeds, setMinBeds] = useState<number | 'any'>('any');
  const [maxRent, setMaxRent] = useState<number | 'any'>('any');
  const [petsOk, setPetsOk] = useState(false);

  const filtered = useMemo(() => {
    let rows: Listing[] = [...SAMPLE_LISTINGS];

    if (minBeds !== 'any') rows = rows.filter(l => l.bedrooms >= minBeds);
    if (maxRent !== 'any') rows = rows.filter(l => l.rent <= maxRent);
    if (petsOk) rows = rows.filter(l => /cat|dog/i.test(l.pet_policy));

    switch (sort) {
      case 'price_asc':
        rows.sort((a, b) => a.rent - b.rent);
        break;
      case 'price_desc':
        rows.sort((a, b) => b.rent - a.rent);
        break;
      case 'bedrooms':
        rows.sort((a, b) => b.bedrooms - a.bedrooms);
        break;
      case 'recent':
      default:
        rows.sort((a, b) => a.available_on.localeCompare(b.available_on));
    }

    return rows;
  }, [sort, minBeds, maxRent, petsOk]);

  return (
    <main className="min-h-screen bg-[#FAFAF7] text-[#0A0A0A]">
      <PublicNav />

      <section className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-14 pb-10">
        <p className="text-[12px] uppercase tracking-[0.15em] text-[#0A0A0A]/50 mb-3">
          {filtered.length} {filtered.length === 1 ? 'home' : 'homes'} available
        </p>
        <h1 className="font-[var(--font-fraunces)] text-[44px] md:text-[56px] leading-[0.98] tracking-[-0.02em] text-[#0A0A0A] mb-3">
          Find your next home.
        </h1>
        <p className="text-[16px] text-[#0A0A0A]/65 max-w-[560px]">
          Every rental in our portfolio — filterable by size, price, and pet policy. Updated
          hourly as units come and go.
        </p>
      </section>

      {/* FILTER BAR */}
      <section className="sticky top-16 z-40 bg-[#FAFAF7]/95 backdrop-blur-md border-y border-black/5">
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
        {filtered.length === 0 ? (
          <div className="text-center py-24 text-[#0A0A0A]/50">
            <p className="font-[var(--font-fraunces)] text-[24px] text-[#0A0A0A] mb-2">
              Nothing matches those filters.
            </p>
            <p className="text-[14px]">Try widening your criteria.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
            {filtered.map(l => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </section>

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
