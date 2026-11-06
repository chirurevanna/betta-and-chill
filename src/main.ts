import './styles.css';
import { Ambience } from './audio';
import { Effects } from './effects/manager';
import {
  EV_CMD,
  EV_HELLO,
  EV_RADIO,
  EV_STATE,
  ROOM_RE,
  isEffect,
  isRadioCmd,
  newRoomCode,
  type EffectType,
  type RadioCmd,
  type StateMsg,
} from './protocol';
import { BENCH_COUNT, BenchPark, SEATS } from './park/benches';
import { Radio, type PlayResult } from './radio/player';
import { STATIONS } from './radio/stations';
import { joinRoom, realtimeConfigured, type Link, type LinkStatus } from './realtime';
import { nightOf } from './scene/palette';
import { Renderer } from './scene/render';
import type { ViewId } from './scene/types';
import { storageGet, storageSet } from './util';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const VIEW_NAMES: Record<ViewId, string> = { nandi: 'Nandi', summit: 'Summit' };
const TOASTS: Record<EffectType, [string, string]> = {
  birds: ['🐦 A flock is passing by', '🐦 A flock is passing by'],
  sun: ['🌇 The sun is going down', '🌅 Here comes the sunrise'],
  breeze: ['🍃 A breeze rolls up the hill', '🍃 A breeze rolls up the hill'],
  rain: ['🌧️ It’s starting to rain', '🌧️ It’s starting to rain'],
};

/* ---------- boot ---------- */
const params = new URLSearchParams(location.search);
const paramView = params.get('view');
const initialView: ViewId = paramView === 'summit' ? 'summit' : 'nandi';
const TIMES: Record<string, number> = { day: 0, golden: 0.42, sunset: 0.56, dusk: 0.72, night: 1 };
const fx = new Effects(TIMES[params.get('time') ?? 'day'] ?? 0);
const renderer = new Renderer($<HTMLCanvasElement>('scene'), initialView);
const audio = new Ambience();
const radio = new Radio();
const park = new BenchPark();
const clock = () => performance.now() / 1000;

fx.onBirds = () => {
  renderer.spawnBirds();
  audio.flock();
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
  audio.update(fx.wind, fx.rain, nightOf(fx.phase));
  radio.duck(fx.rain);
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

/* ---------- triggering effects ---------- */
let link: Link | null = null;

function broadcastState() {
  if (!link) return;
  const msg: StateMsg = {
    isNight: fx.isNight,
    cooldowns: fx.cooldowns(clock()),
    view: renderer.currentView,
    bench: park.mine === null ? null : park.mine + 1,
    radio: {
      on: radio.on,
      station: radio.station.name,
      stationId: radio.station.id,
      stations: radio.list(),
      volume: radio.volume,
      blocked: radio.blocked,
      unavailable: radio.unavailable,
    },
  };
  link.send(EV_STATE, msg);
}

/* ---------- radio ---------- */
const btnRadio = $<HTMLButtonElement>('btn-radio');
const radioTray = $('radio-tray');
function renderRadioButton() {
  btnRadio.textContent = radio.on ? `📻 ${radio.station.name}` : '📻 Radio';
  btnRadio.setAttribute('aria-pressed', String(radio.on));
}

/** Station picker above the bottom bar: on/off, ⏮ ⏭, then one pill per Kannada station. */
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
    pill(radio.on ? '⏸' : '▶', radio.on ? 'Turn the radio off (P)' : 'Turn the radio on (P)', () =>
      void radioCommand({ action: 'toggle' }, false),
    ),
    pill('⏮', 'Previous station', () => void radioCommand({ action: 'prev' }, false)),
    pill('⏭', 'Next station (N)', () => void radioCommand({ action: 'next' }, false)),
  ];
  for (const s of radio.list()) {
    const current = s.id === radio.station.id;
    const b = pill(
      s.name,
      s.available ? `Play ${s.name}` : `${s.name} isn’t responding right now — tap to try again`,
      () => void radioCommand({ action: 'select', station: s.id }, false),
      `station${current && radio.on ? ' current' : ''}${s.available ? '' : ' down'}`,
    );
    b.setAttribute('aria-pressed', String(current && radio.on));
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

let radioStateTimer = 0;
radio.onChange = () => {
  renderRadioButton();
  renderRadioTray();
  // coalesce bursts (e.g. failover + playing) into one broadcast
  clearTimeout(radioStateTimer);
  radioStateTimer = window.setTimeout(broadcastState, 60);
};
renderRadioButton();

function reportRadio(r: PlayResult) {
  if (r === 'blocked') toast('📻 Tap the screen once to let the radio play');
  else if (radio.unavailable) toast('📻 No station is reachable right now');
}

async function radioCommand(cmd: Pick<RadioCmd, 'action' | 'value' | 'station'>, fromRemote: boolean) {
  let r: PlayResult = 'ok';
  const pick =
    cmd.action === 'select' ? cmd.station : cmd.action === 'next' ? radio.stationIdAt(1) : cmd.action === 'prev' ? radio.stationIdAt(-1) : undefined;
  if (pick && park.mine !== null) {
    // seated: the pick changes the station for everyone on this bench
    park.setStation(pick);
    r = await radio.select(pick);
  } else if (cmd.action === 'toggle') r = await radio.toggle();
  else if (cmd.action === 'select' && cmd.station) r = await radio.select(cmd.station);
  else if (cmd.action === 'next') r = await radio.next();
  else if (cmd.action === 'prev') r = await radio.prev();
  else if (cmd.action === 'vol' && cmd.value !== undefined) radio.setVolume(cmd.value);
  reportRadio(r);
  if (fromRemote && r === 'ok' && cmd.action !== 'vol') {
    toast(radio.on ? `📻 ${radio.station.name}` : '📻 Radio paused');
  }
  broadcastState();
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
  else console.info('%c📻 radio is off (turned off earlier) — press P or 📻 to turn it on', 'color:#e9a23b;font-weight:bold');
});

