-- For Postgres views, the DEFINER/INVOKER distinction is controlled by the
-- `security_invoker` reloption (Postgres 15+). Default is false (DEFINER-
-- equivalent), which the Supabase linter flags as ERROR. Set it to true
-- on the three flagged views.
--
-- We previously GRANTed authenticated SELECT on cross-schema dependencies
-- of lease_history_unified (leases.* and properties.*) so the view still
-- works under INVOKER mode. Those schemas are NOT in the PostgREST
-- exposed-schemas list, so the grants only matter for view evaluation;
-- nobody can query them directly via the API.
GRANT USAGE ON SCHEMA leases     TO authenticated;
GRANT USAGE ON SCHEMA properties TO authenticated;
GRANT SELECT ON leases.leases         TO authenticated;
GRANT SELECT ON leases.leases_audit   TO authenticated;
GRANT SELECT ON properties.properties TO authenticated;
GRANT SELECT ON properties.units      TO authenticated;

ALTER VIEW public.v_time_card_daily      SET (security_invoker = true);
ALTER VIEW public.v_simmons_reconcile    SET (security_invoker = true);
ALTER VIEW public.lease_history_unified  SET (security_invoker = true);
