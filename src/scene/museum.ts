/**
 * The Museum: one quiet gallery room with a single real painting on the back wall.
 *
 * The room is drawn in a simple one-point perspective (eye level at `vy`, the back wall facing us):
 * aubergine walls, a pale cornice, a skylight in the ceiling, pale skirting and a herringbone oak
 * floor. Walls, floor and the framed painting are drawn once per size into offscreen canvases;
 * each frame only adds the skylight (which follows the time of day), the night dimming and the
 * picture light.
 *
 * Paintings are public domain works by Raja Ravi Varma (1848–1906), served from /public/paintings
 * (downscaled from Wikimedia Commons).
 */
import { css, hex, mix, mulberry32, type RGB } from '../util';
import type { Frame } from './types';

export interface Painting {
  id: string;
  title: string;
  artist: string;
  src: string;
  /** original pixel size (only the aspect ratio matters) */
  w: number;
  h: number;
}

const RRV = 'Raja Ravi Varma';
/** The Museum's paintings, in the order a tap on the painting's right half steps through them. */
export const PAINTINGS: readonly Painting[] = [
  { id: 'woman-fruit', title: 'Woman Holding a Fruit', artist: RRV, src: '/paintings/ravi-varma-woman-holding-a-fruit.jpg', w: 775, h: 1000 },
  { id: 'swarbat', title: 'Lady Playing the Swarbat', artist: RRV, src: '/paintings/ravi-varma-lady-playing-the-swarbat.jpg', w: 879, h: 1100 },
  { id: 'papa', title: 'There Comes Papa', artist: RRV, src: '/paintings/ravi-varma-there-comes-papa.jpg', w: 721, h: 1100 },
  { id: 'damayanti', title: 'Damayanti and the Swan', artist: RRV, src: '/paintings/ravi-varma-damayanti-and-the-swan.jpg', w: 633, h: 1100 },
  { id: 'moonlight', title: 'Ladies in the Moonlight', artist: RRV, src: '/paintings/ravi-varma-ladies-in-the-moonlight.jpg', w: 828, h: 1100 },
  { id: 'malabar', title: 'Malabar Beauty', artist: RRV, src: '/paintings/ravi-varma-malabar-beauty.jpg', w: 789, h: 1100 },
  { id: 'shakuntala', title: 'Shakuntala', artist: RRV, src: '/paintings/ravi-varma-shakuntala.jpg', w: 822, h: 1100 },
];

/** The painting on the wall: Woman Holding a Fruit to start (?painting=<id> opens on another). */
let current = Math.max(0, PAINTINGS.findIndex((p) => p.id === new URLSearchParams(location.search).get('painting')));
export const currentPainting = (): Painting => PAINTINGS[current];

/** Scale of people and props for a W×H screen (the same formula the layout uses). */
export const sceneScale = (W: number, H: number) => Math.max(Math.min(W / 1200, H / 750), Math.min(W / 700, H / 900));
/** Top edge of the player bar: on phones the listeners have to stand above it. */
let bottomClear = Infinity;
export function setBottomClear(px: number) {
  bottomClear = px > 0 ? px : Infinity;
}
/** How far the ground has to rise so that a bench at `groundY` stands clear of the player bar. */
export const groundLift = (groundY: number) => Math.max(0, groundY - (bottomClear - 8));
/** Where the Museum's bench stands: just above the player bar. */
export const museumBenchY = (W: number, H: number) => {
  const y = H - Math.max(H * 0.13, 110 * sceneScale(W, H), 100);
  return y - groundLift(y);
};
/** Room the frame keeps free under itself for its two-line label. */
export const LABEL_SPACE = 54;

/** How far down the screen the top buttons reach (the painting and its light stay below them). */
let topClear = 0;
export function setMuseumTopClear(px: number) {
  topClear = px;
}

/** room half-width and back-wall distance, in metres */
const R = 5;
const DBACK = 10;
/** how far the room may drift with the pointer (as a share of the outdoor parallax) */
export const MUSEUM_DRIFT = 0.3;
const PAD = 24;

export interface MuseumGeometry {
  vy: number;
  /** back wall: top, floor line, half width */
  yT: number;
  yF: number;
  half: number;
  /** focal length and eye/ceiling heights (world units → px at distance 1) */
  F: number;
  E: number;
  C: number;
  dNear: number;
  /** lowest point of the skylight on screen (birds fly above it) */
  skyBottom: number;
  /** the painting's picture area */
  art: { x: number; y: number; w: number; h: number; ft: number };
}