function fire(type: EffectType, fromRemote: boolean) {
  const wasNight = fx.isNight;
  if (!fx.trigger(type, clock())) return;
  if (fromRemote) toast(TOASTS[type][type === 'sun' && wasNight ? 1 : 0]);
  broadcastState();
  // tell remotes again when cooldowns end so buttons re-enable promptly
  const ms = Math.max(...Object.values(fx.cooldowns(clock())));
  if (ms > 0) setTimeout(broadcastState, ms + 50);
}

/* ---------- UI ---------- */
const btnView = $<HTMLButtonElement>('btn-view');
const btnSound = $<HTMLButtonElement>('btn-sound');
const panel = $('remote-panel');
const pill = $<HTMLButtonElement>('remote-pill');
const statusEl = $('remote-status');

/** Opens straight into a view (Nandi unless ?view=summit); the bottom bar switches later. */
function enterView(view: ViewId) {
  renderer.setView(view);
  updateViewButton();
  showRemote(storageGet('bc.qr') !== 'hidden' && innerWidth >= 640);
  broadcastState();
  maybeResumeAudio();
}

function updateViewButton() {
  const other: ViewId = renderer.currentView === 'nandi' ? 'summit' : 'nandi';
  btnView.textContent = `↔ ${VIEW_NAMES[other]}`;
}

// on-screen effect tray (for anyone without a second phone)
const tray = $('tray');
const btnPlay = $<HTMLButtonElement>('btn-play');
const trayButtons = [...tray.querySelectorAll<HTMLButtonElement>('[data-fx]')];
btnPlay.addEventListener('click', () => {
  if (tray.hidden) showRadioTray(false); // one tray at a time
  tray.hidden = !tray.hidden;
  btnPlay.setAttribute('aria-expanded', String(!tray.hidden));
  refreshTray();
});
trayButtons.forEach((b) => b.addEventListener('click', () => isEffect(b.dataset.fx) && fire(b.dataset.fx, false)));
function refreshTray() {
  if (tray.hidden) return;
  const now = clock();
  for (const b of trayButtons) {
    const e = b.dataset.fx as EffectType;
    b.disabled = fx.cooldownMs(e, now) > 0;
    if (e === 'sun') b.textContent = fx.isNight ? '🌅' : '🌇';
  }
}
setInterval(refreshTray, 300);

