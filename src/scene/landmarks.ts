import { css, mix, type RGB } from '../util';
import type { Drawable, Frame } from './types';

/* All landmark shapes are authored in local units (base centre = 0,0, up = negative y)
 * and scaled by `u` px per unit when the layout is built. */

const WARM: RGB = [255, 200, 118];
const BULB: RGB = [255, 226, 150];

function onionDome(p: Path2D, cx: number, base: number, r: number, h: number) {
  p.moveTo(cx - r * 0.85, base);
  p.bezierCurveTo(cx - r * 1.3, base - h * 0.4, cx - r * 0.55, base - h * 0.78, cx, base - h);
  p.bezierCurveTo(cx + r * 0.55, base - h * 0.78, cx + r * 1.3, base - h * 0.4, cx + r * 0.85, base);
  p.closePath();
}

function arch(p: Path2D, x: number, bottom: number, w: number, h: number) {
  const r = w / 2;
  p.moveTo(x, bottom);
  p.lineTo(x, bottom - h + r);
  p.arc(x + r, bottom - h + r, r, Math.PI, 0);
  p.lineTo(x + w, bottom);
  p.closePath();
}

function sampleLine(out: number[], x0: number, y0: number, x1: number, y1: number, step: number) {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
  for (let i = 0; i <= n; i++) out.push(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
}
function cubic(a: number, b: number, c: number, d: number, t: number) {
  const m = 1 - t;
  return m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * d;
}
/** Samples the same curves as onionDome so bulbs sit exactly on the outline. */
function sampleDome(out: number[], cx: number, base: number, r: number, h: number, n: number) {
  for (const s of [-1, 1]) {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      out.push(
        cubic(cx + s * r * 0.85, cx + s * r * 1.3, cx + s * r * 0.55, cx, t),
        cubic(base, base - h * 0.4, base - h * 0.78, base - h, t),
      );
    }
  }
}

interface Mapped {
  fill: Path2D;
  shade: Path2D;
  accent: Path2D;
  bulbs?: Float32Array;
  lawn?: Path2D;
}

/** Transform a set of local-unit builders into pixel Path2Ds. */
function build(x: number, y: number, u: number, fn: (b: Mapped, m: (p: Path2D) => Path2D) => void): Mapped {
  const b: Mapped = { fill: new Path2D(), shade: new Path2D(), accent: new Path2D() };
  const mtx = new DOMMatrix([u, 0, 0, u, x, y]);
  const m = (p: Path2D) => {
    const out = new Path2D();
    out.addPath(p, mtx);
    return out;
  };
  fn(b, m);
  return b;
}

