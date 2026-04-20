import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchActiveListings, fetchListingById, formatAvailability } from '../../../lib/listings';
import ListingDetailClient from './ListingDetailClient';

export const revalidate = 60;

const SITE_URL = 'https://www.appreciate.io';
const DEFAULT_OG = `${SITE_URL}/hero-building.webp`;

// Per-listing SEO metadata. Tenants share these URLs directly — make each
// one describe itself so Google / Slack / LinkedIn previews look right.
export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const listing = await fetchListingById(params.id);
  if (!listing) {
    return {
      title: 'Listing not found · Appreciate Property Management',
      alternates: {
        languages: {
          en: `/listings/${params.id}`,
          es: `/es/listings/${params.id}`,
        },
      },
    };
  }

  const bedLabel = `${listing.bedrooms} bed`;
  const bathLabel = `${listing.bathrooms} bath`;
  const rentLabel = listing.rent_range || (listing.rent ? `$${listing.rent.toLocaleString()}/mo` : '');
  const locationLabel = [listing.city, listing.state].filter(Boolean).join(', ');
  const availabilityLabel = formatAvailability(listing.available_on, 'long', 'en');

  const title = [
    listing.address,
    `${bedLabel} / ${bathLabel}`,
    rentLabel,
    locationLabel,
  ]
    .filter(Boolean)
    .join(' · ') + ' · Appreciate Property Management';

  // Description: one-liner summary + optional marketing copy excerpt. Cap at
  // ~160 chars for Google SERP. Fall back to specs if no marketing_description.
  const summary = [
    `${bedLabel} / ${bathLabel}`,
    listing.square_feet ? `${listing.square_feet.toLocaleString()} sqft` : '',
    rentLabel,
    `${availabilityLabel}.`,
  ].filter(Boolean).join(' · ');

  const marketing = listing.marketing_description?.trim().replace(/\s+/g, ' ') || '';
  const descBase = `${listing.address} in ${locationLabel}. ${summary}`;
  const description = marketing
    ? `${descBase} ${marketing}`.slice(0, 240)
    : `${descBase} Apply online in minutes.`.slice(0, 240);

  const primaryImage = listing.default_photo_url || listing.photos[0] || DEFAULT_OG;

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: {
      canonical: `/listings/${params.id}`,
      languages: {
        en: `/listings/${params.id}`,
        es: `/es/listings/${params.id}`,
      },
    },
    openGraph: {
      title,
      description,
      url: `/listings/${params.id}`,
      siteName: 'Appreciate Property Management',
      locale: 'en_US',
      type: 'website',
      images: [
        {
          url: primaryImage,
          alt: `${listing.address} — photo`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [primaryImage],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
  };
}

export default async function ListingDetailPage({ params }: { params: { id: string } }) {
  const [listing, allListings] = await Promise.all([
    fetchListingById(params.id),
    fetchActiveListings(),
  ]);

  if (!listing) notFound();

  const siblings = allListings.filter(
    l =>
      l.id !== listing.id &&
      l.latitude === listing.latitude &&
      l.longitude === listing.longitude,
  );

  return <ListingDetailClient listing={listing} siblings={siblings} locale="en" />;
}
