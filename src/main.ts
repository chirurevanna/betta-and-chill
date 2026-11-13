import './styles.css';
import { inject } from '@vercel/analytics';
import { Effects } from './effects/manager';
import { isEffect, type EffectType } from './protocol';
import { BENCH_COUNT, BenchPark, SEATS } from './park/benches';
import { Radio, type PlayResult } from './radio/player';
import { LANGS, STATIONS, type Lang } from './radio/stations';
import { addHearts, realtimeConfigured } from './realtime';
import { knNumber, randomKagga } from './kagga/kagga';
import { Renderer } from './scene/render';
import type { ViewId } from './scene/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Vercel Web Analytics (page views; it only reports on Vercel, never in local dev)
inject();

const VIEW_NAMES: Record<ViewId, string> = { nandi: 'Nandi', summit: 'Summit' };

/* ---------- boot ---------- */
const params = new URLSearchParams(location.search);
const paramView = params.get('view');
const initialView: ViewId = paramView === 'summit' ? 'summit' : 'nandi';
const TIMES: Record<string, number> = { day: 0, golden: 0.42, sunset: 0.56, dusk: 0.72, evening: 0.8, night: 1 };
// default mood: a quiet evening on the hill (dusk sky, city lights coming on)
const fx = new Effects(TIMES[params.get('time') ?? 'evening'] ?? TIMES.evening);
const renderer = new Renderer($<HTMLCanvasElement>('scene'), initialView);
const radio = new Radio();
const park = new BenchPark();
const clock = () => performance.now() / 1000;

fx.onBirds = () => {
  renderer.spawnBirds();
};

/* ---------- loop ---------- */
let last = clock();
let running = true;
function frame() {
  if (!running) return;
  const now = clock();
  const dt = Math.min(0.1, now - last);
  last = now;
  fx.update(now);
  renderer.render(now, dt, fx);
  renderer.bench.listening = radio.on;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  running = !document.hidden;
  if (running) {
    last = clock();
    requestAnimationFrame(frame);
  }
});

let resizeTimer = 0;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => renderer.resize(), 120);
});

/* ---------- radio: the always-visible player bar ---------- */
const player = $('player');
const plPlay = $<HTMLButtonElement>('pl-play');
const plPrev = $<HTMLButtonElement>('pl-prev');
const plNext = $<HTMLButtonElement>('pl-next');
const langBtns = [...player.querySelectorAll<HTMLButtonElement>('.lang-btn')];

function renderPlayer() {
  const on = radio.on;
  player.classList.toggle('on', on);
  // bars only bounce while sound is really coming out; connecting/buffering shows a soft pulse
  player.classList.toggle('live', radio.live);
  player.classList.toggle('loading', on && !radio.live);
  // the browser blocks sound until a first tap: let the Play button glow until then
  player.classList.toggle('blocked', radio.blocked && !on);
  plPlay.setAttribute('aria-pressed', String(on));
  plPlay.setAttribute('aria-label', on ? 'Pause radio (P)' : 'Play radio (P)');
  const single = radio.countLang(radio.lang) < 2;
  plPrev.disabled = plNext.disabled = single;
  for (const b of langBtns) {
    const l = LANGS.find((x) => x.id === b.dataset.lang)!;
    const ready = radio.hasLang(l.id);
    b.disabled = !ready;
    b.title = ready ? `${l.name} radio` : `${l.name} stations coming soon`;
    b.setAttribute('aria-pressed', String(radio.lang === l.id));
  }
}

plPlay.addEventListener('click', () => void radioCommand({ action: 'toggle' }));
plPrev.addEventListener('click', () => void radioCommand({ action: 'prev' }));
plNext.addEventListener('click', () => void radioCommand({ action: 'next' }));
for (const b of langBtns) b.addEventListener('click', () => void radioCommand({ action: 'lang', lang: b.dataset.lang as Lang }));

radio.onChange = renderPlayer;

/* ---------- hearts: tap to send a few floating up, like a live stream ---------- */
const heartBtn = $<HTMLButtonElement>('heart');
const heartLayer = $('hearts');
const HEART_SVG = heartBtn.innerHTML;
const HEART_COLORS = ['#ff5a7a', '#ff8fab', '#f5b971', '#b8a9ff', '#ff6b6b'];
let heartsThisVisit = 0;

