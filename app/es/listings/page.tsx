import type { Metadata } from 'next';
import { fetchActiveListings } from '../../../lib/listings';
import ListingsClient from '../../listings/ListingsClient';

// Match the revalidate cadence of the English page so both locales stay in
// sync with the hourly AppFolio scrape.
export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Propiedades en alquiler — Appreciate Property Management',
  description:
    'Propiedades disponibles en Kansas City, Columbia e Independence. Actualizadas cada hora.',
  alternates: {
    languages: {
      en: '/listings',
      es: '/es/listings',
    },
  },
};

export default async function EsListingsPage() {
  const listings = await fetchActiveListings();
  return <ListingsClient listings={listings} locale="es" />;
}
