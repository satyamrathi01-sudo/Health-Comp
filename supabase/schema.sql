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
-- Visibility is HUB AND SPOKE, not a free-for-all.
--
-- The challenge owner is the hub: they see every rival they have invited.
-- Each rival is a spoke: they see themselves and the owner, and nothing of
-- any other rival. So a rival never learns who else was invited, let alone
-- what they ate.
--
-- Concretely, auth.uid() may read <target> only when they share a challenge
-- AND at least one of the two is that challenge's creator.
--
-- SECURITY DEFINER so the policy does not re-enter challenge_members RLS
-- (that recursion is the classic Supabase footgun).
-- =====================================================================
create or replace function public.can_see(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target = auth.uid() or exists (
    select 1
    from challenge_members me
    join challenges c        on c.id = me.challenge_id
    join challenge_members them on them.challenge_id = c.id
    where me.user_id = auth.uid()
      and them.user_id = target
      and (c.created_by = auth.uid() or c.created_by = target)
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
-- daily_totals lives in the v2 section at the end of this file.
--
-- It is defined exactly once, with DROP + CREATE rather than CREATE OR
-- REPLACE: replacing a view cannot remove or reorder columns, so a second
-- definition here made re-running this file fail with "cannot drop columns
-- from view" once v2 had widened it.
-- =====================================================================

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
         using (public.can_see(user_id))', t, t);
  end loop;
end $$;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_mates_read on public.profiles;
create policy profiles_mates_read on public.profiles for select to authenticated
  using (public.can_see(id));

drop policy if exists challenges_read on public.challenges;
create policy challenges_read on public.challenges for select to authenticated
  using (created_by = auth.uid() or id in (select public.my_challenge_ids()));

drop policy if exists challenges_insert on public.challenges;
create policy challenges_insert on public.challenges for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists challenges_update on public.challenges;
create policy challenges_update on public.challenges for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());

-- Even the membership list is filtered: without this a rival could read the
-- roster and learn that other rivals exist.
drop policy if exists members_read on public.challenge_members;
create policy members_read on public.challenge_members for select to authenticated
  using (
    challenge_id in (select public.my_challenge_ids())
    and public.can_see(user_id)
  );

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
grant execute on function public.can_see(uuid) to authenticated;
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

-- =====================================================================
-- v2 — micronutrients, sleep, and the AI daily suggestion.
-- Re-run this whole file; every statement below is idempotent.
-- =====================================================================

-- Micros are tracked per LOG rather than per item: it keeps the Gemini
-- response small and fast, and unlike macros they are informational only
-- (nothing here feeds the score), so per-item precision buys little.
alter table public.food_logs
  add column if not exists sodium_mg     numeric(8,1) not null default 0,
  add column if not exists potassium_mg  numeric(8,1) not null default 0,
  add column if not exists calcium_mg    numeric(8,1) not null default 0,
  add column if not exists iron_mg       numeric(7,2) not null default 0,
  add column if not exists magnesium_mg  numeric(8,1) not null default 0,
  add column if not exists zinc_mg       numeric(7,2) not null default 0,
  add column if not exists vitamin_c_mg  numeric(8,1) not null default 0,
  add column if not exists vitamin_d_ug  numeric(7,2) not null default 0,
  add column if not exists vitamin_b12_ug numeric(7,2) not null default 0,
  add column if not exists folate_ug     numeric(8,1) not null default 0,
  add column if not exists sugar_g       numeric(7,1) not null default 0,
  add column if not exists satfat_g      numeric(7,1) not null default 0;

-- ---------------------------------------------------------------------
-- sleep_logs : entered by hand, one per night
-- ---------------------------------------------------------------------
create table if not exists public.sleep_logs (
  user_id    uuid not null references auth.users(id) on delete cascade,
  local_date date not null,               -- the morning you woke up
  hours      numeric(4,2) not null check (hours >= 0 and hours <= 24),
  quality    text check (quality in ('poor','ok','good')),
  note       text,
  created_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

-- ---------------------------------------------------------------------
-- daily_advice : the AI's pointers for tomorrow.
--   basis_hash covers the day's totals, so advice is regenerated only
--   when the underlying numbers actually move — one Gemini call per
--   meaningful change rather than one per page view.
-- ---------------------------------------------------------------------
create table if not exists public.daily_advice (
  user_id    uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  basis_hash text not null,
  points     jsonb not null default '[]'::jsonb,
  headline   text,
  created_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

alter table public.sleep_logs   enable row level security;
alter table public.daily_advice enable row level security;

do $$
declare t text;
begin
  foreach t in array array['sleep_logs','daily_advice']
  loop
    execute format('drop policy if exists %I_own on public.%I', t, t);
    execute format(
      'create policy %I_own on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t, t);
    execute format('drop policy if exists %I_mates_read on public.%I', t, t);
    execute format(
      'create policy %I_mates_read on public.%I for select to authenticated
         using (public.can_see(user_id))', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- daily_totals : SQL aggregates only. Scoring lives in TypeScript
-- (src/lib/scoring.ts) so weights can be tuned without a migration.
-- security_invoker => the caller's RLS applies to the underlying tables.
--
-- Dropped and recreated rather than replaced: CREATE OR REPLACE VIEW
-- cannot add, drop or reorder columns.
-- ---------------------------------------------------------------------
drop view if exists public.daily_totals;

create view public.daily_totals
with (security_invoker = true) as
with days as (
  select user_id, local_date from public.food_logs
  union select user_id, local_date from public.workout_logs
  union select user_id, local_date from public.rest_days
  union select user_id, local_date from public.sleep_logs
)
select
  d.user_id,
  d.local_date,
  coalesce(f.kcal_in, 0)        as kcal_in,
  coalesce(f.protein_g, 0)      as protein_g,
  coalesce(f.carbs_g, 0)        as carbs_g,
  coalesce(f.fat_g, 0)          as fat_g,
  coalesce(f.fiber_g, 0)        as fiber_g,
  coalesce(f.meals, 0)          as meals,
  coalesce(w.kcal_out, 0)       as kcal_out,
  coalesce(w.minutes, 0)        as active_minutes,
  coalesce(w.sessions, 0)       as sessions,
  (r.user_id is not null)       as is_rest_day,
  coalesce(f.sodium_mg, 0)      as sodium_mg,
  coalesce(f.potassium_mg, 0)   as potassium_mg,
  coalesce(f.calcium_mg, 0)     as calcium_mg,
  coalesce(f.iron_mg, 0)        as iron_mg,
  coalesce(f.magnesium_mg, 0)   as magnesium_mg,
  coalesce(f.zinc_mg, 0)        as zinc_mg,
  coalesce(f.vitamin_c_mg, 0)   as vitamin_c_mg,
  coalesce(f.vitamin_d_ug, 0)   as vitamin_d_ug,
  coalesce(f.vitamin_b12_ug, 0) as vitamin_b12_ug,
  coalesce(f.folate_ug, 0)      as folate_ug,
  coalesce(f.sugar_g, 0)        as sugar_g,
  coalesce(f.satfat_g, 0)       as satfat_g,
  s.hours                       as sleep_hours,
  s.quality                     as sleep_quality
from days d
left join (
  select user_id, local_date,
         sum(kcal) kcal_in, sum(protein_g) protein_g, sum(carbs_g) carbs_g,
         sum(fat_g) fat_g, sum(fiber_g) fiber_g, count(*) meals,
         sum(sodium_mg) sodium_mg, sum(potassium_mg) potassium_mg,
         sum(calcium_mg) calcium_mg, sum(iron_mg) iron_mg,
         sum(magnesium_mg) magnesium_mg, sum(zinc_mg) zinc_mg,
         sum(vitamin_c_mg) vitamin_c_mg, sum(vitamin_d_ug) vitamin_d_ug,
         sum(vitamin_b12_ug) vitamin_b12_ug, sum(folate_ug) folate_ug,
         sum(sugar_g) sugar_g, sum(satfat_g) satfat_g
  from public.food_logs group by user_id, local_date
) f on f.user_id = d.user_id and f.local_date = d.local_date
left join (
  select user_id, local_date,
         sum(kcal) kcal_out, sum(minutes) minutes, count(*) sessions
  from public.workout_logs group by user_id, local_date
) w on w.user_id = d.user_id and w.local_date = d.local_date
left join public.rest_days  r on r.user_id = d.user_id and r.local_date = d.local_date
left join public.sleep_logs s on s.user_id = d.user_id and s.local_date = d.local_date;

-- =====================================================================
-- v3 — retire the old any-member-sees-any-member helper. Runs last so no
-- policy still references it.
-- =====================================================================
drop function if exists public.shares_challenge_with(uuid);

-- =====================================================================
-- v4 — performance.
--
-- The dashboard used to take six sequential round trips: whoami, my
-- profile, my challenge, its member ids, their profiles, then the totals.
-- On a Vercel function in us-east talking to Supabase, each of those is a
-- full cross-region hop and the page crawled.
--
-- These two functions collapse that into one call each. Both are SECURITY
-- INVOKER on purpose: RLS then applies exactly as it does to the equivalent
-- direct queries, so hub-and-spoke visibility is preserved with no extra
-- filtering here. auth.uid() is read from the caller's JWT, so no separate
-- "who am I" request is needed either.
-- =====================================================================

create or replace function public.get_my_profile()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select to_jsonb(p) from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.get_arena(days integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  uid        uuid := auth.uid();
  me_row     public.profiles;
  ch         public.challenges;
  member_ids uuid[];
  today      date;
  from_date  date;
begin
  if uid is null then
    return null;
  end if;

  select * into me_row from public.profiles where id = uid;
  if not found then
    return null;
  end if;

  -- The user's own timezone decides where "today" starts.
  today     := (now() at time zone coalesce(me_row.timezone, 'Asia/Kolkata'))::date;
  from_date := today - (greatest(coalesce(days, 30), 1) - 1);

  select c.* into ch
  from public.challenge_members m
  join public.challenges c on c.id = m.challenge_id
  where m.user_id = uid
  order by m.joined_at desc
  limit 1;

  -- RLS already restricts this to people I am allowed to see: everyone for
  -- the owner, only myself and the owner for a rival.
  if ch.id is not null then
    select array_agg(m.user_id)
      into member_ids
      from public.challenge_members m
     where m.challenge_id = ch.id;
  end if;

  if member_ids is null then
    member_ids := array[uid];
  end if;

  return jsonb_build_object(
    'today',     today,
    'from_date', from_date,
    'me',        to_jsonb(me_row),
    'challenge', case when ch.id is null then null else to_jsonb(ch) end,
    'players',   coalesce(
                   (select jsonb_agg(to_jsonb(p) order by p.created_at)
                      from public.profiles p
                     where p.id = any(member_ids)), '[]'::jsonb),
    'totals',    coalesce(
                   (select jsonb_agg(to_jsonb(t))
                      from public.daily_totals t
                     where t.user_id = any(member_ids)
                       and t.local_date between from_date and today), '[]'::jsonb),
    -- This month's goals, for everyone visible. They override the derived
    -- targets where they overlap, so scoring has to see them.
    'goals',     coalesce(
                   (select jsonb_agg(to_jsonb(g))
                      from public.monthly_goals g
                     where g.user_id = any(member_ids)
                       and g.month = date_trunc('month', today)::date), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.get_arena(integer) to authenticated;
