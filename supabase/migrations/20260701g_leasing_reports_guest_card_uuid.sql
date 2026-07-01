-- Guest-card UUID from the guest_cards report. Used to deep-link a lead to its
-- AppFolio prospect page: https://appreciateinc.appfolio.com/crm/leasing/prospects/<uuid>
-- (the web URL keys on the UUID, not the numeric guest_card_id).
ALTER TABLE public.leasing_reports ADD COLUMN IF NOT EXISTS guest_card_uuid text;
