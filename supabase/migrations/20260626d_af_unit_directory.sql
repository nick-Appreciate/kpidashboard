-- AppFolio's unit_directory report — the canonical unit↔listing link.
-- The `rentable_uid` column is the same UUID as af_listings.id, so a
-- join lets us know exactly which marketing listing belongs to which
-- physical unit. Replaces the brief detour into a manual mapping table
-- (which was based on the false premise that AppFolio doesn't expose
-- a unit ↔ listing link — it does, via this report).
CREATE TABLE public.af_unit_directory (
  unit_id integer PRIMARY KEY,
  property_id integer,
  property_name text,
  property_full text,
  unit_name text,
  unit_address text,
  unit_street text,
  unit_city text,
  unit_state text,
  unit_zip text,
  unit_type text,
  rentable text,
  rent_ready text,
  visibility text,
  posted_to_website text,
  posted_to_internet text,
  sqft integer,
  bedrooms numeric,
  bathrooms numeric,
  market_rent numeric,
  advertised_rent numeric,
  computed_market_rent numeric,
  legal_rent numeric,
  application_fee numeric,
  default_deposit numeric,
  marketing_title text,
  marketing_description text,
  unit_amenities text,
  unit_appliances text,
  unit_utilities text,
  resident_obligated_utilities text,
  you_tube_url text,
  ready_for_showing_on date,
  created_on date,
  rentable_uid uuid,
  unit_integration_id text,
  portfolio_id integer,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX af_unit_directory_property_idx ON public.af_unit_directory (property_name, unit_name);
CREATE INDEX af_unit_directory_rentable_uid_idx ON public.af_unit_directory (rentable_uid);

ALTER TABLE public.af_unit_directory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read af_unit_directory"
  ON public.af_unit_directory FOR SELECT TO authenticated USING (true);

DROP TABLE IF EXISTS public.unit_listing_mapping;
