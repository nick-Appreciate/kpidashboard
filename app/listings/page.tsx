import type { Metadata } from 'next';
import { fetchActiveListings } from '../../lib/listings';
import ListingsClient from './ListingsClient';

// Cache for 60s in prod so pages are fast but pick up the hourly scraper
// within a minute. The scrape runs at :45 past the hour — anyone hitting
// the page gets fresh data within a minute or two of the new scrape.
export const revalidate = 60;

const SITE_URL = 'https://www.appreciate.io';
const TITLE =
  'Rentals in Kansas City, Columbia & Independence · Appreciate Property Management';
const DESCRIPTION =
  'Apartments, houses, and townhomes for rent in Kansas City, Columbia, and Independence, Missouri. Updated hourly from AppFolio — browse, filter, and apply online in minutes.';
const OG_IMAGE = `${SITE_URL}/hero-building.webp`;

// Metadata that wins over the root layout's "Appreciate Dashboard" default.
// This is the public-facing entry point — Google, Slack, LinkedIn previews
// all read these tags.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'apartments for rent',
    'houses for rent',
    'rentals Kansas City',
    'rentals Columbia MO',
    'rentals Independence MO',
    'property management Missouri',
    'Appreciate Property Management',
  ],
  alternates: {
    canonical: '/listings',
    languages: {
      en: '/listings',
      es: '/es/listings',
    },
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: '/listings',
    siteName: 'Appreciate Property Management',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: OG_IMAGE,
        width: 1920,
        height: 1078,
        alt: 'Available rentals from Appreciate Property Management',
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

export default async function ListingsPage() {
  const listings = await fetchActiveListings();
  return <ListingsClient listings={listings} locale="en" />;
}
