-- Leaflog database setup
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.

-- ---------- Tables ----------

create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

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

create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plant_id     uuid not null references public.plants(id) on delete cascade,
  type         text not null check (type in ('water','fertilise','repot','new_leaf','prune','pest','note')),
  occurred_on  date not null default current_date,
  soil         text check (soil in ('dry','damp','wet')),
  note         text,
  photo_path   text,
  created_at   timestamptz not null default now()
);

create index if not exists events_plant_idx on public.events (plant_id, occurred_on desc);
create index if not exists events_user_idx  on public.events (user_id, occurred_on desc);
create index if not exists plants_room_idx  on public.plants (room_id);

-- ---------- Row level security: you only ever see your own rows ----------

alter table public.rooms  enable row level security;
alter table public.plants enable row level security;
alter table public.events enable row level security;

drop policy if exists "own rooms"  on public.rooms;
drop policy if exists "own plants" on public.plants;
drop policy if exists "own events" on public.events;

create policy "own rooms"  on public.rooms  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own plants" on public.plants for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own events" on public.events for all using (user_id = auth.uid()) with check (user_id = auth.uid());

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
