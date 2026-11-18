-- Word: database tables and security rules for Supabase.
--
-- Run this once: Supabase dashboard > SQL Editor > New query > paste this
-- whole file > Run. It's safe to run again (it drops and recreates the
-- rules and functions, and only creates tables that don't exist yet).
--
-- Who can see what (enforced by the database, not just the app):
--   * Everyone signed in can see names and @handles (so you can find friends).
--   * Posts are visible to you and your accepted friends only.
--   * Replies are visible to anyone who can see the post they're on.
--   * Friend requests are visible to the two people involved.
--   * Favorites and notification settings are private to you.
--   * Nobody who isn't signed in can read anything.

-- ---------- tables ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  handle text not null unique check (handle ~ '^[a-z0-9_.]{2,20}$'),
  created_at timestamptz not null default now()
);

-- Stored once per pair, smallest id first.
create table if not exists public.friendships (
  a uuid not null references public.profiles (id) on delete cascade,
  b uuid not null references public.profiles (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);

create table if not exists public.friend_requests (
  from_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  to_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_id, to_id),
  check (from_id <> to_id)
);

-- One post per person per night. Changing tonight's post updates this row and
-- moves the old pick into history (shown crossed out in the feed).
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  night date not null,
  bar_id text not null check (char_length(bar_id) between 1 and 40),
  arrive text not null check (arrive ~ '^[0-2][0-9]:[0-5][0-9]$'),
  excitement int not null check (excitement between 0 and 100),
  comment text not null default '' check (char_length(comment) <= 1000),
  history jsonb not null default '[]' check (jsonb_typeof(history) = 'array' and jsonb_array_length(history) <= 50),
  posted_at timestamptz not null default now(),
  unique (user_id, night)
);
create index if not exists posts_posted_at on public.posts (posted_at);

create table if not exists public.replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists replies_post on public.replies (post_id);

create table if not exists public.favorites (
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  friend uuid not null references public.profiles (id) on delete cascade,
  primary key (owner, friend)
);

create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  prefs jsonb not null default '{}' check (jsonb_typeof(prefs) = 'object'),
  updated_at timestamptz not null default now()
);

-- ---------- helper functions ----------

-- True if the signed-in user and `other` are friends.
create or replace function public.is_friend(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships
    where a = least(auth.uid(), other) and b = greatest(auth.uid(), other)
  );
$$;

-- True if the signed-in user can see this post (it's theirs or a friend's).
create or replace function public.can_see_post(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.posts p
    where p.id = pid and (p.user_id = auth.uid() or public.is_friend(p.user_id))
  );
$$;

-- New account: make a profile from the name and handle given at sign-up.
-- If the handle is taken (or missing), add a number so sign-up never fails.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n text := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)), 30);
  base text := left(lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'handle', split_part(new.email, '@', 1)), '[^a-zA-Z0-9_.]', '', 'g')), 16);
  h text;
  i int := 0;
begin
  if char_length(base) < 2 then base := 'friend' || base; end if;
  h := base;
  while exists (select 1 from public.profiles where handle = h) loop
    i := i + 1;
    h := base || i;
  end loop;
  insert into public.profiles (id, name, handle) values (new.id, n, h);
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lets the sign-up form say "that handle is taken" before you submit.
create or replace function public.handle_available(h text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where handle = lower(h));
$$;

