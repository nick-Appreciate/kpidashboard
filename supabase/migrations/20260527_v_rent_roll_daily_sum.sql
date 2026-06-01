-- Per-day aggregate of rent_roll_snapshots. Used by the Occupancy "Rent
-- Roll Over Time" chart so we don't transfer 51k per-unit rows over the
-- wire just to sum them in JS.
--
-- One row per snapshot_date, summing each GL column across all units in
-- the portfolio.
CREATE OR REPLACE VIEW public.v_rent_roll_daily_sum
WITH (security_invoker = true) AS
SELECT
  snapshot_date,
  count(*)::int                            AS unit_count,
  sum(total_rent)::numeric(14,2)           AS total_rent,
  sum(tenant_rental_income)::numeric(14,2) AS tenant_rental_income,
  sum(utility_reimbursement)::numeric(14,2) AS utility_reimbursement,
  sum(cha_income)::numeric(14,2)           AS cha_income,
  sum(iha_income)::numeric(14,2)           AS iha_income,
  sum(kckha_income)::numeric(14,2)         AS kckha_income,
  sum(hakc_income)::numeric(14,2)          AS hakc_income,
  sum(hud_income)::numeric(14,2)           AS hud_income,
  sum(pet_rent)::numeric(14,2)             AS pet_rent,
  sum(storage_fee)::numeric(14,2)          AS storage_fee,
  sum(parking_fee)::numeric(14,2)          AS parking_fee,
  sum(insurance_services)::numeric(14,2)   AS insurance_services,
  sum(other_charges)::numeric(14,2)        AS other_charges,
  sum(past_due)::numeric(14,2)             AS past_due
FROM public.rent_roll_snapshots
GROUP BY snapshot_date;

GRANT SELECT ON public.v_rent_roll_daily_sum TO authenticated;
