-- ============================================================
-- ShelfSense — Add is_public to recipes
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================
--
-- PURPOSE:
--   Allow recipes to be shared publicly so all users can
--   see community recipes alongside their own.
--
-- BEHAVIOUR:
--   - is_public = false (default) → private, only visible to owner
--   - is_public = true            → visible to all logged-in users
--
-- RLS NOTE:
--   The SELECT policy must allow rows where is_public = true.
--   If you have a strict user_id = auth.uid() policy, update it to:
--     (user_id = auth.uid()) OR (is_public = true)
-- ============================================================

ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

-- Verify
SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_public) AS public_count
FROM public.recipes;
