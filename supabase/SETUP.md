# Connecting Word to Supabase

Word saves accounts, posts, replies, friends and settings in [Supabase](https://supabase.com),
a hosted database with sign-in built in. The website still runs on GitHub Pages; it talks to
Supabase straight from the browser. The free plan is plenty for a friend group.

You only do this once.

## 1. Make the project

1. Go to supabase.com, click **Start your project**, sign in with GitHub.
2. **New project**: name it `word`, click **Generate a password** (keep it in your password
   manager; the app never needs it), pick a US region, **Create new project**.

## 2. Create the tables and security rules

1. In the left sidebar, open **SQL Editor**, then **New query**.
2. Open [`schema.sql`](schema.sql) in this folder, copy all of it, paste it in, click **Run**.
   You should see "Success. No rows returned". It's safe to run again later.

## 3. Sign-in settings

1. Left sidebar: **Authentication** > **Sign In / Providers** > **Email**. Make sure Email is on.
2. Turn **off** "Confirm email" and save. Supabase's free plan only sends a few emails an hour,
   so with it on, friends signing up at the same time would get stuck waiting for emails.
   (Password-reset emails still work.)
3. **Authentication** > **URL Configuration**: set **Site URL** to the live site
   (`https://sambartz06.github.io/Rolling/`, or the new address if the repo is renamed) and add
   the same address under **Redirect URLs**. This is where password-reset links send people.

## 4. Connect the app

1. Click **Connect** at the top of the project (or **Project Settings** > **API Keys**).
2. Copy the **Project URL** and the **publishable key** (starts with `sb_publishable_`; the older
   "anon public" key also works) into `config.js` in the repo.

These two values are meant to be public. Never put the **secret** / **service_role** key or the
database password in the code.

## What the security rules do

The rules live in the database, so they hold even if someone pokes at the website code:

- Signed-out visitors can't read anything.
- Signed-in people can see names and @handles (so friends can find each other).
- Posts: only you and your accepted friends.
- Replies: anyone who can see the post.
- Friend requests: only the two people involved. Friendships are only made by accepting a request.
- Favorites and notification settings: only you.
- Bar popularity uses totals per bar from everyone's posts, never who posted.
