# Betta & Chill

Sit on Chamundi Hills and watch Mysuru slow down.

Betta & Chill is a calm, illustrated view of Mysuru from one of two spots on the hill: the **Nandi viewpoint** or **the summit** by the Chamundeshwari temple tower. The site shows a QR code. Anyone can scan it to get a **phone remote** that sends birds across the sky, plays a sunset or sunrise, makes a breeze shake the trees, or makes it rain.

- The whole scene is drawn in code on a Canvas 2D: no images, no 3D engine, no video. The first load is about 16 KB gzipped of JS.
- The ambient sound (wind, rain, birds, crickets, a distant temple bell) is synthesized live with Web Audio. There are no audio files, and it's muted until you turn it on.
- The phone remote talks to the screen over **Supabase Realtime** broadcast, on the free tier. It uses no database tables and needs no backend. Each open screen gets its own private 6-character room.
- Without Supabase keys, everything still works locally through the **✨ Play** tray and the keyboard.

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
| M | Sound |
| Q | Show or hide the QR code |

**URL params** (handy for demos):
- `?view=summit` opens at the summit (the default is the Nandi viewpoint; switch any time from the bottom bar).
- `?time=day|golden|sunset|dusk|night` sets the starting light.
- `?fx=rain,birds` starts those effects immediately.

## Phone remote setup (free)

1. Create a free project at [supabase.com](https://supabase.com).
2. Go to **Project Settings → API** and copy the **Project URL** and the **anon / publishable key**.
3. Create `.env.local`, following `.env.example`:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=...
   ```
4. Restart `npm run dev`.

No tables, SQL or policies are needed. The anon key is meant to be public, and the site only uses public broadcast and presence channels.

**Testing with a real phone locally:** run `npm run dev -- --host`, then open the **Network** URL that Vite prints (not `localhost`) on your computer. That makes the QR code point at an address your phone can reach. Your phone needs to be on the same Wi-Fi.

## Deploy on Vercel

1. Push this repo to GitHub and **Import** it in Vercel. It auto-detects Vite, and `vercel.json` sets the build command, the output folder and cache headers.
2. In **Project → Settings → Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for Production and Preview.
3. Deploy. The QR code always points at whatever domain the page is served from, so preview URLs work too.

The free Hobby plan is enough. The site is fully static, with no serverless functions.

## How it's built

```
index.html / remote.html   two pages (big screen, phone remote)
src/main.ts                screen: render loop, UI, effects, remote link
src/scene/build.ts         layout: hills, city rows, landmarks, forest, foreground per viewpoint
src/scene/landmarks.ts     Mysore Palace (with night bulbs), St. Philomena's, Lalitha Mahal,
                           lakes, Chamundeshwari gopuram, Nandi
src/scene/render.ts        per-frame compositing, trees, parallax, cross-fade
src/scene/palette.ts       colour keyframes day → golden → sunset → dusk → night (+ rain tint)
src/scene/sky.ts           sky gradient, sun, moon, stars, clouds
src/effects/manager.ts     effect timing, envelopes and cooldowns
src/effects/particles.ts   birds, leaves, rain
src/audio.ts               synthesized ambience
src/realtime.ts            lazy Supabase Realtime room (broadcast + presence)
src/remote/                phone remote
```

The landmarks sit in their real left-to-right order as seen from the hill. The Palace is front and centre, St. Philomena's twin spires are far behind it, and Lalitha Mahal and Karanji Lake are toward the hill on the right. Kukkarahalli Lake is far to the left.

**Cooldowns:**

| Effect | Cooldown |
|---|---|
| Birds | 8 s |
| Breeze | 10 s |
| Rain | 20 s |
| Sunset / sunrise | until the current transition finishes (40 s) |

The screen enforces these, so a busy remote can't flood it.
