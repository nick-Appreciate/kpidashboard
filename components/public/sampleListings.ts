// Sample data copied from https://appreciateinc.appfolio.com/listings on 2026-04-14.
// Used only for the public-site design mockup — Phase B replaces this with
// Supabase queries backed by the sync-appfolio-listings scraper.

export interface Listing {
  id: string;            // listable_uid from AppFolio — used to build Apply URL
  listing_id: number;    // AppFolio's internal numeric listing id
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
  application_fee: number;
  deposit: number;
  pet_policy: string;
  utilities_included: string[];
  amenities: string[];
  appliances: string[];
  marketing_description: string;
}

// Build the real AppFolio Apply URL from a listable_uid. Pattern verified from
// the public detail page's Apply button on 2026-04-14.
export function getApplicationUrl(listingId: string): string {
  return `https://appreciateinc.appfolio.com/listings/rental_applications/new?listable_uid=${listingId}&source=Website`;
}

export function getFullAddress(l: Pick<Listing, 'address' | 'city' | 'state' | 'zip'>): string {
  return `${l.address}, ${l.city}, ${l.state} ${l.zip}`;
}

// Photo galleries pulled from https://appreciateinc.appfolio.com/listings/detail/{id}
// on 2026-04-14. These are the exact public gallery URLs the scraper will land
// in the `af_listing_photos` table in Phase B.
const MAPLE_PHOTOS = [
  'https://images.cdn.appfolio.com/appreciateinc/images/b0860f8a-d695-4675-993e-fb73d70c894a/large.png',
  'https://images.cdn.appfolio.com/appreciateinc/images/10904c54-d5a3-4729-a40f-3223017838d4/large.jpeg',
  'https://images.cdn.appfolio.com/appreciateinc/images/22c0afd5-297d-4462-9b94-6aa7ed7b6218/large.jpeg',
  'https://images.cdn.appfolio.com/appreciateinc/images/2485eea8-6e22-4568-9871-94bc9fa8d6fc/large.jpeg',
  'https://images.cdn.appfolio.com/appreciateinc/images/37895d46-9483-4c8a-9908-1f13709a5c12/large.jpeg',
  'https://images.cdn.appfolio.com/appreciateinc/images/41e05e52-7520-4c43-8ce1-9b8c72616fba/large.jpeg',
  'https://images.cdn.appfolio.com/appreciateinc/images/48256dbf-4ce0-4385-b153-60f5ab08500f/large.jpeg',
  'https://images.cdn.appfolio.com/appreciateinc/images/5c411b93-2d64-4e28-8a37-150cd98d4530/large.jpeg',
  'https://images.cdn.appfolio.com/appreciateinc/images/60978eed-4e68-4c02-99e2-9132828cdcdf/large.jpeg',
  'https://images.cdn.appfolio.com/appreciateinc/images/61cab33e-102f-496f-a903-126f524b360e/large.jpeg',
  'https://images.cdn.appfolio.com/appreciateinc/images/672839d1-395f-48e4-950f-222591425135/large.jpeg',
  'https://images.cdn.appfolio.com/appreciateinc/images/698132af-6212-4911-a629-c2bdd139a335/large.jpeg',
];

const WOOD_PHOTOS = [
  'https://images.cdn.appfolio.com/appreciateinc/images/65da504a-4ab3-477a-9149-9429a75cd403/large.jpg',
  'https://images.cdn.appfolio.com/appreciateinc/images/3ed53677-72b2-40ff-aa10-1f989ec8c83c/large.jpg',
  'https://images.cdn.appfolio.com/appreciateinc/images/4881a9cb-cf48-4604-952c-a81acb212c66/large.jpg',
  'https://images.cdn.appfolio.com/appreciateinc/images/49adf595-cbfe-491f-b0d8-f21bc677feb8/large.jpg',
  'https://images.cdn.appfolio.com/appreciateinc/images/6641cbcf-6fcc-4004-a1e0-838afb53424d/large.jpg',
  'https://images.cdn.appfolio.com/appreciateinc/images/99ce0141-8976-476c-9d36-1c891a722289/large.jpg',
  'https://images.cdn.appfolio.com/appreciateinc/images/a60aabc2-9204-4cfa-8d46-9b0aa5949caa/large.jpg',
  'https://images.cdn.appfolio.com/appreciateinc/images/b580a98c-073c-47c6-848c-eb263292c14b/large.jpg',
  'https://images.cdn.appfolio.com/appreciateinc/images/ec9d2bf4-7028-4af5-a889-4d22acac410e/large.jpg',
];

