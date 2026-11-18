-- Word: "Report a bug" (added 2026-11-18). Run once in Supabase:
-- SQL Editor > New query > paste this whole file > Run. Safe to run again.
--
-- Signed-in people can send reports. Nobody can read them through the app;
-- Sam reads them in the dashboard: Table Editor > bug_reports.

create table if not exists public.bug_reports (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid() references public.profiles (id) on delete set null,
  what text not null check (char_length(what) between 1 and 2000),
  steps text not null default '' check (char_length(steps) <= 2000),
  screen text not null default '' check (char_length(screen) <= 40),
  device text not null default '' check (char_length(device) <= 500),
  page text not null default '' check (char_length(page) <= 300),
  created_at timestamptz not null default now()
);

alter table public.bug_reports enable row level security;
drop policy if exists "bug reports: send as yourself" on public.bug_reports;
create policy "bug reports: send as yourself" on public.bug_reports
  for insert to authenticated with check (user_id = auth.uid());

revoke all on public.bug_reports from anon, authenticated;
grant insert (what, steps, screen, device, page) on public.bug_reports to authenticated;

-- Handy view for reading reports with the sender's name and handle
-- (only visible in the dashboard, not through the app).
create or replace view public.bug_reports_readable with (security_invoker = true) as
  select b.created_at, p.name, p.handle, b.screen, b.what, b.steps, b.device, b.page, b.id
  from public.bug_reports b left join public.profiles p on p.id = b.user_id
  order by b.created_at desc;
revoke all on public.bug_reports_readable from anon, authenticated;
