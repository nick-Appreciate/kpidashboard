-- The public listings policies required available_on IS NOT NULL, which
-- silently hid 8 active listings from the website -- both Ide Lofts units at
-- 920 Broadway, plus the KCK addresses (2625 Farrow, 2626 Delavan, 3050 N
-- 58th, 3303/3305 Wood). AppFolio leaves available_on empty for these, so
-- they were active, scraped, photographed, and unreachable by renters.
--
-- The condition contradicted the site's own design: formatAvailability() in
-- lib/listings.ts handles a null date explicitly and renders "Call for
-- availability" (and the Spanish equivalent), so the UI was always built for
-- these rows. inactive_since IS NULL is the correct and sufficient gate for
-- what belongs on the public site.
DROP POLICY IF EXISTS "Public can read active listings" ON public.af_listings;
CREATE POLICY "Public can read active listings" ON public.af_listings
  FOR SELECT USING (inactive_since IS NULL);

DROP POLICY IF EXISTS "Public can read photos for active listings" ON public.af_listing_photos;
CREATE POLICY "Public can read photos for active listings" ON public.af_listing_photos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM af_listings
      WHERE af_listings.id = af_listing_photos.listing_id
        AND af_listings.inactive_since IS NULL
    )
  );
