# Rolling

Post once a night where you're rolling, and see where your friends are going.
Beta: Madison bars only.

## Run it

No install needed. Open `index.html` in a browser (Chrome or Safari).
For the phone-sized view on a laptop, open dev tools and turn on device mode, or just narrow the window.

Everything is saved in your browser (localStorage). There's no sign-in yet, so use
**Viewing as** at the top to switch between mock users. **Friends > Reset demo data** restores the seed.

## What's here

| Tab | What it does |
| --- | --- |
| Feed | Your post for tonight, friends' posts (bar, ratings, comment), and who hasn't posted yet |
| Map | Bars where friends are going, with a count on each pin. Tap a pin to see who's going and tonight's average rating. "All bars" shows every bar |
| ＋ | Pick a bar (search, friends' bars first), rate Vibe / Crowd / Drinks / Music 1–5, optional 140-char comment. One post per night; posting again replaces it |
| Friends | Add / remove friends. Feed and map only show friends |

A "night" runs 6 AM to 6 AM, so a 1 AM post still counts for tonight.

## Files

- `index.html`, `styles.css`, `app.js`: the app (plain HTML/CSS/JS, no build step)
- `bars.js`: 142 Madison bars, pubs, clubs and beer gardens from OpenStreetMap (see `scripts/fetch-bars.md`)
- `data.js`: mock users, friendships and tonight's posts
- `vendor/`: Leaflet 1.9.4 (map library)

Map tiles: Esri World Dark Gray (free, no key, attribution shown). Bar data © OpenStreetMap contributors (ODbL).
