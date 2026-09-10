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

/**
 * Returns the caller's profile, creating it first if it is somehow missing.
 *
 * The signup trigger normally handles this, but an account created before
 * the trigger existed — or one whose insert lost a race — ends up with an
 * auth user and no profile row. That state is unrecoverable from the app:
 * sign-in succeeds, the profile lookup returns nothing, and the layout
 * bounces the user straight back to the login screen forever. Healing it on
 * read costs one statement and removes the whole failure mode.
 */
create or replace function public.get_my_profile()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row_out public.profiles;
begin
  if uid is null then
    return null;
  end if;

  select * into row_out from public.profiles where id = uid;
  if found then
    return to_jsonb(row_out);
  end if;

  insert into public.profiles (id, display_name)
  select uid, coalesce(
    nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Player')
  from auth.users u where u.id = uid
  on conflict (id) do nothing;

  select * into row_out from public.profiles where id = uid;
  return to_jsonb(row_out);
end;
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

-- =====================================================================
-- v5 — backfill any auth user that never got a profile row.
--
-- One account was found in this state: sign-in worked, but with no profile
-- the app had nothing to show and bounced it back to the login screen.
-- Idempotent, so it is safe on every re-run.
-- =====================================================================
insert into public.profiles (id, display_name)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Player')
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- =====================================================================
-- v6 — fold today's logs into get_arena.
--
-- The Today screen was still making a second and third query for today's
-- food and workout rows after get_arena had already returned. Returning
-- them here removes another sequential round trip; RLS applies exactly as
-- before, since the function stays SECURITY INVOKER.
-- =====================================================================
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

  today     := (now() at time zone coalesce(me_row.timezone, 'Asia/Kolkata'))::date;
  from_date := today - (greatest(coalesce(days, 30), 1) - 1);

  select c.* into ch
  from public.challenge_members m
  join public.challenges c on c.id = m.challenge_id
  where m.user_id = uid
  order by m.joined_at desc
  limit 1;

  if ch.id is not null then
    select array_agg(m.user_id) into member_ids
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
    'goals',     coalesce(
                   (select jsonb_agg(to_jsonb(g))
                      from public.monthly_goals g
                     where g.user_id = any(member_ids)
                       and g.month = date_trunc('month', today)::date), '[]'::jsonb),
    -- Today's own entries, so the dashboard needs no follow-up queries.
    'today_food', coalesce(
                   (select jsonb_agg(to_jsonb(f) order by f.logged_at)
                      from public.food_logs f
                     where f.user_id = uid and f.local_date = today), '[]'::jsonb),
    'today_workouts', coalesce(
                   (select jsonb_agg(to_jsonb(w) order by w.logged_at)
                      from public.workout_logs w
                     where w.user_id = uid and w.local_date = today), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_arena(integer) to authenticated;

-- =====================================================================
-- v7 — many challenges per person.
--
-- Everyone can run their own challenge and join other people's, so a user
-- is now in N of them at once and picks which one they are looking at.
--
-- Visibility needs NO change: can_see() already requires a SHARED challenge
-- where one of the pair created it. So if I run challenge A with X, and X
-- separately runs challenge C with Z, X sees both of us and Z and I never
-- see each other. That is exactly the intent, and it falls out of the
-- existing rule rather than needing a new one.
-- =====================================================================

alter table public.profiles
  add column if not exists active_challenge_id uuid
    references public.challenges(id) on delete set null;

-- get_arena resolves which challenge to report on, in this order:
--   1. the challenge_id passed in
--   2. profiles.active_challenge_id
--   3. most recently joined
-- Each candidate is checked for membership first, so a stale or forged id
-- simply falls through instead of leaking someone else's challenge.
create or replace function public.get_arena(
  days integer default 30,
  challenge_id uuid default null
)
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
  wanted     uuid;
begin
  if uid is null then
    return null;
  end if;

  select * into me_row from public.profiles where id = uid;
  if not found then
    return null;
  end if;

  today     := (now() at time zone coalesce(me_row.timezone, 'Asia/Kolkata'))::date;
  from_date := today - (greatest(coalesce(days, 30), 1) - 1);

  wanted := coalesce(challenge_id, me_row.active_challenge_id);

  if wanted is not null then
    select c.* into ch
    from public.challenge_members m
    join public.challenges c on c.id = m.challenge_id
    where m.user_id = uid and c.id = wanted;
  end if;

  -- Nothing asked for, or asked for something they are not in.
  if ch.id is null then
    select c.* into ch
    from public.challenge_members m
    join public.challenges c on c.id = m.challenge_id
    where m.user_id = uid
    order by m.joined_at desc
    limit 1;
  end if;

  if ch.id is not null then
    select array_agg(m.user_id) into member_ids
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
    'goals',     coalesce(
                   (select jsonb_agg(to_jsonb(g))
                      from public.monthly_goals g
                     where g.user_id = any(member_ids)
                       and g.month = date_trunc('month', today)::date), '[]'::jsonb),
    'today_food', coalesce(
                   (select jsonb_agg(to_jsonb(f) order by f.logged_at)
                      from public.food_logs f
                     where f.user_id = uid and f.local_date = today), '[]'::jsonb),
    'today_workouts', coalesce(
                   (select jsonb_agg(to_jsonb(w) order by w.logged_at)
                      from public.workout_logs w
                     where w.user_id = uid and w.local_date = today), '[]'::jsonb),
    -- Every challenge this person belongs to, for the switcher. Named by
    -- whoever created it, which is how you tell two "60-Day Clash" apart.
    'my_challenges', coalesce(
                   (select jsonb_agg(jsonb_build_object(
                              'id',           c.id,
                              'name',         c.name,
                              'invite_code',  c.invite_code,
                              'start_date',   c.start_date,
                              'end_date',     c.end_date,
                              'created_by',   c.created_by,
                              'is_mine',      c.created_by = uid,
                              'owner_name',   coalesce(op.display_name, 'Someone'),
                              'owner_emoji',  coalesce(op.avatar_emoji, '🔥'),
                              'member_count', (select count(*) from public.challenge_members mm
                                                where mm.challenge_id = c.id)
                            ) order by m2.joined_at desc)
                      from public.challenge_members m2
                      join public.challenges c on c.id = m2.challenge_id
                      left join public.profiles op on op.id = c.created_by
                     where m2.user_id = uid), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_arena(integer, uuid) to authenticated;

-- The single-argument form is what older deploys call; drop it so there is
-- exactly one get_arena and no ambiguity about which overload runs.
drop function if exists public.get_arena(integer);

-- =====================================================================
-- v8 — your body is your own business.
--
-- Height, weight, age, sex and everything computed from them stop being
-- readable by the people you are competing against. What a rival can see is
-- a CARD: name, emoji, and the three daily targets their score is measured
-- against.
--
-- Publishing the targets but not the body is a deliberate line. The targets
-- are already implied by the scoreboard — 450 kcal burned scoring 30 out of
-- 35 says the burn target is about 525 whether or not we say so — and
-- relative scoring is pointless without them. Height and weight are implied
-- by nothing, so they stay behind the profile.
--
-- This is enforced in the database rather than in the UI. The browser holds
-- an anon key and can run its own queries, so a number left out of a React
-- component is not hidden at all.
-- =====================================================================

alter table public.profiles
  -- Manual overrides. Null means "derive it for me".
  add column if not exists bmr_override         numeric(6,1),
  add column if not exists kcal_target_override numeric(6,1),
  add column if not exists protein_target_g     numeric(6,1),
  add column if not exists carbs_target_g       numeric(6,1),
  add column if not exists fat_target_g         numeric(6,1),
  add column if not exists fiber_target_g       numeric(6,1),
  add column if not exists burn_target_override numeric(6,1),
  -- "I want to be 70 kg by 30 November." start_kg is frozen when the plan is
  -- set so progress is measured from where you actually began, not from
  -- wherever today's weigh-in happens to sit.
  add column if not exists weight_goal_kg       numeric(5,1),
  add column if not exists weight_goal_date     date,
  add column if not exists weight_goal_start_kg numeric(5,1),
  add column if not exists weight_goal_set_on   date,
  -- The published copy of the derived targets: the only part of the body
  -- calculation a rival ever sees. Written by the app from deriveTargets()
  -- in src/lib/calc.ts, which stays the single source of truth for the
  -- formula — mirroring it in SQL would guarantee the two drift apart.
  add column if not exists target_kcal          integer,
  add column if not exists target_protein_g     integer,
  add column if not exists target_burn_kcal     integer;

-- ---------------------------------------------------------------------
-- player_cards : what a competitor is allowed to know about you.
--
-- A definer view (security_invoker = false, the default) so it reads
-- profiles as the view's owner and the WHERE clause is the whole gate.
-- can_see() is the same hub-and-spoke rule used everywhere else.
-- ---------------------------------------------------------------------
drop view if exists public.player_cards;

create view public.player_cards
with (security_invoker = false) as
select
  p.id,
  p.display_name,
  p.avatar_emoji,
  p.created_at,
  p.target_kcal,
  p.target_protein_g,
  p.target_burn_kcal
from public.profiles p
where public.can_see(p.id);

grant select on public.player_cards to authenticated;

-- The row-level twin of the above: a rival's profile row is no longer
-- readable at all, so `select * from profiles` returns only yourself no
-- matter who asks. Everything the app needs about someone else now comes
-- through player_cards.
drop policy if exists profiles_mates_read on public.profiles;

-- Weigh-in history is a body measurement, so it goes the same way.
drop policy if exists weigh_ins_mates_read on public.weigh_ins;

-- ---------------------------------------------------------------------
-- jnum : a number out of a jsonb object, or 0.
--
-- The food item arrays are written by this app and always hold numbers,
-- but one malformed row should degrade a comparison rather than 500 the
-- whole page, so the cast is guarded.
-- ---------------------------------------------------------------------
create or replace function public.jnum(obj jsonb, key text)
returns numeric
language sql
immutable
as $$
  select case
    when jsonb_typeof(obj -> key) = 'number' then (obj ->> key)::numeric
    when (obj ->> key) ~ '^-?[0-9]+(\.[0-9]+)?$' then (obj ->> key)::numeric
    else 0
  end;
$$;

grant execute on function public.jnum(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- Bootstrap the published targets for everyone who already exists.
--
-- One-time only, and deliberately the plain formula with no manual
-- overrides applied (nobody has set any yet). The app republishes these
-- from calc.ts whenever a profile is saved, a weigh-in lands, or a page
-- load notices they have drifted — so this is a starting point, not a
-- second implementation to keep in step.
-- ---------------------------------------------------------------------
with base as (
  select
    p.id,
    p.goal,
    p.weight_kg,
    (10 * p.weight_kg + 6.25 * p.height_cm
       - 5 * extract(year from age(p.birth_date))
       + case when p.sex = 'male' then 5 else -161 end) as bmr,
    case p.activity_level
      when 'sedentary' then 1.2  when 'light' then 1.375
      when 'active'    then 1.725 when 'very_active' then 1.9
      else 1.55 end as factor
  from public.profiles p
  where p.sex is not null and p.birth_date is not null
    and p.height_cm is not null and p.weight_kg is not null
    and p.target_kcal is null
)
update public.profiles p
   set target_kcal      = greatest(1200, round(b.bmr * b.factor
                            + case b.goal when 'cut' then -500 when 'bulk' then 300 else 0 end)),
       target_protein_g = round(b.weight_kg
                            * case b.goal when 'cut' then 2.0 when 'bulk' then 1.8 else 1.6 end),
       target_burn_kcal = greatest(200, round(b.bmr * b.factor * 0.15))
  from base b
 where p.id = b.id;

-- ---------------------------------------------------------------------
-- get_arena v8
--
-- Same one-round-trip contract as before, with two changes:
--   * rivals arrive as cards, so their body stats cannot leave the database
--   * food_days > 0 additionally returns per-item food rollups for everyone
--     visible, which is what the Versus protein breakdown reasons over.
--     Pages that do not need it pass 0 and carry none of the weight.
--
-- All three arguments are required. The older two-argument form is dropped
-- below rather than left as an overload: with a default on food_days,
-- PostgREST could not tell the two apart.
-- ---------------------------------------------------------------------
create or replace function public.get_arena(
  days integer,
  challenge_id uuid,
  food_days integer
)
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
  food_from  date;
  wanted     uuid;
begin
  if uid is null then
    return null;
  end if;

  select * into me_row from public.profiles where id = uid;
  if not found then
    return null;
  end if;

  today     := (now() at time zone coalesce(me_row.timezone, 'Asia/Kolkata'))::date;
  from_date := today - (greatest(coalesce(days, 30), 1) - 1);
  food_from := today - (greatest(coalesce(food_days, 0), 1) - 1);

  wanted := coalesce(challenge_id, me_row.active_challenge_id);

  if wanted is not null then
    select c.* into ch
    from public.challenge_members m
    join public.challenges c on c.id = m.challenge_id
    where m.user_id = uid and c.id = wanted;
  end if;

  if ch.id is null then
    select c.* into ch
    from public.challenge_members m
    join public.challenges c on c.id = m.challenge_id
    where m.user_id = uid
    order by m.joined_at desc
    limit 1;
  end if;

  -- RLS on challenge_members already narrows this to people I may see.
  if ch.id is not null then
    select array_agg(m.user_id) into member_ids
      from public.challenge_members m
     where m.challenge_id = ch.id;
  end if;

  if member_ids is null then
    member_ids := array[uid];
  end if;

  return jsonb_build_object(
    'today',     today,
    'from_date', from_date,
    -- My own row, in full. Nobody else's ever appears here.
    'me',        to_jsonb(me_row),
    'challenge', case when ch.id is null then null else to_jsonb(ch) end,
    'players',   coalesce(
                   (select jsonb_agg(to_jsonb(c) order by c.created_at)
                      from public.player_cards c
                     where c.id = any(member_ids)), '[]'::jsonb),
    'totals',    coalesce(
                   (select jsonb_agg(to_jsonb(t))
                      from public.daily_totals t
                     where t.user_id = any(member_ids)
                       and t.local_date between from_date and today), '[]'::jsonb),
    'goals',     coalesce(
                   (select jsonb_agg(to_jsonb(g))
                      from public.monthly_goals g
                     where g.user_id = any(member_ids)
                       and g.month = date_trunc('month', today)::date), '[]'::jsonb),
    'today_food', coalesce(
                   (select jsonb_agg(to_jsonb(f) order by f.logged_at)
                      from public.food_logs f
                     where f.user_id = uid and f.local_date = today), '[]'::jsonb),
    'today_workouts', coalesce(
                   (select jsonb_agg(to_jsonb(w) order by w.logged_at)
                      from public.workout_logs w
                     where w.user_id = uid and w.local_date = today), '[]'::jsonb),
    -- My own weigh-ins. Mine only, by policy as well as by this filter:
    -- a weigh-in is a body measurement, so v8 stopped challenge-mates being
    -- able to read them at all. Carried here so the three screens that want
    -- the current weight do not each make their own round trip for it.
    'my_weigh_ins', coalesce(
                   (select jsonb_agg(jsonb_build_object(
                             'local_date', w.local_date,
                             'weight_kg',  w.weight_kg) order by w.local_date desc)
                      from (select local_date, weight_kg
                              from public.weigh_ins
                             where user_id = uid
                             order by local_date desc
                             limit 60) w), '[]'::jsonb),
    'my_challenges', coalesce(
                   (select jsonb_agg(jsonb_build_object(
                              'id',           c.id,
                              'name',         c.name,
                              'invite_code',  c.invite_code,
                              'start_date',   c.start_date,
                              'end_date',     c.end_date,
                              'created_by',   c.created_by,
                              'is_mine',      c.created_by = uid,
                              'owner_name',   coalesce(op.display_name, 'Someone'),
                              'owner_emoji',  coalesce(op.avatar_emoji, '🔥'),
                              'member_count', (select count(*) from public.challenge_members mm
                                                where mm.challenge_id = c.id)
                            ) order by m2.joined_at desc)
                      from public.challenge_members m2
                      join public.challenges c on c.id = m2.challenge_id
                      left join public.player_cards op on op.id = c.created_by
                     where m2.user_id = uid), '[]'::jsonb),
    -- Per-person, per-day, per-food protein and calories. Rolled up here
    -- rather than shipped raw: one row per distinct food per day keeps the
    -- payload small enough that the comparison costs nothing extra.
    'food_items', case when coalesce(food_days, 0) <= 0 then '[]'::jsonb else coalesce(
                   (select jsonb_agg(jsonb_build_object(
                             'user_id',   x.user_id,
                             'date',      x.local_date,
                             'name',      x.name,
                             'protein_g', x.protein_g,
                             'kcal',      x.kcal))
                      from (
                        select f.user_id,
                               f.local_date,
                               min(btrim(it ->> 'name'))                     as name,
                               round(sum(public.jnum(it, 'protein_g')), 1)   as protein_g,
                               round(sum(public.jnum(it, 'kcal')))           as kcal
                          from public.food_logs f
                          cross join lateral jsonb_array_elements(f.items) as it
                         where f.user_id = any(member_ids)
                           and f.local_date between food_from and today
                           and btrim(coalesce(it ->> 'name', '')) <> ''
                         group by f.user_id, f.local_date, lower(btrim(it ->> 'name'))
                      ) x), '[]'::jsonb) end
  );
end;
$$;

grant execute on function public.get_arena(integer, uuid, integer) to authenticated;

-- Exactly one get_arena, so there is never any question which overload ran.
drop function if exists public.get_arena(integer, uuid);

-- =====================================================================
-- v9 — water.
--
-- One row per person per day rather than one per sip. Drinking is the
-- highest-frequency thing anyone logs here — a dozen taps a day each — and
-- the only question the app ever asks of it is "how much so far". An event
-- table would be a hundred rows a week to answer a question a single
-- integer answers.
--
-- The trade-off is that "when did I last drink" is not recoverable beyond
-- updated_at. That is worth it; if a timeline is ever wanted, this becomes
-- the daily rollup of one.
-- =====================================================================

create table if not exists public.water_logs (
  user_id    uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  ml         integer not null default 0 check (ml >= 0),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

alter table public.water_logs enable row level security;

drop policy if exists water_logs_own on public.water_logs;
create policy water_logs_own on public.water_logs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Visible to challenge-mates like food and training are: what you drink is
-- behaviour, not a body measurement, and the whole point of the challenge is
-- seeing what the other person actually did.
drop policy if exists water_logs_mates_read on public.water_logs;
create policy water_logs_mates_read on public.water_logs for select to authenticated
  using (public.can_see(user_id));

-- A manual daily target, for anyone who would rather set their own.
alter table public.profiles
  add column if not exists water_target_ml integer;

-- ---------------------------------------------------------------------
-- log_water(delta, date) -> the new total.
--
-- One round trip per tap, and atomic: two quick taps cannot read the same
-- total and both write it back. Returning the new figure means the button
-- does not need a follow-up read to know what to draw.
--
-- SECURITY INVOKER, so the own-row policy above is what authorises the
-- write; there is no path here to anyone else's row.
-- ---------------------------------------------------------------------
create or replace function public.log_water(delta_ml integer, on_date date default null)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  d     date;
  total integer;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  -- The caller passes the date it is already showing. The fallback is only
  -- for a client that has not got one to hand.
  d := coalesce(on_date, (now() at time zone coalesce(
         (select timezone from public.profiles where id = uid), 'Asia/Kolkata'))::date);

  insert into public.water_logs (user_id, local_date, ml, updated_at)
  values (uid, d, greatest(0, coalesce(delta_ml, 0)), now())
  on conflict (user_id, local_date) do update
    set ml = greatest(0, public.water_logs.ml + coalesce(delta_ml, 0)),
        updated_at = now()
  returning ml into total;

  return total;
end;
$$;

grant execute on function public.log_water(integer, date) to authenticated;

-- ---------------------------------------------------------------------
-- daily_totals, again — now carrying water.
--
-- Dropped and recreated rather than replaced, for the same reason as
-- before: CREATE OR REPLACE VIEW cannot add a column in the middle, and
-- this file has to stay re-runnable.
--
-- water_logs joins the `days` union so a day where someone only drank
-- still produces a row. It does NOT make the day count as logged for the
-- score or the streak — scoreDay() reads meals, sessions and rest days,
-- and hydration is tracked but deliberately unscored, like sleep.
-- ---------------------------------------------------------------------
drop view if exists public.daily_totals;

create view public.daily_totals
with (security_invoker = true) as
with days as (
  select user_id, local_date from public.food_logs
  union select user_id, local_date from public.workout_logs
  union select user_id, local_date from public.rest_days
  union select user_id, local_date from public.sleep_logs
  union select user_id, local_date from public.water_logs
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
  s.quality                     as sleep_quality,
  coalesce(h.ml, 0)             as water_ml
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
left join public.sleep_logs s on s.user_id = d.user_id and s.local_date = d.local_date
left join public.water_logs h on h.user_id = d.user_id and h.local_date = d.local_date;

-- =====================================================================
-- v10 — the last absolute target.
--
-- Active minutes were 60 for everybody. They are now derived from your own
-- burn target at a moderate intensity, so an active person chasing a 600
-- kcal day is asked for more of them than a sedentary one chasing 250.
--
-- It has to be published like the other three: a rival scores your day from
-- your card, and the minutes figure is computed from your bodyweight, which
-- is exactly what a card must never carry.
--
-- Worth knowing what this does NOT change much: minutes-to-target is close
-- to weight-independent, because a heavier body burns proportionally more
-- per minute. So it lands near an hour for most people — but it is now an
-- hour BECAUSE of their numbers rather than in spite of them, and it moves
-- properly when the burn target or activity level does.
-- =====================================================================

alter table public.profiles
  add column if not exists minutes_target_override integer,
  add column if not exists target_active_minutes   integer;

drop view if exists public.player_cards;

create view public.player_cards
with (security_invoker = false) as
select
  p.id,
  p.display_name,
  p.avatar_emoji,
  p.created_at,
  p.target_kcal,
  p.target_protein_g,
  p.target_burn_kcal,
  p.target_active_minutes
from public.profiles p
where public.can_see(p.id);

grant select on public.player_cards to authenticated;

-- Bootstrap, on the same terms as the v8 backfill: the plain derivation for
-- anyone who already has a burn target, republished from calc.ts on their
-- next page load.
update public.profiles
   set target_active_minutes = greatest(25, least(90,
         round(target_burn_kcal / ((5 * 3.5 * weight_kg) / 200))))
 where target_active_minutes is null
   and target_burn_kcal is not null
   and weight_kg is not null
   and weight_kg > 0;

-- ---------------------------------------------------------------------
-- v9 — the score grows three nutrition lines, so a card grows one column.
--
-- Fibre and the sugar / saturated-fat ceilings need nothing new: all three
-- are functions of the calorie target that is already published. Micro-
-- nutrient aims are not. They scale with sex and bodyweight, neither of
-- which leaves this database, so a rival could not otherwise be scored on
-- the line at all.
--
-- What is published is the aim AT REST. The sweat component is additive and
-- depends only on calories burned — a number the daily totals already carry
-- — so the aim for any particular day is reconstructed exactly at scoring
-- time. One column, no per-day rows, and the body stays where it was.
--
-- This is the same trade every other target already makes, and it is worth
-- restating plainly: publishing an aim narrows what the body behind it can
-- be. target_protein_g already did that far more sharply, being weight times
-- a factor of 1.6, 1.8 or 2.0. Nothing here is a new category of disclosure.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists target_micros jsonb;

drop view if exists public.player_cards;

create view public.player_cards
with (security_invoker = false) as
select
  p.id,
  p.display_name,
  p.avatar_emoji,
  p.created_at,
  p.target_kcal,
  p.target_protein_g,
  p.target_burn_kcal,
  p.target_active_minutes,
  p.target_micros
from public.profiles p
where public.can_see(p.id);

grant select on public.player_cards to authenticated;

-- No backfill. Unlike target_active_minutes there is no arithmetic here that
-- SQL can do as well as calc.ts, and a wrong aim scores worse than a missing
-- one: scoreTargetsFrom() falls back to aims scaled by the calorie target
-- alone until each person's next page load republishes the real figures.

-- ---------------------------------------------------------------------
-- get_day_detail — the evidence behind one day of one head-to-head.
--
-- Every scored line on the day-by-day list can now be opened to see what
-- actually produced it: which exercises made up the burn, which plates made
-- up the protein, the carbs, the fat and the fibre. The score already says
-- who won a line; this says what did it.
--
-- Deliberately NOT folded into get_arena. That payload is loaded on every
-- tab switch and is kept lean for exactly that reason, whereas this is one
-- day, opened on purpose, and carries per-item rows for two people. Paying
-- for it only when someone asks is the right trade; the drill-down page
-- makes this one extra call and nothing else does.
--
-- security invoker, so the _mates_read policies on food_logs and
-- workout_logs are what decide visibility — the same can_see() rule as
-- everywhere else. The explicit can_see check below is a fast exit, not the
-- gate: strip it out and RLS still returns nothing for a stranger.
-- ---------------------------------------------------------------------
create or replace function public.get_day_detail(other_id uuid, day date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  who uuid[];
begin
  if uid is null then
    return null;
  end if;
  if other_id is null or not public.can_see(other_id) then
    return null;
  end if;

  who := array[uid, other_id];

  return jsonb_build_object(
    'day', day,
    -- One row per distinct food per person: the same fold the protein
    -- comparison already does, but carrying every macro rather than
    -- protein alone, so carbs, fat and fibre get the same treatment.
    'foods', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'user_id',   x.user_id,
                'name',      x.name,
                'kcal',      x.kcal,
                'protein_g', x.protein_g,
                'carbs_g',   x.carbs_g,
                'fat_g',     x.fat_g,
                'fiber_g',   x.fiber_g))
         from (
           select f.user_id,
                  min(btrim(it ->> 'name'))                    as name,
                  round(sum(public.jnum(it, 'kcal')))          as kcal,
                  round(sum(public.jnum(it, 'protein_g')), 1)  as protein_g,
                  round(sum(public.jnum(it, 'carbs_g')), 1)    as carbs_g,
                  round(sum(public.jnum(it, 'fat_g')), 1)      as fat_g,
                  round(sum(public.jnum(it, 'fiber_g')), 1)    as fiber_g
             from public.food_logs f
             cross join lateral jsonb_array_elements(f.items) as it
            where f.user_id = any(who)
              and f.local_date = day
              and btrim(coalesce(it ->> 'name', '')) <> ''
            group by f.user_id, lower(btrim(it ->> 'name'))
         ) x), '[]'::jsonb),

    -- The same, for training. kcal here is computed in calc.ts from MET,
    -- minutes and bodyweight at log time and stored on the exercise, so
    -- summing it needs no body and leaks none.
    'workouts', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'user_id', y.user_id,
                'name',    y.name,
                'kind',    y.kind,
                'minutes', y.minutes,
                'kcal',    y.kcal))
         from (
           select w.user_id,
                  min(btrim(ex ->> 'name'))                as name,
                  min(coalesce(ex ->> 'kind', 'other'))    as kind,
                  round(sum(public.jnum(ex, 'minutes')), 1) as minutes,
                  round(sum(public.jnum(ex, 'kcal')))       as kcal
             from public.workout_logs w
             cross join lateral jsonb_array_elements(w.exercises) as ex
            where w.user_id = any(who)
              and w.local_date = day
              and btrim(coalesce(ex ->> 'name', '')) <> ''
            group by w.user_id, lower(btrim(ex ->> 'name'))
         ) y), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_day_detail(uuid, date) to authenticated;

-- =====================================================================
-- v11 — what you are aiming for is nobody else's business.
--
-- Two tables were still readable by the people you compete against, even
-- though no screen showed them any more:
--
--   * monthly_goals kept its mates-read policy, so a challenge-mate could
--     list your goals — "Reach 72 kg" included, which is a body measurement
--     under another name.
--   * daily_advice kept one too, and the coach writes from a briefing that
--     quotes your weight and your plan.
--
-- Both policies go.
--
-- Monthly goals have since been retired from the app. A goal only ever
-- overrode a protein or burn target, and the Goals tab now sets those
-- directly. The table is kept so nobody's rows are lost, but nothing reads
-- it, and get_arena below no longer returns it.
-- =====================================================================

drop policy if exists monthly_goals_mates_read on public.monthly_goals;
drop policy if exists daily_advice_mates_read on public.daily_advice;

-- ---------------------------------------------------------------------
-- players_in_challenges(on_date) — how many people are in a running
-- challenge anywhere in the app, for the count at the top of Versus.
--
-- security definer because it has to count past hub and spoke: under
-- members_read you only see people you share a challenge with, which would
-- make this "how many people can I see" — a number the switcher already
-- shows. It returns one integer and never a row, so nothing about who those
-- people are, or which challenge holds them, crosses the line.
--
-- Running means not yet ended on the caller's own today. A challenge that
-- finished in June is history, not participation.
--
-- Signed-in users only. Postgres lets PUBLIC execute a new function and
-- Supabase grants anon the same by default, so both are taken back.
-- ---------------------------------------------------------------------
create or replace function public.players_in_challenges(on_date date)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct m.user_id)::integer
    from challenge_members m
    join challenges c on c.id = m.challenge_id
   where c.end_date >= on_date;
