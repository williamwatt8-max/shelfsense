-- Known products: learned product memory keyed by (user_id, barcode)
-- Populated automatically when a user saves barcode-scanned items.
-- Used to pre-fill future scans of the same barcode.

create table if not exists public.known_products (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  barcode          text not null,
  name             text not null,
  category         text,
  amount_per_unit  numeric,
  unit             text not null default 'item',
  usual_retailer   text,
  times_purchased  integer not null default 1,
  last_seen_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),

  constraint known_products_user_barcode unique (user_id, barcode)
);

-- Only the owning user can read/write their known products
alter table public.known_products enable row level security;

create policy "Users manage their own known products"
  on public.known_products
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Index for the primary lookup pattern
create index if not exists known_products_user_barcode_idx
  on public.known_products (user_id, barcode);
