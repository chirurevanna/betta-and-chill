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

/**
 * Mysore (Amba Vilas) Palace, front elevation, after the real building: a long two-storey facade
 * with a lower arcade of big cusped arches; paired square towers at each end under red onion domes;
 * two grey domes on drums along the roof; a central block with a red arched canopy; and the tall
 * tiered central tower under its gilded dome and spire. At night every line is traced in bulbs.
 */
export function mysorePalace(x: number, y: number, u: number, depth: number, hazeAmt: number): Drawable {
  const bulbs: number[] = [];
  const red = new Path2D();
  const gold = new Path2D();
  const grey = new Path2D();
  const g = build(x, y, u, (b, m) => {
    const fill = new Path2D();
    const shade = new Path2D();
    const R = new Path2D(); // red domes and canopies
    const G = new Path2D(); // gilded central dome, lantern, spire
    const Y = new Path2D(); // grey domes
    const L: number[] = []; // bulb outline

    // ---- the long facade between the inner towers ----
    fill.rect(-56, -25, 112, 25);
    shade.rect(-56, -25, 112, 1.6); // cornice
    shade.rect(-56, -15.6, 112, 1); // band between the storeys
    // upper storey: a run of small arched windows
    for (let i = 0; i < 22; i++) {
      const wx = -54 + i * 4.95;
      if (Math.abs(wx + 1.4) < 15) continue; // the central block has its own windows
      arch(shade, wx, -17.6, 2.8, 5.4);
    }
    // lower arcade: big round arches, the middle one widest
    const arches: [number, number, number][] = [];
    for (const s of [-1, 1]) {
      for (const cx of [24, 38, 49]) arches.push([s * cx, 10.4, 14]);
    }
    arches.push([0, 13, 14.6]);
    for (const [cx, w, h] of arches) arch(shade, cx - w / 2, 0, w, h);
    // small cusps over each arch: three little lobes along the crown
    for (const [cx, w, h] of arches) {
      for (const k of [-0.3, 0, 0.3]) {
        const px = cx + k * w;
        const py = -h + w / 2 - Math.sqrt(Math.max(0, (w / 2) ** 2 - (k * w) ** 2)) - 0.3;
        shade.moveTo(px + 0.8, py);
        shade.arc(px, py, 0.8, 0, Math.PI * 2);
      }
    }
    sampleLine(L, -56, -25, 56, -25, 3.5);
    sampleLine(L, -56, -1, 56, -1, 3.5);
    for (const [cx, w, h] of arches) {
      const r = w / 2;
      for (let k = 0; k <= 8; k++) {
        const a = Math.PI + (k / 8) * Math.PI;
        L.push(cx + Math.cos(a) * r, -h + r + Math.sin(a) * r);
      }
    }

    // ---- small red domes along the roof ----
    for (const s of [-1, 1]) {
      for (const dx of [28, 45]) {
        onionDome(R, s * dx, -25, 2.3, 4.6);
        sampleDome(L, s * dx, -25, 2.3, 4.6, 3);
      }
    }

    // ---- grey domes on square drums ----
    for (const s of [-1, 1]) {
      const cx = s * 37;
      fill.rect(cx - 5, -32, 10, 7); // drum pavilion
      shade.rect(cx - 5, -32, 10, 1);
      for (const k of [-3, 0, 3]) arch(shade, cx + k - 1, -26.2, 2, 4);
      onionDome(Y, cx, -32, 4.6, 9);
      Y.rect(cx - 0.35, -44, 0.7, 3.4); // finial
      sampleLine(L, cx - 5, -32, cx - 5, -25, 3.5);
      sampleLine(L, cx + 5, -32, cx + 5, -25, 3.5);
      sampleDome(L, cx, -32, 4.6, 9, 6);
    }

    // ---- paired towers at each end, under red onion domes ----
    for (const s of [-1, 1]) {
      for (const [cx, w, top] of [
        [s * 61, 12, -34],
        [s * 79.5, 13, -34],
      ] as [number, number, number][]) {
        fill.rect(cx - w / 2, top, w, -top);
        shade.rect(cx - w / 2 - 0.6, top, w + 1.2, 1.6); // parapet
        // stacked windows, a red balcony hood over the middle ones
        for (const wy of [-29.5, -22.5, -15.5]) {
          for (const k of [-3, 0, 3]) arch(shade, cx + k - 0.9, wy + 3.4, 1.8, 3.4);
        }
        R.moveTo(cx - w * 0.36, -20);
        R.ellipse(cx, -20, w * 0.36, 1.4, 0, Math.PI, 0);
        R.closePath();
        arch(shade, cx - 2.6, 0, 5.2, 8.5); // gateway
        // dome, with small pinnacles at the corners of the parapet
        onionDome(R, cx, top, 4.8, 11);
        fill.rect(cx - 3.6, top - 1.6, 7.2, 1.6);
        R.rect(cx - 0.3, top - 15, 0.6, 4.2);
        for (const k of [-1, 1]) {
          R.rect(cx + k * (w / 2 - 0.3) - 0.4, top - 4, 0.8, 4);
          R.moveTo(cx + k * (w / 2 - 0.3) + 0.9, top - 4);
          R.arc(cx + k * (w / 2 - 0.3), top - 4, 0.9, 0, Math.PI * 2);
        }
        sampleLine(L, cx - w / 2, top, cx - w / 2, 0, 3.5);
        sampleLine(L, cx + w / 2, top, cx + w / 2, 0, 3.5);
        sampleLine(L, cx - w / 2, top, cx + w / 2, top, 3.5);
        sampleDome(L, cx, top, 4.8, 11, 6);
      }
      // low wing between each pair of towers
      fill.rect(s * 70.5 - 3, -27, 6, 27);
    }

    // ---- central block with the red arched canopy ----
    fill.rect(-15, -29, 30, 29);
    shade.rect(-15, -29, 30, 1.2);
    for (let i = 0; i < 5; i++) arch(shade, -10.5 + i * 4.6 - 1.4, -17.6, 2.8, 6);
    R.moveTo(-9.5, -29);
    R.ellipse(0, -29, 9.5, 5.2, 0, Math.PI, 0);
    R.closePath();
    shade.moveTo(-5.4, -29);
    shade.ellipse(0, -29, 5.4, 2.8, 0, Math.PI, 0); // the window inside the canopy
    shade.closePath();
    sampleLine(L, -15, -29, -15, -1, 3.5);
    sampleLine(L, 15, -29, 15, -1, 3.5);
    for (let k = 0; k <= 10; k++) {
      const a = Math.PI + (k / 10) * Math.PI;
      L.push(Math.cos(a) * 9.5, -29 + Math.sin(a) * 5.2);
    }

    // ---- the tiered central tower, its flanking domes, gilded dome and spire ----
    fill.rect(-8, -42, 16, 13); // tier 1
    fill.rect(-6.4, -51, 12.8, 9); // tier 2
    fill.rect(-4.8, -55, 9.6, 4); // drum
    shade.rect(-8.6, -42, 17.2, 1.2);
    shade.rect(-7, -51, 14, 1);
    for (const k of [-4, 0, 4]) arch(shade, k - 1, -34, 2, 5.5);
    for (const k of [-2.6, 2.6]) arch(shade, k - 0.9, -44, 1.8, 4.6);
    for (const sx of [-1, 1]) {
      onionDome(R, sx * 11.5, -33, 2.6, 5.4); // red, at the tower's feet
      onionDome(Y, sx * 6.2, -42, 2, 4.4); // grey, on the first tier
      R.rect(sx * 11.5 - 0.25, -40.6, 0.5, 2.4);
      sampleDome(L, sx * 11.5, -33, 2.6, 5.4, 3);
      sampleDome(L, sx * 6.2, -42, 2, 4.4, 3);
    }
    onionDome(G, 0, -55, 5, 10.5); // the gilded dome
    G.rect(-1.4, -69, 2.8, 4.4); // lantern
    onionDome(G, 0, -69, 1.8, 3.4);
    G.rect(-0.3, -77, 0.6, 5); // spire
    sampleLine(L, -8, -42, -8, -29, 3.5);
    sampleLine(L, 8, -42, 8, -29, 3.5);
    sampleLine(L, -6.4, -51, -6.4, -42, 3);
    sampleLine(L, 6.4, -51, 6.4, -42, 3);
    sampleDome(L, 0, -55, 5, 10.5, 7);
    sampleLine(L, 0, -72, 0, -77, 2.5);

    b.fill = m(fill);
    b.shade = m(shade);
    b.accent = new Path2D();
    red.addPath(m(R));
    gold.addPath(m(G));
    grey.addPath(m(Y));
    const lawn = new Path2D();
    lawn.moveTo(-100, 0);
    lawn.lineTo(100, 0);
    lawn.lineTo(118, 14);
    lawn.lineTo(-118, 14);
    lawn.closePath();
    b.lawn = m(lawn);
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
  const bulbR = Math.max(0.65, 0.62 * u);
  const glowR = 150 * u;
  const RED: RGB = [176, 44, 44];
  const GOLD: RGB = [214, 166, 64];
  const GREY: RGB = [118, 112, 108];

  return {
    depth,
    draw(ctx, f) {
      const { pal } = f;
      const lit = f.bulbs;
      const hz = (c: RGB) => mix(c, pal.haze, hazeAmt);
      // domes keep their own colours by day and sink toward the palette at dusk
      const tone = (c: RGB) => hz(mix(c, pal.dome, 0.25 + 0.55 * f.night));
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
      ctx.fillStyle = css(mix(tone(GREY), [190, 140, 100], 0.45 * lit));
      ctx.fill(grey);
      ctx.fillStyle = css(mix(tone(RED), [236, 120, 80], 0.45 * lit));
      ctx.fill(red);
      ctx.fillStyle = css(mix(tone(GOLD), [255, 200, 110], 0.5 * lit));
      ctx.fill(gold);
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
      // the water mirrors the sky by day; after dusk it goes dark, like the land around it
      let water = mix(mix(pal.skyTop, pal.skyBottom, 0.55), pal.haze, hazeAmt * 0.6);
      water = mix(water, mix(pal.forest, pal.skyTop, 0.35), f.night * 0.7);
      // soft green shore that fades into the city (no hard outline)
      ctx.save();
      ctx.translate(cx, cy + ry * 0.1);
      ctx.scale(1, (ry * 1.3) / (rx * 1.1));
      const shore = ctx.createRadialGradient(0, 0, rx * 0.85, 0, 0, rx * 1.1);
      const sc = mix(pal.cityTree, pal.forest, 0.4);
      shore.addColorStop(0, css(sc, 0.55));
      shore.addColorStop(1, css(sc, 0));
      ctx.fillStyle = shore;
      ctx.fillRect(-rx * 1.1, -rx * 1.1, rx * 2.2, rx * 2.2);
      ctx.restore();
      // far edge lighter (reflected sky), near edge deeper
      const wg = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
      wg.addColorStop(0, css(mix(water, pal.haze, 0.25)));
      wg.addColorStop(1, css(mix(water, pal.forest, 0.18)));
      ctx.fillStyle = wg;
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
  // lift the pen first: without these moveTo calls the path drew a line from the back down to
  // the creases and filled a stray triangle across the bull's side
  light.moveTo(-52, -3);
  light.ellipse(-30, -3, 22, 3, 0, Math.PI, 0); // folded rear leg crease
  light.moveTo(41, -3);
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
