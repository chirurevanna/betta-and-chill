import './styles.css';
import { inject } from '@vercel/analytics';
import { Effects } from './effects/manager';
import { isEffect, type EffectType } from './protocol';
import { BENCH_COUNT, BenchPark, SEATS, VOTE_MS } from './park/benches';
import { Radio, type PlayResult } from './radio/player';
import { LANGS, STATIONS, type Lang } from './radio/stations';
import { addHearts, realtimeConfigured } from './realtime';
import { storageGet, storageSet } from './util';
import { knNumber, randomKagga } from './kagga/kagga';
import { loadFilms, pickFilms, type Film } from './movies/movies';
import { Renderer } from './scene/render';
import type { ViewId } from './scene/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Vercel Web Analytics (page views; it only reports on Vercel, never in local dev)
inject();

/** the Nandi | Museum toggle (Summit is archived; ?view=summit still opens it) */
const otherView = (v: ViewId): ViewId => (v === 'nandi' ? 'museum' : 'nandi');

/* ---------- boot ---------- */
const params = new URLSearchParams(location.search);
const paramView = params.get('view');
const initialView: ViewId = paramView === 'summit' || paramView === 'museum' ? paramView : 'nandi';
const TIMES: Record<string, number> = { day: 0, golden: 0.42, sunset: 0.56, dusk: 0.72, evening: 0.8, night: 1 };
// default mood: a quiet evening on the hill (dusk sky, city lights coming on)
const fx = new Effects(TIMES[params.get('time') ?? 'evening'] ?? TIMES.evening);
const renderer = new Renderer($<HTMLCanvasElement>('scene'), initialView);
const radio = new Radio();
// read before BenchPark runs (it creates its own keys on first visit)
const returningVisitor = storageGet('bc.visited') !== null;
storageSet('bc.visited', '1');
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

