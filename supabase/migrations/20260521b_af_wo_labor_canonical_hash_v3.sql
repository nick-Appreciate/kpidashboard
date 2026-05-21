-- v3 canonical hash: drop start_time entirely. The CSV export strips start
-- times for many entries while the API keeps them, so including start_time
-- splits the same logical labor entry into two rows. We use just
-- (tech, date, wo_num, round(hours*60)) to identify a unique billable entry.
--
-- Edge case: a tech could log two separate entries on the same WO same day
-- with the exact same hours, but at different times. Extremely rare; we
-- accept the collision risk in exchange for reliable cross-source dedup.
CREATE OR REPLACE FUNCTION af_wo_labor_canonical_hash(
  p_technician text,
  p_date date,
  p_wo_num text,
  p_hours numeric,
  p_start_time text  -- kept for signature compatibility; ignored
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT md5(
    coalesce(p_technician, '') || '|' ||
    coalesce(p_date::text, '') || '|' ||
    coalesce(p_wo_num, '') || '|' ||
    CASE WHEN p_hours IS NULL THEN '' ELSE round(p_hours * 60)::int::text END
  );
$$;