btnView.addEventListener('click', () => {
  renderer.setView(renderer.currentView === 'nandi' ? 'summit' : 'nandi');
  updateViewButton();
  broadcastState();
});

function renderSoundButton() {
  btnSound.textContent = audio.enabled ? '🔊 Sound' : '🔇 Sound';
  btnSound.setAttribute('aria-pressed', String(audio.enabled));
}
btnSound.addEventListener('click', async () => {
  await audio.setEnabled(!audio.enabled);
  storageSet('bc.sound', audio.enabled ? 'on' : 'off');
  renderSoundButton();
});
function maybeResumeAudio() {
  if (storageGet('bc.sound') === 'on' && !audio.enabled) {
    void audio.setEnabled(true).then(renderSoundButton);
  }
}

function showRemote(open: boolean) {
  panel.hidden = !open;
  pill.hidden = open;
  storageSet('bc.qr', open ? 'shown' : 'hidden');
}
$('remote-collapse').addEventListener('click', () => showRemote(false));
pill.addEventListener('click', () => showRemote(true));

// idle: fade the HUD (the QR stays so people can still scan it)
let idleTimer = 0;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => document.body.classList.add('idle'), 4000);
}
addEventListener('pointermove', wake);
addEventListener('pointerdown', wake);
addEventListener('keydown', wake);
wake();

let toastTimer = 0;
function toast(text: string) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 3200);
}

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const map: Record<string, EffectType> = { b: 'birds', s: 'sun', w: 'breeze', r: 'rain' };
  const k = e.key.toLowerCase();
  if (map[k]) fire(map[k], false);
  else if (k === 'v') btnView.click();
  else if (k === 'm') btnSound.click();
  else if (k === 'q') showRemote(panel.hidden);
  else if (k === 'p') void radioCommand({ action: 'toggle' }, false);
  else if (k === 'n') void radioCommand({ action: 'next' }, false);
});

enterView(initialView);
// ?fx=rain,birds — start with effects running (handy for demos and screenshots)
for (const e of (params.get('fx') ?? '').split(',')) if (isEffect(e)) fire(e, false);

/* ---------- benches ---------- */
const btnBench = $<HTMLButtonElement>('btn-bench');
const benchPanel = $('bench-panel');
const benchList = $('bench-list');
const benchSummary = $('bench-summary');
const benchFree = $<HTMLInputElement>('bench-free');
const sitPrompt = $('sit-prompt');
const stationName = (id: string) => STATIONS.find((s) => s.id === id)?.name ?? id;
let qrWasOpen = false;

function renderBenchButton() {
  const b = park.mine;
  btnBench.textContent = b === null ? '🪑 Bench' : `🪑 Bench ${b + 1}`;
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
        toast('🪑 You got up from the bench');
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
    // the panel takes the right side; tuck the QR away until it closes
    qrWasOpen = !panel.hidden;
    panel.hidden = true;
    pill.hidden = true;
    showSitPrompt(false);
    renderBenchPanel();
    benchList.querySelector<HTMLElement>('.mine')?.scrollIntoView({ block: 'center' });
  } else {
    panel.hidden = !qrWasOpen;
    pill.hidden = qrWasOpen;
  }
}

function sitOn(bench: number) {
  if (!park.sit(bench)) {
    toast('🪑 That bench just filled up — pick another');
    return;
  }
  afterSitting();
}

function afterSitting() {
  const b = park.myBench;
  if (!b) return;
  showSitPrompt(false);
  showBenchPanel(false);
  toast(`🪑 Bench ${b.id + 1} · 📻 ${stationName(b.station)}`);
  // sitting down is a gesture: make sure the bench's music is playing
  if (!radio.on) void radio.select(b.station).then(reportRadio);
}