export function museumGeometry(W: number, H: number, p: Painting = currentPainting()): MuseumGeometry {
  const wide = W > H;
  const vy = H * 0.44;
  const yT = H * (wide ? 0.15 : 0.17);
  const half = W * (wide ? 0.34 : 0.44);
  const aspect = p.w / p.h;
  if (!wide) return tallGeometry(W, H, vy, yT, half, aspect);
  const yF = H * 0.69;
  const F = (half * DBACK) / R;
  const E = ((yF - vy) * DBACK) / F;
  const C = ((vy - yT) * DBACK) / F;
  const dNear = ((E * F) / (H - vy)) * 0.85;
  const skyBottom = vy - (C * F) / (DBACK - 1.4);
  const wall = yF - yT;
  let ph = wall * 0.6;
  ph = Math.min(ph, (half * 2 * 0.64) / aspect);
  const pw = ph * aspect;
  const cy = yT + wall * 0.46;
  const ft = Math.max(7, ph * 0.075);
  return { vy, yT, yF, half, F, E, C, dNear, skyBottom, art: { x: W / 2 - pw / 2, y: cy - ph / 2, w: pw, h: ph, ft } };
}

/**
 * Phones: the painting starts just below the top buttons (with room for its picture light), is
 * about 60 % of the screen wide, and the floor line moves down to sit under its label.
 */
function tallGeometry(W: number, H: number, vy: number, yT: number, half: number, aspect: number): MuseumGeometry {
  const LABEL = LABEL_SPACE;
  const top = Math.max(yT + H * 0.04, topClear + 30); // top of the frame
  // frame + label end above the floor line, and leave the listeners room above the player bar
  const listener = 105 * Math.max(0.75, sceneScale(W, H) * 2);
  const room = Math.min(H * 0.76, museumBenchY(W, H) - listener) - LABEL - top;
  let ph = Math.min((W * 0.6) / aspect, room / 1.15);
  ph = Math.min(ph, (half * 2 * 0.86) / aspect);
  const pw = ph * aspect;
  const ft = Math.max(7, ph * 0.075);
  const y = top + ft;
  const yF = Math.max(H * 0.66, y + ph + ft + LABEL);
  const F = (half * DBACK) / R;
  const E = ((yF - vy) * DBACK) / F;
  const C = ((vy - yT) * DBACK) / F;
  const dNear = ((E * F) / (H - vy)) * 0.85;
  const skyBottom = vy - (C * F) / (DBACK - 1.4);
  return { vy, yT, yF, half, F, E, C, dNear, skyBottom, art: { x: W / 2 - pw / 2, y, w: pw, h: ph, ft } };
}

const WALL = hex('#3c2e39');
const SIDE = hex('#2c222b');
const CEIL = hex('#e4e0da');
const SKIRT = hex('#cdc8c1');
// close oak tones and faint seams: the floor should sit back, not compete with the painting
const OAK: RGB[] = [hex('#8f6644'), hex('#8a6141'), hex('#946a47'), hex('#86603f')];
const SEAM = 'rgba(70,44,26,0.28)';
const SKY_DAY = hex('#f6f7f9');
const SKY_NIGHT = hex('#1f2742');
const NIGHT_INK: RGB = [12, 9, 22];

export class Museum {
  private room: HTMLCanvasElement | null = null;
  private artLayer: HTMLCanvasElement | null = null;
  private imgs = new Map<string, HTMLImageElement>();
  private W = 0;
  private H = 0;
  private dpr = 1;
  g!: MuseumGeometry;
  private skylight = new Path2D();
  private mullions = new Path2D();
  get painting() {
    return currentPainting();
  }

  /** Fetch the painting on the wall, and quietly its neighbours so a tap shows them at once. */
  load() {
    const n = PAINTINGS.length;
    for (const k of [0, 1, -1]) this.image(PAINTINGS[(current + k + n) % n]);
  }

