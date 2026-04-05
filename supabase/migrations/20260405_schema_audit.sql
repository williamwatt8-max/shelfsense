-- ============================================================
-- ShelfSense — Schema audit 2026-04-05
-- ============================================================
-- This file documents the confirmed schema state after the
-- barcode/quantity model audit. NO new columns are needed —
-- all required columns already exist from prior migrations.
--
-- Run this in Supabase Dashboard → SQL Editor ONLY if you
-- need to verify your schema matches what the code expects.
-- ============================================================

-- Expected columns on inventory_items:
--   id                  uuid
--   user_id             uuid
--   receipt_item_id     uuid (nullable)
--   source              text         -- 'receipt' | 'manual' | 'barcode' | 'voice'
--   name                text
--   quantity            numeric      -- current remaining amount
--   quantity_original   numeric      -- original amount at save time
--   count               integer      -- number of individual packs/units (nullable)
--   amount_per_unit     numeric      -- size of each unit, e.g. 330 for 330ml (nullable)
--   unit                text         -- 'ml' | 'g' | 'l' | 'kg' | 'item' | etc.
--   location            text         -- 'fridge' | 'freezer' | 'cupboard' | 'household' | 'other'
--   category            text (nullable)
--   retailer            text (nullable)
--   purchase_date       date (nullable)
--   expiry_date         date (nullable)
--   opened_at           date (nullable)
--   opened_expiry_days  integer (nullable)
--   status              text         -- 'active' | 'used' | 'discarded' | 'expired' | 'removed'
--   created_at          timestamptz
--   updated_at          timestamptz

-- Verify all columns are present:
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'inventory_items'
ORDER BY ordinal_position;
