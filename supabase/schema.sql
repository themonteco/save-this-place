-- Save This Place — database schema
-- Paste this entire file into Supabase SQL Editor and click "Run".
-- It's safe to run more than once.

create extension if not exists "uuid-ossp";

-- ============ PLACES TABLE ============
create table if not exists public.places (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  notes text default '',
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  category text,
  category_override text,
  photo text,                       -- base64 data URL, optional
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists places_user_id_created_idx
  on public.places (user_id, created_at desc);

-- ============ ROW LEVEL SECURITY ============
alter table public.places enable row level security;

drop policy if exists "places select own" on public.places;
create policy "places select own" on public.places
  for select using (auth.uid() = user_id);

drop policy if exists "places insert own" on public.places;
create policy "places insert own" on public.places
  for insert with check (auth.uid() = user_id);

drop policy if exists "places update own" on public.places;
create policy "places update own" on public.places
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "places delete own" on public.places;
create policy "places delete own" on public.places
  for delete using (auth.uid() = user_id);

-- ============ PROFILES TABLE ============
-- Stores the display name. Auth provides email + id.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  created_at timestamptz default now() not null
);

alter table public.profiles enable row level security;

drop policy if exists "profiles select own" on public.profiles;
create policy "profiles select own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles upsert own" on public.profiles;
create policy "profiles upsert own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ============ DONE ============
-- After running this, go to Authentication > Providers in the Supabase dashboard
-- and make sure "Email" is enabled. That's it.
