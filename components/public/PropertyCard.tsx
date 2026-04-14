'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Property, Listing } from './sampleListings';

function formatAvailable(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const now = new Date();
  if (d <= now) return 'Available now';
  return 'Available ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatRentRange(property: Property): string {
  if (property.minRent === property.maxRent) return '$' + property.minRent.toLocaleString();
  return `$${property.minRent.toLocaleString()} – $${property.maxRent.toLocaleString()}`;
}

function UnitRow({ unit, hideAddress }: { unit: Listing; hideAddress?: boolean }) {
  const specs = `${unit.bedrooms} bd · ${unit.bathrooms} ba · ${unit.square_feet.toLocaleString()} sqft`;
  return (
    <Link
      href={`/preview/listings/${unit.id}`}
      className="group/unit flex items-center justify-between gap-3 px-4 py-3 border-t border-black/5 hover:bg-black/[0.02] transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-[#0A0A0A] mb-0.5">{specs}</p>
        <p className="text-[11px] text-[#0A0A0A]/55">{formatAvailable(unit.available_on)}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <p className="font-[var(--font-fraunces)] text-[18px] text-[#0A0A0A] tabular-nums">
          {unit.rent_range}
          <span className="text-[11px] font-sans text-[#0A0A0A]/45 ml-0.5">/mo</span>
        </p>
        <span className="text-[#0A0A0A]/30 text-[14px] group-hover/unit:text-[#06b6d4] group-hover/unit:translate-x-0.5 transition-all">
          →
        </span>
      </div>
    </Link>
  );
}

export default function PropertyCard({ property }: { property: Property }) {
  const primaryPhoto = property.photos[0];
  const unitCount = property.units.length;
  const rentLabel = formatRentRange(property);
  // Photo + header always link to the first (soonest-available) unit.
  const firstUnitHref = `/preview/listings/${property.units[0].id}`;

  return (
    <article className="bg-white rounded-2xl overflow-hidden border border-black/5 hover:border-black/10 transition-all hover:shadow-[0_20px_40px_-20px_rgba(10,10,10,0.12)]">
      <Link href={firstUnitHref} className="group block">
        <div className="relative aspect-[4/3] bg-[#F1F0EC] overflow-hidden">
          {primaryPhoto && (
            <Image
              src={primaryPhoto}
              alt={property.address}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
              className="object-cover group-hover:scale-[1.03] transition-transform duration-500"
              unoptimized
            />
          )}
          {unitCount > 1 && (
            <div className="absolute top-3 left-3 px-2.5 py-1 bg-[#0A0A0A]/90 text-white rounded-full text-[11px] font-medium backdrop-blur-sm">
              {unitCount} units available
            </div>
          )}
          {property.photos.length > 1 && (
            <div className="absolute bottom-3 right-3 px-2 py-0.5 bg-white/90 text-[#0A0A0A] rounded-full text-[11px] font-medium backdrop-blur-sm flex items-center gap-1">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                <path
                  fillRule="evenodd"
                  d="M1 5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H3a2 2 0 01-2-2V5zm8.5 3.5L6 12l3 3h6l-3.5-3.5L9.5 8.5z"
                  clipRule="evenodd"
                />
              </svg>
              {property.photos.length}
            </div>
          )}
        </div>
        <div className="px-5 pt-4 pb-3">
          <p className="text-[11px] uppercase tracking-wider text-[#0A0A0A]/50 mb-1.5">
            {property.city}, {property.state} {property.zip}
          </p>
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-[var(--font-fraunces)] text-[22px] leading-tight text-[#0A0A0A]">
              {property.address}
            </p>
            <p className="text-[14px] text-[#0A0A0A]/75 tabular-nums shrink-0">
              {rentLabel}
              <span className="text-[11px] text-[#0A0A0A]/45 ml-0.5">/mo</span>
            </p>
          </div>
        </div>
      </Link>

      <div>
        {property.units.map(unit => (
          <UnitRow key={unit.id} unit={unit} />
        ))}
      </div>
    </article>
  );
}
