import type { SeatView } from '../park/benches';
import { clamp, css, hex, mix, mulberry32, type RGB } from '../util';
import type { BenchSpot } from './build';
import type { Frame } from './types';

/*
 * The shared bench, seen from behind as it faces the city, with up to four listeners in
 * headphones slowly nodding along, plus the occasional Chamundi monkey after the peanuts.
 * Local units: origin at the bench centre on the ground, 1 unit = spot.u px.
 */

const SEAT_X = [-54, -18, 18, 54];
const BACK_TOP = -46;
const NIGHT: RGB = [16, 20, 36];

const SKIN = ['#8d5524', '#a0673a', '#c68642', '#e0ac69', '#6b4226', '#b97a50'].map(hex);
const HAIR = ['#1b1410', '#2b1d14', '#3a2a1e', '#4a3426', '#151515', '#8a8580'].map(hex);
const SHIRT = ['#d9534f', '#f0ad4e', '#5bc0de', '#5cb85c', '#8e6bb8', '#e8e1d0', '#2f4858', '#c0607e', '#3f7cac', '#e07a5f'].map(hex);
const PHONES = ['#e94f37', '#2e86ab', '#f6c90e', '#f4f4f4', '#222222', '#8e44ad', '#16a085', '#ff7eb6'].map(hex);
const CAPS = ['#c0392b', '#1f4e79', '#2d6a4f', '#f2c14e', '#333333'].map(hex);
type HairStyle = 'short' | 'long' | 'bun' | 'cap' | 'balding';
const STYLES: HairStyle[] = ['short', 'short', 'long', 'bun', 'cap', 'balding'];

interface Look {
  skin: RGB;
  hair: RGB;
  shirt: RGB;
  phones: RGB;
  cap: RGB;
  style: HairStyle;
  phase: number;
  rate: number;
  width: number;
}

const lookCache = new Map<string, Look>();
function lookOf(seed: string): Look {
  let l = lookCache.get(seed);
  if (l) return l;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const r = mulberry32(h >>> 0);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const style = pick(STYLES);
  l = {
    skin: pick(SKIN),
    hair: style === 'balding' ? HAIR[5] : pick(HAIR.slice(0, 5)),
    shirt: pick(SHIRT),
    phones: pick(PHONES),
    cap: pick(CAPS),
    style,
    phase: r() * Math.PI * 2,
    rate: 0.38 + r() * 0.14, // slow nods, slightly different per person
    width: 0.92 + r() * 0.16,
  };
  lookCache.set(seed, l);
  return l;
}

type MonkeyPhase = 'enter' | 'sit' | 'exit';
interface Monkey {
  phase: MonkeyPhase;
  t: number;
  seat: number;
  from: number; // start x (local units)
  to: number; // exit x
  hasCone: boolean;
}

export class BenchScene {
  private seats: (SeatView | null)[] = [null, null, null, null];
  private youAt = -1;
  /** is my radio playing (my own head only nods when it is) */
  listening = true;
  private monkey: Monkey | null = null;
  private nextMonkey = 90 + Math.random() * 150;
  private coneSeat = -1;
  private coneBackAt = 0;
  private box = { x: 0, y: 0, w: 0, h: 0 };

  setSeats(seats: (SeatView | null)[], now: number) {
    const hadMe = this.seats.some((s) => s?.me);
    const hasMe = seats.some((s) => s?.me);
    if (hasMe && !hadMe) this.youAt = now;
    this.seats = seats;
  }

  /** Bring a monkey along soon (for demos: ?monkey). */
  summonMonkey(now: number) {
    this.nextMonkey = now + 2;
  }

  /** Was this screen point on the bench (or the people on it)? */
  hit(x: number, y: number) {
    const b = this.box;
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  }