/** One heart floating up from (x, y) — by default from the heart button. */
function floatHeart(delay: number, from?: { x: number; y: number }) {
  if (heartLayer.childElementCount > 60) return; // keep frantic tapping cheap
  const size = 22 + Math.random() * 14;
  let x: number;
  let y: number;
  if (from) {
    x = from.x;
    y = from.y;
  } else {
    const r = heartBtn.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top;
  }
  const h = document.createElement('span');
  h.className = 'float-heart';
  h.innerHTML = HEART_SVG;
  h.style.cssText = [
    `left:${x - size / 2 + (Math.random() - 0.5) * 10}px`,
    `top:${y - size * 0.4}px`,
    `width:${size}px`,
    `height:${size}px`,
    `color:${HEART_COLORS[(Math.random() * HEART_COLORS.length) | 0]}`,
    `--rise:${-(220 + Math.random() * 180)}px`,
    `--sway:${(Math.random() - 0.5) * 90}px`,
    `--tilt:${(Math.random() - 0.5) * 40}deg`,
    `animation-duration:${2.4 + Math.random() * 1.2}s`,
    `animation-delay:${delay}ms`,
  ].join(';');
  h.addEventListener('animationend', () => h.remove());
  setTimeout(() => h.remove(), 4500 + delay); // fallback when animations are off (reduced motion)
  heartLayer.append(h);
}

// taps are batched: to the bench every ~300 ms, to the all-visitor total every ~2 s
let benchPending = 0;
let benchTimer = 0;
let totalPending = 0;
let totalTimer = 0;
let everyone: number | null = null;

function flushTotal() {
  totalTimer = 0;
  const n = Math.min(totalPending, 50);
  totalPending -= n;
  void addHearts(n).then((t) => {
    if (t === null) return;
    everyone = t;
    console.log(`♥ hearts from everyone so far: ${t.toLocaleString()}`);
  });
  if (totalPending > 0) totalTimer = window.setTimeout(flushTotal, 2000);
}

heartBtn.addEventListener('click', () => {
  heartsThisVisit++;
  let device = heartsThisVisit;
  try {
    device = Number(localStorage.getItem('bc.hearts') ?? 0) + 1;
    localStorage.setItem('bc.hearts', String(device));
  } catch {
    /* storage blocked: the visit count is still right */
  }
  const all = everyone === null ? '' : ` · ${(everyone + totalPending + 1).toLocaleString()} from everyone`;
  console.log(`♥ heart pressed: ${heartsThisVisit} this visit · ${device} on this device${all}`);

  const n = 2 + ((Math.random() * 2) | 0);
  for (let i = 0; i < n; i++) floatHeart(i * 110);
  heartBtn.classList.remove('pop');
  void heartBtn.offsetWidth; // restart the little pop
  heartBtn.classList.add('pop');

  // benchmates see hearts rise from my figure
  benchPending++;
  benchTimer ||= window.setTimeout(() => {
    park.sendHeart(benchPending);
    benchPending = 0;
    benchTimer = 0;
  }, 300);
  // and every tap counts towards the shared total
  totalPending++;
  if (realtimeConfigured) totalTimer ||= window.setTimeout(flushTotal, 2000);
});

// a benchmate tapped their heart: hearts float up from their head on my screen
park.onHeart = ({ seat, n }) => {
  const at = renderer.bench.seatPoint(seat);
  for (let i = 0; i < Math.min(n * 2, 8); i++) floatHeart(i * 120, at);
};
renderPlayer();

function reportRadio(r: PlayResult) {
  // a blocked autoplay shows as a gently pulsing Play button (see renderPlayer), not a message
  if (r !== 'blocked' && radio.unavailable) toast('No station is reachable right now');
}

interface RadioCmd {
  action: 'toggle' | 'next' | 'prev' | 'select' | 'lang';
  station?: string;
  lang?: Lang;
}

async function radioCommand(cmd: RadioCmd) {
  let r: PlayResult = 'ok';
  const pick =
    cmd.action === 'select'
      ? cmd.station
      : cmd.action === 'next'
        ? radio.stationIdAt(1)
        : cmd.action === 'prev'
          ? radio.stationIdAt(-1)
          : cmd.action === 'lang' && cmd.lang
            ? cmd.lang === radio.lang && radio.on
              ? undefined // already listening in this language
              : (radio.firstIdOf(cmd.lang) ?? undefined)
            : undefined;
  if (pick && park.mine !== null) {
    // seated: the pick changes the station for everyone on this bench
    park.setStation(pick);
    r = await radio.select(pick);
  } else if (cmd.action === 'toggle') r = await radio.toggle();
  else if (pick && (cmd.action === 'select' || cmd.action === 'lang')) r = await radio.select(pick);
  else if (cmd.action === 'next') r = await radio.next();
  else if (cmd.action === 'prev') r = await radio.prev();
  reportRadio(r);
}


// The radio is on by default. Browsers block sound until the first tap / key press,
// so if autoplay was refused, that first interaction starts it.
function unblockRadio() {
  if (radio.blocked && !radio.on && radio.preferredOn) void radio.play().then(reportRadio);
}
addEventListener(
  'pointerdown',
  (e) => {
    if (e.target instanceof Node && player.contains(e.target)) return; // its buttons handle it
    unblockRadio();
  },
  { capture: true },
);
addEventListener(
  'keydown',
  (e) => {
    if (e.key.toLowerCase() === 'p') return; // the P shortcut toggles it itself
    unblockRadio();
  },
  { capture: true },
);

