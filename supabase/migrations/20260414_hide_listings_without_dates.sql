-- Hide listings without an availability date from the public site entirely.
-- We still scrape + store them (they'll pick up a date on a future scrape and
-- re-appear), but they don't leak through to anon/authenticated selects.

DROP POLICY IF EXISTS "Public can read active listings" ON af_listings;
CREATE POLICY "Public can read active listings" ON af_listings
  FOR SELECT TO anon, authenticated
  USING (inactive_since IS NULL AND available_on IS NOT NULL);

DROP POLICY IF EXISTS "Public can read photos for active listings" ON af_listing_photos;
CREATE POLICY "Public can read photos for active listings" ON af_listing_photos
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM af_listings
      WHERE af_listings.id = af_listing_photos.listing_id
        AND af_listings.inactive_since IS NULL
        AND af_listings.available_on IS NOT NULL
    )
  );
