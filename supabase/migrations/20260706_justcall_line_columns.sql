-- Capture which of our JustCall DIDs took/placed each call, plus the
-- friendly line name and JustCall's own contact-book name for the
-- counterparty. Lets us prove per-line coverage and answer questions
-- like "how many calls went to the Leasing line last week?"
ALTER TABLE public.justcall_calls
  ADD COLUMN IF NOT EXISTS justcall_number      text,
  ADD COLUMN IF NOT EXISTS justcall_number_norm text,
  ADD COLUMN IF NOT EXISTS justcall_line_name   text,
  ADD COLUMN IF NOT EXISTS contact_name         text;

CREATE INDEX IF NOT EXISTS justcall_calls_line_idx
  ON public.justcall_calls (justcall_line_name, call_at DESC);
