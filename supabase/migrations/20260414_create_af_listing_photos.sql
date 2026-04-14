-- af_listing_photos: one row per photo on a listing detail page.
-- Ordered by `position` (0-based, matches display order on AppFolio).
CREATE TABLE IF NOT EXISTS af_listing_photos (
  id           bigserial PRIMARY KEY,
  listing_id   text NOT NULL REFERENCES af_listings(id) ON DELETE CASCADE,
  photo_url    text NOT NULL,
  position     integer NOT NULL DEFAULT 0,
  scraped_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, photo_url)
);

CREATE INDEX IF NOT EXISTS idx_af_listing_photos_listing
  ON af_listing_photos (listing_id, position);

ALTER TABLE af_listing_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read photos for active listings" ON af_listing_photos;
CREATE POLICY "Public can read photos for active listings" ON af_listing_photos
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM af_listings
      WHERE af_listings.id = af_listing_photos.listing_id
        AND af_listings.inactive_since IS NULL
    )
  );

COMMENT ON TABLE af_listing_photos IS
  'Gallery photos per listing, scraped from the AppFolio /listings/detail/{id} page. '
  'Ordered by `position`, which matches the display order on AppFolio.';
