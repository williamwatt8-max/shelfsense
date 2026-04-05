-- ============================================================
-- ShelfSense — Recipes + Shopping List tables
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── recipes ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recipes (
  id             UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID    REFERENCES auth.users(id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,
  base_servings  INTEGER NOT NULL DEFAULT 2,
  instructions   TEXT,
  source         TEXT    NOT NULL DEFAULT 'manual',  -- 'manual' | 'scanned'
  raw_text       TEXT,                               -- original OCR text from scan
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── recipe_ingredients ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recipe_ingredients (
  id         UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  recipe_id  UUID    NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  quantity   NUMERIC NOT NULL DEFAULT 1,
  unit       TEXT    NOT NULL DEFAULT 'item',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── shopping_list_items ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shopping_list_items (
  id         UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID    REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  quantity   NUMERIC NOT NULL DEFAULT 1,
  unit       TEXT    NOT NULL DEFAULT 'item',
  checked    BOOLEAN NOT NULL DEFAULT FALSE,
  recipe_id  UUID    REFERENCES public.recipes(id) ON DELETE SET NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE public.recipes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_list_items  ENABLE ROW LEVEL SECURITY;

-- Recipes: users own their own recipes
CREATE POLICY "own recipes" ON public.recipes
  FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Ingredients: accessible via recipe ownership
CREATE POLICY "own recipe ingredients" ON public.recipe_ingredients
  FOR ALL
  USING  (recipe_id IN (SELECT id FROM public.recipes WHERE user_id = auth.uid()))
  WITH CHECK (recipe_id IN (SELECT id FROM public.recipes WHERE user_id = auth.uid()));

-- Shopping list: users own their own items
CREATE POLICY "own shopping list" ON public.shopping_list_items
  FOR ALL
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe_id
  ON public.recipe_ingredients(recipe_id);

CREATE INDEX IF NOT EXISTS idx_shopping_list_user_id
  ON public.shopping_list_items(user_id);

CREATE INDEX IF NOT EXISTS idx_recipes_user_id
  ON public.recipes(user_id);

-- ── Verify ────────────────────────────────────────────────────
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('recipes','recipe_ingredients','shopping_list_items')
ORDER BY table_name, ordinal_position;
