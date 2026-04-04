-- ============================================================
-- ShelfSense — missing column + enum migrations
-- Run this in: Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. Add opened_at (date the user opened/started an item)
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS opened_at date;

-- 2. Add opened_expiry_days (suggested shelf life after opening, in days)
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS opened_expiry_days integer;

-- 3. Add 'household' to the storage location enum (if location is an enum type)
DO $$
BEGIN
  ALTER TYPE storage_location ADD VALUE IF NOT EXISTS 'household';
EXCEPTION WHEN others THEN
  RAISE NOTICE 'storage_location is not an enum type — check constraint path below may apply';
END
$$;

-- 3b. If location uses a CHECK constraint instead of an enum, run this instead:
-- (Only needed if the DO block above raises an error or does nothing)
--
-- ALTER TABLE public.inventory_items
--   DROP CONSTRAINT IF EXISTS inventory_items_location_check;
-- ALTER TABLE public.inventory_items
--   ADD CONSTRAINT inventory_items_location_check
--   CHECK (location IN ('fridge', 'freezer', 'cupboard', 'other', 'household'));

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'inventory_items'
ORDER BY ordinal_position;