const plStation = $('pl-station');
function renderPlayer() {
  const on = radio.on;
  player.classList.toggle('on', on);
  // bars only bounce while sound is really coming out; connecting/buffering shows a soft pulse
  player.classList.toggle('live', radio.live);
  player.classList.toggle('loading', on && !radio.live);
  // the browser blocks sound until a first tap: let the Play button glow until then
  player.classList.toggle('blocked', radio.blocked && !on);
  plStation.textContent = radio.station.name;
  plStation.title = radio.station.name;
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
function floatHeart(delay: number, from?: { x: number; y: number }, scale = 1) {
  if (heartLayer.childElementCount > 60) return; // keep frantic tapping cheap
  const size = (22 + Math.random() * 14) * scale;
  let x: number;
  let y: number;
  let rise: number;
  let sway = (Math.random() - 0.5) * 90;
  if (from) {
    x = from.x;
    y = from.y;
    rise = 220 + Math.random() * 180;
  } else {
    // my own hearts: from the button all the way up to the top of the screen
    const r = heartBtn.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top;
    rise = y - (24 + Math.random() * 110);
    sway = (Math.random() - 0.7) * 100; // lean inwards so they don't slip off the right edge
  }
  // longer climbs take longer, so the pace stays the same
  const duration = Math.max(2.4, rise / 210) + Math.random() * 1.1;
  const h = document.createElement('span');
  h.className = 'float-heart';
  h.innerHTML = HEART_SVG;
  h.style.cssText = [
    `left:${x - size / 2 + (Math.random() - 0.5) * 10}px`,
    `top:${y - size * 0.4}px`,
    `width:${size}px`,
    `height:${size}px`,
    `color:${HEART_COLORS[(Math.random() * HEART_COLORS.length) | 0]}`,
    `--rise:${-rise}px`,
    `--sway:${sway}px`,
    `--tilt:${(Math.random() - 0.5) * 40}deg`,
    `animation-duration:${duration.toFixed(2)}s`,
    `animation-delay:${delay}ms`,
  ].join(';');
  h.addEventListener('animationend', () => h.remove());
  setTimeout(() => h.remove(), duration * 1000 + 600 + delay); // fallback when animations are off
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

/** One heart "press": counts, floats `burst` hearts, and is shared. `quiet` skips the console line. */
function sendHeart(burst: number, quiet = false) {
  heartsThisVisit++;
  let device = heartsThisVisit;
  try {
    device = Number(localStorage.getItem('bc.hearts') ?? 0) + 1;
    localStorage.setItem('bc.hearts', String(device));
  } catch {
    /* storage blocked: the visit count is still right */
  }
  if (!quiet) {
    const all = everyone === null ? '' : ` · ${(everyone + totalPending + 1).toLocaleString()} from everyone`;
    console.log(`♥ heart pressed: ${heartsThisVisit} this visit · ${device} on this device${all}`);
  }

  for (let i = 0; i < burst; i++) floatHeart(i * 110);
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
}

// tap: a little burst. hold: a steady stream until the finger lifts (each heart counts once)
let holdDelay = 0;
let holdTimer = 0;
let held = 0;
function stopHold() {
  clearTimeout(holdDelay);
  clearInterval(holdTimer);
  holdDelay = holdTimer = 0;
  if (held) {
    console.log(`♥ held the heart: +${held} (${heartsThisVisit} this visit)`);
    held = 0;
  }
}
heartBtn.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  stopHold(); // never two streams at once (second finger, repeated press)
  heartBtn.setPointerCapture(e.pointerId);
  sendHeart(2 + ((Math.random() * 2) | 0));
  holdDelay = window.setTimeout(() => {
    holdTimer = window.setInterval(() => {
      held++;
      sendHeart(1, true);
    }, 140);
  }, 350);
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) heartBtn.addEventListener(ev, stopHold);
heartBtn.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press menu on phones
// keyboard (Enter / Space) still sends a burst; pointer clicks are handled above
heartBtn.addEventListener('click', (e) => {
  if (e.detail === 0) sendHeart(2 + ((Math.random() * 2) | 0));
});

// a benchmate tapped their heart: hearts float up from their head on my screen
park.onHeart = ({ seat, n }, sameBench) => {
  if (sameBench) {
    // a benchmate: hearts rise from their head
    const at = renderer.bench.seatPoint(seat);
    for (let i = 0; i < Math.min(n * 2, 8); i++) floatHeart(i * 120, at);
    return;
  }
  // someone on another bench: a few small hearts drift up from a distant bench on the hillside
  const at = renderer.farBenchPoint();
  if (!at) return;
  for (let i = 0; i < Math.min(n, 4); i++) floatHeart(i * 180, at, 0.55);
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
    // seated: alone, the pick just changes the bench's station; with others, it asks them first
    const asked = park.requestStation(pick);
    if (asked !== 'applied') {
      toast(REQUEST_TEXT, 12_000, true);
      return;
    }
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
const btnNandi = $<HTMLButtonElement>('btn-nandi');
const btnMuseum = $<HTMLButtonElement>('btn-museum');

/** Opens straight into a view (Nandi unless ?view=museum or ?view=summit); the toggle switches later. */
function enterView(view: ViewId) {
  renderer.setView(view);
  updateViewButton();
}

function updateViewButton() {
  // Nandi | Museum: the place you're in is highlighted
  btnNandi.setAttribute('aria-pressed', String(renderer.currentView === 'nandi'));
  btnMuseum.setAttribute('aria-pressed', String(renderer.currentView === 'museum'));
  // indoors there's no sky to play with: the Effects button is hidden and its tray closed
  const indoor = renderer.currentView === 'museum';
  const sky = $<HTMLButtonElement>('btn-play');
  sky.hidden = indoor;
  if (indoor) {
    $('tray').hidden = true;
    sky.setAttribute('aria-expanded', 'false');
  }
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

btnNandi.addEventListener('click', () => enterView('nandi'));
btnMuseum.addEventListener('click', () => enterView('museum'));



let toastTimer = 0;
const toastClose = $<HTMLButtonElement>('toast-close');
toastClose.addEventListener('click', () => {
  clearTimeout(toastTimer);
  $('toast').classList.remove('show', 'closable');
});
/** A short message at the top; `closable` ones get an × and can be tapped. */
function toast(text: string, ms = 3200, closable = false) {
  const el = $('toast');
  $('toast-text').textContent = text;
  toastClose.hidden = !closable;
  el.classList.toggle('closable', closable);
  el.classList.toggle('long', text.length > 60);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const map: Record<string, EffectType> = { b: 'birds', s: 'sun', w: 'breeze', r: 'rain' };
  const k = e.key.toLowerCase();
  if (map[k] && renderer.currentView !== 'museum') fire(map[k]);
  else if (k === 'v') enterView(otherView(renderer.currentView));
  else if (k === 'p') void radioCommand({ action: 'toggle' });
  else if (k === 'n') void radioCommand({ action: 'next' });
});

enterView(initialView);
// ?fx=rain,birds — start with effects running (handy for demos and screenshots)
for (const e of (params.get('fx') ?? '').split(',')) if (isEffect(e)) fire(e);

/* ---------- benches ---------- */
const btnBench = $<HTMLButtonElement>('btn-bench');
const btnBenches = $<HTMLButtonElement>('btn-benches');
const benchPanel = $('bench-panel');
const benchList = $('bench-list');
const benchSummary = $('bench-summary');
const stationName = (id: string) => STATIONS.find((s) => s.id === id)?.name ?? id;
const PAGE_SIZE = 5;
const pageCount = Math.ceil(BENCH_COUNT / PAGE_SIZE);
const benchPages = $('bench-pages');
let benchPage = 0;
/** the bench whose station list is expanded in the panel (one at a time) */
let openStations: number | null = null;

/** Solo | Bench toggle: exactly one is highlighted. */
function renderBenchButton() {
  btnBench.setAttribute('aria-pressed', String(!solo));
  btnSolo.setAttribute('aria-pressed', String(solo));
}

/* ---------- solo: off the benches, alone with an old cassette radio ---------- */
const btnSolo = $<HTMLButtonElement>('btn-solo');
let solo = storageGet('bc.solo') === '1';
renderer.bench.solo = solo;
function setSolo(on: boolean) {
  solo = on;
  storageSet('bc.solo', on ? '1' : '');
  renderer.bench.solo = on;
  if (on) {
    park.leave();
    showBenchPanel(false);
    console.info('%c🎧 solo — listening alone, change stations freely', 'color:#7fb36a;font-weight:bold');
  }
  renderBenchButton();
  renderBenchPanel();
}
btnSolo.addEventListener('click', () => {
  if (!solo) setSolo(true);
  toast('Love you, Manu', 2200);
});

function renderBenchPanel() {
  if (benchPanel.hidden) return;
  const n = park.sittingCount;
  benchSummary.textContent = solo
    ? `You're listening solo · ${n} ${n === 1 ? 'person' : 'people'} on benches`
    : park.shared
    ? `${n} ${n === 1 ? 'person' : 'people'} sitting · ${BENCH_COUNT} benches`
    : `${BENCH_COUNT} benches · just you for now`;
  // page pills: 1, 2, … (5 benches each)
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
    // the chevron shows every station in the language this bench is playing
    const open = openStations === b.id;
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'bench-more';
    more.setAttribute('aria-expanded', String(open));
    more.setAttribute('aria-label', `All ${langName(b.station)} stations`);
    more.title = 'Show all stations';
    more.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 9.5l5.5 5.5 5.5-5.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    more.addEventListener('click', () => {
      openStations = open ? null : b.id;
      renderBenchPanel();
    });
    li.append(name, dots, st, more, btn);
    if (open) li.append(stationList(b.station, mine));
    rows.push(li);
  }
  benchList.replaceChildren(...rows);
}

const langName = (station: string) => {
  const lang = STATIONS.find((s) => s.id === station)?.lang;
  return LANGS.find((l) => l.id === lang)?.name ?? '';
};

/**
 * The stations in the language a bench is playing, with the one on now marked. On my own bench
 * each one can be tapped (switching straight away alone, or asking benchmates first); on other
 * benches it's just a look at what they could tune to.
 */
function stationList(current: string, mine: boolean) {
  const lang = STATIONS.find((s) => s.id === current)?.lang ?? radio.lang;
  const ul = document.createElement('ul');
  ul.className = 'bench-stations';
  ul.setAttribute('aria-label', `${langName(current)} stations`);
  for (const s of radio.stationsOf(lang)) {
    const li = document.createElement('li');
    const on = s.id === current;
    if (mine) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `bench-st${on ? ' on' : ''}`;
      b.textContent = s.name;
      b.disabled = on;
      if (on) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => void radioCommand({ action: 'select', station: s.id }));
      li.append(b);
    } else {
      const sp = document.createElement('span');
      sp.className = `bench-st${on ? ' on' : ''}`;
      sp.textContent = s.name;
      if (on) sp.setAttribute('aria-current', 'true');
      li.append(sp);
    }
    ul.append(li);
  }
  if (!mine) {
    const hint = document.createElement('li');
    hint.className = 'bench-st-hint';
    hint.textContent = 'Sit here to pick one';
    ul.append(hint);
  }
  return ul;
}

