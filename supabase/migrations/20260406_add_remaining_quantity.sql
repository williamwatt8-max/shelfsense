-- ============================================================
-- ShelfSense — Add remaining_quantity column
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
--
-- PURPOSE:
--   Separates "how much is currently left" from the purchase
--   structure (count × amount_per_unit). Previously `quantity`
--   was overloaded to mean both "total amount" and "remaining".
--
-- NEW MODEL:
--   count             = how many units were purchased  (e.g. 6)
--   amount_per_unit   = size of each unit             (e.g. 330 ml)
--   unit              = measurement unit              (e.g. 'ml')
--   remaining_quantity= how much is left right now    (e.g. 990 ml)
--
--   initial remaining_quantity = count × amount_per_unit  (if apu set)
--                               = count                   (if no apu)
--
-- BACKWARD COMPAT:
--   quantity and quantity_original columns are kept but treated as
--   legacy. New code writes both remaining_quantity AND quantity
--   so old queries keep working.
-- ============================================================

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS remaining_quantity NUMERIC;

-- Backfill from existing quantity column
UPDATE public.inventory_items
  SET remaining_quantity = quantity
  WHERE remaining_quantity IS NULL;

-- Verify
SELECT
  COUNT(*)                                        AS total_rows,
  COUNT(remaining_quantity)                       AS rows_with_remaining_qty,
  COUNT(*) - COUNT(remaining_quantity)            AS rows_still_null
FROM public.inventory_items;
