-- ============================================================
-- ShelfSense — Retrospective enrichment fields on inventory_items
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
--
-- PURPOSE:
--   Support retrospective enrichment of inventory items regardless
--   of how they were originally added (manual, voice, shopping list,
--   receipt, barcode).
--
-- NEW COLUMNS:
--   barcode       — barcode matched via scan (populated on add OR retro match)
--   price_source  — how the price was determined: manual | receipt | barcode | inferred
-- ============================================================

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS barcode      TEXT,
  ADD COLUMN IF NOT EXISTS price_source TEXT;

-- Backfill price_source for existing receipt-sourced items that have a price
UPDATE public.inventory_items
SET price_source = 'receipt'
WHERE source = 'receipt'
  AND price IS NOT NULL
  AND price_source IS NULL;

-- Backfill price_source for barcode-sourced items
UPDATE public.inventory_items
SET price_source = 'barcode'
WHERE source = 'barcode'
  AND price IS NOT NULL
  AND price_source IS NULL;

-- Verify
SELECT source, price_source, COUNT(*) AS n
FROM public.inventory_items
GROUP BY source, price_source
ORDER BY source, price_source;
