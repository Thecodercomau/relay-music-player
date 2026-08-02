-- =====================================================
--  Relay Music Player — Supabase (Postgres) schema
--  Apply with:  supabase db push
--  (or paste into the Dashboard → SQL Editor)
-- =====================================================

-- -----------------------------------------------------
-- Profiles — one row per Supabase Auth user.
-- `email` is denormalized here so admin listing doesn't
-- need to touch auth.users.
-- -----------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text        not null default '',
  email      text        not null default '',
  is_admin   boolean     not null default false,
  created_at timestamptz not null default now()
);

-- Auto-create a profile when a user signs up.
-- The FIRST account ever created becomes an admin
-- (mirrors the old php/setup.php behavior).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
    coalesce(new.email, '')
  );

  if not exists (select 1 from public.profiles where is_admin) then
    update public.profiles set is_admin = true where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------
-- Playlists
-- -----------------------------------------------------
create table if not exists public.playlists (
  id         bigserial primary key,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  name       varchar(120) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_playlists_user on public.playlists (user_id);

-- -----------------------------------------------------
-- Playlist tracks — snapshot of the track metadata.
-- `deezer_id` is kept for frontend compatibility; it
-- holds the source track id (Jamendo id or local song id).
-- -----------------------------------------------------
create table if not exists public.playlist_tracks (
  id          bigserial primary key,
  playlist_id bigint      not null references public.playlists(id) on delete cascade,
  deezer_id   bigint      not null,
  title       varchar(255) not null,
  artist      varchar(255) not null,
  album       varchar(255) not null default '',
  cover       varchar(500) not null default '',
  cover_big   varchar(500) not null default '',
  preview     varchar(500) not null default '',
  duration    int         not null default 0,
  source      varchar(20) not null default '',
  added_at    timestamptz not null default now(),
  unique (playlist_id, deezer_id)
);

create index if not exists idx_playlist_tracks_playlist on public.playlist_tracks (playlist_id);

-- -----------------------------------------------------
-- Songs — your own music catalog (DB-first hybrid source)
-- -----------------------------------------------------
create table if not exists public.songs (
  id         bigserial primary key,
  jamendo_id bigint unique,
  title      varchar(255) not null,
  artist     varchar(255) not null,
  album      varchar(255) not null default '',
  cover      varchar(500) not null default '',
  duration   int          not null default 0,
  audio_url  text         not null default '',
  created_at timestamptz  not null default now()
);

-- LIKE-based search needs a trigram index on Postgres
-- (MySQL's plain BTREE + %...% does nothing useful here).
create extension if not exists pg_trgm;
create index if not exists idx_songs_search
  on public.songs using gin (title gin_trgm_ops, artist gin_trgm_ops, album gin_trgm_ops);

-- -----------------------------------------------------
-- Row Level Security.
-- All data access happens through Edge Functions using
-- the service role key, so tables are locked down to
-- everyone else (deny-all). Nothing is exposed directly
-- to the browser via PostgREST.
-- -----------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.playlists       enable row level security;
alter table public.playlist_tracks enable row level security;
alter table public.songs           enable row level security;

-- -----------------------------------------------------
-- Storage: the `uploads` bucket for admin-uploaded audio.
-- Public read (so tracks can be played), authenticated
-- write. 100 MB per file mirrors the old PHP upload limit.
-- -----------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'uploads',
  'uploads',
  true,
  104857600,
  array[
    'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
    'audio/flac', 'audio/aac', 'audio/opus', 'application/octet-stream'
  ]
)
on conflict (id) do update set public = true;

drop policy if exists "uploads public read" on storage.objects;
create policy "uploads public read"
  on storage.objects for select
  using (bucket_id = 'uploads');

-- Note: any logged-in user can upload to this bucket (the browser uploads
-- directly). The real gate is the admin-only `songs` function — orphaned
-- files are harmless because only an admin can add them to the library.
drop policy if exists "uploads auth write" on storage.objects;
create policy "uploads auth write"
  on storage.objects for insert
  with check (bucket_id = 'uploads' and auth.role() = 'authenticated');

drop policy if exists "uploads auth delete" on storage.objects;
create policy "uploads auth delete"
  on storage.objects for delete
  using (bucket_id = 'uploads' and auth.role() = 'authenticated');