  draw(ctx: CanvasRenderingContext2D, f: Frame, spot: BenchSpot, W: number, reduced: boolean) {
    const { u } = spot;
    const lit = (c: RGB, k = 0.72) => mix(mix(c, f.pal.sun, 0.1 * f.golden), NIGHT, f.night * k);

    this.updateMonkey(f, W, spot, reduced);
    this.box = { x: spot.x - 80 * u + f.px, y: spot.y - 92 * u + f.py, w: 160 * u, h: 92 * u };

    ctx.save();
    ctx.translate(spot.x, spot.y);
    ctx.scale(u, u);

    // shadow
    ctx.fillStyle = `rgba(10,12,20,${0.22 - f.night * 0.1})`;
    ctx.beginPath();
    ctx.ellipse(0, 1, 84, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // people behind the backrest (seen from behind, looking at the city)
    for (let i = 0; i < 4; i++) {
      const s = this.seats[i];
      if (s) this.drawPerson(ctx, f, SEAT_X[i], s, lit, reduced);
    }

    // bench: stone legs/uprights + wooden slats of the backrest (we see its back)
    const stone = css(mix(f.pal.stoneLight, f.pal.rockLight, 0.5));
    const wood = lit(hex('#8a5a3b'), 0.8);
    const woodDark = lit(hex('#6b442c'), 0.8);
    ctx.fillStyle = stone;
    for (const x of [-70, 66]) ctx.fillRect(x, BACK_TOP - 2, 6, -BACK_TOP + 2);
    ctx.fillRect(-76, -16, 152, 4); // seat edge peeking out
    for (const [y, h] of [
      [BACK_TOP, 7],
      [BACK_TOP + 10, 6],
      [BACK_TOP + 19, 6],
    ]) {
      ctx.fillStyle = css(wood);
      ctx.fillRect(-74, y, 148, h);
      ctx.fillStyle = css(woodDark);
      ctx.fillRect(-74, y + h - 1.4, 148, 1.4);
    }

    // peanut cone on the top rail at an empty seat
    if (this.coneSeat >= 0) this.drawCone(ctx, SEAT_X[this.coneSeat] + 8, BACK_TOP, lit);

    // the monkey is in front of everything
    if (this.monkey) this.drawMonkey(ctx, f, spot, lit);

    // "you" tag for a few seconds after sitting down
    const mi = this.seats.findIndex((s) => s?.me);
    const age = f.time - this.youAt;
    if (mi >= 0 && this.youAt >= 0 && age < 8) {
      const a = clamp(Math.min(age / 0.6, (8 - age) / 1.5));
      ctx.globalAlpha = a;
      ctx.font = '600 9px ui-rounded, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(20,24,40,0.55)';
      const tx = SEAT_X[mi];
      ctx.beginPath();
      ctx.roundRect(tx - 12, -103, 24, 12, 6);
      ctx.fill();
      ctx.fillStyle = '#fffaf0';
      ctx.fillText('you', tx, -94);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  private drawPerson(
    ctx: CanvasRenderingContext2D,
    f: Frame,
    x: number,
    s: SeatView,
    lit: (c: RGB, k?: number) => RGB,
    reduced: boolean,
  ) {
    const L = lookOf(s.seed);
    const nodding = !reduced && (!s.me || this.listening);
    // slow nod: a soft dip and lift, with a lazy side-to-side sway
    const w = Math.sin(f.time * Math.PI * 2 * L.rate + L.phase);
    const dip = nodding ? Math.pow(Math.max(0, w), 1.6) * 2.4 : 0;
    const tilt = nodding ? Math.sin(f.time * Math.PI * L.rate + L.phase) * 0.06 : 0;
    const bob = dip * 0.25;

    ctx.save();
    ctx.translate(x, bob);
    const sw = 13 * L.width;
    // torso + shoulders
    ctx.fillStyle = css(lit(L.shirt));
    ctx.beginPath();
    ctx.moveTo(-sw + 2, -20);
    ctx.lineTo(-sw, -50);
    ctx.quadraticCurveTo(-sw, -58, -sw + 7, -59);
    ctx.lineTo(sw - 7, -59);
    ctx.quadraticCurveTo(sw, -58, sw, -50);
    ctx.lineTo(sw - 2, -20);
    ctx.closePath();
    ctx.fill();
    // neck
    ctx.fillStyle = css(lit(L.skin));
    ctx.fillRect(-3, -64, 6, 6);

    // head pivots at the neck
    ctx.translate(0, -62);
    ctx.rotate(tilt);
    ctx.translate(0, dip - 9);
    const r = 8.5;
    const skin = css(lit(L.skin));
    const hair = css(lit(L.hair));
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hair;
    ctx.beginPath();
    switch (L.style) {
      case 'short':
        ctx.arc(0, -0.6, r + 0.4, Math.PI * 0.92, Math.PI * 2.08);
        ctx.quadraticCurveTo(0, r * 0.95, -r * 0.98, r * 0.15);
        break;
      case 'long':
        ctx.arc(0, -0.4, r + 0.8, Math.PI, Math.PI * 2);
        ctx.lineTo(r + 1.2, 12);
        ctx.quadraticCurveTo(0, 15, -r - 1.2, 12);
        break;
      case 'bun':
        ctx.arc(0, -0.5, r + 0.4, Math.PI * 0.9, Math.PI * 2.1);
        ctx.quadraticCurveTo(0, r * 0.9, -r, r * 0.25);
        ctx.moveTo(4, -r - 1);
        ctx.arc(0, -r - 1.5, 4, 0, Math.PI * 2);
        break;
      case 'cap':
        ctx.arc(0, 0, r + 0.3, Math.PI * 0.15, Math.PI * 0.85);
        break;
      case 'balding':
        // bald crown, hair wrapping round the sides and back
        ctx.arc(0, 0, r + 0.3, -Math.PI * 0.12, Math.PI * 1.12);
        ctx.arc(0, -1.5, r * 0.72, Math.PI * 1.12, -Math.PI * 0.12, true);
        ctx.closePath();
        break;
    }
    ctx.fill();
    if (L.style === 'cap') {
      ctx.fillStyle = css(lit(L.cap));
      ctx.beginPath();
      ctx.arc(0, -0.5, r + 0.7, Math.PI * 1.02, Math.PI * 1.98);
      ctx.lineTo(r + 0.7, 1.5);
      ctx.lineTo(-r - 0.7, 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = css(lit(mix(L.cap, [255, 255, 255], 0.35)));
      ctx.fillRect(-3, 0.5, 6, 1.6); // strap
    }

    // headphones: band over the top + ear cups
    const ph = lit(L.phones, 0.6);
    ctx.strokeStyle = css(ph);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0.5, r + 1.8, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.fillStyle = css(ph);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.roundRect(side * (r + 0.6) - 2.6, -2.2, 5.2, 8, 2.4);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (const side of [-1, 1]) ctx.fillRect(side * (r + 0.6) - (side > 0 ? 1.6 : 0), -1, 1.6, 5);
    ctx.restore();
  }

  private drawCone(ctx: CanvasRenderingContext2D, x: number, y: number, lit: (c: RGB, k?: number) => RGB) {
    ctx.fillStyle = css(lit(hex('#e8d7a8')));
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 8);
    ctx.lineTo(x + 4, y - 8);
    ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = css(lit(hex('#b07a45')));
    for (const [dx, dy] of [
      [-2, -9],
      [0.5, -10],
      [2.5, -9],
    ]) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private updateMonkey(f: Frame, W: number, spot: BenchSpot, reduced: boolean) {
    const empty = this.seats.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
    // the cone sits by an empty seat; it comes back a while after a monkey took it
    if (this.coneSeat >= 0 && this.seats[this.coneSeat]) this.coneSeat = -1;
    if (this.coneSeat < 0 && !this.monkey && f.time > this.coneBackAt && empty.length) {
      this.coneSeat = empty[empty.length - 1];
    }
    if (reduced) return;

    const m = this.monkey;
    if (!m) {
      if (f.time > this.nextMonkey && this.coneSeat >= 0) {
        const fromRight = Math.random() < 0.5;
        const off = (fromRight ? 1 : -1) * (W / spot.u + 40); // start well off-screen
        this.monkey = { phase: 'enter', t: 0, seat: this.coneSeat, from: off, to: -off, hasCone: false };
        console.info('%c🐒 a monkey is coming for the peanuts', 'color:#b07a45;font-weight:bold');
      }
      return;
    }
    m.t += f.dt;
    if (m.phase === 'enter' && m.t > 3.2) {
      m.phase = 'sit';
      m.t = 0;
    } else if (m.phase === 'sit') {
      if (!m.hasCone && m.t > 1.6) {
        m.hasCone = true;
        this.coneSeat = -1;
      }
      if (m.t > 3.2) {
        m.phase = 'exit';
        m.t = 0;
      }
    } else if (m.phase === 'exit' && m.t > 3.2) {
      this.monkey = null;
      this.coneBackAt = f.time + 40;
      this.nextMonkey = f.time + 120 + Math.random() * 180;
    }
    // someone sat where the monkey was heading: it gives up and leaves
    if (this.monkey && this.monkey.phase !== 'exit' && this.seats[this.monkey.seat]) {
      this.monkey.phase = 'exit';
      this.monkey.t = 0;
    }
  }

  private drawMonkey(ctx: CanvasRenderingContext2D, f: Frame, spot: BenchSpot, lit: (c: RGB, k?: number) => RGB) {
    const m = this.monkey!;
    const seatX = SEAT_X[m.seat] + 8;
    let x: number;
    let y: number;
    let dir: number;
    const hop = (t: number, n: number, hgt: number) => -Math.abs(Math.sin(t * Math.PI * n)) * hgt;
    if (m.phase === 'enter') {
      const k = clamp(m.t / 3.2);
      const e = 1 - (1 - k) * (1 - k);
      x = m.from + (seatX - m.from) * e;
      // along the ground, then a last jump up onto the backrest rail
      const up = clamp((k - 0.8) / 0.2);
      y = hop(m.t, 3, 8) * (1 - up) + BACK_TOP * up * up;
      dir = Math.sign(seatX - m.from) || 1;
    } else if (m.phase === 'sit') {
      x = seatX;
      y = BACK_TOP;
      // looks around, then turns for the peanuts
      dir = m.t < 0.8 ? Math.sign(-m.from) || 1 : m.t < 1.4 ? -(Math.sign(-m.from) || 1) : 1;
    } else {
      const k = clamp(m.t / 3.2);
      const down = clamp(k / 0.15);
      x = seatX + (m.to - seatX) * (k * k);
      y = BACK_TOP * (1 - down) + hop(m.t, 3.5, 9) * down;
      dir = Math.sign(m.to - seatX) || 1;
    }
    void spot;
    const fur = css(lit(hex('#8b7766')));
    const furDark = css(lit(hex('#6e5d50')));
    const face = css(lit(hex('#d9a38c')));
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    // tail
    ctx.strokeStyle = furDark;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-7, -6);
    ctx.quadraticCurveTo(-18, -4 + Math.sin(f.time * 4) * 2, -16, -20);
    ctx.stroke();
    // legs
    ctx.strokeStyle = fur;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-4, -5);
    ctx.lineTo(-5, 0);
    ctx.moveTo(4, -5);
    ctx.lineTo(5, 0);
    ctx.stroke();
    // body + head
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(0, -10, 8.5, 6.5, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(7.5, -18, 5.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = furDark;
    ctx.beginPath();
    ctx.arc(4.5, -21, 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.ellipse(10, -17.5, 3.1, 3.6, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,16,14,0.85)';
    ctx.beginPath();
    ctx.arc(10.8, -18.6, 0.75, 0, Math.PI * 2);
    ctx.fill();
    // the stolen peanuts
    if (m.hasCone) this.drawCone(ctx, 11, -8, lit);
    ctx.restore();
  }
}
