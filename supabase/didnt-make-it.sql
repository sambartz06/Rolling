-- "Didn't make it out" (Nov 18, 2026). Run once in Supabase: SQL Editor > New query > paste > Run.
-- Safe to run more than once.

-- A post can be marked "didn't make it out", with a short note (100 words, checked in the app).
alter table public.posts add column if not exists bail jsonb
  check (bail is null or (jsonb_typeof(bail) = 'object' and char_length(coalesce(bail->>'comment', '')) <= 1000));

-- Nights people didn't make it out don't count toward a bar's popularity.
create or replace function public.bar_popularity()
returns table (bar_id text, score float8, month_count int)
language sql stable security definer set search_path = public as $$
  select p.bar_id,
         sum(power(0.5, extract(epoch from (now() - p.posted_at)) / 86400 / 21))::float8,
         (count(*) filter (where p.posted_at > now() - interval '30 days'))::int
  from public.posts p
  where p.posted_at > now() - interval '365 days' and p.bail is null
  group by p.bar_id;
$$;
