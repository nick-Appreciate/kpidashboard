import { notFound } from 'next/navigation';
import { fetchActiveListings, fetchListingById } from '../../../lib/listings';
import ListingDetailClient from './ListingDetailClient';

export const revalidate = 60;

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

  return <ListingDetailClient listing={listing} siblings={siblings} />;
}
