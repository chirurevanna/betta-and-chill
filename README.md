# Betta & Chill

Sit on Chamundi Hills and watch Mysuru slow down.

Betta & Chill is a calm, illustrated view of Mysuru from one of two spots on the hill: the **Nandi viewpoint** or **the summit** by the Chamundeshwari temple tower. Visitors can sit on one of **20 shared benches** (4 seats each) with other people, listen to Kannada, Hindi or English radio together, and send birds across the sky, play a sunset or sunrise, make a breeze shake the trees, or make it rain.

- The whole scene is drawn in code on a Canvas 2D: no images, no 3D engine, no video. The first load is about 16 KB gzipped of JS.
- Live Kannada radio streams (from [radio-browser.info](https://www.radio-browser.info)) play on every bench. Anyone on a bench can change its station, and it changes for everyone sitting there.
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
- `?view=summit` opens at the summit (the default is the Nandi viewpoint; switch any time from the bottom bar).
- `?time=day|golden|sunset|dusk|night` sets the starting light.
- `?fx=rain,birds` starts those effects immediately.
- `?monkey` sends a Chamundi monkey for the peanuts right away.

## Shared benches setup (free)

1. Create a free project at [supabase.com](https://supabase.com).
2. Go to **Project Settings → API** and copy the **Project URL** and the **anon / publishable key**.
3. Create `.env.local`, following `.env.example`:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=...
   ```
4. Restart `npm run dev`.

No tables, SQL or policies are needed. The anon key is meant to be public, and the site only uses public broadcast and presence channels.

To test sharing, open the site in two tabs (or two devices) and sit on the same bench. The free tier allows about 200 people online at once, comfortably more than 20 full benches (80 people). The bench count is `BENCH_COUNT` in `src/park/benches.ts`.

## Deploy on Vercel

1. Push this repo to GitHub and **Import** it in Vercel. It auto-detects Vite, and `vercel.json` sets the build command, the output folder and cache headers.
2. In **Project → Settings → Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Production and Preview.
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
