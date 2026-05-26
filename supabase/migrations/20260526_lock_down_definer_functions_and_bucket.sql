-- ─────────────────────────────────────────────────────────────────────────
-- 1) Bucket listing policy
--    The `billing-invoices` storage bucket is public:true so direct file
--    URLs from getPublicUrl() work without any storage.objects SELECT
--    policy. The existing broad "Allow public read access" policy adds
--    nothing for direct access — but lets anyone *list* every object in
--    the bucket. Drop it.
-- ─────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public read access on billing-invoices" ON storage.objects;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) SECURITY DEFINER function exposure
--    These functions were callable by anon (= anyone with the public anon
--    key, which is shipped in the browser bundle):
--      - 22 truncate_* / sync_appfolio_data — bulk deletes + sync trigger
--        called only by the sync-appfolio edge function (service role).
--      - reset_collection_notes — admin-only operation called server-side.
--    Revoke from PUBLIC, anon, authenticated; grant service_role.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  f text;
  funcs text[] := ARRAY[
    'truncate_af_bill_detail', 'truncate_af_cash_flow',
    'truncate_af_charge_detail', 'truncate_af_chart_of_accounts',
    'truncate_af_delinquency', 'truncate_af_general_ledger',
    'truncate_af_income_register', 'truncate_af_lease_history',
    'truncate_af_occupancy_summary', 'truncate_af_owner_directory',
    'truncate_af_property_directory', 'truncate_af_prospect_source_tracking',
    'truncate_af_tenant_directory', 'truncate_af_tenant_ledger',
    'truncate_af_trial_balance', 'truncate_af_vendor_directory',
    'truncate_af_work_orders', 'truncate_brex_expenses',
    'truncate_leasing_reports', 'truncate_rental_applications',
    'truncate_showings',
    'sync_appfolio_data', 'reset_collection_notes'
  ];
BEGIN
  FOREACH f IN ARRAY funcs LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I() FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I() TO service_role', f);
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) is_admin() — used by RLS policies on app_users. Authenticated users
--    must be able to call it for those policies to work. Anon does not.
-- ─────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- st_estimatedextent() (PostGIS) is intentionally left alone — it's a
-- harmless geometry helper and PostGIS ships its functions as SECURITY
-- DEFINER by default.
