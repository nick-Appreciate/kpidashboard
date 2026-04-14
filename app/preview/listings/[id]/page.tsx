import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import PublicNav from '../../../../components/public/PublicNav';
import PublicFooter from '../../../../components/public/PublicFooter';
import { SAMPLE_LISTINGS, TENANT_PORTAL_URL } from '../../../../components/public/sampleListings';

export function generateStaticParams() {
  return SAMPLE_LISTINGS.map(l => ({ id: l.id }));
}

export default function ListingDetailPage({ params }: { params: { id: string } }) {
  const listing = SAMPLE_LISTINGS.find(l => l.id === params.id);
  if (!listing) notFound();

  const availableDate = new Date(listing.available_on + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  // Sibling units at the same property (for the "Other units here" section)
  const siblings = SAMPLE_LISTINGS.filter(
    l =>
      l.id !== listing.id &&
      l.latitude === listing.latitude &&
      l.longitude === listing.longitude,
  );

  return (
    <main className="min-h-screen bg-[#FAFAF7] text-[#0A0A0A]">
      <PublicNav />

      <div className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-8 pb-4">
        <Link
          href="/preview/listings"
          className="inline-flex items-center gap-1.5 text-[13px] text-[#0A0A0A]/60 hover:text-[#0A0A0A] transition-colors"
        >
          ← All listings
        </Link>
      </div>

      {/* Photo gallery — primary + 4 thumbs if available */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-2">
        <PhotoGallery photos={listing.photos} address={listing.address} />
      </section>

      {/* Header + key facts */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-10 pb-6 grid md:grid-cols-3 gap-10">
        <div className="md:col-span-2">
          <p className="text-[12px] uppercase tracking-[0.15em] text-[#0A0A0A]/50 mb-3">
            {listing.city}, {listing.state} {listing.zip}
          </p>
          <h1 className="font-[var(--font-fraunces)] text-[40px] md:text-[52px] leading-[1] tracking-[-0.02em] text-[#0A0A0A] mb-2">
            {listing.address}
            {listing.unit_label && (
              <span className="text-[#0A0A0A]/45"> · {listing.unit_label}</span>
            )}
          </h1>
          <p className="text-[17px] text-[#0A0A0A]/65 mb-8">
            {listing.bedrooms} bed · {listing.bathrooms} bath · {listing.square_feet.toLocaleString()}{' '}
            sqft · Available {availableDate}
          </p>

          <p className="text-[16px] leading-[1.65] text-[#0A0A0A]/80 max-w-[620px] mb-10">
            {listing.marketing_description}
          </p>

          <div className="grid sm:grid-cols-2 gap-8">
            <FeatureList title="Amenities" items={listing.amenities} />
            <FeatureList title="Appliances" items={listing.appliances} />
            <FeatureList title="Utilities included" items={listing.utilities_included} />
            <FeatureList title="Pet policy" items={[listing.pet_policy]} />
          </div>
        </div>

        {/* Right rail — price + apply card */}
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
              <Row label="Deposit" value={`$${listing.deposit.toLocaleString()}`} />
              <Row label="Application fee" value={`$${listing.application_fee}`} />
              <Row label="Pet policy" value={listing.pet_policy} />
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

      {/* Sibling units at the same property */}
      {siblings.length > 0 && (
        <section className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-8 pb-6">
          <h2 className="font-[var(--font-fraunces)] text-[26px] text-[#0A0A0A] mb-4">
            Other units at {listing.address}
          </h2>
          <div className="bg-white border border-black/5 rounded-2xl overflow-hidden">
            {siblings.map(unit => (
              <Link
                key={unit.id}
                href={`/preview/listings/${unit.id}`}
                className="group flex items-center justify-between gap-3 px-5 py-4 border-t first:border-t-0 border-black/5 hover:bg-black/[0.02] transition-colors"
              >
                <div>
                  <p className="text-[14px] font-medium text-[#0A0A0A]">
                    {unit.unit_label ?? 'Unit'}
                  </p>
                  <p className="text-[12px] text-[#0A0A0A]/55">
                    {unit.bedrooms} bd · {unit.bathrooms} ba · {unit.square_feet.toLocaleString()}{' '}
                    sqft · Available{' '}
                    {new Date(unit.available_on + 'T12:00:00').toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
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

      {/* Map */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-10 pb-6">
        <div className="flex items-end justify-between mb-5">
          <h2 className="font-[var(--font-fraunces)] text-[26px] text-[#0A0A0A]">Location</h2>
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(listing.address + ', ' + listing.city + ', ' + listing.state)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-[#0A0A0A]/60 hover:text-[#0A0A0A]"
          >
            Open in Google Maps ↗
          </a>
        </div>
        <div className="rounded-2xl overflow-hidden border border-black/5 h-[320px] relative bg-[#F1F0EC]">
          <iframe
            title="map"
            width="100%"
            height="100%"
            loading="lazy"
            allowFullScreen
            src={`https://maps.google.com/maps?q=${encodeURIComponent(listing.address)}&z=15&output=embed`}
          />
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}

function PhotoGallery({ photos, address }: { photos: string[]; address: string }) {
  const hero = photos[0];
  const thumbs = photos.slice(1, 5);
  const extraCount = Math.max(0, photos.length - 5);

  if (!hero) return null;

  // If only 1 photo, full-width single image
  if (thumbs.length === 0) {
    return (
      <div className="relative aspect-[16/9] md:aspect-[21/9] rounded-3xl overflow-hidden bg-[#F1F0EC]">
        <Image
          src={hero}
          alt={address}
          fill
          sizes="1280px"
          className="object-cover"
          unoptimized
          priority
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 md:grid-rows-2 gap-2 rounded-3xl overflow-hidden">
      <div className="md:col-span-2 md:row-span-2 relative aspect-[4/3] md:aspect-auto bg-[#F1F0EC] md:min-h-[420px]">
        <Image
          src={hero}
          alt={address}
          fill
          sizes="(max-width: 768px) 100vw, 640px"
          className="object-cover"
          unoptimized
          priority
        />
      </div>
      {thumbs.map((photo, i) => (
        <div
          key={photo}
          className="relative aspect-square bg-[#F1F0EC] hidden md:block"
        >
          <Image
            src={photo}
            alt={`${address} photo ${i + 2}`}
            fill
            sizes="(max-width: 768px) 0, 320px"
            className="object-cover"
            unoptimized
          />
          {i === thumbs.length - 1 && extraCount > 0 && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-[14px] font-medium">
              +{extraCount} more
            </div>
          )}
        </div>
      ))}
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
