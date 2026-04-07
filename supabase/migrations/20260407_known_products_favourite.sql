-- Add is_favourite flag to known_products
-- Lets users mark recurring/favourite products for prominence in the UI

alter table public.known_products
  add column if not exists is_favourite boolean not null default false;
