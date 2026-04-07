-- Add source_type to receipts table
-- Tracks how the receipt was entered: photo, library scan, digital screenshot,
-- PDF upload, pasted text, or (future) forwarded email.

alter table public.receipts
  add column if not exists source_type text not null default 'photo';

-- No check constraint — keeps it easy to add new source types later
-- (e.g. 'forwarded_email') without a migration.
