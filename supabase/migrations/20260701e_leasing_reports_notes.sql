-- Guest-card notes: the PM's freeform activity log, including the
-- "Marked Inactive / Reason: <X>" entry written on disqualification.
-- Synced from the guest_cards report (guest_card_statuses:'all') so we can
-- surface the disqualification reason on the Speed-to-Lead board.
ALTER TABLE public.leasing_reports ADD COLUMN IF NOT EXISTS notes text;