$$;

revoke execute on function public.players_in_challenges(date) from public, anon;
grant execute on function public.players_in_challenges(date) to authenticated;

-- ---------------------------------------------------------------------
-- get_arena v11
--
-- Same three arguments as v8, so no caller changes and a build from before
-- this release keeps working against it. Two differences in what comes back:
--   * no goals. Monthly goals are retired (see the top of v11), and an older
--     build reads a missing goals list as an empty one.
--   * players_enrolled, the headcount above, resolved against my today.
-- ---------------------------------------------------------------------
create or replace function public.get_arena(
  days integer,
  challenge_id uuid,
  food_days integer
)
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
  food_from  date;
  wanted     uuid;
begin
  if uid is null then
    return null;
  end if;

  select * into me_row from public.profiles where id = uid;
  if not found then
    return null;
  end if;

  today     := (now() at time zone coalesce(me_row.timezone, 'Asia/Kolkata'))::date;
  from_date := today - (greatest(coalesce(days, 30), 1) - 1);
  food_from := today - (greatest(coalesce(food_days, 0), 1) - 1);

  wanted := coalesce(challenge_id, me_row.active_challenge_id);

  if wanted is not null then
    select c.* into ch
    from public.challenge_members m
    join public.challenges c on c.id = m.challenge_id
    where m.user_id = uid and c.id = wanted;
  end if;

  if ch.id is null then
    select c.* into ch
    from public.challenge_members m
    join public.challenges c on c.id = m.challenge_id
    where m.user_id = uid
    order by m.joined_at desc
    limit 1;
  end if;

  -- RLS on challenge_members already narrows this to people I may see.
  if ch.id is not null then
    select array_agg(m.user_id) into member_ids
      from public.challenge_members m
     where m.challenge_id = ch.id;
  end if;

  if member_ids is null then
    member_ids := array[uid];
  end if;

  return jsonb_build_object(
    'today',     today,
    'from_date', from_date,
    -- My own row, in full. Nobody else's ever appears here.
    'me',        to_jsonb(me_row),
    'challenge', case when ch.id is null then null else to_jsonb(ch) end,
    'players',   coalesce(
                   (select jsonb_agg(to_jsonb(c) order by c.created_at)
                      from public.player_cards c
                     where c.id = any(member_ids)), '[]'::jsonb),
    'totals',    coalesce(
                   (select jsonb_agg(to_jsonb(t))
                      from public.daily_totals t
                     where t.user_id = any(member_ids)
                       and t.local_date between from_date and today), '[]'::jsonb),
    'today_food', coalesce(
                   (select jsonb_agg(to_jsonb(f) order by f.logged_at)
                      from public.food_logs f
                     where f.user_id = uid and f.local_date = today), '[]'::jsonb),
    'today_workouts', coalesce(
                   (select jsonb_agg(to_jsonb(w) order by w.logged_at)
                      from public.workout_logs w
                     where w.user_id = uid and w.local_date = today), '[]'::jsonb),
    'my_weigh_ins', coalesce(
                   (select jsonb_agg(jsonb_build_object(
                             'local_date', w.local_date,
                             'weight_kg',  w.weight_kg) order by w.local_date desc)
                      from (select local_date, weight_kg
                              from public.weigh_ins
                             where user_id = uid
                             order by local_date desc
                             limit 60) w), '[]'::jsonb),
    'my_challenges', coalesce(
                   (select jsonb_agg(jsonb_build_object(
                              'id',           c.id,
                              'name',         c.name,
                              'invite_code',  c.invite_code,
                              'start_date',   c.start_date,
                              'end_date',     c.end_date,
                              'created_by',   c.created_by,
                              'is_mine',      c.created_by = uid,
                              'owner_name',   coalesce(op.display_name, 'Someone'),
                              'owner_emoji',  coalesce(op.avatar_emoji, '🔥'),
                              'member_count', (select count(*) from public.challenge_members mm
                                                where mm.challenge_id = c.id)
                            ) order by m2.joined_at desc)
                      from public.challenge_members m2
                      join public.challenges c on c.id = m2.challenge_id
                      left join public.player_cards op on op.id = c.created_by
                     where m2.user_id = uid), '[]'::jsonb),
    'food_items', case when coalesce(food_days, 0) <= 0 then '[]'::jsonb else coalesce(
                   (select jsonb_agg(jsonb_build_object(
                             'user_id',   x.user_id,
                             'date',      x.local_date,
                             'name',      x.name,
                             'protein_g', x.protein_g,
                             'kcal',      x.kcal))
                      from (
                        select f.user_id,
                               f.local_date,
                               min(btrim(it ->> 'name'))                     as name,
                               round(sum(public.jnum(it, 'protein_g')), 1)   as protein_g,
                               round(sum(public.jnum(it, 'kcal')))           as kcal
                          from public.food_logs f
                          cross join lateral jsonb_array_elements(f.items) as it
                         where f.user_id = any(member_ids)
                           and f.local_date between food_from and today
                           and btrim(coalesce(it ->> 'name', '')) <> ''
                         group by f.user_id, f.local_date, lower(btrim(it ->> 'name'))
                      ) x), '[]'::jsonb) end,
    -- Everyone in a running challenge anywhere, not just this one. A count,
    -- never a list — see players_in_challenges above.
    'players_enrolled', public.players_in_challenges(today)
  );
end;
$$;

grant execute on function public.get_arena(integer, uuid, integer) to authenticated;

-- =====================================================================
-- v12 — swap ideas are cached like parses.
--
-- The limits page asks Gemini for "instead of this, have that" ideas for
-- the foods that pushed a limit over. The same plate on another day, or on
-- someone else's plate, should not cost another request, so the answers go
-- in ai_cache under a new kind.
--
-- The cached text is food only — names, portions, and how much of a
-- nutrient each supplied — never the person's limits, which are derived
-- from their body. ai_cache is readable by every signed-in user, which is
-- exactly why that line matters. See swapBrief() in src/lib/overage.ts.
--
-- Until this runs the cache rejects kind 'swap'. The app still shows the
-- ideas; it just asks Gemini again each time.
-- =====================================================================

alter table public.ai_cache drop constraint if exists ai_cache_kind_check;
alter table public.ai_cache
  add constraint ai_cache_kind_check check (kind in ('food', 'workout', 'swap'));
