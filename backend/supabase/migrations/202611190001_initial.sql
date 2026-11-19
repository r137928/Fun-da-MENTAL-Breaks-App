begin;
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  name text not null check (length(btrim(name)) between 1 and 100),
  nickname text check (length(nickname) <= 60),
  phone text check (length(phone) between 3 and 32),
  gender text check (length(gender) <= 60),
  age integer not null check (age between 0 and 130),
  mind_score integer not null check (mind_score between 1 and 10),
  presence_score integer not null check (presence_score between 0 and 100),
  break_pref text[] not null default '{}',
  goals text[] not null default '{}',
  color_palette jsonb,
  role text not null default 'user' check (role in ('user', 'admin')),
  constraint valid_palette check (
    color_palette is null or (
      jsonb_typeof(color_palette) = 'object'
      and color_palette ? 'now' and color_palette ? 'goal'
      and coalesce((color_palette ->> 'now') ~ '^#[0-9a-fA-F]{6}$', false)
      and coalesce((color_palette ->> 'goal') ~ '^#[0-9a-fA-F]{6}$', false)
    )
  )
);
create table public.breaks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  break_type text not null check (break_type in ('stillness', 'movement')),
  duration integer not null check (duration between 1 and 1440),
  icon text check (length(icon) <= 200),
  created_at timestamptz not null default now()
);
create index breaks_user_created_idx on public.breaks(user_id, created_at desc, id desc);
alter table public.profiles enable row level security;
alter table public.breaks enable row level security;
revoke all on public.profiles, public.breaks from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (user_id, name, nickname, phone, gender, age, mind_score,
  presence_score, break_pref, goals, color_palette) on public.profiles to authenticated;
grant update (name, nickname, phone, gender, age, mind_score,
  presence_score, break_pref, goals, color_palette) on public.profiles to authenticated;
grant select on public.breaks to authenticated;
grant insert (user_id, title, break_type, duration, icon) on public.breaks to authenticated;
grant update (title, break_type, duration, icon) on public.breaks to authenticated;
grant delete on public.breaks to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy profiles_insert on public.profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy profiles_update on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy breaks_select on public.breaks for select to authenticated
  using ((select auth.uid()) = user_id);
create policy breaks_insert on public.breaks for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy breaks_update on public.breaks for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy breaks_delete on public.breaks for delete to authenticated
  using ((select auth.uid()) = user_id);
commit;
