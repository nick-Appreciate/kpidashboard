// Sample data copied from https://appreciateinc.appfolio.com/listings on 2026-04-14.
// Used only for the /preview/* design mockup — Phase B replaces this with
// Supabase queries backed by the sync-appfolio-listings scraper.

export interface Listing {
  id: string;
  listing_id: number;
  address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
  rent: number;
  rent_range: string;
  bedrooms: number;
  bathrooms: number;
  square_feet: number;
  available_on: string;
  photos: string[];
  application_url: string;
  application_fee: number;
  deposit: number;
  pet_policy: string;
  utilities_included: string[];
  amenities: string[];
  appliances: string[];
  marketing_description: string;
}

export const SAMPLE_LISTINGS: Listing[] = [
  {
    id: 'c6ee0a40-68b0-4ae5-85e6-12c41b261861',
    listing_id: 70,
    address: '1411 W Maple Avenue',
    city: 'Independence',
    state: 'MO',
    zip: '64050',
    latitude: 39.0922235,
    longitude: -94.4334471,
    rent: 1125,
    rent_range: '$1,125',
    bedrooms: 3,
    bathrooms: 1,
    square_feet: 1000,
    available_on: '2026-04-23',
    photos: [
      'https://images.cdn.appfolio.com/appreciateinc/images/b0860f8a-d695-4675-993e-fb73d70c894a/large.png',
    ],
    application_url: 'https://appreciateinc.appfolio.com/listings/rental_applications/new?listing_id=70',
    application_fee: 50,
    deposit: 900,
    pet_policy: 'Cats OK, small dogs by approval',
    utilities_included: ['Water', 'Trash'],
    amenities: ['Secure breezeway', 'Shared laundry', 'Basement storage'],
    appliances: ['Refrigerator', 'Range'],
    marketing_description:
      '3-bedroom, 1-bath apartment with 1,000 sq ft of living space — perfect for small families. The building features secure breezeways, shared laundry rooms, and extra storage in the basement.',
  },
  {
    id: '4f40aaea-d342-49df-bb16-ab1289c8dc20',
    listing_id: 51,
    address: '3307 Wood Avenue',
    city: 'Kansas City',
    state: 'KS',
    zip: '66102',
    latitude: 39.1232193,
    longitude: -94.66729,
    rent: 1025,
    rent_range: '$1,025',
    bedrooms: 2,
    bathrooms: 1,
    square_feet: 825,
    available_on: '2026-05-01',
    photos: [
      'https://images.cdn.appfolio.com/appreciateinc/images/65da504a-4ab3-477a-9149-9429a75cd403/large.jpg',
    ],
    application_url: 'https://appreciateinc.appfolio.com/listings/rental_applications/new?listing_id=51',
    application_fee: 50,
    deposit: 800,
    pet_policy: 'No pets',
    utilities_included: ['Water', 'Trash'],
    amenities: ['On-site laundry', 'Off-street parking'],
    appliances: ['Refrigerator', 'Range'],
    marketing_description:
      'Spacious 2-bedroom apartment in a well-maintained Kansas City building. Updated kitchen and hardwood floors throughout.',
  },
  {
    id: 'b844d836-3872-45f3-a6a4-6031346e5518',
    listing_id: 48,
    address: '3303 Wood Avenue',
    city: 'Kansas City',
    state: 'KS',
    zip: '66102',
    latitude: 39.1232576,
    longitude: -94.666954,
    rent: 1025,
    rent_range: '$1,025',
    bedrooms: 2,
    bathrooms: 1,
    square_feet: 825,
    available_on: '2026-04-25',
    photos: [
      'https://images.cdn.appfolio.com/appreciateinc/images/65da504a-4ab3-477a-9149-9429a75cd403/large.jpg',
    ],
    application_url: 'https://appreciateinc.appfolio.com/listings/rental_applications/new?listing_id=48',
    application_fee: 50,
    deposit: 800,
    pet_policy: 'No pets',
    utilities_included: ['Water', 'Trash'],
    amenities: ['On-site laundry', 'Off-street parking'],
    appliances: ['Refrigerator', 'Range'],
    marketing_description:
      'Classic 2-bedroom in a quiet Kansas City neighborhood. Close to dining, parks, and transit.',
  },
  {
    id: '60ec8a3b-40c8-4bd4-8368-db85d7ce409e',
    listing_id: 68,
    address: '2406 Whitegate Drive',
    city: 'Columbia',
    state: 'MO',
    zip: '65202',
    latitude: 38.9675063,
    longitude: -92.3019843,
    rent: 900,
    rent_range: '$900',
    bedrooms: 1,
    bathrooms: 1,
    square_feet: 675,
    available_on: '2026-05-15',
    photos: [
      'https://listings.cdn.appfolio.com/listings/assets/listings/rental_listing/no_photo-ea9e892a45f62e048771a4b22081d1eed003a21f0658a92aa5abcfd357dd4699.png',
    ],
    application_url: 'https://appreciateinc.appfolio.com/listings/rental_applications/new?listing_id=68',
    application_fee: 50,
    deposit: 700,
    pet_policy: 'Cats OK',
    utilities_included: ['Water'],
    amenities: ['In-unit laundry hookups', 'Patio'],
    appliances: ['Refrigerator', 'Range', 'Dishwasher'],
    marketing_description:
      'Cozy 1-bedroom apartment in Columbia with a private patio. Quiet residential setting with easy access to campus and shopping.',
  },
  {
    id: '82974cd9-2f25-4ff8-9c6a-b2c3e1312b8b',
    listing_id: 49,
    address: '3052 N 58th St',
    city: 'Kansas City',
    state: 'KS',
    zip: '66104',
    latitude: 39.1424335,
    longitude: -94.7143956,
    rent: 1025,
    rent_range: '$1,025',
    bedrooms: 2,
    bathrooms: 1,
    square_feet: 950,
    available_on: '2026-05-01',
    photos: [
      'https://images.cdn.appfolio.com/appreciateinc/leads_marketing_photos/ea33e86e-336d-47e4-900f-6644952ad10a/original.jpg',
    ],
    application_url: 'https://appreciateinc.appfolio.com/listings/rental_applications/new?listing_id=49',
    application_fee: 50,
    deposit: 800,
    pet_policy: 'Small dogs by approval',
    utilities_included: ['Trash'],
    amenities: ['Off-street parking', 'Fenced yard'],
    appliances: ['Refrigerator', 'Range', 'Microwave'],
    marketing_description:
      'Roomy 2-bedroom duplex with a private fenced yard. Bright living spaces and plenty of storage throughout.',
  },
  {
    id: '60163f9d-55ef-4a7e-a117-6c4116a4961d',
    listing_id: 34,
    address: '3303 Wood Avenue, Apt B',
    city: 'Kansas City',
    state: 'KS',
    zip: '66102',
    latitude: 39.1232576,
    longitude: -94.666954,
    rent: 1025,
    rent_range: '$1,025',
    bedrooms: 2,
    bathrooms: 1,
    square_feet: 825,
    available_on: '2026-06-01',
    photos: [
      'https://images.cdn.appfolio.com/appreciateinc/images/65da504a-4ab3-477a-9149-9429a75cd403/large.jpg',
    ],
    application_url: 'https://appreciateinc.appfolio.com/listings/rental_applications/new?listing_id=34',
    application_fee: 50,
    deposit: 800,
    pet_policy: 'No pets',
    utilities_included: ['Water', 'Trash'],
    amenities: ['On-site laundry', 'Off-street parking'],
    appliances: ['Refrigerator', 'Range'],
    marketing_description:
      'Updated 2-bedroom unit on the upper floor of a classic Kansas City duplex.',
  },
  {
    id: 'd2c1b8b9-54d5-460c-a7e4-5e9160027456',
    listing_id: 61,
    address: '3307 Wood Avenue, Apt B',
    city: 'Kansas City',
    state: 'KS',
    zip: '66102',
    latitude: 39.1232193,
    longitude: -94.66729,
    rent: 1025,
    rent_range: '$1,025',
    bedrooms: 2,
    bathrooms: 1,
    square_feet: 825,
    available_on: '2026-05-10',
    photos: [
      'https://images.cdn.appfolio.com/appreciateinc/images/65da504a-4ab3-477a-9149-9429a75cd403/large.jpg',
    ],
    application_url: 'https://appreciateinc.appfolio.com/listings/rental_applications/new?listing_id=61',
    application_fee: 50,
    deposit: 800,
    pet_policy: 'No pets',
    utilities_included: ['Water', 'Trash'],
    amenities: ['On-site laundry', 'Off-street parking'],
    appliances: ['Refrigerator', 'Range'],
    marketing_description:
      'Charming upper-floor 2-bedroom with natural light and a convenient location.',
  },
  {
    id: '5676292c-bd52-41da-8539-3fd14f7f4d23',
    listing_id: 52,
    address: '3307 Wood Avenue, Apt C',
    city: 'Kansas City',
    state: 'KS',
    zip: '66102',
    latitude: 39.1232193,
    longitude: -94.66729,
    rent: 925,
    rent_range: '$925',
    bedrooms: 1,
    bathrooms: 1,
    square_feet: 750,
    available_on: '2026-05-20',
    photos: [
      'https://images.cdn.appfolio.com/appreciateinc/images/b95f7b28-f044-4397-b8fb-d6e8d0d21390/large.jpg',
    ],
    application_url: 'https://appreciateinc.appfolio.com/listings/rental_applications/new?listing_id=52',
    application_fee: 50,
    deposit: 700,
    pet_policy: 'No pets',
    utilities_included: ['Water', 'Trash'],
    amenities: ['On-site laundry'],
    appliances: ['Refrigerator', 'Range'],
    marketing_description:
      'Well-sized 1-bedroom apartment with a clean, simple layout. Great starter home or for a small household.',
  },
];

export const TENANT_PORTAL_URL = 'https://appreciateinc.appfolio.com/connect';
