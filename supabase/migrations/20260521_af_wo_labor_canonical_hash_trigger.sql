-- Canonical row_hash for af_work_order_labor: a SQL function + BEFORE trigger
-- that derives row_hash from (technician, date, work_order_number,
-- ROUND(hours*60), start_time). Uses minutes-as-integer to dodge the decimal
-- formatting drift (2.90 vs 2.9) that breaks string-based hashing across
-- languages — PG's `numeric::text` keeps trailing zeros, JS's `String(n)`
-- drops them, so the same logical entry from the API sync vs CSV import
-- used to produce different hashes and slip past onConflict='row_hash'.
--
-- With the trigger in place, any sync script can upsert with row_hash=NULL
-- and the DB will compute the canonical value. Result: API and CSV imports
-- of the same logical entry overwrite each other instead of duplicating.

CREATE OR REPLACE FUNCTION af_wo_labor_canonical_hash(
  p_technician text,
  p_date date,
  p_wo_num text,
  p_hours numeric,
  p_start_time text
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT md5(
    coalesce(p_technician, '') || '|' ||
    coalesce(p_date::text, '') || '|' ||
    coalesce(p_wo_num, '') || '|' ||
    CASE WHEN p_hours IS NULL THEN '' ELSE round(p_hours * 60)::int::text END || '|' ||
    coalesce(p_start_time, '')
  );
$$;

CREATE OR REPLACE FUNCTION af_wo_labor_set_hash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.row_hash := af_wo_labor_canonical_hash(
    NEW.technician,
    NEW.date_worked,
    NEW.raw->>'work_order_number',
    NEW.hours,
    NEW.raw->>'start_time'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS af_wo_labor_set_hash_trigger ON af_work_order_labor;
CREATE TRIGGER af_wo_labor_set_hash_trigger
  BEFORE INSERT OR UPDATE ON af_work_order_labor
  FOR EACH ROW EXECUTE FUNCTION af_wo_labor_set_hash();
