import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchActiveListings, fetchListingById } from '../../../../lib/listings';
import ListingDetailClient from '../../../listings/[id]/ListingDetailClient';

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  return {
    alternates: {
      languages: {
        en: `/listings/${params.id}`,
        es: `/es/listings/${params.id}`,
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