void radio.checkDirectory().then(() => {
  // no landing screen any more, so on a fresh visit this usually needs one tap: say so
  if (radio.preferredOn) void radio.play().then(reportRadio);
  else console.info('%c📻 radio is off (turned off earlier) — press P or the Radio button to turn it on', 'color:#e9a23b;font-weight:bold');
});

function fire(type: EffectType) {
  fx.trigger(type, clock());
}

/* ---------- UI ---------- */
const btnView = $<HTMLButtonElement>('btn-view');

/** Opens straight into a view (Nandi unless ?view=summit); the bottom bar switches later. */
function enterView(view: ViewId) {
  renderer.setView(view);
  updateViewButton();
}

function updateViewButton() {
  const other: ViewId = renderer.currentView === 'nandi' ? 'summit' : 'nandi';
  btnView.textContent = VIEW_NAMES[other];
}

// on-screen effect tray
const tray = $('tray');
const btnPlay = $<HTMLButtonElement>('btn-play');
const trayButtons = [...tray.querySelectorAll<HTMLButtonElement>('[data-fx]')];
btnPlay.addEventListener('click', () => {
  tray.hidden = !tray.hidden;
  btnPlay.setAttribute('aria-expanded', String(!tray.hidden));
  refreshTray();
});
trayButtons.forEach((b) => b.addEventListener('click', () => isEffect(b.dataset.fx) && fire(b.dataset.fx)));
function refreshTray() {
  if (tray.hidden) return;
  const now = clock();
  for (const b of trayButtons) {
    const e = b.dataset.fx as EffectType;
    b.disabled = fx.cooldownMs(e, now) > 0;
    if (e === 'sun') b.textContent = fx.isNight ? 'Sunrise' : 'Sunset';
  }
}
setInterval(refreshTray, 300);

btnView.addEventListener('click', () => {
  renderer.setView(renderer.currentView === 'nandi' ? 'summit' : 'nandi');
  updateViewButton();
});



let toastTimer = 0;
function toast(text: string, ms = 3200) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const map: Record<string, EffectType> = { b: 'birds', s: 'sun', w: 'breeze', r: 'rain' };
  const k = e.key.toLowerCase();
  if (map[k]) fire(map[k]);
  else if (k === 'v') btnView.click();
  else if (k === 'p') void radioCommand({ action: 'toggle' });
  else if (k === 'n') void radioCommand({ action: 'next' });
});

enterView(initialView);
// ?fx=rain,birds — start with effects running (handy for demos and screenshots)
for (const e of (params.get('fx') ?? '').split(',')) if (isEffect(e)) fire(e);

/* ---------- benches ---------- */
const btnBench = $<HTMLButtonElement>('btn-bench');
const benchPanel = $('bench-panel');
const benchList = $('bench-list');
const benchSummary = $('bench-summary');
const benchFree = $<HTMLInputElement>('bench-free');
const stationName = (id: string) => STATIONS.find((s) => s.id === id)?.name ?? id;
const PAGE_SIZE = 10;
const pageCount = Math.ceil(BENCH_COUNT / PAGE_SIZE);
const benchPages = $('bench-pages');
let benchPage = 0;

function renderBenchButton() {
  const b = park.mine;
  btnBench.textContent = 'Bench';
  btnBench.setAttribute('aria-pressed', String(b !== null));
}

function renderBenchPanel() {
  if (benchPanel.hidden) return;
  const n = park.sittingCount;
  benchSummary.textContent = park.shared
    ? `${n} ${n === 1 ? 'person' : 'people'} sitting · ${BENCH_COUNT} benches`
    : `${BENCH_COUNT} benches · just you for now`;
  // page pills: 1, 2, … (10 benches each)
  benchPages.replaceChildren(
    ...Array.from({ length: pageCount }, (_, p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pill page-pill';
      b.textContent = String(p + 1);
      b.setAttribute('aria-label', `Benches ${p * PAGE_SIZE + 1} to ${Math.min(BENCH_COUNT, (p + 1) * PAGE_SIZE)}`);
      b.setAttribute('aria-pressed', String(p === benchPage));
      b.addEventListener('click', () => {
        benchPage = p;
        renderBenchPanel();
      });
      return b;
    }),
  );
  const rows: HTMLElement[] = [];
  for (const b of park.list().slice(benchPage * PAGE_SIZE, (benchPage + 1) * PAGE_SIZE)) {
    const mine = b.id === park.mine;
    const full = b.count >= SEATS;
    if (benchFree.checked && full && !mine) continue;
    const li = document.createElement('li');
    li.className = `bench-row${mine ? ' mine' : ''}${full ? ' full' : ''}`;
    const name = document.createElement('span');
    name.className = 'bench-name';
    name.textContent = `Bench ${b.id + 1}`;
    const dots = document.createElement('span');
    dots.className = 'bench-dots';
    dots.setAttribute('aria-label', `${b.count} of ${SEATS} seats taken`);
    dots.textContent = b.seats.map((s) => (s ? '●' : '○')).join('');
    const st = document.createElement('span');
    st.className = 'bench-station';
    st.textContent = stationName(b.station);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill bench-act';
    if (mine) {
      btn.textContent = 'Leave';
      btn.addEventListener('click', () => park.leave());
    } else {
      btn.textContent = full ? 'Full' : 'Sit';
      btn.disabled = full;
      btn.addEventListener('click', () => sitOn(b.id));
    }
    li.append(name, dots, st, btn);
    rows.push(li);
  }
  benchList.replaceChildren(...rows);
}

