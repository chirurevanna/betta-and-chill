import './styles.css';
import { inject } from '@vercel/analytics';
import { Effects } from './effects/manager';
import { isEffect, type EffectType } from './protocol';
import { BENCH_COUNT, BenchPark, SEATS } from './park/benches';
import { Radio, type PlayResult } from './radio/player';
import { LANGS, STATIONS, type Lang } from './radio/stations';
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

/* ---------- radio ---------- */
const btnRadio = $<HTMLButtonElement>('btn-radio');
const radioTray = $('radio-tray');
function renderRadioButton() {
  btnRadio.textContent = 'Radio';
  btnRadio.setAttribute('aria-pressed', String(radio.on));
}

/** Radio row above the bottom bar: on/off, prev/next (within the language), then KA / HI / EN. */
function renderRadioTray() {
  if (radioTray.hidden) return;
  const pill = (label: string, title: string, onClick: () => void, extra = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pill ${extra}`.trim();
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  };
  const items: HTMLButtonElement[] = [
    pill(radio.on ? 'Off' : 'On', radio.on ? 'Turn the radio off (P)' : 'Turn the radio on (P)', () =>
      void radioCommand({ action: 'toggle' }),
    ),
    pill('Prev', 'Previous station', () => void radioCommand({ action: 'prev' })),
    pill('Next', 'Next station (N)', () => void radioCommand({ action: 'next' })),
  ];
  const single = radio.countLang(radio.lang) < 2;
  items[1].disabled = items[2].disabled = single;
  for (const l of LANGS) {
    const ready = radio.hasLang(l.id);
    const current = radio.lang === l.id;
    const b = pill(
      l.label,
      ready ? `${l.name} stations` : `${l.name} stations coming soon`,
      () => void radioCommand({ action: 'lang', lang: l.id }),
      `lang${current ? ' current' : ''}`,
    );
    b.disabled = !ready;
    b.setAttribute('aria-pressed', String(current));
    b.setAttribute('lang', l.id);
    items.push(b);
  }
  radioTray.replaceChildren(...items);
}

function showRadioTray(open: boolean) {
  radioTray.hidden = !open;
  btnRadio.setAttribute('aria-expanded', String(open));
  if (open) {
    // one tray at a time
    $('tray').hidden = true;
    $('btn-play').setAttribute('aria-expanded', 'false');
  }
  renderRadioTray();
}

radio.onChange = () => {
  renderRadioButton();
  renderRadioTray();
};
renderRadioButton();

function reportRadio(r: PlayResult) {
  if (r === 'blocked') toast('Tap the screen once to let the radio play');
  else if (radio.unavailable) toast('No station is reachable right now');
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

btnRadio.addEventListener('click', () => showRadioTray(radioTray.hidden));

// The radio is on by default. Browsers block sound until the first tap / key press,
// so if autoplay was refused, that first interaction starts it.
function unblockRadio() {
  if (radio.blocked && !radio.on && radio.preferredOn) void radio.play().then(reportRadio);
}
addEventListener(
  'pointerdown',
  (e) => {
    if (e.target instanceof Node && radioTray.contains(e.target)) return; // its buttons handle it
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
  if (tray.hidden) showRadioTray(false); // one tray at a time
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
  const rows: HTMLElement[] = [];
  for (const b of park.list()) {
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
      btn.addEventListener('click', () => {
        park.leave();
        toast('You got up from the bench');
      });
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
    renderBenchPanel();
    benchList.querySelector<HTMLElement>('.mine')?.scrollIntoView({ block: 'center' });
  }
}

function sitOn(bench: number) {
  if (!park.sit(bench)) {
    toast('That bench just filled up — pick another');
    return;
  }
  afterSitting('picked');
}

/**
 * `picked`: they chose it from the list. `auto`: seated at random on arrival.
 * `back`: a reload put them back on the bench they had.
 */
function afterSitting(how: 'picked' | 'auto' | 'back') {
  const b = park.myBench;
  if (!b) return;
  showBenchPanel(false);
  if (how === 'picked') {
    toast('You moved to a new bench');
    // choosing a bench is a tap, so the bench's music can start right away
    if (!radio.on) void radio.select(b.station).then(reportRadio);
    return;
  }
  const others = b.count - 1;
  const company = others > 0 ? ` with ${others} other${others > 1 ? 's' : ''}` : '';
  const lead = how === 'back' ? 'Back on your bench' : `You're sitting on a bench${company}`;
  const tail = radio.blocked ? 'tap anywhere to start the music' : 'tap Bench to move';
  toast(`${lead} · ${tail}`, 6000);
}

park.onChange = () => {
  renderer.bench.setSeats(park.myBench?.seats ?? [null, null, null, null], clock());
  renderBenchButton();
  renderBenchPanel();
};
park.onStation = (id) => void radio.tune(id);
park.onBumped = () => {
  toast('That bench just filled up — pick another');
  showBenchPanel(true);
};
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

/* ---------- shared benches (connected after first paint) ---------- */
const idle = (cb: () => void) =>
  'requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 1500 }) : setTimeout(cb, 300);
idle(() =>
  void park
    .connect()
    .catch(() => {})
    .finally(() => {
      // wait a moment so presence knows who's where, then seat everyone: back on their bench
      // after a reload, otherwise at random (preferring benches with company)
      setTimeout(() => {
        if (park.restore()) afterSitting('back');
        else if (park.sitAnywhere() !== null) afterSitting('auto');
      }, 1200);
    }),
);