const WOOD_UNIT_C_PHOTOS = [
  'https://images.cdn.appfolio.com/appreciateinc/images/b95f7b28-f044-4397-b8fb-d6e8d0d21390/large.jpg',
  ...WOOD_PHOTOS,
];

const FIFTYEIGHT_PHOTOS = [
  'https://images.cdn.appfolio.com/appreciateinc/leads_marketing_photos/ea33e86e-336d-47e4-900f-6644952ad10a/original.jpg',
];

const NO_PHOTO = [
  'https://listings.cdn.appfolio.com/listings/assets/listings/rental_listing/no_photo-ea9e892a45f62e048771a4b22081d1eed003a21f0658a92aa5abcfd357dd4699.png',
];

// Note: AppFolio's public listings page does NOT expose unit labels (A/B/C) or
// property_id. All three units at 3307 Wood Avenue show the EXACT same address
// string. Phase B scraper will join to af_property_directory.property_id for
// stronger grouping; until then we group on lat/lng (same building = same coords).
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
    photos: MAPLE_PHOTOS,
    application_fee: 50,
    deposit: 900,
    pet_policy: 'Cats OK, small dogs by approval',
    utilities_included: ['Water', 'Trash'],
    amenities: ['Secure breezeway', 'Shared laundry', 'Basement storage'],
    appliances: ['Refrigerator', 'Range'],
    marketing_description:
      '3-bedroom, 1-bath apartment with 1,000 sq ft of living space — perfect for small families. The building features secure breezeways, shared laundry rooms, and extra storage in the basement.',
  },
  // 3307 Wood Avenue — 3 units (AppFolio shows same address string for all)
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
    photos: WOOD_PHOTOS,
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
    id: 'd2c1b8b9-54d5-460c-a7e4-5e9160027456',
    listing_id: 61,
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
    available_on: '2026-05-10',
    photos: WOOD_PHOTOS,
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
    address: '3307 Wood Avenue',
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
    photos: WOOD_UNIT_C_PHOTOS,
    application_fee: 50,
    deposit: 700,
    pet_policy: 'No pets',
    utilities_included: ['Water', 'Trash'],
    amenities: ['On-site laundry'],
    appliances: ['Refrigerator', 'Range'],
    marketing_description:
      'Well-sized 1-bedroom apartment with a clean, simple layout. Great starter home or for a small household.',
  },
  // 3303 Wood Avenue — 2 units
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
    photos: WOOD_PHOTOS,
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
    id: '60163f9d-55ef-4a7e-a117-6c4116a4961d',
    listing_id: 34,
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
    available_on: '2026-06-01',
    photos: WOOD_PHOTOS,
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
    photos: NO_PHOTO,
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
    photos: FIFTYEIGHT_PHOTOS,
    application_fee: 50,
    deposit: 800,
    pet_policy: 'Small dogs by approval',
    utilities_included: ['Trash'],
    amenities: ['Off-street parking', 'Fenced yard'],
    appliances: ['Refrigerator', 'Range', 'Microwave'],
    marketing_description:
      'Roomy 2-bedroom duplex with a private fenced yard. Bright living spaces and plenty of storage throughout.',
  },
];

// ─── Grouping helpers ──────────────────────────────────────────────────

export interface Property {
  key: string;              // stable id derived from lat/lng
  address: string;          // street address
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
  photos: string[];         // photos from the first unit as the property's representative set
  units: Listing[];         // sorted by available_on asc
  minRent: number;
  maxRent: number;
  nextAvailable: string;    // earliest available_on
}

export function groupByProperty(listings: Listing[]): Property[] {
  // Phase B note: when wired to real data, group on af_property_directory.property_id
  // (joined via the listings scraper). For the mockup we use coordinates since AppFolio's
  // public scrape doesn't expose the property_id — units at the same building share
  // identical lat/lng.
  const byKey = new Map<string, Listing[]>();
  for (const l of listings) {
    const key = `${l.latitude.toFixed(5)}_${l.longitude.toFixed(5)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(l);
  }

  const properties: Property[] = [];
  for (const [key, units] of Array.from(byKey.entries())) {
    const sorted = [...units].sort((a, b) => a.available_on.localeCompare(b.available_on));
    const rents = sorted.map(u => u.rent);
    properties.push({
      key,
      address: sorted[0].address,
      city: sorted[0].city,
      state: sorted[0].state,
      zip: sorted[0].zip,
      latitude: sorted[0].latitude,
      longitude: sorted[0].longitude,
      photos: sorted[0].photos,
      units: sorted,
      minRent: Math.min(...rents),
      maxRent: Math.max(...rents),
      nextAvailable: sorted[0].available_on,
    });
  }

  return properties;
}

export const TENANT_PORTAL_URL = 'https://appreciateinc.appfolio.com/connect';