export function mysorePalace(x: number, y: number, u: number, depth: number, hazeAmt: number): Drawable {
  const bulbs: number[] = [];
  const g = build(x, y, u, (b, m) => {
    const fill = new Path2D();
    const shade = new Path2D();
    const accent = new Path2D();
    // long facade + upper storey
    fill.rect(-82, -30, 164, 30);
    fill.rect(-44, -44, 88, 14);
    // towers
    fill.rect(-11, -68, 22, 24);
    for (const s of [-1, 1]) {
      fill.rect(s * 30 - 5, -56, 10, 12);
      fill.rect(s * 74 - 5, -42, 10, 12);
    }
    // domes (accent)
    onionDome(accent, 0, -68, 12, 24);
    accent.rect(-0.8, -98, 1.6, 7);
    for (const s of [-1, 1]) {
      onionDome(accent, s * 30, -56, 6, 12);
      onionDome(accent, s * 74, -42, 5, 10);
      onionDome(accent, s * 54, -30, 3.2, 7);
      onionDome(accent, s * 16, -44, 3, 6);
    }
    // arcades
    for (let i = 0; i < 15; i++) arch(shade, -76 + i * 10.4, -3, 6.5, 16);
    for (let i = 0; i < 9; i++) arch(shade, -38 + i * 8.6, -32, 5, 9);
    shade.rect(-82, -30, 164, 2.2); // cornice line
    shade.rect(-7, -62, 14, 3);
    b.fill = m(fill);
    b.shade = m(shade);
    b.accent = m(accent);
    const lawn = new Path2D();
    lawn.moveTo(-100, 0);
    lawn.lineTo(100, 0);
    lawn.lineTo(118, 14);
    lawn.lineTo(-118, 14);
    lawn.closePath();
    b.lawn = m(lawn);

    // bulb outline (local units)
    const L: number[] = [];
    sampleLine(L, -82, -30, 82, -30, 4);
    sampleLine(L, -82, -30, -82, 0, 4);
    sampleLine(L, 82, -30, 82, 0, 4);
    sampleLine(L, -82, -1, 82, -1, 4);
    sampleLine(L, -44, -44, 44, -44, 4);
    sampleLine(L, -11, -68, 11, -68, 4);
    sampleLine(L, -11, -68, -11, -44, 4);
    sampleLine(L, 11, -68, 11, -44, 4);
    sampleDome(L, 0, -68, 12, 24, 12);
    for (const s of [-1, 1]) {
      sampleDome(L, s * 30, -56, 6, 12, 6);
      sampleDome(L, s * 74, -42, 5, 10, 5);
      sampleLine(L, s * 30 - 5, -56, s * 30 - 5, -44, 4);
      sampleLine(L, s * 30 + 5, -56, s * 30 + 5, -44, 4);
    }
    for (let i = 0; i < 15; i++) {
      const ax = -76 + i * 10.4 + 3.25;
      for (let k = 0; k <= 4; k++) {
        const a = Math.PI + (k / 4) * Math.PI;
        L.push(ax + Math.cos(a) * 3.25, -3 - 16 + 3.25 + Math.sin(a) * 3.25);
      }
    }
    for (let i = 0; i < L.length; i += 2) bulbs.push(x + L[i] * u, y + L[i + 1] * u);
  });

  // order bulbs from the centre outward so they "switch on" in a wave
  const n = bulbs.length / 2;
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => Math.abs(bulbs[a * 2] - x) + Math.abs(bulbs[a * 2 + 1] - y) * 0.6 - (Math.abs(bulbs[b * 2] - x) + Math.abs(bulbs[b * 2 + 1] - y) * 0.6),
  );
  const sorted = new Float32Array(n * 2);
  order.forEach((src, i) => {
    sorted[i * 2] = bulbs[src * 2];
    sorted[i * 2 + 1] = bulbs[src * 2 + 1];
  });
  const bulbR = Math.max(0.7, 0.75 * u);
  const glowR = 150 * u;

  return {
    depth,
    draw(ctx, f) {
      const { pal } = f;
      const lit = f.bulbs;
      const hz = (c: RGB) => mix(c, pal.haze, hazeAmt);
      ctx.fillStyle = css(hz(mix(pal.ground, pal.cityTree, 0.55)));
      ctx.fill(g.lawn!);
      if (lit > 0) {
        const grd = ctx.createRadialGradient(x, y - 30 * u, 0, x, y - 30 * u, glowR);
        grd.addColorStop(0, css(WARM, 0.42 * lit));
        grd.addColorStop(1, css(WARM, 0));
        ctx.fillStyle = grd;
        ctx.fillRect(x - glowR, y - 30 * u - glowR, glowR * 2, glowR * 2);
      }
      ctx.fillStyle = css(mix(hz(pal.palace), WARM, 0.55 * lit));
      ctx.fill(g.fill);
      ctx.fillStyle = css(mix(hz(pal.dome), [236, 150, 92], 0.5 * lit));
      ctx.fill(g.accent);
      ctx.fillStyle = css(mix(hz(pal.palaceShade), [150, 80, 40], 0.6 * lit));
      ctx.fill(g.shade);
      if (lit > 0.01) {
        const on = Math.floor(n * Math.min(1, lit * 1.15));
        ctx.fillStyle = css(BULB, Math.min(1, lit * 1.4));
        ctx.beginPath();
        for (let i = 0; i < on; i++) {
          ctx.moveTo(sorted[i * 2] + bulbR, sorted[i * 2 + 1]);
          ctx.arc(sorted[i * 2], sorted[i * 2 + 1], bulbR, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    },
  };
}

export function philomenaChurch(x: number, y: number, u: number, depth: number, hazeAmt: number): Drawable {
  const g = build(x, y, u, (b, m) => {
    const fill = new Path2D();
    const shade = new Path2D();
    fill.rect(-16, -22, 32, 22); // nave front
    fill.moveTo(-6, -22);
    fill.lineTo(0, -32);
    fill.lineTo(6, -22);
    fill.closePath();
    for (const s of [-1, 1]) {
      const cx = s * 9;
      fill.rect(cx - 4, -50, 8, 28);
      fill.moveTo(cx - 4.2, -50);
      fill.lineTo(cx, -88);
      fill.lineTo(cx + 4.2, -50);
      fill.closePath();
      fill.rect(cx - 0.4, -94, 0.8, 6);
      fill.rect(cx - 2, -92, 4, 0.8);
      arch(shade, cx - 1.6, -36, 3.2, 8);
    }
    shade.moveTo(3.2, -16);
    shade.arc(0, -16, 3.2, 0, Math.PI * 2);
    arch(shade, -2.5, 0, 5, 9);
    b.fill = m(fill);
    b.shade = m(shade);
  });
  return {
    depth,
    draw(ctx, f) {
      const base = mix(mix(f.pal.cityFar, f.pal.stoneLight, 0.35), f.pal.haze, hazeAmt);
      ctx.fillStyle = css(base);
      ctx.fill(g.fill);
      ctx.fillStyle = css(mix(base, f.pal.stone, 0.35));
      ctx.fill(g.shade);
      if (f.night > 0.2) {
        // floodlit spires
        ctx.fillStyle = css([255, 236, 200], 0.25 * f.night);
        ctx.fill(g.fill);
      }
    },
  };
}

export function lalithaMahal(x: number, y: number, u: number, depth: number, hazeAmt: number): Drawable {
  const g = build(x, y, u, (b, m) => {
    const fill = new Path2D();
    const shade = new Path2D();
    const accent = new Path2D();
    fill.rect(-62, -20, 124, 20);
    fill.rect(-20, -27, 40, 7);
    fill.rect(-9, -36, 18, 9);
    accent.moveTo(-10, -36);
    accent.arc(0, -36, 10, Math.PI, 0);
    accent.closePath();
    accent.rect(-1.5, -50, 3, 5);
    for (const s of [-1, 1]) {
      fill.rect(s * 50 - 6, -28, 12, 8);
      accent.moveTo(s * 50 - 5.5, -28);
      accent.arc(s * 50, -28, 5.5, Math.PI, 0);
      accent.closePath();
    }
    for (let i = 0; i < 14; i++) shade.rect(-56 + i * 8.3, -15, 3.2, 8);
    for (let i = 0; i < 6; i++) shade.rect(-16 + i * 6.2, -25, 2.4, 4);
    shade.rect(-62, -21, 124, 1.4);
    b.fill = m(fill);
    b.shade = m(shade);
    b.accent = m(accent);
  });
  return {
    depth,
    draw(ctx, f) {
      const base = mix(f.pal.white, f.pal.haze, hazeAmt);
      ctx.fillStyle = css(base);
      ctx.fill(g.fill);
      ctx.fill(g.accent);
      ctx.fillStyle = css(mix(mix(base, f.pal.palaceShade, 0.6), WARM, 0.75 * f.night));
      ctx.fill(g.shade);
    },
  };
}

export function lakeDrawable(cx: number, cy: number, rx: number, ry: number, depth: number, hazeAmt: number): Drawable {
  const shape = new Path2D();
  shape.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  const glints = Array.from({ length: 6 }, (_, i) => ({
    ox: (((i * 0.37) % 1) - 0.5) * rx * 1.2,
    oy: ((((i * 0.61) % 1) - 0.5) * ry) * 1.0,
    w: rx * (0.08 + ((i * 0.23) % 0.12)),
    ph: i * 1.9,
  }));
  return {
    depth,
    draw(ctx, f) {
      const { pal } = f;
      const water = mix(mix(pal.skyTop, pal.skyBottom, 0.55), pal.haze, hazeAmt * 0.6);
      ctx.fillStyle = css(mix(pal.cityTree, pal.forest, 0.5));
      ctx.beginPath();
      ctx.ellipse(cx, cy + ry * 0.12, rx * 1.06, ry * 1.25, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = css(water);
      ctx.fill(shape);
      const glint = f.night > 0.5 ? mix([255, 214, 150], water, 0.3) : mix(pal.sun, [255, 255, 255], 0.5);
      ctx.strokeStyle = css(glint, 0.55 * (1 - f.rain * 0.7));
      ctx.lineWidth = Math.max(0.6, ry * 0.08);
      ctx.beginPath();
      for (const gl of glints) {
        const dx = Math.sin(f.time * 0.4 + gl.ph) * rx * 0.08;
        ctx.moveTo(cx + gl.ox + dx - gl.w / 2, cy + gl.oy);
        ctx.lineTo(cx + gl.ox + dx + gl.w / 2, cy + gl.oy);
      }
      ctx.stroke();
    },
  };
}

/** Chamundeshwari gopuram: stacked tiers topped with a barrel vault and golden kalashas. */
export function gopuram(x: number, baseY: number, u: number) {
  const fill = new Path2D();
  const shade = new Path2D();
  const gold = new Path2D();
  fill.rect(-50, -30, 100, 30);
  arch(shade, -11, 0, 22, 26);
  shade.rect(-52, -33, 104, 3);
  let y = -33;
  for (let i = 0; i < 7; i++) {
    const w = 92 - i * 11;
    const h = 17 - i * 0.9;
    fill.rect(-w / 2, y - h, w, h);
    shade.rect(-w / 2 - 2, y - h - 2.4, w + 4, 2.4);
    const niches = Math.max(2, Math.round(w / 13));
    for (let k = 0; k < niches; k++) {
      const nx = -w / 2 + ((k + 0.5) * w) / niches - 2;
      arch(shade, nx, y - 3, 4, h - 6);
    }
    for (let k = 0; k <= niches; k++) {
      const bx = -w / 2 + (k * w) / niches;
      shade.moveTo(bx - 1.6, y - h - 3.2);
      shade.arc(bx, y - h - 3.2, 1.6, Math.PI, 0);
    }
    y -= h + 2.4;
  }
  // barrel vault (shala)
  const vw = 22;
  fill.moveTo(-vw, y);
  fill.lineTo(-vw, y - 6);
  fill.quadraticCurveTo(-vw, y - 16, -vw + 8, y - 16);
  fill.lineTo(vw - 8, y - 16);
  fill.quadraticCurveTo(vw, y - 16, vw, y - 6);
  fill.lineTo(vw, y);
  fill.closePath();
  for (let k = 0; k < 7; k++) {
    const kx = -15 + k * 5;
    const ky = y - 16;
    gold.ellipse(kx, ky - 2.6, 2.1, 2.6, 0, 0, Math.PI * 2);
    gold.moveTo(kx - 0.6, ky - 5);
    gold.lineTo(kx, ky - 9);
    gold.lineTo(kx + 0.6, ky - 5);
    gold.closePath();
  }
  const mtx = new DOMMatrix([u, 0, 0, u, x, baseY]);
  const out = (p: Path2D) => {
    const o = new Path2D();
    o.addPath(p, mtx);
    return o;
  };
  const F = out(fill);
  const S = out(shade);
  const G = out(gold);
  return {
    draw(ctx: CanvasRenderingContext2D, f: Frame) {
      ctx.fillStyle = f.c.gopuram;
      ctx.fill(F);
      ctx.fillStyle = f.c.gopuramShade;
      ctx.fill(S);
      ctx.fillStyle = f.c.gold;
      ctx.fill(G);
      if (f.night > 0.15) {
        // gentle temple floodlight from below
        const grd = ctx.createLinearGradient(0, baseY, 0, baseY - 150 * u);
        grd.addColorStop(0, css(WARM, 0.32 * f.night));
        grd.addColorStop(1, css(WARM, 0));
        ctx.save();
        ctx.clip(F);
        ctx.fillStyle = grd;
        ctx.fillRect(x - 60 * u, baseY - 180 * u, 120 * u, 180 * u);
        ctx.restore();
      }
    },
  };
}

/**
 * Seated Nandi in side profile, facing right, on a stepped plinth.
 * Local units: body base at y=0 (plinth top), plinth below to y=18; width ≈ 140.
 */
export function nandi(x: number, baseY: number, u: number) {
  const plinth = new Path2D();
  plinth.rect(-66, 0, 136, 9);
  plinth.rect(-72, 9, 148, 10);
  const body = new Path2D();
  body.moveTo(-58, 0);
  body.bezierCurveTo(-68, -10, -68, -40, -50, -48); // rump
  body.bezierCurveTo(-36, -56, -14, -54, 0, -58); // back
  body.bezierCurveTo(6, -70, 16, -76, 25, -70); // hump
  body.bezierCurveTo(31, -66, 38, -68, 46, -74); // neck crest
  body.bezierCurveTo(50, -80, 58, -82, 62, -76); // poll / forehead
  body.bezierCurveTo(68, -64, 75, -52, 73, -44); // face
  body.bezierCurveTo(72, -38, 64, -36, 58, -40); // muzzle + jaw
  body.bezierCurveTo(52, -36, 50, -28, 44, -22); // throat
  body.bezierCurveTo(40, -16, 40, -10, 46, -8); // dewlap / chest
  body.bezierCurveTo(56, -7, 62, -4, 62, 0); // folded fore-leg
  body.closePath();
  // horns
  body.moveTo(50, -77);
  body.quadraticCurveTo(45, -93, 54, -97);
  body.quadraticCurveTo(51, -88, 55, -79);
  body.closePath();
  body.moveTo(58, -80);
  body.quadraticCurveTo(59, -95, 67, -97);
  body.quadraticCurveTo(62, -88, 62, -78);
  body.closePath();
  // ear + tail
  body.ellipse(43, -72, 8, 2.8, 0.45, 0, Math.PI * 2);
  body.moveTo(-60, -28);
  body.quadraticCurveTo(-74, -14, -64, 0);
  body.lineTo(-61, 0);
  body.quadraticCurveTo(-70, -14, -57, -26);
  body.closePath();

  const light = new Path2D(); // sky-lit top edge
  light.moveTo(-60, -40);
  light.bezierCurveTo(-48, -50, -14, -52, 0, -56);
  light.bezierCurveTo(6, -68, 16, -74, 25, -68);
  light.bezierCurveTo(31, -64, 38, -66, 46, -72);
  light.bezierCurveTo(50, -78, 58, -80, 61, -75);
  light.bezierCurveTo(57, -77, 51, -76, 46, -69);
  light.bezierCurveTo(38, -62, 30, -61, 24, -64);
  light.bezierCurveTo(16, -69, 8, -64, 2, -52);
  light.bezierCurveTo(-14, -48, -46, -46, -60, -40);
  light.closePath();
  light.ellipse(-30, -3, 22, 3, 0, Math.PI, 0); // folded rear leg crease
  light.ellipse(50, -3, 9, 2.2, 0, Math.PI, 0);

  const deco = new Path2D(); // bell garland round the neck + eye
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    const cx = (1 - t) * (1 - t) * 38 + 2 * (1 - t) * t * 34 + t * t * 47;
    const cy = (1 - t) * (1 - t) * -66 + 2 * (1 - t) * t * -42 + t * t * -26;
    deco.moveTo(cx + 2.1, cy);
    deco.arc(cx, cy, 2.1, 0, Math.PI * 2);
  }
  deco.moveTo(62, -64);
  deco.arc(61, -64, 1.2, 0, Math.PI * 2);
  const mtx = new DOMMatrix([u, 0, 0, u, x, baseY]);
  const out = (p: Path2D) => {
    const o = new Path2D();
    o.addPath(p, mtx);
    return o;
  };
  const P = out(plinth);
  const B = out(body);
  const L = out(light);
  const D = out(deco);
  return {
    halfWidth: 72 * u,
    draw(ctx: CanvasRenderingContext2D, f: Frame) {
      ctx.fillStyle = css(mix(f.pal.rockLight, f.pal.palaceShade, 0.25));
      ctx.fill(P);
      ctx.fillStyle = f.c.stone;
      ctx.fill(B);
      const rim = mix(f.pal.stoneLight, f.pal.sun, 0.35 * f.golden);
      ctx.fillStyle = css(rim, 0.85);
      ctx.fill(L);
      ctx.fillStyle = f.c.gold;
      ctx.fill(D);
    },
  };
}
