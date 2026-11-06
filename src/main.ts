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
import { Radio, type PlayResult } from './radio/player';
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
    radio: {
      on: radio.on,
      station: radio.station.name,
      volume: radio.volume,
      blocked: radio.blocked,
      unavailable: radio.unavailable,
    },
  };
  link.send(EV_STATE, msg);
}

/* ---------- radio ---------- */
const btnRadio = $<HTMLButtonElement>('btn-radio');
function renderRadioButton() {
  btnRadio.textContent = radio.on ? `📻 ${radio.station.name}` : '📻 Radio';
  btnRadio.setAttribute('aria-pressed', String(radio.on));
}
let radioStateTimer = 0;
radio.onChange = () => {
  renderRadioButton();
  // coalesce bursts (e.g. failover + playing) into one broadcast
  clearTimeout(radioStateTimer);
  radioStateTimer = window.setTimeout(broadcastState, 60);
};
renderRadioButton();

function reportRadio(r: PlayResult) {
  if (r === 'blocked') toast('📻 Tap the screen once to let the radio play');
  else if (radio.unavailable) toast('📻 No station is reachable right now');
}

async function radioCommand(cmd: Pick<RadioCmd, 'action' | 'value'>, fromRemote: boolean) {
  let r: PlayResult = 'ok';
  if (cmd.action === 'toggle') r = await radio.toggle();
  else if (cmd.action === 'next') r = await radio.next();
  else if (cmd.action === 'prev') r = await radio.prev();
  else if (cmd.action === 'vol' && cmd.value !== undefined) radio.setVolume(cmd.value);
  reportRadio(r);
  if (fromRemote && r === 'ok' && cmd.action !== 'vol') {
    toast(radio.on ? `📻 ${radio.station.name}` : '📻 Radio paused');
  }
  broadcastState();
}

btnRadio.addEventListener('click', () => void radioCommand({ action: 'toggle' }, false));

// a remote may ask for the radio before anyone touched this screen; the first tap unblocks it
addEventListener(
  'pointerdown',
  (e) => {
    if (e.target instanceof Node && btnRadio.contains(e.target)) return; // its click handles it
    if (radio.blocked && !radio.on) void radio.play().then(reportRadio);
  },
  { capture: true },
);

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
const landing = $('landing');
const hud = $('hud');
const btnView = $<HTMLButtonElement>('btn-view');
const btnSound = $<HTMLButtonElement>('btn-sound');
const panel = $('remote-panel');
const pill = $<HTMLButtonElement>('remote-pill');
const statusEl = $('remote-status');

function enterView(view: ViewId) {
  renderer.setView(view);
  landing.classList.add('gone');
  setTimeout(() => (landing.hidden = true), 900);
  hud.hidden = false;
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

landing.querySelectorAll<HTMLButtonElement>('.card').forEach((b) =>
  b.addEventListener('click', () => enterView(b.dataset.view as ViewId)),
);
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
  else if (k === 'v' && landing.hidden) btnView.click();
  else if (k === 'm' && landing.hidden) btnSound.click();
  else if (k === 'q' && landing.hidden) showRemote(panel.hidden);
  else if (k === 'p' && landing.hidden) void radioCommand({ action: 'toggle' }, false);
  else if (k === 'n' && landing.hidden) void radioCommand({ action: 'next' }, false);
});

if (paramView === 'nandi' || paramView === 'summit') enterView(paramView);
// ?fx=rain,birds — start with effects running (handy for demos and screenshots)
for (const e of (params.get('fx') ?? '').split(',')) if (isEffect(e)) fire(e, false);

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