function showSitPrompt(open: boolean) {
  sitPrompt.hidden = !open;
  if (!open) storageSet('bc.sitPrompt', 'off', 'session');
}

park.onChange = () => {
  renderer.bench.setSeats(park.myBench?.seats ?? [null, null, null, null], clock());
  renderBenchButton();
  renderBenchPanel();
  clearTimeout(radioStateTimer);
  radioStateTimer = window.setTimeout(broadcastState, 60);
};
park.onStation = (id) => void radio.tune(id);
park.onBumped = () => {
  toast('🪑 That bench just filled up — pick another');
  showBenchPanel(true);
};
park.onChange();

btnBench.addEventListener('click', () => showBenchPanel(benchPanel.hidden));
$('bench-close').addEventListener('click', () => showBenchPanel(false));
benchFree.addEventListener('change', renderBenchPanel);
$('sit-anywhere').addEventListener('click', () => {
  if (park.sitAnywhere() === null) toast('🪑 Every bench is full right now');
  else afterSitting();
});
$('sit-choose').addEventListener('click', () => showBenchPanel(true));
$('sit-dismiss').addEventListener('click', () => showSitPrompt(false));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    showBenchPanel(false);
    showSitPrompt(false);
  }
});
// tap the bench in the scene to pick a seat
$<HTMLCanvasElement>('scene').addEventListener('click', (e) => {
  if (renderer.bench.hit(e.clientX, e.clientY)) showBenchPanel(true);
});
if (params.has('monkey')) renderer.bench.summonMonkey(clock());

/* ---------- remote link (loaded after first paint) ---------- */
function setStatus(text: string, cls: string) {
  statusEl.textContent = text;
  statusEl.dataset.state = cls;
}

function getRoom(): string {
  const saved = storageGet('bc.room', 'session');
  if (saved && ROOM_RE.test(saved)) return saved;
  const r = newRoomCode();
  storageSet('bc.room', r, 'session');
  return r;
}

async function startRemote() {
  const room = getRoom();
  const url = `${location.origin}/remote.html?r=${room}`;
  const { drawQR } = await import('./qr');
  await drawQR($<HTMLCanvasElement>('qr'), url);

  if (!realtimeConfigured) {
    setStatus('Remote unavailable — keys B · S · W · R work here', 'off');
    return;
  }
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const labels: Record<LinkStatus, [string, string]> = {
    connecting: ['Connecting…', 'wait'],
    online: local
      ? ['Open this page via your network IP so phones can reach it', 'warn']
      : [`Room ${room} · waiting for a phone`, 'ok'],
    offline: ['Remote offline — retrying…', 'off'],
    unconfigured: ['Remote unavailable', 'off'],
  };
  let remotes = 0;
  link = await joinRoom(room, 'screen', {
    onStatus(s) {
      if (s === 'online' && remotes > 0) return;
      setStatus(...labels[s]);
    },
    onPresence(c) {
      remotes = c.remote;
      if (remotes > 0) setStatus(`📱 ${remotes} remote${remotes > 1 ? 's' : ''} connected`, 'ok');
      else setStatus(...labels.online);
      broadcastState();
    },
    onMessage(event, payload) {
      if (event === EV_CMD) {
        const t = (payload as { type?: unknown })?.type;
        if (isEffect(t)) fire(t, true);
        else broadcastState();
      } else if (event === EV_RADIO) {
        if (isRadioCmd(payload)) void radioCommand(payload, true);
      } else if (event === EV_HELLO) {
        broadcastState();
      }
    },
  });
}

const idle = (cb: () => void) =>
  'requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 1500 }) : setTimeout(cb, 300);
idle(() => void startRemote().catch(() => setStatus('Remote unavailable', 'off')));
idle(() =>
  void park
    .connect()
    .catch(() => {})
    .finally(() => {
      // wait a moment so presence knows who's where before re-taking a seat or asking
      setTimeout(() => {
        if (park.restore()) return;
        if (park.mine === null && storageGet('bc.sitPrompt', 'session') !== 'off') sitPrompt.hidden = false;
      }, 1200);
    }),
);
