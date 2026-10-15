-- Leaflog database setup (version 2)
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- It is safe to run more than once, and it also upgrades a version 1 database.

-- ---------- Rooms ----------

create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ---------- Plants ----------

create table if not exists public.plants (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  room_id       uuid references public.rooms(id) on delete set null,
  name          text not null,
  species       text,
  photo_path    text,
  interval_days int  not null default 7 check (interval_days between 1 and 365),
  notes         text,
  created_at    timestamptz not null default now()
);

-- watering flexibility: how many days LATER than ideal a plant may be pushed onto a shared water day
alter table public.plants add column if not exists flex text not null default 'normal' check (flex in ('strict','normal','hardy'));
-- feeding (rides along on the plant's watering day)
alter table public.plants add column if not exists fert_every_weeks int check (fert_every_weeks between 1 and 26);
alter table public.plants add column if not exists fert_winter_pause boolean not null default true;
-- moss pole (drip-watered)
alter table public.plants add column if not exists has_pole boolean not null default false;
alter table public.plants add column if not exists pole_every_days int check (pole_every_days between 1 and 30);
alter table public.plants add column if not exists pole_ml int check (pole_ml >= 0);
alter table public.plants add column if not exists pole_notes text;
-- grow light
alter table public.plants add column if not exists grow_light boolean not null default false;
alter table public.plants add column if not exists light_model text;
alter table public.plants add column if not exists light_watts int;
alter table public.plants add column if not exists light_hours numeric(4,1);
alter table public.plants add column if not exists light_distance_cm int;
alter table public.plants add column if not exists light_notes text;
-- details
alter table public.plants add column if not exists light_level text check (light_level in ('low','medium','bright','direct'));
alter table public.plants add column if not exists pot_size_cm numeric(5,1);
alter table public.plants add column if not exists soil_mix text;
alter table public.plants add column if not exists purchased_on date;
alter table public.plants add column if not exists purchased_from text;
alter table public.plants add column if not exists price numeric(10,2);
-- propagation (a cutting is a plant whose parent_id points at the plant it came from)
alter table public.plants add column if not exists parent_id uuid references public.plants(id) on delete set null;
alter table public.plants add column if not exists prop_stage text check (prop_stage in ('cutting','rooting','potted','established','failed'));
alter table public.plants add column if not exists propagated_on date;
alter table public.plants add column if not exists prop_method text check (prop_method in ('water','soil','sphagnum','air_layer','division','offset','other'));

-- ---------- Events (watering, feeding, repotting, new leaves, pole drips, ...) ----------

create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plant_id     uuid not null references public.plants(id) on delete cascade,
  type         text not null,
  occurred_on  date not null default current_date,
  soil         text check (soil in ('dry','damp','wet')),
  note         text,
  photo_path   text,
  created_at   timestamptz not null default now()
);
alter table public.events add column if not exists amount_ml int check (amount_ml >= 0);
alter table public.events drop constraint if exists events_type_check;
alter table public.events add constraint events_type_check
  check (type in ('water','fertilise','repot','new_leaf','prune','pest','note','pole','propagate'));

-- ---------- Problems (pests and other issues, open or resolved) ----------

create table if not exists public.issues (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plant_id     uuid not null references public.plants(id) on delete cascade,
  kind         text not null check (kind in ('pest','disease','overwatering','underwatering','nutrients','light','other')),
  title        text not null,
  started_on   date not null default current_date,
  resolved_on  date,
  treatment    text,
  what_worked  text,
  notes        text,
  created_at   timestamptz not null default now()
);

-- ---------- Your settings (water days, location, notifications) ----------

create table if not exists public.user_settings (
  user_id          uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  water_days       int[] not null default '{}',
  hemisphere       text not null default 'south' check (hemisphere in ('south','north')),
  season_adjust    boolean not null default false,
  season_factors   jsonb not null default '{"summer":1,"autumn":1.15,"winter":1.4,"spring":1.1}',
  latitude         double precision,
  longitude        double precision,
  location_name    text,
  notify_hour      int not null default 7 check (notify_hour between 0 and 23),
  timezone         text,
  push_enabled     boolean not null default false,
  last_notified_on date,
  updated_at       timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

-- ---------- Indexes ----------

create index if not exists events_plant_idx on public.events (plant_id, occurred_on desc);
create index if not exists events_user_idx  on public.events (user_id, occurred_on desc);
create index if not exists plants_room_idx  on public.plants (room_id);
create index if not exists plants_parent_idx on public.plants (parent_id);
create index if not exists issues_plant_idx on public.issues (plant_id);

-- ---------- Row level security: you only ever see your own rows ----------

alter table public.rooms              enable row level security;
alter table public.plants             enable row level security;
alter table public.events             enable row level security;
alter table public.issues             enable row level security;
alter table public.user_settings      enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "own rooms"    on public.rooms;
drop policy if exists "own plants"   on public.plants;
drop policy if exists "own events"   on public.events;
drop policy if exists "own issues"   on public.issues;
drop policy if exists "own settings" on public.user_settings;
drop policy if exists "own push"     on public.push_subscriptions;

create policy "own rooms"    on public.rooms              for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own plants"   on public.plants             for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own events"   on public.events             for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own issues"   on public.issues             for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own settings" on public.user_settings      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own push"     on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Private photo storage ----------
-- Photos are saved under <your user id>/<random>.jpg and only you can read them.

insert into storage.buckets (id, name, public)
values ('plant-photos', 'plant-photos', false)
on conflict (id) do nothing;

drop policy if exists "photos read"   on storage.objects;
drop policy if exists "photos insert" on storage.objects;
drop policy if exists "photos update" on storage.objects;
drop policy if exists "photos delete" on storage.objects;

create policy "photos read"   on storage.objects for select
  using (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos insert" on storage.objects for insert
  with check (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos update" on storage.objects for update
  using (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos delete" on storage.objects for delete
  using (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Make the API pick up the new tables and columns straight away
notify pgrst, 'reload schema';