function showBenchPanel(open: boolean) {
  if (open === !benchPanel.hidden) return;
  benchPanel.hidden = !open;
  btnBenches.setAttribute('aria-expanded', String(open));
  if (open) {
    // open on the page that has my bench
    if (park.mine !== null) benchPage = Math.floor(park.mine / PAGE_SIZE);
    renderBenchPanel();
  }
}

function sitOn(bench: number) {
  if (solo && park.list()[bench]?.count < SEATS) setSolo(false);
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

/* ---------- station votes: a change on a shared bench needs one benchmate's Yes ---------- */
const REQUEST_TEXT =
  'Channel change request sent to people on the bench. Wait for their approval or try solo/empty bench to change channels as you like.';
const DECLINED_TEXT = 'Nobody approved your channel change request, please sit in another bench to freely change channels';
const voteCard = $('vote-card');
const voteText = $('vote-text');
let voteId = '';
function hideVote() {
  voteCard.hidden = true;
  voteId = '';
}
park.onRequest = (req) => {
  voteId = req.id;
  voteText.textContent = '';
  voteText.append('Someone on your bench wants to switch to ');
  const name = document.createElement('strong');
  name.textContent = stationName(req.station);
  voteText.append(name);
  // restart the countdown bar from full
  const bar = voteCard.querySelector<HTMLElement>('.vote-bar i')!;
  bar.style.animation = 'none';
  void bar.offsetWidth;
  bar.style.animation = '';
  voteCard.style.setProperty('--vote-ms', `${Math.min(VOTE_MS, Math.max(0, VOTE_MS - (Date.now() - req.at)))}ms`);
  voteCard.hidden = false;
};
park.onRequestClosed = hideVote;
park.onRequestResult = (approved) => {
  if (approved) void radio.tune(park.myBench?.station ?? '');
  else toast(DECLINED_TEXT, 12_000, true);
};
$('vote-yes').addEventListener('click', () => {
  park.vote(voteId, true);
  hideVote();
});
$('vote-no').addEventListener('click', () => {
  park.vote(voteId, false);
  hideVote();
});
park.onBumped = () => showBenchPanel(true); // lost a seat race on a full bench: let them pick
park.onChange();

// Bench: from solo, back onto the first empty bench; already on the benches, open or close the list
btnBench.addEventListener('click', () => {
  if (!solo) return showBenchPanel(benchPanel.hidden);
  setSolo(false);
  if (park.sitFirstEmpty() === null) showBenchPanel(true); // everything full: let them pick
});
// the list button: every bench and its free seats, from solo too (picking one leaves solo)
btnBenches.addEventListener('click', () => showBenchPanel(benchPanel.hidden));
$('bench-close').addEventListener('click', () => showBenchPanel(false));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') showBenchPanel(false);
});
// tap the bench in the scene to pick a seat
// in the Museum, a tap on the painting's left / right half hangs the previous / next one
const sceneEl = $<HTMLCanvasElement>('scene');
sceneEl.addEventListener('click', (e) => {
  const side = renderer.paintingSide(e.clientX, e.clientY);
  if (side) renderer.stepPainting(side);
  else if (renderer.bench.hit(e.clientX, e.clientY)) showBenchPanel(true);
});
sceneEl.addEventListener('pointermove', (e) => {
  sceneEl.style.cursor = renderer.paintingSide(e.clientX, e.clientY) ? 'pointer' : '';
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
btnKagga.addEventListener('click', () => {
  if (kaggaCard.hidden) {
    hideMovies();
    void showKagga();
  } else hideKagga();
});
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
  if (e.key === 'Escape') {
    hideKagga();
    hideMovies();
  }
});

