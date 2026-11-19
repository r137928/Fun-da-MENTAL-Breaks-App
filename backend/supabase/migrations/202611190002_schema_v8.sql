begin;

-- Keep the original migration unchanged. Apply this migration once after it.
alter table public.profiles alter column mind_score drop not null;
alter table public.profiles alter column presence_score drop not null;

-- Earlier test profiles may contain free-form gender/activity preferences.
-- Preserve those values and validate new or changed choices.
create function public.validate_profile_choices()
returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' or new.gender is distinct from old.gender then
    if new.gender is null or new.gender not in ('female', 'male', 'non-binary', 'prefer not to say') then
      raise check_violation using message = 'Select a valid gender option';
    end if;
  end if;
  if TG_OP = 'INSERT' or new.break_pref is distinct from old.break_pref then
    if new.break_pref is null
      or cardinality(new.break_pref) > 4
      or coalesce(array_ndims(new.break_pref), 1) <> 1
      or exists (
        select 1 from unnest(new.break_pref) as preference(value)
        where value is null or value not in ('stillness', 'movement', 'balanced', 'depends')
      )
      or cardinality(new.break_pref) <> (select count(distinct value) from unnest(new.break_pref) as preference(value))
    then
      raise check_violation using message = 'Select unique break preferences from the allowed options';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.validate_profile_choices() from public;
create trigger validate_profile_choices before insert or update on public.profiles
  for each row execute function public.validate_profile_choices();

-- Revoke column privileges as well as table privileges so scores remain server-managed.
revoke all on public.profiles from anon, authenticated;
revoke all (user_id, created_at, name, nickname, phone, gender, age,
  mind_score, presence_score, break_pref, goals, color_palette, role)
  on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (user_id, name, nickname, phone, gender, age, break_pref, goals, color_palette)
  on public.profiles to authenticated;
grant update (name, nickname, phone, gender, age, break_pref, goals, color_palette)
  on public.profiles to authenticated;

-- Preserve activity IDs, ownership and original duration values.
alter table public.breaks rename column id to break_id;
alter table public.breaks rename column user_id to created_by;
alter table public.breaks alter column created_by drop not null;
alter table public.breaks alter column duration drop not null;
alter table public.breaks add column duration_bucket text;
update public.breaks set duration_bucket = case
  when duration <= 5 then '1_to_5'
  when duration <= 10 then '5_to_10'
  when duration <= 15 then '10_to_15'
  when duration <= 20 then '15_to_20'
  else '20+'
end;
alter table public.breaks alter column duration_bucket set not null;
alter table public.breaks add constraint breaks_duration_bucket_check
  check (duration_bucket in ('1_to_5', '5_to_10', '10_to_15', '15_to_20', '20+'));
comment on column public.breaks.duration is
  'Legacy planned minutes retained for compatibility. New clients select duration_bucket.';

drop policy breaks_select on public.breaks;
drop policy breaks_insert on public.breaks;
drop policy breaks_update on public.breaks;
drop policy breaks_delete on public.breaks;
create policy breaks_select on public.breaks for select to authenticated
  using (created_by is null or created_by = (select auth.uid()));
create policy breaks_insert on public.breaks for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy breaks_update on public.breaks for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));
create policy breaks_delete on public.breaks for delete to authenticated
  using (created_by = (select auth.uid()));

revoke all on public.breaks from anon, authenticated;
revoke all (break_id, created_by, title, break_type, duration, icon, created_at, duration_bucket)
  on public.breaks from anon, authenticated;
grant select on public.breaks to authenticated;
grant insert (created_by, title, break_type, duration_bucket, duration, icon)
  on public.breaks to authenticated;
grant update (title, break_type, duration_bucket, duration, icon)
  on public.breaks to authenticated;
grant delete on public.breaks to authenticated;

create table public.break_logs (
  log_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  break_id uuid references public.breaks(break_id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 120),
  break_type text not null check (break_type in ('stillness', 'movement')),
  source text not null check (source in ('timer', 'manual')),
  occurred_at timestamptz not null,
  actual_duration_secs integer check (actual_duration_secs > 0),
  started_at timestamptz,
  completed_at timestamptz,
  mind_score_before integer check (mind_score_before between 1 and 10),
  mind_score_after integer check (mind_score_after between 1 and 10),
  break_presence_score integer check (break_presence_score between 0 and 100),
  created_at timestamptz not null default now(),
  status text not null check (status in ('in_progress', 'completed', 'cancelled')),
  icon text check (length(icon) <= 200),
  constraint break_logs_time_order check (
    started_at is null or completed_at is null or completed_at >= started_at
  ),
  constraint break_logs_completion_status check (
    completed_at is null or status <> 'in_progress'
  )
);
create index break_logs_user_occurred_idx
  on public.break_logs(user_id, occurred_at desc, log_id desc);
create index break_logs_break_idx on public.break_logs(break_id);

-- Apply source-dependent defaults even for inserts through the Supabase Data API.
create function public.default_break_log_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is null then
    new.status := case when new.source = 'manual' then 'completed' else 'in_progress' end;
  end if;
  return new;
end;
$$;
revoke all on function public.default_break_log_status() from public;
create trigger default_break_log_status before insert on public.break_logs
  for each row execute function public.default_break_log_status();

alter table public.break_logs enable row level security;
revoke all on public.break_logs from anon, authenticated;
grant select, delete on public.break_logs to authenticated;
grant insert (user_id, break_id, title, break_type, source, occurred_at,
  actual_duration_secs, started_at, completed_at, mind_score_before,
  mind_score_after, break_presence_score, status, icon)
  on public.break_logs to authenticated;
grant update (break_id, title, break_type, source, occurred_at, actual_duration_secs,
  started_at, completed_at, mind_score_before, mind_score_after, break_presence_score,
  status, icon) on public.break_logs to authenticated;

create policy break_logs_select on public.break_logs for select to authenticated
  using (user_id = (select auth.uid()));
create policy break_logs_insert on public.break_logs for insert to authenticated
  with check (
    user_id = (select auth.uid()) and (
      break_id is null or exists (
        select 1 from public.breaks b where b.break_id = break_logs.break_id
          and (b.created_by is null or b.created_by = (select auth.uid()))
      )
    )
  );
create policy break_logs_update on public.break_logs for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid()) and (
      break_id is null or exists (
        select 1 from public.breaks b where b.break_id = break_logs.break_id
          and (b.created_by is null or b.created_by = (select auth.uid()))
      )
    )
  );
create policy break_logs_delete on public.break_logs for delete to authenticated
  using (user_id = (select auth.uid()));

-- Counts use completed logs. Missing durations contribute no invented minutes.
-- Local-day streaks and profile score formulas remain product decisions.
create view public.break_log_totals with (security_invoker = true) as
select user_id,
  count(*) as completed_breaks,
  count(actual_duration_secs) as breaks_with_duration,
  coalesce(sum(actual_duration_secs), 0) as total_duration_secs
from public.break_logs where status = 'completed'
group by user_id;
revoke all on public.break_log_totals from public, anon, authenticated;
grant select on public.break_log_totals to authenticated;

notify pgrst, 'reload schema';
commit;
