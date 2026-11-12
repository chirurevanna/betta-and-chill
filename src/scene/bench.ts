import type { SeatView } from '../park/benches';
import { clamp, css, hex, mix, mulberry32, smoothstep, type RGB } from '../util';
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
const HAIR = ['#1b1410', '#2b1d14', '#3a2a1e', '#151515', '#4a2c22', '#6d3b2a'].map(hex);
// muted, current hoodie colours
const HOODIE = ['#9caf88', '#b8a9d9', '#e0b44a', '#ece4d4', '#3c3f48', '#d2775a', '#3d5a80', '#e8a0a8', '#5f8f8b', '#c85a54'].map(hex);
const PHONES = ['#e94f37', '#2e86ab', '#f6c90e', '#f4f4f4', '#222222', '#8e44ad', '#16a085', '#ff7eb6'].map(hex);
const CAPS = ['#c0392b', '#1f4e79', '#2d6a4f', '#f2c14e', '#222222', '#f4f1ea'].map(hex);
type HairStyle = 'messy' | 'curly' | 'topknot' | 'buzz' | 'long' | 'capBack';
const STYLES: HairStyle[] = ['messy', 'messy', 'curly', 'topknot', 'buzz', 'long', 'long', 'capBack'];
const INK: RGB = hex('#241c2c');
const RIM: RGB = hex('#8f86c9');

interface Look {
  skin: RGB;
  hair: RGB;
  hoodie: RGB;
  phones: RGB;
  cap: RGB;
  style: HairStyle;
  hoodUp: boolean;
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
    hair: pick(HAIR),
    hoodie: pick(HOODIE),
    phones: pick(PHONES),
    cap: pick(CAPS),
    style,
    hoodUp: style !== 'capBack' && r() < 0.25,
    phase: r() * Math.PI * 2,
    rate: 0.38 + r() * 0.14, // slow nods, slightly different per person
    width: 0.94 + r() * 0.14,
  };
  lookCache.set(seed, l);
  return l;
}

/** One piece of a character: filled and/or stroked, outlined as part of its group. */
interface Shape {
  p: Path2D;
  fill?: string;
  line?: { color: string; w: number };
}

/**
 * Stroke-then-fill: every shape is first stroked thick in ink, then all are filled on top,
 * so a group gets one clean outline around its silhouette instead of lines at every overlap.
 */
function inked(ctx: CanvasRenderingContext2D, shapes: Shape[], ink: string, ow: number) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = ink;
  for (const s of shapes) {
    ctx.lineWidth = (s.line ? s.line.w : 0) + ow * 2;
    ctx.stroke(s.p);
  }
  for (const s of shapes) {
    if (s.fill) {
      ctx.fillStyle = s.fill;
      ctx.fill(s.p);
    }
    if (s.line) {
      ctx.strokeStyle = s.line.color;
      ctx.lineWidth = s.line.w;
      ctx.stroke(s.p);
    }
  }
}

