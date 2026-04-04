-- ============================================================
-- ShelfSense — add source, retailer, quantity_original columns
-- Run this in: Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. retailer stored directly on inventory_items
--    For receipt-based items this is copied from the receipt at save time.
--    For manual/voice/barcode items this is user-supplied (or null).
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS retailer TEXT;

-- 2. source — how the item entered inventory
--    Values: 'receipt' | 'manual' | 'barcode' | 'voice'
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'receipt';

-- 3. quantity_original — the quantity at the time the item was first saved.
--    quantity (existing column) = current remaining quantity.
--    When quantity < quantity_original the UI shows "Xg of Yg remaining".
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS quantity_original NUMERIC;

-- Backfill quantity_original = quantity for all existing rows
UPDATE public.inventory_items
  SET quantity_original = quantity
  WHERE quantity_original IS NULL;

-- Verify columns
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'inventory_items'
ORDER BY ordinal_position;
