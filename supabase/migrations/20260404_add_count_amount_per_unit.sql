-- Add count and amount_per_unit columns to inventory_items
-- count: number of individual units purchased (e.g. 6 for a 6-pack)
-- amount_per_unit: size of each unit (e.g. 330 for 330ml cans)
-- Run in Supabase Dashboard → SQL Editor

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS count INTEGER DEFAULT 1;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS amount_per_unit NUMERIC;