  private image(p: Painting) {
    let img = this.imgs.get(p.id);
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (p === this.painting) this.artLayer = null; // redraw with the picture in it
      };
      img.src = p.src;
      this.imgs.set(p.id, img);
    }
    return img;
  }

  /** Hang the previous (-1) or next (+1) painting; the room re-fits its size. */
  step(dir: number) {
    const n = PAINTINGS.length;
    current = (current + dir + n) % n;
    this.resize(this.W, this.H, this.dpr);
    this.load();
  }

  /** Which half of the framed painting a screen point is on: -1 left, 1 right, 0 not on it. */
  side(px: number, py: number) {
    const { x, y, w, h, ft } = this.g.art;
    if (px < x - ft || px > x + w + ft || py < y - ft || py > y + h + ft) return 0;
    return px < x + w / 2 ? -1 : 1;
  }

  resize(W: number, H: number, dpr: number) {
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.g = museumGeometry(W, H, this.painting);
    this.room = null;
    this.artLayer = null;
    this.buildSkylight();
  }

  /** floor point → screen */
  private floor(X: number, D: number): [number, number] {
    const { F, E, vy } = this.g;
    return [this.W / 2 + (X * F) / D, vy + (E * F) / D];
  }
  /** wall/ceiling point at height Y above the eye → screen */
  private at(X: number, Y: number, D: number): [number, number] {
    const { F, vy } = this.g;
    return [this.W / 2 + (X * F) / D, vy - (Y * F) / D];
  }

  private buildSkylight() {
    const { C, dNear } = this.g;
    const xIn = R - 1.1;
    const d0 = Math.max(0.6, dNear * 0.6);
    const d1 = DBACK - 1.4;
    const quad = (pts: [number, number][]) => {
      const p = new Path2D();
      p.moveTo(...pts[0]);
      for (const q of pts.slice(1)) p.lineTo(...q);
      p.closePath();
      return p;
    };
    this.skylight = quad([this.at(-xIn, C, d0), this.at(xIn, C, d0), this.at(xIn, C, d1), this.at(-xIn, C, d1)]);
    // glazing bars: only a few, running away from us (cross bars read as office ceiling tiles)
    const m = new Path2D();
    for (let i = 1; i < 4; i++) {
      const X = -xIn + (2 * xIn * i) / 4;
      m.moveTo(...this.at(X, C, d0));
      m.lineTo(...this.at(X, C, d1));
    }
    this.mullions = m;
  }

  private canvas() {
    const c = document.createElement('canvas');
    c.width = Math.round((this.W + PAD * 2) * this.dpr);
    c.height = Math.round((this.H + PAD * 2) * this.dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, PAD * this.dpr, PAD * this.dpr);
    return { c, ctx };
  }

  private poly(ctx: CanvasRenderingContext2D, pts: [number, number][], fill: string | CanvasGradient) {
    ctx.beginPath();
    ctx.moveTo(...pts[0]);
    for (const q of pts.slice(1)) ctx.lineTo(...q);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  /** Walls, ceiling, skirting and the herringbone floor (daylight colours). */
  private drawRoom() {
    const { c, ctx } = this.canvas();
    const { W, H } = this;
    const { C, E, dNear, yT, yF } = this.g;
    const dn = dNear * 0.5;
    const x0 = W / 2 - this.g.half;
    const x1 = W / 2 + this.g.half;

    // ceiling (behind everything)
    ctx.fillStyle = css(CEIL);
    ctx.fillRect(-PAD, -PAD, W + PAD * 2, yT + PAD);

    // side walls
    for (const sx of [-1, 1]) {
      const pts: [number, number][] = [this.at(sx * R, C, DBACK), this.at(sx * R, C, dn), this.at(sx * R, -E, dn), this.at(sx * R, -E, DBACK)];
      const [nx] = this.at(sx * R, 0, dn);
      const g = ctx.createLinearGradient(sx < 0 ? x0 : x1, 0, nx, 0);
      g.addColorStop(0, css(mix(SIDE, WALL, 0.35)));
      g.addColorStop(1, css(mix(SIDE, NIGHT_INK, 0.25)));
      this.poly(ctx, pts, g);
    }

    // back wall, a touch lighter towards the top where the skylight reaches
    const bw = ctx.createLinearGradient(0, yT, 0, yF);
    bw.addColorStop(0, css(mix(WALL, CEIL, 0.06)));
    bw.addColorStop(1, css(mix(WALL, NIGHT_INK, 0.12)));
    ctx.fillStyle = bw;
    ctx.fillRect(x0, yT, x1 - x0, yF - yT);

    // floor: chevron-laid oak planks in perspective, clipped to the floor
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(...this.floor(-R, DBACK));
    ctx.lineTo(...this.floor(R, DBACK));
    ctx.lineTo(...this.floor(R, dn));
    ctx.lineTo(...this.floor(-R, dn));
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = css(OAK[0]);
    ctx.fillRect(-PAD, yF - 2, W + PAD * 2, H - yF + PAD + 2);
    const rnd = mulberry32(77);
    const cw = 0.42;
    const ph = 0.15;
    ctx.strokeStyle = SEAM;
    ctx.lineWidth = 0.6;
    for (let col = 0, X = -R - cw; X < R + cw; col++, X += cw) {
      const dir = col % 2 === 0 ? 1 : -1;
      const off = col % 2 === 0 ? 0 : ph / 2;
      for (let d = dn - cw - ph + off; d < DBACK + ph; d += ph) {
        const a = d;
        const b = d + dir * cw;
        if (Math.max(a, b) + ph < dn || Math.min(a, b) <= 0.05) continue;
        const pts: [number, number][] = [this.floor(X, a), this.floor(X + cw, b), this.floor(X + cw, b + ph), this.floor(X, a + ph)];
        this.poly(ctx, pts, css(OAK[(rnd() * OAK.length) | 0]));
        ctx.stroke();
      }
    }
    // depth: the far floor sits in the wall's shade; a soft sheen where the skylight falls
    const fd = ctx.createLinearGradient(0, yF, 0, H);
    fd.addColorStop(0, 'rgba(36,20,14,0.38)');
    fd.addColorStop(0.3, 'rgba(36,20,14,0.12)');
    fd.addColorStop(1, 'rgba(26,14,12,0.5)');
    ctx.fillStyle = fd;
    ctx.fillRect(-PAD, yF, W + PAD * 2, H - yF + PAD);
    ctx.save();
    ctx.translate(W / 2, yF + (H - yF) * 0.42);
    ctx.scale(1, 0.32);
    const sheen = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.45);
    sheen.addColorStop(0, 'rgba(255,236,205,0.14)');
    sheen.addColorStop(1, 'rgba(255,240,215,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(-W, -W, W * 2, W * 2);
    ctx.restore();
    ctx.restore();

    // skirting along all three walls
    const sk = 0.2;
    const skirt = css(SKIRT);
    ctx.fillStyle = skirt;
    const [, skTop] = this.at(0, -E + sk, DBACK);
    ctx.fillRect(x0, skTop, x1 - x0, yF - skTop);
    for (const sx of [-1, 1]) {
      this.poly(ctx, [this.at(sx * R, -E + sk, DBACK), this.at(sx * R, -E + sk, dn), this.at(sx * R, -E, dn), this.at(sx * R, -E, DBACK)], css(mix(SKIRT, SIDE, 0.3)));
    }

    // cornice: a pale moulding where the walls meet the ceiling
    const co = 0.32;
    const [, coB] = this.at(0, C - co, DBACK);
    ctx.fillStyle = css(mix(CEIL, WALL, 0.08));
    ctx.fillRect(x0, yT, x1 - x0, coB - yT);
    for (const sx of [-1, 1]) {
      this.poly(ctx, [this.at(sx * R, C, DBACK), this.at(sx * R, C, dn), this.at(sx * R, C - co, dn), this.at(sx * R, C - co, DBACK)], css(mix(CEIL, SIDE, 0.25)));
    }
    ctx.strokeStyle = 'rgba(60,44,52,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, coB);
    ctx.lineTo(x1, coB);
    ctx.moveTo(...this.at(-R, C - co, DBACK));
    ctx.lineTo(...this.at(-R, C - co, dn));
    ctx.moveTo(...this.at(R, C - co, DBACK));
    ctx.lineTo(...this.at(R, C - co, dn));
    ctx.stroke();

    // corners where the walls meet
    ctx.strokeStyle = 'rgba(14,8,16,0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x0, yT);
    ctx.lineTo(x0, yF);
    ctx.moveTo(x1, yT);
    ctx.lineTo(x1, yF);
    ctx.stroke();

    // a recessed frame in the ceiling around the skylight
    ctx.strokeStyle = css(mix(CEIL, WALL, 0.25));
    ctx.lineWidth = 3;
    ctx.stroke(this.skylight);
    this.room = c;
  }

  /** The framed painting, its picture light and the wall label. */
  private drawArt() {
    const { c, ctx } = this.canvas();
    const { x, y, w, h, ft } = this.g.art;

    // frame with a soft drop shadow on the wall
    ctx.save();
    ctx.shadowColor = 'rgba(8,4,10,0.55)';
    ctx.shadowBlur = ft * 1.6;
    ctx.shadowOffsetY = ft * 0.7;
    ctx.fillStyle = '#7a5418';
    ctx.fillRect(x - ft, y - ft, w + ft * 2, h + ft * 2);
    ctx.restore();

    const gold = ctx.createLinearGradient(x - ft, y - ft, x + w + ft, y + h + ft);
    gold.addColorStop(0, '#f3d98a');
    gold.addColorStop(0.3, '#c7953b');
    gold.addColorStop(0.55, '#ecc96f');
    gold.addColorStop(0.8, '#a8762a');
    gold.addColorStop(1, '#d8ae55');
    ctx.fillStyle = gold;
    ctx.fillRect(x - ft, y - ft, w + ft * 2, h + ft * 2);

    // carved bands: an outer bead, an ornament row, an inner dark lip
    const band = (inset: number, width: number, style: string) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.strokeRect(x - ft + inset, y - ft + inset, w + (ft - inset) * 2, h + (ft - inset) * 2);
    };
    band(0.5, 1, 'rgba(70,42,8,0.9)');
    band(ft * 0.16, ft * 0.12, 'rgba(255,236,170,0.75)');
    band(ft * 0.3, ft * 0.06, 'rgba(110,70,16,0.6)');
    band(ft * 0.82, ft * 0.1, 'rgba(255,236,170,0.55)');
    band(ft - ft * 0.06, ft * 0.12, 'rgba(70,42,8,0.85)');
    // ornament: a row of little raised leaves around the middle of the frame
    const r = ft * 0.13;
    const mid = ft * 0.56;
    const leaf = (cx: number, cy: number) => {
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    };
    ctx.beginPath();
    const step = ft * 0.48;
    for (let t = x - ft + mid; t <= x + w + ft - mid; t += step) {
      leaf(t, y - ft + mid);
      leaf(t, y + h + ft - mid);
    }
    for (let t = y - ft + mid + step; t <= y + h + ft - mid - step * 0.5; t += step) {
      leaf(x - ft + mid, t);
      leaf(x + w + ft - mid, t);
    }
    ctx.fillStyle = 'rgba(255,232,160,0.6)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(110,70,16,0.5)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    // corner cartouches
    for (const [cx, cy] of [
      [x - ft * 0.5, y - ft * 0.5],
      [x + w + ft * 0.5, y - ft * 0.5],
      [x - ft * 0.5, y + h + ft * 0.5],
      [x + w + ft * 0.5, y + h + ft * 0.5],
    ]) {
      const cg = ctx.createRadialGradient(cx - ft * 0.15, cy - ft * 0.15, 0, cx, cy, ft * 0.46);
      cg.addColorStop(0, '#fff1c2');
      cg.addColorStop(0.5, '#d9ab4c');
      cg.addColorStop(1, '#8a5e1c');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(cx, cy, ft * 0.46, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(70,42,8,0.7)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // the painting (a dark canvas until the image arrives)
    const img = this.image(this.painting);
    if (img.complete && img.naturalWidth > 0) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, x, y, w, h);
    } else {
      ctx.fillStyle = '#231a14';
      ctx.fillRect(x, y, w, h);
    }
    // a whisper of varnish sheen and the frame's inner shadow
    const vs = ctx.createLinearGradient(x, y, x + w, y + h);
    vs.addColorStop(0, 'rgba(255,250,235,0.06)');
    vs.addColorStop(0.5, 'rgba(255,250,235,0)');
    ctx.fillStyle = vs;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(20,10,4,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    // brass picture light above the frame
    const lw = w * 0.42;
    const ly = y - ft - Math.max(10, h * 0.07);
    ctx.strokeStyle = '#6e5630';
    ctx.lineWidth = Math.max(1.5, ft * 0.16);
    ctx.beginPath();
    ctx.moveTo(this.W / 2, y - ft);
    ctx.lineTo(this.W / 2, ly + 2);
    ctx.stroke();
    const lamp = ctx.createLinearGradient(0, ly - 3, 0, ly + 5);
    lamp.addColorStop(0, '#e2c27c');
    lamp.addColorStop(1, '#7d5f2c');
    ctx.fillStyle = lamp;
    ctx.beginPath();
    ctx.roundRect(this.W / 2 - lw / 2, ly - Math.max(3, ft * 0.3), lw, Math.max(6, ft * 0.6), 3);
    ctx.fill();

    // wall label: beside the frame when there's room, otherwise under it
    const p = this.painting;
    const fs = Math.max(8.5, Math.min(13, h * 0.032));
    const lwid = fs * 10.5;
    const right = this.W / 2 + this.g.half;
    let lx = x + w + ft + fs * 2.4;
    let lyTop = y + h * 0.72;
    let align: CanvasTextAlign = 'left';
    if (lx + lwid > right - 8) {
      lx = this.W / 2;
      lyTop = y + h + ft + fs * 1.6;
      align = 'center';
    }
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(232,224,214,0.82)';
    ctx.font = `600 ${fs}px Georgia, 'Times New Roman', serif`;
    ctx.fillText(p.artist, lx, lyTop);
    ctx.font = `italic ${fs}px Georgia, 'Times New Roman', serif`;
    ctx.fillText(p.title, lx, lyTop + fs * 1.4);
    this.artLayer = c;
  }

  /** Clip region of the skylight glass, in screen space with the room's drift applied by the caller. */
  get skylightPath() {
    return this.skylight;
  }

  /** Points at the far corners of the floor (hearts from people on other benches rise from there). */
  edgePoints(): { x: number; y: number }[] {
    const { yF } = this.g;
    const x0 = this.W / 2 - this.g.half;
    const x1 = this.W / 2 + this.g.half;
    return [
      { x: x0 + 20, y: yF + 6 },
      { x: x1 - 20, y: yF + 6 },
      { x: x0 * 0.5, y: yF + (this.H - yF) * 0.3 },
      { x: this.W - x0 * 0.5, y: yF + (this.H - yF) * 0.3 },
    ];
  }

  /** The room before the listeners and birds/rain; the caller has already translated for drift. */
  draw(ctx: CanvasRenderingContext2D, f: Frame) {
    if (!this.room) this.drawRoom();
    if (!this.artLayer) this.drawArt();
    const { W, H } = this;
    const night = f.night;

    ctx.drawImage(this.room!, -PAD, -PAD, W + PAD * 2, H + PAD * 2);

    // skylight: daylight white, warm at golden hour, a deep blue at night
    let sky = mix(SKY_DAY, f.pal.sun, 0.28 * f.golden);
    sky = mix(sky, mix(f.pal.skyTop, SKY_NIGHT, 0.5), Math.min(1, night * 1.1));
    sky = mix(sky, hex('#9aa3b0'), f.rain * 0.45);
    const glow = ctx.createLinearGradient(0, 0, 0, this.g.skyBottom);
    glow.addColorStop(0, css(mix(sky, [255, 255, 255], 0.25 * (1 - night))));
    glow.addColorStop(1, css(sky));
    ctx.fillStyle = glow;
    ctx.fill(this.skylight);
    ctx.strokeStyle = css(mix(CEIL, NIGHT_INK, 0.2 + night * 0.4), 0.85);
    ctx.lineWidth = 3;
    ctx.stroke(this.mullions);

    // after dusk the room falls into gallery lighting
    const dim = 0.52 * night + 0.1 * f.rain;
    if (dim > 0.01) {
      ctx.fillStyle = css(NIGHT_INK, dim);
      ctx.fillRect(-PAD, -PAD, W + PAD * 2, H + PAD * 2);
      // the glass keeps its own colour (the night sky through it)
      ctx.fillStyle = glow;
      ctx.fill(this.skylight);
      ctx.stroke(this.mullions);
    }
    // daylight from above washes the top of the walls
    const wash = ctx.createLinearGradient(0, this.g.yT, 0, this.g.yT + (this.g.yF - this.g.yT) * 0.5);
    wash.addColorStop(0, css(sky, 0.12 * (1 - night)));
    wash.addColorStop(1, css(sky, 0));
    ctx.fillStyle = wash;
    ctx.fillRect(W / 2 - this.g.half, this.g.yT, this.g.half * 2, this.g.yF - this.g.yT);

    // the picture light: a warm pool on the wall, stronger once the skylight fades
    const { x, y, w, h, ft } = this.g.art;
    const cx = W / 2;
    const cy = y + h * 0.35;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cx, cy);
    ctx.scale(1, (h + ft * 2) / (w + ft * 2));
    const rr = (w + ft * 2) * 0.95;
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, rr);
    pool.addColorStop(0, `rgba(255,196,120,${0.08 + 0.12 * night})`);
    pool.addColorStop(1, 'rgba(255,196,120,0)');
    ctx.fillStyle = pool;
    ctx.fillRect(-rr, -rr, rr * 2, rr * 2);
    ctx.restore();

    // the painting itself barely dims: the picture light keeps it readable
    ctx.drawImage(this.artLayer!, -PAD, -PAD, W + PAD * 2, H + PAD * 2);
    if (night > 0.01) {
      ctx.fillStyle = css(NIGHT_INK, 0.14 * night);
      ctx.fillRect(x - ft, y - ft, w + ft * 2, h + ft * 2);
    }
  }
}
