create extension if not exists "uuid-ossp";

create table receipts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid,
  retailer_name text,
  purchase_datetime timestamptz default now(),
  raw_text text,
  image_url text,
  created_at timestamptz default now()
);

create table receipt_items (
  id uuid primary key default uuid_generate_v4(),
  receipt_id uuid references receipts(id) on delete cascade not null,
  raw_text text,
  normalized_name text not null,
  quantity numeric default 1,
  unit text default 'item',
  category text,
  confidence numeric default 1.0,
  created_at timestamptz default now()
);

create type inventory_status as enum ('active', 'used', 'discarded', 'expired');
create type storage_location as enum ('fridge', 'freezer', 'cupboard', 'other');

create table inventory_items (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid,
  receipt_item_id uuid references receipt_items(id) on delete set null,
  name text not null,
  quantity numeric default 1,
  unit text default 'item',
  location storage_location default 'cupboard',
  category text,
  purchase_date date default current_date,
  expiry_date date,
  status inventory_status default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create type event_type as enum ('added', 'used', 'used_some', 'moved', 'discarded', 'expired');

create table inventory_events (
  id uuid primary key default uuid_generate_v4(),
  inventory_item_id uuid references inventory_items(id) on delete cascade not null,
  type event_type not null,
  quantity_delta numeric,
  notes text,
  created_at timestamptz default now()
);