-- Accept a friend request: removes the request(s) and makes you friends.
create or replace function public.accept_friend_request(requester uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.friend_requests where from_id = requester and to_id = auth.uid();
  if not found then raise exception 'no such friend request'; end if;
  delete from public.friend_requests where from_id = auth.uid() and to_id = requester;
  insert into public.friendships (a, b, requested_by)
    values (least(auth.uid(), requester), greatest(auth.uid(), requester), requester)
    on conflict do nothing;
end;
$$;

-- Bar popularity for the bar picker: every post by anyone counts, newer posts
-- count more (half weight every 3 weeks). Only totals per bar, never who.
create or replace function public.bar_popularity()
returns table (bar_id text, score float8, month_count int)
language sql stable security definer set search_path = public as $$
  select p.bar_id,
         sum(power(0.5, extract(epoch from (now() - p.posted_at)) / 86400 / 21))::float8,
         (count(*) filter (where p.posted_at > now() - interval '30 days'))::int
  from public.posts p
  where p.posted_at > now() - interval '365 days'
  group by p.bar_id;
$$;

-- Removing a friend also removes each of you from the other's favorites.
create or replace function public.cleanup_unfriend()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.favorites
   where (owner = old.a and friend = old.b) or (owner = old.b and friend = old.a);
  return old;
end;
$$;
drop trigger if exists on_unfriend on public.friendships;
create trigger on_unfriend after delete on public.friendships
  for each row execute function public.cleanup_unfriend();

-- ---------- row-level security ----------

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.friend_requests enable row level security;
alter table public.posts enable row level security;
alter table public.replies enable row level security;
alter table public.favorites enable row level security;
alter table public.user_settings enable row level security;

-- profiles
drop policy if exists "profiles: signed-in users can read" on public.profiles;
create policy "profiles: signed-in users can read" on public.profiles
  for select to authenticated using (true);
drop policy if exists "profiles: edit your own" on public.profiles;
create policy "profiles: edit your own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- friendships (created only by accept_friend_request)
drop policy if exists "friendships: see your own" on public.friendships;
create policy "friendships: see your own" on public.friendships
  for select to authenticated using (auth.uid() in (a, b));
drop policy if exists "friendships: remove your own" on public.friendships;
create policy "friendships: remove your own" on public.friendships
  for delete to authenticated using (auth.uid() in (a, b));

-- friend requests
drop policy if exists "requests: see ones you sent or got" on public.friend_requests;
create policy "requests: see ones you sent or got" on public.friend_requests
  for select to authenticated using (auth.uid() in (from_id, to_id));
drop policy if exists "requests: send as yourself" on public.friend_requests;
create policy "requests: send as yourself" on public.friend_requests
  for insert to authenticated with check (from_id = auth.uid() and not public.is_friend(to_id));
drop policy if exists "requests: cancel or decline" on public.friend_requests;
create policy "requests: cancel or decline" on public.friend_requests
  for delete to authenticated using (auth.uid() in (from_id, to_id));

-- posts
drop policy if exists "posts: you and your friends can read" on public.posts;
create policy "posts: you and your friends can read" on public.posts
  for select to authenticated using (user_id = auth.uid() or public.is_friend(user_id));
drop policy if exists "posts: write your own" on public.posts;
create policy "posts: write your own" on public.posts
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "posts: edit your own" on public.posts;
create policy "posts: edit your own" on public.posts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "posts: delete your own" on public.posts;
create policy "posts: delete your own" on public.posts
  for delete to authenticated using (user_id = auth.uid());

-- replies
drop policy if exists "replies: read if you can see the post" on public.replies;
create policy "replies: read if you can see the post" on public.replies
  for select to authenticated using (public.can_see_post(post_id));
drop policy if exists "replies: reply if you can see the post" on public.replies;
create policy "replies: reply if you can see the post" on public.replies
  for insert to authenticated with check (user_id = auth.uid() and public.can_see_post(post_id));
drop policy if exists "replies: delete your own" on public.replies;
create policy "replies: delete your own" on public.replies
  for delete to authenticated using (user_id = auth.uid());

-- favorites (private)
drop policy if exists "favorites: only yours" on public.favorites;
create policy "favorites: only yours" on public.favorites
  for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

-- settings (private)
drop policy if exists "settings: only yours" on public.user_settings;
create policy "settings: only yours" on public.user_settings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- access for the website ----------
-- Signed-out visitors get nothing; signed-in users go through the rules above.

revoke all on public.profiles, public.friendships, public.friend_requests, public.posts,
  public.replies, public.favorites, public.user_settings from anon;
grant select, update (name, handle) on public.profiles to authenticated;
grant select, delete on public.friendships to authenticated;
grant select, insert, delete on public.friend_requests to authenticated;
grant select, insert, update, delete on public.posts to authenticated;
grant select, insert, delete on public.replies to authenticated;
grant select, insert, delete on public.favorites to authenticated;
grant select, insert, update on public.user_settings to authenticated;

revoke execute on function public.is_friend(uuid), public.can_see_post(uuid),
  public.accept_friend_request(uuid), public.bar_popularity(),
  public.handle_new_user(), public.cleanup_unfriend() from public, anon;
grant execute on function public.is_friend(uuid), public.can_see_post(uuid),
  public.accept_friend_request(uuid), public.bar_popularity() to authenticated;
grant execute on function public.handle_available(text) to anon, authenticated;

-- ---------- bug reports (same as bug_reports.sql) ----------
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
