# Betta & Chill

Sit on Chamundi Hills and watch Mysuru slow down.

Betta & Chill is a calm, illustrated view of Mysuru from the **Nandi viewpoint** on Chamundi Hill, or, for a change of scene, a quiet **Museum** room with a single painting by Raja Ravi Varma on the wall. Visitors can sit on one of **20 shared benches** (4 seats each) with other people, listen to Kannada, Hindi or English radio together, and send birds across the sky, play a sunset or sunrise, make a breeze shake the trees, or make it rain.

- The whole scene is drawn in code on a Canvas 2D: no images, no 3D engine, no video. The first load is about 16 KB gzipped of JS.
- Live Kannada radio streams (from [radio-browser.info](https://www.radio-browser.info)) play on every bench. Alone on a bench, you change its station freely. With others there, a change is a request: the first benchmate to tap **Yes** within 45 seconds switches it for everyone. If nobody approves, the station stays. **Solo** (next to Bench) takes you off the benches to listen alone, on a rock with an old cassette radio, changing stations freely; it's remembered for next time.
- Who sits where is shared through **Supabase Realtime** presence, on the free tier. There's no login, no database tables and no backend; a seat frees itself when its tab closes.
- Without Supabase keys, everything still works in solo mode: you can sit on any bench, but you'll only see yourself.

## Run it

```bash
npm install
npm run dev            # http://localhost:5173
```

**Keyboard shortcuts:**

| Key | Action |
|---|---|
| B | Birds |
| S | Sunset / sunrise |
| W | Breeze |
| R | Rain |
| V | Switch viewpoint |
| P | Radio on / off |
| N | Next station |

**URL params** (handy for demos):
- `?view=museum` opens in the Museum (the default is the Nandi viewpoint; the Nandi | Museum toggle at the top switches between the two). The summit view is archived: it's no longer in the switcher, but `?view=summit` still opens it.
- The film button (beside the heart, bottom right) opens **Movies roulette**: one random film at a time, from those rated 3.5★ or more from a Letterboxd export (`data/letterboxd-ratings.csv`), its poster and title linking to the film on Letterboxd. After a new export, replace that file and run `npm run movies` to rebuild `src/movies/movies.json` (posters come from Wikipedia, and from TMDB for films Wikipedia lacks when `TMDB_KEY` is set in `.env.local`; only new films are looked up).
- The Museum opens on *Woman Holding a Fruit*; tapping the left or right half of the painting hangs the previous or next one (each listener browses on their own). The paintings are public-domain works by Raja Ravi Varma, downscaled from Wikimedia Commons into `public/paintings/` and listed in `PAINTINGS` in `src/scene/museum.ts`. `?painting=<id>` (e.g. `?view=museum&painting=damayanti`) shows a particular one.
- `?time=day|golden|sunset|dusk|night` sets the starting light.
- `?fx=rain,birds` starts those effects immediately.
- `?monkey` sends a Chamundi monkey for the peanuts right away.

## Shared benches setup (free)

1. Create a free project at [supabase.com](https://supabase.com). Pick the **Mumbai (ap-south-1)** region so it's close to listeners.
2. Go to **Project Settings → API** and copy the **Project URL** and the **anon / publishable key**.
3. Create `.env.local`, following `.env.example`:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=...
   ```
4. In **SQL Editor**, run [`supabase/hearts.sql`](supabase/hearts.sql). It creates the one-row heart total and the `add_hearts` function, the only thing visitors can call.
5. Restart `npm run dev`.

Seats, bench stations and bench hearts use Realtime presence and broadcast on the public `bc:park` channel, so they need no tables. The anon key is meant to be public.

- A seat frees itself when its tab closes. If a phone locks or the app goes to the background, the seat is **held for 5 minutes**, shown dimmed to benchmates. Coming back within that time puts the person back in the same seat. Pressing **Leave** frees it straight away.
- Heart taps float up from the tapper's figure on their benchmates' screens. They're also added to one shared total, logged in the console as "hearts from everyone".

To test sharing, open the site in two browser profiles (or two devices) and sit on the same bench. The free tier allows about 200 people online at once, comfortably more than 20 full benches (80 people). The bench count is `BENCH_COUNT` in `src/park/benches.ts`.

## Open alerts (push to your phone)

Every time someone opens the site or the installed app, `api/visit.ts` sends a push to your phone through
[ntfy](https://ntfy.sh), for example "New listener · App · Mysuru, India · iPhone". Bots, link previews and non-production
deploys are skipped, and nothing is stored.

1. Install the **ntfy** app (iOS / Android, free, no account).
2. In the app, subscribe to a long, random topic name (it works like a password: anyone who knows it can read the alerts).
3. In **Vercel → Settings → Environment Variables**, add `NTFY_TOPIC` = that topic name for **Production**, then redeploy.

## Deploy on Vercel

1. Push this repo to GitHub and **Import** it in Vercel. It auto-detects Vite, and `vercel.json` sets the build command, the output folder and cache headers.
2. In **Project → Settings → Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Production and Preview. They're baked in at build time, so redeploy after adding them.
3. Deploy.

The free Hobby plan is enough. The site is fully static, with no serverless functions.

## How it's built

```
index.html                 the page
src/main.ts                render loop, UI, effects, radio and bench wiring
src/scene/build.ts         layout: hills, city rows, landmarks, forest, foreground per viewpoint
src/scene/landmarks.ts     Mysore Palace (with night bulbs), St. Philomena's, Lalitha Mahal,
                           lakes, Chamundeshwari gopuram, Nandi
src/scene/render.ts        per-frame compositing, trees, parallax, cross-fade
src/scene/palette.ts       colour keyframes day → golden → sunset → dusk → night (+ rain tint)
src/scene/sky.ts           sky gradient, sun, moon, stars, clouds
src/scene/bench.ts         the bench, listeners in headphones, the monkey
src/effects/manager.ts     effect timing, envelopes and cooldowns
src/effects/particles.ts   birds, leaves, rain
src/radio/                 Kannada stations and the always-on player
src/park/benches.ts        shared benches (BENCH_COUNT): seats, conflicts, bench stations
src/realtime.ts            lazy Supabase Realtime presence
```

The landmarks sit in their real left-to-right order as seen from the hill. The Palace is front and centre, St. Philomena's twin spires are far behind it, and Lalitha Mahal and Karanji Lake are toward the hill on the right. Kukkarahalli Lake is far to the left.

**Cooldowns:**

| Effect | Cooldown |
|---|---|
| Birds | 8 s |
| Breeze | 10 s |
| Rain | 20 s |
| Sunset / sunrise | until the current transition finishes (40 s) |
