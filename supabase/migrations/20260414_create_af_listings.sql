-- af_listings: one row per AppFolio public listing (unit).
-- Source of truth is the scraper (sync-appfolio-listings), which populates
-- this table hourly from https://appreciateinc.appfolio.com/listings.
CREATE TABLE IF NOT EXISTS af_listings (
  id                     text PRIMARY KEY,          -- AppFolio listable_uid (UUID from detail_page_url)
  listing_id             integer,                    -- AppFolio's numeric listing id
  address                text NOT NULL,
  city                   text,
  state                  text,
  zip                    text,
  latitude               numeric(10, 7),
  longitude              numeric(11, 7),
  rent                   numeric(10, 2),             -- monthly rent, parsed numeric
  rent_range             text,                        -- raw display string, e.g. "$1,025"
  bedrooms               integer,
  bathrooms              numeric(3, 1),               -- half-baths exist
  square_feet            integer,
  available_on           date,
  application_fee        numeric(10, 2),
  deposit                numeric(10, 2),
  pet_policy             text,
  utilities_included     text[],
  amenities              text[],
  appliances             text[],
  marketing_description  text,
  application_url        text,                        -- full Apply URL (listable_uid + source=Website)
  detail_page_url        text,                        -- AppFolio public detail page
  default_photo_url      text,                        -- hero photo (same as first photo in af_listing_photos)
  scraped_at             timestamptz NOT NULL DEFAULT now(),
  inactive_since         timestamptz,                 -- set when a listing stops appearing in the index scrape
  first_seen_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_af_listings_active      ON af_listings (inactive_since) WHERE inactive_since IS NULL;
CREATE INDEX IF NOT EXISTS idx_af_listings_available   ON af_listings (available_on)   WHERE inactive_since IS NULL;
CREATE INDEX IF NOT EXISTS idx_af_listings_coords      ON af_listings (latitude, longitude);

-- RLS: the public site needs anon SELECT. Writes happen via the service-role
-- key from the edge function only.
ALTER TABLE af_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active listings" ON af_listings;
CREATE POLICY "Public can read active listings" ON af_listings
  FOR SELECT TO anon, authenticated
  USING (inactive_since IS NULL);

COMMENT ON TABLE af_listings IS
  'Public AppFolio listings scraped hourly from appreciateinc.appfolio.com/listings. '
  'Populated by the sync-appfolio-listings edge function. Consumed by the public listings site.';
