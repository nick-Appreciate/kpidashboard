'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import PublicNav from '../../../components/public/PublicNav';
import PublicFooter from '../../../components/public/PublicFooter';
import PhotoLightbox from '../../../components/public/PhotoLightbox';
import { TENANT_PORTAL_URL, getFullAddress, type Listing } from '../../../lib/listings';

interface Props {
  listing: Listing;
  siblings: Listing[];
}

export default function ListingDetailClient({ listing, siblings }: Props) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const openLightbox = (idx: number) => {
    setLightboxIndex(idx);
    setLightboxOpen(true);
  };

  const availableDate = listing.available_on
    ? new Date(listing.available_on + 'T12:00:00').toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Call for availability';

  const fullAddress = getFullAddress(listing);

  return (
    <main className="min-h-screen bg-[#FAFAF7] text-[#0A0A0A]">
      <PublicNav />

      <div className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-8 pb-4">
        <Link
          href="/listings"
          className="inline-flex items-center gap-1.5 text-[13px] text-[#0A0A0A]/60 hover:text-[#0A0A0A] transition-colors"
        >
          ← All listings
        </Link>
      </div>

      <section className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-2">
        <PhotoGallery
          photos={listing.photos}
          address={listing.address}
          onOpen={openLightbox}
        />
      </section>

      <section className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-10 pb-6 grid md:grid-cols-3 gap-10">
        <div className="md:col-span-2">
          <p className="text-[12px] uppercase tracking-[0.15em] text-[#0A0A0A]/50 mb-3">
            {listing.city}, {listing.state} {listing.zip}
          </p>
          <h1 className="font-[var(--font-fraunces)] text-[40px] md:text-[52px] leading-[1] tracking-[-0.02em] text-[#0A0A0A] mb-2">
            {listing.address}
          </h1>
          <p className="text-[17px] text-[#0A0A0A]/65 mb-8">
            {listing.bedrooms} bed · {listing.bathrooms} bath ·{' '}
            {listing.square_feet.toLocaleString()} sqft · Available {availableDate}
          </p>

          {listing.marketing_description && (
            <div className="text-[16px] leading-[1.65] text-[#0A0A0A]/80 max-w-[620px] mb-10 whitespace-pre-line">
              {listing.marketing_description}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-8">
            {listing.pet_policy && (
              <FeatureList title="Pet policy" items={[listing.pet_policy]} />
            )}
          </div>
        </div>

        <aside className="md:col-span-1">
          <div className="md:sticky md:top-24 bg-white border border-black/5 rounded-2xl p-7 shadow-[0_4px_12px_-4px_rgba(10,10,10,0.08)]">
            <div className="flex items-baseline gap-1 mb-1">
              <p className="font-[var(--font-fraunces)] text-[42px] leading-none text-[#0A0A0A]">
                {listing.rent_range}
              </p>
              <p className="text-[14px] text-[#0A0A0A]/50">/ month</p>
            </div>
            <p className="text-[13px] text-[#0A0A0A]/60 mb-6">Available {availableDate}</p>

            <dl className="space-y-3 text-[13px] pb-6 border-b border-black/5 mb-6">
              {listing.deposit > 0 && (
                <Row label="Deposit" value={`$${listing.deposit.toLocaleString()}`} />
              )}
              {listing.application_fee > 0 && (
                <Row label="Application fee" value={`$${listing.application_fee}`} />
              )}
              {listing.pet_policy && <Row label="Pet policy" value={listing.pet_policy} />}
            </dl>

            <a
              href={listing.application_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center w-full px-4 py-3.5 rounded-full bg-[#0A0A0A] text-white text-[14px] font-medium hover:bg-[#06b6d4] transition-colors"
            >
              Apply now ↗
            </a>
            <a
              href={TENANT_PORTAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center w-full mt-2.5 px-4 py-3 rounded-full border border-black/10 text-[13px] text-[#0A0A0A] hover:bg-black/[0.03] transition-colors"
            >
              Already a tenant? Portal ↗
            </a>
          </div>
        </aside>
      </section>

      {siblings.length > 0 && (
        <section className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-8 pb-6">
          <h2 className="font-[var(--font-fraunces)] text-[26px] text-[#0A0A0A] mb-4">
            Other units at {listing.address}
          </h2>
          <div className="bg-white border border-black/5 rounded-2xl overflow-hidden">
            {siblings.map(unit => (
              <Link
                key={unit.id}
                href={`/listings/${unit.id}`}
                className="group flex items-center justify-between gap-3 px-5 py-4 border-t first:border-t-0 border-black/5 hover:bg-black/[0.02] transition-colors"
              >
                <div>
                  <p className="text-[14px] font-medium text-[#0A0A0A]">
                    {unit.bedrooms} bd · {unit.bathrooms} ba ·{' '}
                    {unit.square_feet.toLocaleString()} sqft
                  </p>
                  <p className="text-[12px] text-[#0A0A0A]/55">
                    {unit.available_on
                      ? 'Available ' +
                        new Date(unit.available_on + 'T12:00:00').toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })
                      : 'Call for availability'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-[var(--font-fraunces)] text-[20px] text-[#0A0A0A]">
                    {unit.rent_range}
                  </p>
                  <span className="text-[#0A0A0A]/30 group-hover:text-[#06b6d4] group-hover:translate-x-0.5 transition-all">
                    →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-10 pb-6">
        <div className="flex items-end justify-between mb-5">
          <h2 className="font-[var(--font-fraunces)] text-[26px] text-[#0A0A0A]">Location</h2>
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(fullAddress)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-[#0A0A0A]/60 hover:text-[#0A0A0A]"
          >
            Open in Google Maps ↗
          </a>
        </div>
        <div className="rounded-2xl overflow-hidden border border-black/5 h-[380px] relative bg-[#F1F0EC]">
          <iframe
            title="map"
            width="100%"
            height="100%"
            loading="lazy"
            style={{ border: 0 }}
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${listing.longitude - 0.01}%2C${listing.latitude - 0.005}%2C${listing.longitude + 0.01}%2C${listing.latitude + 0.005}&layer=mapnik&marker=${listing.latitude}%2C${listing.longitude}`}
          />
        </div>
      </section>

      <PublicFooter />

      <PhotoLightbox
        photos={listing.photos}
        alt={listing.address}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        initialIndex={lightboxIndex}
      />
    </main>
  );
}

function PhotoGallery({
  photos,
  address,
  onOpen,
}: {
  photos: string[];
  address: string;
  onOpen: (index: number) => void;
}) {
  const hero = photos[0];
  const thumbs = photos.slice(1, 5);
  const extraCount = Math.max(0, photos.length - 5);

  if (!hero) return null;

  if (thumbs.length === 0) {
    return (
      <button
        onClick={() => onOpen(0)}
        className="relative aspect-[16/9] md:aspect-[21/9] w-full rounded-3xl overflow-hidden bg-[#F1F0EC] cursor-zoom-in group"
        aria-label="Open photo gallery"
      >
        <Image
          src={hero}
          alt={address}
          fill
          sizes="1280px"
          className="object-cover group-hover:scale-[1.01] transition-transform duration-500"
          unoptimized
          priority
        />
      </button>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 md:grid-rows-2 gap-2 rounded-3xl overflow-hidden relative">
      <button
        onClick={() => onOpen(0)}
        className="md:col-span-2 md:row-span-2 relative aspect-[4/3] md:aspect-auto bg-[#F1F0EC] md:min-h-[420px] cursor-zoom-in group"
        aria-label="Open photo gallery"
      >
        <Image
          src={hero}
          alt={address}
          fill
          sizes="(max-width: 768px) 100vw, 640px"
          className="object-cover group-hover:scale-[1.02] transition-transform duration-500"
          unoptimized
          priority
        />
      </button>
      {thumbs.map((photo, i) => (
        <button
          key={photo}
          onClick={() => onOpen(i + 1)}
          className="relative aspect-square bg-[#F1F0EC] hidden md:block cursor-zoom-in group"
          aria-label={`Open photo ${i + 2}`}
        >
          <Image
            src={photo}
            alt={`${address} photo ${i + 2}`}
            fill
            sizes="320px"
            className="object-cover group-hover:scale-[1.02] transition-transform duration-500"
            unoptimized
          />
          {i === thumbs.length - 1 && extraCount > 0 && (
            <div className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-[14px] font-medium">
              +{extraCount} more
            </div>
          )}
        </button>
      ))}

      <button
        onClick={() => onOpen(0)}
        className="absolute bottom-4 right-4 px-4 py-2 bg-white/95 hover:bg-white text-[#0A0A0A] rounded-full text-[13px] font-medium shadow-md backdrop-blur-sm flex items-center gap-1.5 transition-colors"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path
            fillRule="evenodd"
            d="M1 5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H3a2 2 0 01-2-2V5zm8.5 3.5L6 12l3 3h6l-3.5-3.5L9.5 8.5z"
            clipRule="evenodd"
          />
        </svg>
        Show all {photos.length} photos
      </button>
    </div>
  );
}

function FeatureList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.15em] text-[#06b6d4] mb-3">{title}</p>
      <ul className="space-y-2">
        {items.map(item => (
          <li key={item} className="text-[14px] text-[#0A0A0A]/80 leading-[1.5]">
            · {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[#0A0A0A]/55">{label}</dt>
      <dd className="text-[#0A0A0A] text-right">{value}</dd>
    </div>
  );
}
