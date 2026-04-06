-- ============================================================
-- ShelfSense — Add price column to inventory_items
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
--
-- PURPOSE:
--   Allow manually added items (and all inventory items) to have
--   a price stored directly, so users can add/edit price retroactively.
--   Previously price was only available via the receipt_items join,
--   which meant manually added items always had null price.
--
-- BEHAVIOUR:
--   - price = NULL by default (no price set)
--   - For new receipt items, the save flow copies price from receipt_items
--   - For manual/barcode/voice items, price can be set in the edit modal
--   - Stock value calculation reads from inventory_items.price (fallback to receipt join)
-- ============================================================

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS price NUMERIC(10,2);

-- Backfill price from linked receipt_items for existing receipt-sourced items
UPDATE public.inventory_items ii
SET price = ri.price
FROM public.receipt_items ri
WHERE ii.receipt_item_id = ri.id
  AND ii.price IS NULL
  AND ri.price IS NOT NULL;

-- Verify
SELECT COUNT(*) AS total, COUNT(price) AS with_price FROM public.inventory_items;
