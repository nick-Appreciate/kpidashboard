-- Enable RLS + add an "authenticated_read" SELECT policy on every flagged
-- DoorLoop / audit / lookup table in the public schema. Writes use the
-- service role, which bypasses RLS — so the DoorLoop sync continues to
-- write unchanged. Anon clients (the dashboard's browser bundle) will no
-- longer be able to read these tables.
--
-- Pattern matches what's already in place for bpu_meter_readings,
-- como_meter_readings, rent_roll_snapshots, etc.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'account_types', 'accounts', 'accounts_audit',
    'account_cashflow_activies', 'account_classes',
    'addresses', 'addresses_audit',
    'contact_types',
    'emails', 'emails_audit',
    'phones', 'phones_audit',
    'genders',
    'doorloop_account_lookups', 'doorloop_expense_lookups',
    'doorloop_lease_charge_lookups', 'doorloop_lease_credit_lookups',
    'doorloop_lease_payment_lookups', 'doorloop_lease_returned_payment_lookups',
    'doorloop_line_charge_lookups', 'doorloop_vendor_bill_lookups',
    'doorloop_vendor_credit_lookups', 'doorloop_vendor_lookups',
    'deposit_statuses', 'payment_methods',
    'expenses', 'expenses_audit',
    'federal_tax_infos', 'federal_tax_infos_audit',
    'insurance_infos', 'insurance_infos_audit',
    'lease_charges', 'lease_charges_audit',
    'lease_charges_to_lease_payments', 'lease_charges_to_lease_payments_audit',
    'lease_credits', 'lease_credits_audit',
    'lease_credits_to_lease_payments', 'lease_credits_to_lease_payments_audit',
    'lease_payments', 'lease_payments_audit',
    'lease_payments_to_tenants',
    'lease_returned_payments', 'lease_returned_payments_audit',
    'line_charges', 'line_charges_audit',
    'line_charges_to_lease_payments', 'line_charges_to_lease_payments_audit',
    'statement_type_accounts', 'statement_type_accounts_audit',
    'statement_types',
    'vendor_bills', 'vendor_bills_audit',
    'vendor_credits', 'vendor_credits_audit',
    'vendor_properties', 'vendor_properties_audit',
    'vendors', 'vendors_audit'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_read" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "authenticated_read" ON public.%I FOR SELECT TO authenticated USING (true)',
      t
    );
  END LOOP;
END
$$;

-- spatial_ref_sys (PostGIS) is intentionally left alone: PostGIS expects
-- world-readable access for projection lookups. The lint warning is a
-- documented exception.
