-- =====================================================================
-- Remove the test accounts created while building and debugging.
--
-- Everything I made signed up under @example.com, which is reserved by RFC
-- 2606 for documentation and cannot receive mail — so no real person could
-- ever have registered with one. Your own accounts are untouched.
--
-- Run the SELECT first and read it. Only then run the DELETE.
-- =====================================================================

-- ---- 1. PREVIEW: exactly what would go ----
select
  u.email,
  p.display_name,
  u.created_at::date          as signed_up,
  (select count(*) from public.food_logs    f where f.user_id = u.id) as food_logs,
  (select count(*) from public.workout_logs w where w.user_id = u.id) as workout_logs,
  (select count(*) from public.challenges   c where c.created_by = u.id) as challenges_owned
from auth.users u
left join public.profiles p on p.id = u.id
where u.email like '%@example.com'
order by u.created_at;

-- ---- 2. Sanity check: this must return 0 ----
select count(*) as real_accounts_that_would_be_hit
from auth.users
where email like '%@example.com'
  and email not like 'fitclash-%'
  and email not like 'flow-%'
  and email not like 'demo-%'
  and email not like 'v2-%'
  and email not like 'm2-%'
  and email not like 'micro-%'
  and email not like 'o2-%'
  and email not like 'f1-%'
  and email not like 'f2-%'
  and email not like 'own-%'
  and email not like 'frn-%'
  and email not like 'p1-%'
  and email not like 'p-%'
  and email not like 'gap-%';

-- ---- 3. DELETE. Cascades to profiles, logs, sleep, goals, advice,
--         challenges owned and memberships — every table's user_id has
--         ON DELETE CASCADE, so nothing is orphaned.
delete from auth.users where email like '%@example.com';

-- ---- 4. Confirm nothing test-shaped is left ----
select count(*) as remaining_test_users
from auth.users where email like '%@example.com';

select u.email, p.display_name
from auth.users u left join public.profiles p on p.id = u.id
order by u.created_at;

-- Note: public.ai_cache is deliberately NOT cleared. It holds parsed food
-- and workout results keyed by text, belongs to nobody, and every entry is
-- a real Gemini answer — including ones you would otherwise pay to compute
-- again. Clearing it would only cost you quota.
