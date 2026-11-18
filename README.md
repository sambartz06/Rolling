# Word

What's the word? (Formerly "Rolling". The repo and live link keep the old name for now.)

Post once a night where you're headed, and see where your friends are going.
Beta: Madison bars only.

## Run it

No install needed. Live site: https://sambartz06.github.io/Rolling/ (GitHub Pages, from `main`).
Or open `index.html` in a browser (Chrome or Safari).
On a computer the site fills the window (sidebar tabs, big map); under 900px wide it uses the phone layout, which is the look we keep for the iPhone app.

**Accounts:** sign up with your name, @handle, email and password. Posts, replies, friends,
favorites and notification settings are saved in Supabase (a hosted database), and only friends
you accept can see your posts. Setup steps: [`supabase/SETUP.md`](supabase/SETUP.md).

**Demo mode:** if `config.js` has no Supabase keys, the app runs on sample data saved in your
browser, with **Viewing as** on the Profile tab to switch between sample users and
**Settings > Reset demo data** to start over.

## What's here

| Tab | What it does |
| --- | --- |
| Feed | Your post for tonight (tap "Post where I'm headed" at the top: pick a bar, most popular first, then arrival time, an optional comment up to 100 words, and the excitement meter; posting again replaces it), friends' posts (bar, excitement, arrival time, comment), and who hasn't posted yet. Tap a post to open its replies page ("‹ Feed" to go back) and reply from the box at the bottom (up to 100 words) |
| Map | Bars where friends are going, with a count on each pin. Tap a pin to see who's going, when they'll get there, and the group's excitement. "Friends' spots" shows every bar your friends have been to before, pale red for places they rarely go up to deep red for their favorites (dots only grow a little). Bars your friends never go to aren't shown |
| Friends | One search across your friends, requests and everyone else (friends first). Send, accept or decline friend requests; star favorites; remove friends. Feed and map only show friends |
| Profile | Your name and @handle, nights out, bars and switches, your top 3 usual spots, and Edit profile. No profile pictures anywhere in the app |
| 🔔 / ⚙ | Notification inbox and Settings (top right). Choose what you hear about: favorites posting, any friend posting, a bar hitting N+ friends, a friend picking your bar, a friend switching bars, a friend maxing out excitement, friend requests, and a nightly reminder to post. Optional browser notifications while the site is open |

**Popularity:** every post by anyone counts toward a bar, and newer posts count more (a post loses half its weight every 3 weeks). The demo seeds 8 weeks of history so the ranking has something to work with.

A "night" runs 6 AM to 6 AM, so a 1 AM post still counts for tonight.

## Files

- `index.html`, `styles.css`, `app.js`: the app (plain HTML/CSS/JS, no build step)
- `backend.js`: reads and saves data in Supabase, and handles sign-in
- `config.js`: the Supabase project address and public key (empty = demo mode)
- `supabase/schema.sql`: database tables and security rules; `supabase/SETUP.md`: how to set it up; `supabase/bug_reports.sql`: the bug-report table (Settings > Report a bug; read them in Supabase > Table Editor > bug_reports)
- `bars.js`: 142 Madison bars, pubs, clubs and beer gardens from OpenStreetMap (see `scripts/fetch-bars.md`)
- `data.js`: sample users and posts for demo mode
- `vendor/`: Leaflet 1.9.4 (map library) and supabase-js 2.118.0 (MIT)

Notifications are worked out on your own device from what you can already see (friends' posts,
replies, requests) and your own settings, so nobody else learns your settings or favorites.
They show in the bell, and as browser notifications while the site is open. Push alerts to a
locked phone come with the iPhone app.

Map tiles: Esri World Light Gray (free, no key, attribution shown). Bar data © OpenStreetMap contributors (ODbL).
