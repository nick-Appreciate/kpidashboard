import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchActiveListings, fetchListingById, formatAvailability } from '../../../../lib/listings';
import ListingDetailClient from '../../../listings/[id]/ListingDetailClient';

export const revalidate = 60;

const SITE_URL = 'https://www.appreciate.io';
const DEFAULT_OG = `${SITE_URL}/hero-building.webp`;

// Per-listing SEO metadata (Spanish). Mirrors the English generator; copy
// is translated, AppFolio-sourced address/city/state stay as-is.
export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const listing = await fetchListingById(params.id);
  if (!listing) {
    return {
      title: 'Propiedad no encontrada · Appreciate Property Management',
      alternates: {
        languages: {
          en: `/listings/${params.id}`,
          es: `/es/listings/${params.id}`,
        },
      },
    };
  }

  const bedLabel = `${listing.bedrooms} ${listing.bedrooms === 1 ? 'habitación' : 'habitaciones'}`;
  const bathLabel = `${listing.bathrooms} ${listing.bathrooms === 1 ? 'baño' : 'baños'}`;
  const rentLabel = listing.rent_range || (listing.rent ? `$${listing.rent.toLocaleString()}/mes` : '');
  const locationLabel = [listing.city, listing.state].filter(Boolean).join(', ');
  const availabilityLabel = formatAvailability(listing.available_on, 'long', 'es');

  const title = [
    listing.address,
    `${bedLabel} / ${bathLabel}`,
    rentLabel,
    locationLabel,
  ]
    .filter(Boolean)
    .join(' · ') + ' · Appreciate Property Management';

  const summary = [
    `${bedLabel} / ${bathLabel}`,
    listing.square_feet ? `${listing.square_feet.toLocaleString()} sqft` : '',
    rentLabel,
    `${availabilityLabel}.`,
  ].filter(Boolean).join(' · ');

  const marketing = listing.marketing_description?.trim().replace(/\s+/g, ' ') || '';
  const descBase = `${listing.address} en ${locationLabel}. ${summary}`;
  const description = marketing
    ? `${descBase} ${marketing}`.slice(0, 240)
    : `${descBase} Aplica en línea en minutos.`.slice(0, 240);

  const primaryImage = listing.default_photo_url || listing.photos[0] || DEFAULT_OG;

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: {
      canonical: `/es/listings/${params.id}`,
      languages: {
        en: `/listings/${params.id}`,
        es: `/es/listings/${params.id}`,
      },
    },
    openGraph: {
      title,
      description,
      url: `/es/listings/${params.id}`,
      siteName: 'Appreciate Property Management',
      locale: 'es_US',
      type: 'website',
      images: [
        {
          url: primaryImage,
          alt: `${listing.address} — foto`,
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

export default async function EsListingDetailPage({ params }: { params: { id: string } }) {
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

  return <ListingDetailClient listing={listing} siblings={siblings} locale="es" />;
}
