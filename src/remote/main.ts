import './remote.css';
import {
  EFFECTS,
  EV_CMD,
  EV_HELLO,
  EV_RADIO,
  EV_STATE,
  ROOM_RE,
  type EffectType,
  type RadioAction,
  type RadioState,
  type StateMsg,
} from '../protocol';
import { joinRoom, type Link } from '../realtime';

const statusEl = document.getElementById('status')!;
const buttons = new Map<EffectType, HTMLButtonElement>();
document.querySelectorAll<HTMLButtonElement>('.ctl').forEach((b) => buttons.set(b.dataset.cmd as EffectType, b));

const room = (new URLSearchParams(location.search).get('r') ?? '').toUpperCase();
const until: Record<EffectType, number> = { birds: 0, sun: 0, breeze: 0, rain: 0 };
const total: Record<EffectType, number> = { birds: 1, sun: 1, breeze: 1, rain: 1 };
let screens = 0;
let link: Link | null = null;
let online = false;
const me = Math.random().toString(36).slice(2, 10);

function setStatus(text: string, ok = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('ok', ok);
}

function setSunLabel(isNight: boolean) {
  const b = buttons.get('sun')!;
  b.querySelector('.ico')!.textContent = isNight ? '🌅' : '🌇';
  b.querySelector('.lbl')!.textContent = isNight ? 'Sunrise' : 'Sunset';
}

function applyState(s: StateMsg) {
  const now = performance.now();
  for (const e of EFFECTS) {
    const ms = Math.max(0, s.cooldowns?.[e] ?? 0);
    until[e] = now + ms;
    total[e] = Math.max(ms, 1);
  }
  setSunLabel(!!s.isNight);
  if (s.radio) applyRadio(s.radio);
  if (screens === 0) screens = 1; // a state message proves a screen is there
  refreshStatus();
}

/* ---------- radio card ---------- */
const radioStation = document.getElementById('radio-station')!;
const radioNote = document.getElementById('radio-note')!;
const radioVol = document.getElementById('radio-vol') as HTMLInputElement;
const radioButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-radio]')];
const radioToggle = radioButtons.find((b) => b.dataset.radio === 'toggle')!;
let volDragging = false;

function applyRadio(r: RadioState) {
  radioStation.textContent = r.on ? r.station : 'Kannada radio';
  radioNote.textContent = r.blocked
    ? 'Tap the big screen once to start the radio'
    : r.unavailable
      ? 'No station reachable right now'
      : r.on
        ? 'Live now'
        : `Off · ${r.station}`;
  radioToggle.textContent = r.on ? '⏸' : '▶';
  if (!volDragging) radioVol.value = String(Math.round(r.volume * 100));
}

function sendRadio(action: RadioAction, value?: number) {
  if (!link) return;
  link.send(EV_RADIO, { action, value, from: me });
}

for (const b of radioButtons) {
  b.addEventListener('click', () => {
    if (b.disabled) return;
    sendRadio(b.dataset.radio as RadioAction);
    navigator.vibrate?.(12);
  });
}

// throttle slider updates so a drag doesn't flood the channel
let volTimer = 0;
let volPending: number | null = null;
radioVol.addEventListener('input', () => {
  volDragging = true;
  volPending = Number(radioVol.value) / 100;
  if (volTimer) return;
  volTimer = window.setTimeout(function flush() {
    if (volPending !== null) sendRadio('vol', volPending);
    volPending = null;
    volTimer = 0;
  }, 150);
});
radioVol.addEventListener('change', () => {
  volDragging = false;
  sendRadio('vol', Number(radioVol.value) / 100);
});

function refreshStatus() {
  if (!online) return;
  if (screens > 0) setStatus('Connected to the big screen', true);
  else setStatus('Waiting for the big screen…');
}

function tick() {
  const now = performance.now();
  for (const [e, b] of buttons) {
    const left = until[e] - now;
    const ready = online && screens > 0 && left <= 0;
    b.disabled = !ready;
    const bar = b.querySelector<HTMLElement>('.bar')!;
    bar.style.transform = `scaleX(${left > 0 ? left / total[e] : 0})`;
  }
  const linked = online && screens > 0;
  for (const b of radioButtons) b.disabled = !linked;
  radioVol.disabled = !linked;
  requestAnimationFrame(tick);
}

if (!ROOM_RE.test(room)) {
  setStatus('Scan the QR code on the big screen to connect.');
} else {
  requestAnimationFrame(tick);
  joinRoom(room, 'remote', {
    onStatus(s) {
      online = s === 'online';
      if (s === 'online') {
        refreshStatus();
        link?.send(EV_HELLO, { from: me });
      } else if (s === 'connecting') setStatus('Connecting…');
      else if (s === 'unconfigured') setStatus('This remote isn’t set up yet.');
      else setStatus('Connection lost — retrying…');
    },
    onPresence(c) {
      screens = c.screen;
      refreshStatus();
      if (screens > 0) link?.send(EV_HELLO, { from: me });
    },
    onMessage(event, payload) {
      if (event === EV_STATE) applyState(payload as StateMsg);
    },
  })
    .then((l) => {
      link = l;
      if (online) l?.send(EV_HELLO, { from: me });
    })
    .catch(() => setStatus('Could not connect. Check your internet and rescan.'));

  for (const [e, b] of buttons) {
    b.addEventListener('click', () => {
      if (!link || b.disabled) return;
      link.send(EV_CMD, { type: e, from: me });
      navigator.vibrate?.(18);
      // optimistic short lock until the screen's state message arrives
      until[e] = performance.now() + 1500;
      total[e] = 1500;
      b.classList.add('sent');
      setTimeout(() => b.classList.remove('sent'), 400);
    });
  }
}
