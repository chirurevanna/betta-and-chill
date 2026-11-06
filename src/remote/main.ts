import './remote.css';
import { EFFECTS, EV_CMD, EV_HELLO, EV_STATE, ROOM_RE, type EffectType, type StateMsg } from '../protocol';
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
  if (screens === 0) screens = 1; // a state message proves a screen is there
  refreshStatus();
}

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
