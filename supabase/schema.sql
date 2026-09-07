-- =====================================================================
-- FitClash — schema
-- Paste this whole file into Supabase Studio → SQL Editor → Run.
-- Safe to re-run: everything is idempotent.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- profiles : one row per auth user
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null default 'Player',
  avatar_emoji  text not null default '🔥',
  sex           text check (sex in ('male','female')),
  birth_date    date,
  height_cm     numeric(5,1),
  weight_kg     numeric(5,1),
  activity_level text default 'moderate'
                 check (activity_level in ('sedentary','light','moderate','active','very_active')),
  goal          text default 'cut' check (goal in ('cut','maintain','bulk')),
  timezone      text not null default 'Asia/Kolkata',
  onboarded     boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- challenges : the "one-to-two-month challenge" container
-- ---------------------------------------------------------------------
create table if not exists public.challenges (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text not null unique,
  start_date  date not null,
  end_date    date not null,
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.challenge_members (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

-- ---------------------------------------------------------------------
-- food_logs : one row per logged eating occasion
--   items jsonb = [{name, qty, unit, kcal, protein_g, carbs_g, fat_g, fiber_g}]
-- ---------------------------------------------------------------------
create table if not exists public.food_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  logged_at  timestamptz not null default now(),
  meal_slot  text not null default 'snack'
             check (meal_slot in ('breakfast','lunch','dinner','snack')),
  raw_text   text not null,
  items      jsonb not null default '[]'::jsonb,
  kcal       numeric(7,1) not null default 0,
  protein_g  numeric(6,1) not null default 0,
  carbs_g    numeric(6,1) not null default 0,
  fat_g      numeric(6,1) not null default 0,
  fiber_g    numeric(6,1) not null default 0,
  confidence text not null default 'medium'
             check (confidence in ('low','medium','high')),
  source     text not null default 'ai' check (source in ('ai','manual','edited')),
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists food_logs_user_date_idx on public.food_logs (user_id, local_date desc);

-- ---------------------------------------------------------------------
-- workout_logs : one row per training session
--   exercises jsonb = [{name, kind, met, minutes, sets, reps, weight_kg, distance_km, kcal}]
-- ---------------------------------------------------------------------
create table if not exists public.workout_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  local_date   date not null,
  logged_at    timestamptz not null default now(),
  raw_text     text not null,
  exercises    jsonb not null default '[]'::jsonb,
  minutes      numeric(6,1) not null default 0,
  kcal         numeric(7,1) not null default 0,
  body_weight_kg numeric(5,1),
  confidence   text not null default 'medium'
               check (confidence in ('low','medium','high')),
  source       text not null default 'ai' check (source in ('ai','manual','edited')),
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists workout_logs_user_date_idx on public.workout_logs (user_id, local_date desc);

-- ---------------------------------------------------------------------
-- rest_days : an explicit "today was a rest day" so it still scores
-- ---------------------------------------------------------------------
create table if not exists public.rest_days (
  user_id    uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

-- ---------------------------------------------------------------------
-- weigh_ins
-- ---------------------------------------------------------------------
create table if not exists public.weigh_ins (
  user_id    uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  weight_kg  numeric(5,1) not null,
  created_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

-- ---------------------------------------------------------------------
-- monthly_goals : "what I want to achieve over the next month"
-- ---------------------------------------------------------------------
create table if not exists public.monthly_goals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  month        date not null,                -- always the 1st of the month
  title        text not null,
  metric       text not null default 'custom'
               check (metric in ('weight_kg','avg_protein_g','total_kcal_burned','workout_days','avg_score','custom')),
  target_value numeric(10,2),
  done         boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists monthly_goals_user_month_idx on public.monthly_goals (user_id, month desc);

-- ---------------------------------------------------------------------
-- ai_cache : same food text -> same answer. Protects the Gemini free tier.
-- ---------------------------------------------------------------------
create table if not exists public.ai_cache (
  hash       text primary key,
  kind       text not null check (kind in ('food','workout')),
  prompt     text not null,
  response   jsonb not null,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Helper: does the current user share a challenge with <target>?
-- SECURITY DEFINER so the policy does not re-enter challenge_members RLS
-- (that recursion is the classic Supabase footgun).
-- =====================================================================
create or replace function public.shares_challenge_with(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from challenge_members me
    join challenge_members them on them.challenge_id = me.challenge_id
    where me.user_id = auth.uid()
      and them.user_id = target
  );
$$;

create or replace function public.my_challenge_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select challenge_id from challenge_members where user_id = auth.uid();
$$;

-- =====================================================================
-- Auto-create a profile row when someone signs up
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(coalesce(new.email, ''), '@', 1)
    )), ''), 'Player')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- daily_totals : SQL aggregates only. Scoring lives in TypeScript
-- (src/lib/scoring.ts) so weights can be tuned without a migration.
-- security_invoker => the caller's RLS applies to the underlying tables.
-- =====================================================================
create or replace view public.daily_totals
with (security_invoker = true) as
with days as (
  select user_id, local_date from public.food_logs
  union
  select user_id, local_date from public.workout_logs
  union
  select user_id, local_date from public.rest_days
)
select
  d.user_id,
  d.local_date,
  coalesce(f.kcal_in, 0)      as kcal_in,
  coalesce(f.protein_g, 0)    as protein_g,
  coalesce(f.carbs_g, 0)      as carbs_g,
  coalesce(f.fat_g, 0)        as fat_g,
  coalesce(f.fiber_g, 0)      as fiber_g,
  coalesce(f.meals, 0)        as meals,
  coalesce(w.kcal_out, 0)     as kcal_out,
  coalesce(w.minutes, 0)      as active_minutes,
  coalesce(w.sessions, 0)     as sessions,
  (r.user_id is not null)     as is_rest_day
from days d
left join (
  select user_id, local_date,
         sum(kcal) kcal_in, sum(protein_g) protein_g, sum(carbs_g) carbs_g,
         sum(fat_g) fat_g, sum(fiber_g) fiber_g, count(*) meals
  from public.food_logs group by user_id, local_date
) f on f.user_id = d.user_id and f.local_date = d.local_date
left join (
  select user_id, local_date,
         sum(kcal) kcal_out, sum(minutes) minutes, count(*) sessions
  from public.workout_logs group by user_id, local_date
) w on w.user_id = d.user_id and w.local_date = d.local_date
left join public.rest_days r on r.user_id = d.user_id and r.local_date = d.local_date;

-- =====================================================================
-- Row Level Security
-- Rule: you fully control your own rows; people in your challenge can
-- READ them (seeing what your rival actually ate is the whole point).
-- =====================================================================
alter table public.profiles          enable row level security;
alter table public.challenges        enable row level security;
alter table public.challenge_members enable row level security;
alter table public.food_logs         enable row level security;
alter table public.workout_logs      enable row level security;
alter table public.rest_days         enable row level security;
alter table public.weigh_ins         enable row level security;
alter table public.monthly_goals     enable row level security;
alter table public.ai_cache          enable row level security;

do $$
declare t text;
begin
  -- own-row CRUD + challenge-mate read, for every per-user table
  foreach t in array array['food_logs','workout_logs','rest_days','weigh_ins','monthly_goals']
  loop
    execute format('drop policy if exists %I_own on public.%I', t, t);
    execute format(
      'create policy %I_own on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t, t);

    execute format('drop policy if exists %I_mates_read on public.%I', t, t);
    execute format(
      'create policy %I_mates_read on public.%I for select to authenticated
         using (public.shares_challenge_with(user_id))', t, t);
  end loop;
end $$;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_mates_read on public.profiles;
create policy profiles_mates_read on public.profiles for select to authenticated
  using (public.shares_challenge_with(id));

drop policy if exists challenges_read on public.challenges;
create policy challenges_read on public.challenges for select to authenticated
  using (created_by = auth.uid() or id in (select public.my_challenge_ids()));

drop policy if exists challenges_insert on public.challenges;
create policy challenges_insert on public.challenges for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists challenges_update on public.challenges;
create policy challenges_update on public.challenges for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists members_read on public.challenge_members;
create policy members_read on public.challenge_members for select to authenticated
  using (challenge_id in (select public.my_challenge_ids()));

drop policy if exists members_join on public.challenge_members;
create policy members_join on public.challenge_members for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists members_leave on public.challenge_members;
create policy members_leave on public.challenge_members for delete to authenticated
  using (user_id = auth.uid());

-- ai_cache is written only by the server (service role bypasses RLS);
-- signed-in users may read it so a cache hit needs no Gemini call.
drop policy if exists ai_cache_read on public.ai_cache;
create policy ai_cache_read on public.ai_cache for select to authenticated using (true);

-- =====================================================================
-- join_challenge(code) — lets someone join by code without being able to
-- SELECT challenges they are not yet a member of.
-- =====================================================================
create or replace function public.join_challenge(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare cid uuid;
begin
  select id into cid from challenges where invite_code = upper(trim(code));
  if cid is null then
    raise exception 'No challenge with that code';
  end if;
  insert into challenge_members (challenge_id, user_id)
  values (cid, auth.uid())
  on conflict do nothing;
  return cid;
end;
$$;

grant execute on function public.join_challenge(text) to authenticated;
grant execute on function public.shares_challenge_with(uuid) to authenticated;
grant execute on function public.my_challenge_ids() to authenticated;

-- =====================================================================
-- cache_ai(...) — lets a signed-in user's server request populate the
-- shared AI cache without a blanket INSERT policy on ai_cache, and
-- without the app needing a service-role key at all.
-- =====================================================================
create or replace function public.cache_ai(
  p_hash text, p_kind text, p_prompt text, p_response jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ai_cache (hash, kind, prompt, response)
  values (p_hash, p_kind, p_prompt, p_response)
  on conflict (hash) do nothing;
end;
$$;

grant execute on function public.cache_ai(text, text, text, jsonb) to authenticated;