const circle = (x: number, y: number, r: number, p = new Path2D()) => {
  p.moveTo(x + r, y);
  p.arc(x, y, r, 0, Math.PI * 2);
  return p;
};

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
  private ink = '';

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
    // outlines: dark plum ink by day; after dusk they turn into a soft lavender rim light,
    // because a dark line on a dark scene separates nothing
    this.ink = css(mix(INK, RIM, smoothstep(0.45, 0.95, f.night)), 0.92);

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

    // bench: stone uprights + seat edge + wooden slats of the backrest (we see its back)
    const stone = css(mix(f.pal.stoneLight, f.pal.rockLight, 0.5));
    const wood = css(lit(hex('#8a5a3b'), 0.8));
    const rect = (x: number, y: number, w: number, h: number, r = 1.2) => {
      const p = new Path2D();
      p.roundRect(x, y, w, h, r);
      return p;
    };
    const bench: Shape[] = [
      { p: rect(-70, BACK_TOP - 2, 6, -BACK_TOP + 2, 1), fill: stone },
      { p: rect(64, BACK_TOP - 2, 6, -BACK_TOP + 2, 1), fill: stone },
      { p: rect(-76, -16, 152, 4, 1), fill: stone },
    ];
    for (const [y, h] of [
      [BACK_TOP, 7],
      [BACK_TOP + 10, 6],
      [BACK_TOP + 19, 6],
    ]) bench.push({ p: rect(-74, y, 148, h), fill: wood });
    inked(ctx, bench, this.ink, 0.75);
    // wood grain, very faint
    ctx.strokeStyle = css(lit(hex('#6b442c'), 0.8), 0.6);
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (const [y, x0, x1] of [
      [BACK_TOP + 3.5, -60, -20],
      [BACK_TOP + 3, 10, 50],
      [BACK_TOP + 13, -40, 0],
      [BACK_TOP + 22, 20, 62],
    ]) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();

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
    const ink = this.ink;
    const hoodie = css(lit(L.hoodie));
    const hoodieShade = css(lit(mix(L.hoodie, INK, 0.22)));
    const skin = css(lit(L.skin));
    const hair = css(lit(L.hair));
    const ph = css(lit(L.phones, 0.6));

    ctx.save();
    ctx.translate(x, bob);

    // hoodie body: roomy, rounded shoulders; the bench back hides the lower half
    const sw = 14 * L.width;
    const torso = new Path2D();
    torso.moveTo(-sw + 1, -18);
    torso.bezierCurveTo(-sw - 1.5, -32, -sw - 1, -48, -sw + 1, -53);
    torso.quadraticCurveTo(-sw + 3, -59, -7, -60);
    torso.lineTo(7, -60);
    torso.quadraticCurveTo(sw - 3, -59, sw - 1, -53);
    torso.bezierCurveTo(sw + 1, -48, sw + 1.5, -32, sw - 1, -18);
    torso.closePath();
    const body: Shape[] = [{ p: torso, fill: hoodie }];
    if (!L.hoodUp) {
      // the hood, bunched at the back of the neck
      const hood = new Path2D();
      hood.moveTo(-9, -60);
      hood.bezierCurveTo(-10.5, -66, -5, -69, 0, -68.5);
      hood.bezierCurveTo(5, -69, 10.5, -66, 9, -60);
      hood.bezierCurveTo(6, -52.5, -6, -52.5, -9, -60);
      hood.closePath();
      body.push({ p: hood, fill: hoodieShade });
    }
    inked(ctx, body, ink, 0.75);
    // a couple of soft fold lines on the back
    ctx.strokeStyle = css(lit(mix(L.hoodie, INK, 0.35)), 0.7);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-sw + 4, -46);
    ctx.quadraticCurveTo(-sw + 6, -36, -sw + 5, -27);
    ctx.moveTo(sw - 4, -46);
    ctx.quadraticCurveTo(sw - 6, -36, sw - 5, -27);
    if (!L.hoodUp) {
      ctx.moveTo(-5, -58.5);
      ctx.quadraticCurveTo(0, -55.5, 5, -58.5);
    }
    ctx.stroke();

    // head pivots at the neck
    ctx.translate(0, -62);
    ctx.rotate(tilt);
    ctx.translate(0, dip - 8.5);
    const r = 8.3;
    const head: Shape[] = [];
    if (L.hoodUp) {
      // hood up: it wraps the whole head and runs down into the body
      const hood = new Path2D();
      hood.moveTo(-r - 3, 8);
      hood.bezierCurveTo(-r - 3.6, -2, -r - 2.4, -r - 2.8, 0, -r - 3.4);
      hood.bezierCurveTo(r + 2.4, -r - 2.8, r + 3.6, -2, r + 3, 8);
      hood.quadraticCurveTo(0, 11, -r - 3, 8);
      hood.closePath();
      head.push({ p: hood, fill: hoodie });
    } else {
      head.push({ p: circle(0, 0, r), fill: skin });
      const h = new Path2D();
      switch (L.style) {
        case 'messy': {
          h.arc(0, -0.5, r + 0.5, Math.PI * 0.9, Math.PI * 2.1);
          h.quadraticCurveTo(0, r * 0.95, -r * 1.0, r * 0.25);
          // tufts sticking up
          for (const [tx, ty, tr] of [
            [-5, -7.5, 2.6],
            [-1.5, -9.2, 2.8],
            [2.5, -9, 2.6],
            [5.8, -6.8, 2.3],
          ]) circle(tx, ty, tr, h);
          break;
        }
        case 'curly':
          for (let i = 0; i < 11; i++) {
            const a = Math.PI * (0.85 + (i / 10) * 1.3);
            circle(Math.cos(a) * (r - 0.4), Math.sin(a) * (r - 0.4) - 0.6, 3.1, h);
          }
          circle(0, -1.2, r - 0.6, h);
          break;
        case 'topknot':
          h.arc(0, -0.4, r + 0.4, Math.PI * 0.9, Math.PI * 2.1);
          h.quadraticCurveTo(0, r * 0.9, -r, r * 0.25);
          circle(0, -r - 2.4, 3.6, h);
          break;
        case 'buzz':
          h.arc(0, -0.2, r + 0.2, Math.PI * 0.95, Math.PI * 2.05);
          h.quadraticCurveTo(0, r * 1.02, -r, r * 0.2);
          break;
        case 'long':
          h.arc(0, -0.4, r + 0.9, Math.PI, Math.PI * 2);
          h.lineTo(r + 1.4, 13);
          h.quadraticCurveTo(0, 16, -r - 1.4, 13);
          h.closePath();
          break;
        case 'capBack':
          h.arc(0, 0, r + 0.3, Math.PI * 0.1, Math.PI * 0.9);
          h.closePath();
          break;
      }
      head.push({ p: h, fill: L.style === 'buzz' ? css(lit(mix(L.hair, L.skin, 0.3))) : hair });
      if (L.style === 'capBack') {
        // backwards cap: dome on top, the brim pointing back at us
        const cap = new Path2D();
        cap.arc(0, -0.6, r + 0.8, Math.PI * 1.02, Math.PI * 1.98);
        cap.lineTo(r + 0.8, 1);
        cap.lineTo(-r - 0.8, 1);
        cap.closePath();
        const brim = new Path2D();
        brim.ellipse(0, 1.6, 6.5, 2.2, 0, 0, Math.PI * 2);
        const c = css(lit(L.cap));
        head.push({ p: cap, fill: c }, { p: brim, fill: css(lit(mix(L.cap, INK, 0.2))) });
      }
    }
    // headphones over hair or hood
    const out = L.hoodUp ? 3.4 : 1.8;
    const band = new Path2D();
    band.arc(0, 0.5, r + out, Math.PI * 1.1, Math.PI * 1.9);
    head.push({ p: band, line: { color: ph, w: 2.2 } });
    for (const side of [-1, 1]) {
      const cup = new Path2D();
      cup.roundRect(side * (r + out - 1.2) - 2.7, -2.4, 5.4, 8.2, 2.5);
      head.push({ p: cup, fill: ph });
    }
    inked(ctx, head, ink, 0.75);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (const side of [-1, 1]) ctx.fillRect(side * (r + out - 1.2) - (side > 0 ? 1.5 : 0.1), -1, 1.4, 4.6);
    ctx.restore();
  }

  private drawCone(ctx: CanvasRenderingContext2D, x: number, y: number, lit: (c: RGB, k?: number) => RGB) {
    const cone = new Path2D();
    cone.moveTo(x - 4, y - 8);
    cone.lineTo(x + 4, y - 8);
    cone.lineTo(x, y);
    cone.closePath();
    const nuts = new Path2D();
    for (const [dx, dy] of [
      [-2, -9],
      [0.5, -10],
      [2.5, -9],
    ]) circle(x + dx, y + dy, 1.4, nuts);
    inked(
      ctx,
      [
        { p: nuts, fill: css(lit(hex('#b07a45'))) },
        { p: cone, fill: css(lit(hex('#e8d7a8'))) },
      ],
      this.ink,
      0.55,
    );
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
    const tail = new Path2D();
    tail.moveTo(-7, -6);
    tail.quadraticCurveTo(-18, -4 + Math.sin(f.time * 4) * 2, -16, -20);
    const legs = new Path2D();
    legs.moveTo(-4, -5);
    legs.lineTo(-5, 0);
    legs.moveTo(4, -5);
    legs.lineTo(5, 0);
    const torso = new Path2D();
    torso.ellipse(0, -10, 8.5, 6.5, -0.15, 0, Math.PI * 2);
    inked(
      ctx,
      [
        { p: tail, line: { color: furDark, w: 2 } },
        { p: legs, line: { color: fur, w: 2.6 } },
        { p: torso, fill: fur },
        { p: circle(7.5, -18, 5.4), fill: fur },
        { p: circle(4.5, -21, 1.9), fill: furDark },
      ],
      this.ink,
      0.7,
    );
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

/**
 * Other benches further down the hillside: tiny silhouettes on the forest edge, each with a
 * lamp that glows warm after dusk. They hint that the hill is full of people listening.
 */
export function drawFarBenches(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  W: number,
  top: number,
  s: number,
  avoidX: number,
) {
  const spots = [0.36, 0.63, 0.86];
  const glow = 0.08 + 0.85 * smoothstep(0.35, 0.9, f.night);
  for (let i = 0; i < spots.length; i++) {
    const x = spots[i] * W;
    if (Math.abs(x - avoidX) < 140 * s) continue;
    const y = top + (7 + i * 2) * s;
    const k = s * (0.55 - i * 0.04);
    const breathe = 0.85 + 0.15 * Math.sin(f.time * 0.6 + i * 2.1);
    // lamp glow
    if (glow > 0.02) {
      const r = 58 * k;
      const g = ctx.createRadialGradient(x + 22 * k, y - 30 * k, 0, x + 22 * k, y - 30 * k, r);
      g.addColorStop(0, `rgba(255,190,120,${0.7 * glow * breathe})`);
      g.addColorStop(1, 'rgba(255,190,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + 22 * k - r, y - 30 * k - r, r * 2, r * 2);
    }
    // bench + lamp post silhouette
    ctx.fillStyle = css(mix(f.pal.forest, INK, 0.45));
    ctx.fillRect(x - 16 * k, y - 9 * k, 32 * k, 2.4 * k); // backrest
    ctx.fillRect(x - 16 * k, y - 4.5 * k, 32 * k, 2 * k); // seat
    ctx.fillRect(x - 14 * k, y - 9 * k, 1.8 * k, 9 * k);
    ctx.fillRect(x + 12 * k, y - 9 * k, 1.8 * k, 9 * k);
    ctx.fillRect(x + 21.5 * k, y - 30 * k, 1.4 * k, 30 * k); // post
    ctx.fillStyle = css(mix(hex('#ffd59a'), f.pal.forest, 1 - glow));
    ctx.beginPath();
    ctx.arc(x + 22.2 * k, y - 30.5 * k, 2.2 * k, 0, Math.PI * 2);
    ctx.fill();
  }
}