/* ---------- movies roulette: one random 3.5★+ film at a time; its poster or title opens it on Letterboxd ---------- */
const btnMovies = $<HTMLButtonElement>('btn-movies');
const moviesCard = $('movies-card');
const moviesGrid = $('movies-grid');
const PICKS = 1;
let lastPicks = new Set<string>();

function filmTile(f: Film) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.className = 'film';
  a.href = f.url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('aria-label', `${f.name} (${f.year}) on Letterboxd`);
  const art = document.createElement('div');
  art.className = 'film-poster';
  // no poster found (or it fails to load): a plain title card instead
  const fallback = () => {
    art.classList.add('bare');
    art.textContent = f.name;
  };
  if (f.poster) {
    const img = document.createElement('img');
    img.src = f.poster;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      img.remove();
      fallback();
    });
    art.append(img);
  } else fallback();
  const name = document.createElement('span');
  name.className = 'film-name';
  name.textContent = f.name;
  const year = document.createElement('span');
  year.className = 'film-meta';
  year.textContent = String(f.year);
  a.append(art, name, year);
  li.append(a);
  return li;
}

async function showMovies() {
  const all = await loadFilms();
  const picks = pickFilms(all, PICKS, lastPicks);
  lastPicks = new Set(picks.map((f) => f.url));
  moviesGrid.replaceChildren(...picks.map(filmTile));
  moviesCard.hidden = false;
  moviesCard.classList.remove('fresh');
  void moviesCard.offsetWidth;
  moviesCard.classList.add('fresh');
  btnMovies.setAttribute('aria-expanded', 'true');
}
function hideMovies() {
  moviesCard.hidden = true;
  btnMovies.setAttribute('aria-expanded', 'false');
}
btnMovies.addEventListener('click', () => {
  if (moviesCard.hidden) {
    hideKagga();
    void showMovies();
  } else hideMovies();
});
$('movies-shuffle').addEventListener('click', () => void showMovies());
$('movies-close').addEventListener('click', hideMovies);

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
        if (!solo && !park.restore()) park.sitFirstEmpty();
      }, 1200);
    }),
);

/* ---------- welcome, on every open ---------- */
{
  const el = $('welcome');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let gone = false;
  const hide = () => {
    if (gone) return;
    gone = true;
    el.classList.remove('show');
    setTimeout(() => (el.hidden = true), reduced ? 0 : 1600);
  };
  setTimeout(() => {
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(hide, 7000); // ~1 s in, ~6 s to read
  }, 800);
  el.addEventListener('click', hide);
}

/* ---------- tell the owner someone opened the site or the app (see api/visit.ts) ---------- */
{
  const standalone =
    matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  void fetch('/api/visit', {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: standalone ? 'app' : 'website', returning: returningVisitor }),
  }).catch(() => {
    /* fire and forget: never let this affect the page */
  });
}

