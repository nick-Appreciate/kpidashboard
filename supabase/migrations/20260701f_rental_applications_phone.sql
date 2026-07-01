-- Applicant phone from the rental_applications report. This is the reliable
-- link between an application and a lead: AppFolio assigns each application its
-- OWN inquiry_id (distinct from the guest card's inquiry_id), so apps can't be
-- joined to leasing_reports on inquiry_id. Leads are keyed by phone10, so we
-- match applications the same way.
ALTER TABLE public.rental_applications ADD COLUMN IF NOT EXISTS phone_number text;
