import type { Metadata } from 'next';
import { fetchActiveListings } from '../../../lib/listings';
import ListingsClient from '../../listings/ListingsClient';

// Match the revalidate cadence of the English page so both locales stay in
// sync with the hourly AppFolio scrape.
export const revalidate = 60;

const SITE_URL = 'https://www.appreciate.io';
const TITLE =
  'Alquileres en Kansas City, Columbia e Independence · Appreciate Property Management';
const DESCRIPTION =
  'Apartamentos, casas y townhomes disponibles para alquilar en Kansas City, Columbia e Independence, Missouri. Actualizados cada hora desde AppFolio — explora, filtra y aplica en minutos.';
const OG_IMAGE = `${SITE_URL}/hero-building.webp`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'apartamentos en alquiler',
    'casas en alquiler',
    'alquileres Kansas City',
    'alquileres Columbia MO',
    'alquileres Independence MO',
    'administración de propiedades Missouri',
    'Appreciate Property Management',
  ],
  alternates: {
    canonical: '/es/listings',
    languages: {
      en: '/listings',
      es: '/es/listings',
    },
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: '/es/listings',
    siteName: 'Appreciate Property Management',
    locale: 'es_US',
    type: 'website',
    images: [
      {
        url: OG_IMAGE,
        width: 1920,
        height: 1078,
        alt: 'Propiedades disponibles de Appreciate Property Management',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
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

export default async function EsListingsPage() {
  const listings = await fetchActiveListings();
  return <ListingsClient listings={listings} locale="es" />;
}
