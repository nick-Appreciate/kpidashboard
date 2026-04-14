'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Listing } from './sampleListings';

function formatAvailable(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const now = new Date();
  if (d <= now) return 'Available now';
  return 'Available ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ListingCard({ listing }: { listing: Listing }) {
  const primaryPhoto = listing.photos[0];
  const specs = `${listing.bedrooms} bed · ${listing.bathrooms} bath · ${listing.square_feet.toLocaleString()} sqft`;

  return (
    <Link
      href={`/preview/listings/${listing.id}`}
      className="group block bg-white rounded-2xl overflow-hidden border border-black/5 hover:border-black/10 transition-all hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-20px_rgba(10,10,10,0.15)]"
    >
      <div className="relative aspect-[4/3] bg-[#F1F0EC] overflow-hidden">
        {primaryPhoto && (
          <Image
            src={primaryPhoto}
            alt={listing.address}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
            className="object-cover group-hover:scale-[1.03] transition-transform duration-500"
            unoptimized
          />
        )}
        <div className="absolute top-3 left-3 px-2.5 py-1 bg-white/95 backdrop-blur-sm rounded-full text-[11px] font-medium text-[#0A0A0A] shadow-sm">
          {formatAvailable(listing.available_on)}
        </div>
      </div>
      <div className="p-5">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <p className="font-[var(--font-fraunces)] text-[22px] text-[#0A0A0A] leading-none">
            {listing.rent_range}
            <span className="text-[13px] font-sans text-[#0A0A0A]/50 ml-1">/ mo</span>
          </p>
          <span className="text-[11px] uppercase tracking-wider text-[#0A0A0A]/50">
            {listing.city}, {listing.state}
          </span>
        </div>
        <p className="text-[14px] text-[#0A0A0A] font-medium mb-1.5 truncate">{listing.address}</p>
        <p className="text-[13px] text-[#0A0A0A]/60">{specs}</p>
      </div>
    </Link>
  );
}
