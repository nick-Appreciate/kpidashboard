import { fetchActiveListings } from '../../lib/listings';
import ListingsClient from './ListingsClient';

// Cache for 60s in prod so pages are fast but pick up the hourly scraper
// within a minute. The scrape runs at :45 past the hour — anyone hitting
// the page gets fresh data within a minute or two of the new scrape.
export const revalidate = 60;

export default async function ListingsPage() {
  const listings = await fetchActiveListings();
  return <ListingsClient listings={listings} />;
}