function showBenchPanel(open: boolean) {
  if (open === !benchPanel.hidden) return;
  benchPanel.hidden = !open;
  btnBench.setAttribute('aria-expanded', String(open));
  if (open) {
    // open on the page that has my bench
    if (park.mine !== null) benchPage = Math.floor(park.mine / PAGE_SIZE);
    renderBenchPanel();
  }
}

function sitOn(bench: number) {
  if (park.sit(bench)) afterSitting();
  else renderBenchPanel(); // it filled up meanwhile: the list shows it as Full
}

/** They picked a bench from the list (a tap, so the bench's music can start right away). Quietly. */
function afterSitting() {
  const b = park.myBench;
  if (!b) return;
  showBenchPanel(false);
  if (!radio.on) void radio.select(b.station).then(reportRadio);
}

park.onChange = () => {
  renderer.bench.setSeats(park.myBench?.seats ?? [null, null, null, null], clock());
  renderBenchButton();
  renderBenchPanel();
};
park.onStation = (id) => void radio.tune(id);
park.onBumped = () => showBenchPanel(true); // lost a seat race on a full bench: let them pick
park.onChange();

btnBench.addEventListener('click', () => showBenchPanel(benchPanel.hidden));
$('bench-close').addEventListener('click', () => showBenchPanel(false));
benchFree.addEventListener('change', renderBenchPanel);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') showBenchPanel(false);
});
// tap the bench in the scene to pick a seat
$<HTMLCanvasElement>('scene').addEventListener('click', (e) => {
  if (renderer.bench.hit(e.clientX, e.clientY)) showBenchPanel(true);
});
if (params.has('monkey')) renderer.bench.summonMonkey(clock());

/* ---------- kagga: the full Kannada verse on demand, English translation one tap away ---------- */
const btnKagga = $<HTMLButtonElement>('btn-kagga');
const kaggaCard = $('kagga-card');
async function showKagga() {
  const k = await randomKagga();
  $('kagga-num').textContent = `ಕಗ್ಗ ${knNumber(k.number)}`;
  $('kagga-text').textContent = k.lines.join('\n');
  // each new kagga starts with the Kannada alone; the English waits for the Translation button
  $('kagga-en').textContent = k.english;
  $<HTMLAnchorElement>('kagga-link').href = k.url; // this verse on the Mankuthimma app
  showTranslation(false);
  $<HTMLButtonElement>('kagga-tr').disabled = !k.english;
  kaggaCard.hidden = false;
  kaggaCard.classList.remove('fresh');
  void kaggaCard.offsetWidth; // replay the fade for "Another"
  kaggaCard.classList.add('fresh');
  btnKagga.setAttribute('aria-expanded', 'true');
}
function hideKagga() {
  kaggaCard.hidden = true;
  btnKagga.setAttribute('aria-expanded', 'false');
}
btnKagga.addEventListener('click', () => (kaggaCard.hidden ? void showKagga() : hideKagga()));
$('kagga-next').addEventListener('click', () => void showKagga());
function showTranslation(on: boolean) {
  $('kagga-en').hidden = !on;
  $('kagga-en-credit').hidden = !on; // credit the translation only when it's shown
  const b = $<HTMLButtonElement>('kagga-tr');
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? 'Hide translation' : 'Translation';
}
$('kagga-tr').addEventListener('click', () => showTranslation($('kagga-en').hidden));
$('kagga-close').addEventListener('click', hideKagga);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideKagga();
});

/* ---------- shared benches (connected after first paint) ---------- */
const idle = (cb: () => void) =>
  'requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 1500 }) : setTimeout(cb, 300);
idle(() =>
  void park
    .connect()
    .catch(() => {})
    .finally(() => {
      // wait a moment so presence knows who's where, then seat everyone quietly: back on their
      // own seat after a reload / locked phone, otherwise on the first empty bench
      setTimeout(() => {
        if (!park.restore()) park.sitFirstEmpty();
      }, 1200);
    }),
);
