import { css, mix, mulberry32, smoothstep, type RGB } from '../util';
import { gopuram, lakeDrawable, lalithaMahal, mysorePalace, nandi, philomenaChurch } from './landmarks';
import type { Drawable, Frame, Lake, TreeDef, ViewId } from './types';

export interface BenchSpot {
  x: number;
  y: number;
  u: number;
}

export interface Layout {
  W: number;
  H: number;
  s: number;
  view: ViewId;
  horizonY: number;
  hills: Path2D;
  city: Drawable[];
  lakes: Lake[];
  forest: Path2D;
  forestLight: Path2D;
  forestTop: number;
  drawForeground(ctx: CanvasRenderingContext2D, f: Frame): void;
  ledgeTop(x: number): number;
  trees: TreeDef[];
  /** where the shared bench stands: centre x, ground y, and its drawing unit */
  bench: BenchSpot;
  palaceX: number;
  palaceY: number;
}

interface ViewCfg {
  horizon: number;
  cityBottom: number;
  forest: number;
  landmarkScale: number;
  palace: [number, number];
  church: [number, number];
  lalitha: [number, number];
  karanji: [number, number, number];
  kukkarahalli: [number, number, number];
}

const VIEWS: Record<ViewId, ViewCfg> = {
  nandi: {
    horizon: 0.42,
    cityBottom: 0.86,
    forest: 0.775,
    landmarkScale: 1,
    palace: [0.5, 0.42],
    church: [0.42, 0.12],
    lalitha: [0.83, 0.7],
    karanji: [0.68, 0.58, 0.085],
    kukkarahalli: [0.16, 0.2, 0.1],
  },
  summit: {
    horizon: 0.36,
    cityBottom: 0.86,
    forest: 0.8,
    landmarkScale: 0.85,
    palace: [0.44, 0.47],
    church: [0.36, 0.17],
    lalitha: [0.66, 0.78],
    karanji: [0.6, 0.64, 0.08],
    kukkarahalli: [0.1, 0.27, 0.09],
  },
};

const TINTS: RGB[] = [
  [0, 0, 0],
  [14, -4, -2],
  [-6, 3, 12],
];

interface Exclusion {
  x0: number;
  x1: number;
  t0: number;
  t1: number;
}

export function buildLayout(W: number, H: number, view: ViewId): Layout {
  const cfg = VIEWS[view];
  const rnd = mulberry32(view === 'nandi' ? 1907 : 1151);
  const s = Math.max(Math.min(W / 1200, H / 750), Math.min(W / 700, H / 900));
  const horizonY = H * cfg.horizon;
  const cityBottom = H * cfg.cityBottom;
  const depthY = (t: number) => horizonY + (cityBottom - horizonY) * t ** 1.6;
  const depthK = (t: number) => 0.28 + 2.0 * t ** 1.35;
  const hazeOf = (t: number) => (1 - t) ** 2.4 * 0.5;

  /* ---------- far hills ---------- */
  const hills = new Path2D();
  hills.moveTo(-40, horizonY + 4);
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
  for (let x = -40; x <= W + 40; x += 8) {
    const nx = x / W;
    const edge = 0.35 + 0.65 * (Math.abs(nx - 0.5) * 2) ** 1.5;
    const h =
      (Math.sin(nx * 7 + ph[0]) * 0.5 + 0.5) * 0.6 +
      (Math.sin(nx * 17 + ph[1]) * 0.5 + 0.5) * 0.3 +
      (Math.sin(nx * 41 + ph[2]) * 0.5 + 0.5) * 0.1;
    hills.lineTo(x, horizonY - H * 0.045 * h * edge - 2);
  }
  hills.lineTo(W + 40, horizonY + 4);
  hills.closePath();

  /* ---------- landmarks & lakes ---------- */
  const city: Drawable[] = [];
  const excl: Exclusion[] = [];
  const lakes: Lake[] = [];
  const L = cfg.landmarkScale * s;

  const place = (fx: number, t: number) => ({ x: W * fx, y: depthY(t), u: L * depthK(t) });

  const pal = place(...cfg.palace);
  city.push(mysorePalace(pal.x, pal.y, pal.u, cfg.palace[1], hazeOf(cfg.palace[1])));
  excl.push({ x0: pal.x - 100 * pal.u, x1: pal.x + 100 * pal.u, t0: cfg.palace[1] - 0.005, t1: cfg.palace[1] + 0.09 });

  const ch = place(...cfg.church);
  const chU = ch.u * 1.25;
  city.push(philomenaChurch(ch.x, ch.y, chU, cfg.church[1], hazeOf(cfg.church[1])));
  excl.push({ x0: ch.x - 20 * chU, x1: ch.x + 20 * chU, t0: cfg.church[1] - 0.005, t1: cfg.church[1] + 0.04 });

  const la = place(...cfg.lalitha);
  const laU = la.u * 0.7;
  city.push(lalithaMahal(la.x, la.y, laU, cfg.lalitha[1], hazeOf(cfg.lalitha[1])));
  excl.push({ x0: la.x - 70 * laU, x1: la.x + 70 * laU, t0: cfg.lalitha[1] - 0.005, t1: cfg.lalitha[1] + 0.07 });

  for (const [fx, t, frx] of [cfg.karanji, cfg.kukkarahalli]) {
    const cx = W * fx;
    const cy = depthY(t);
    const rx = W * frx * (0.6 + t * 0.6);
    const ry = Math.min(rx * 0.3, Math.max(3, (depthY(Math.min(1, t + 0.07)) - depthY(Math.max(0, t - 0.07))) * 0.42));
    lakes.push({ cx, cy, rx, ry, depth: t });
    city.push(lakeDrawable(cx, cy, rx, ry, t - 0.001, hazeOf(t)));
    excl.push({ x0: cx - rx * 1.05, x1: cx + rx * 1.05, t0: t - 0.03, t1: t + 0.1 });
  }

  /* ---------- city rows ---------- */
  const ROWS = 18;
  for (let i = 0; i < ROWS; i++) {
    const t = 0.008 + (i / (ROWS - 1)) * 0.992;
    const y = depthY(t);
    const k = depthK(t) * s;
    const bodies = [new Path2D(), new Path2D(), new Path2D()];
    const roofs = new Path2D();
    const tanks = new Path2D();
    const trees = new Path2D();
    const lights = Array.from({ length: 6 }, () => new Path2D());
    const rowExcl = excl.filter((e) => t > e.t0 && t <= e.t1);
    const ws = Math.max(0.8, 1.25 * k);
    let x = -30 + rnd() * 10 * k;
    while (x < W + 30) {
      const w = (7 + rnd() * 11) * k;
      const cxh = x + w / 2;
      if (rowExcl.some((e) => cxh > e.x0 && cxh < e.x1)) {
        x += w;
        continue;
      }
      if (rnd() < 0.2) {
        const r = (3 + rnd() * 4) * k;
        trees.moveTo(x + r * 2, y - r * 0.7);
        trees.arc(x + r, y - r * 0.7, r, 0, Math.PI * 2);
        if (rnd() < 0.6) {
          trees.moveTo(x + r * 2.6, y - r * 0.5);
          trees.arc(x + r * 1.8, y - r * 0.5, r * 0.8, 0, Math.PI * 2);
        }
        x += r * 1.8;
        continue;
      }
      const tall = rnd() < 0.08 ? 8 + rnd() * 10 : 0;
      const h = (5 + rnd() * 9 + tall) * k;
      bodies[(rnd() * 3) | 0].rect(x, y - h, w, h);
      const roll = rnd();
      if (roll < 0.28) {
        roofs.moveTo(x - 0.6 * k, y - h);
        roofs.lineTo(x + w * 0.5, y - h - w * 0.32);
        roofs.lineTo(x + w + 0.6 * k, y - h);
        roofs.closePath();
      } else if (roll < 0.5) {
        tanks.rect(x + w * (0.15 + rnd() * 0.5), y - h - 2.2 * k, w * 0.25, 2.2 * k);
      }
      tanks.rect(x, y - h, w, Math.max(0.6, 0.6 * k)); // parapet line
      const nWin = rnd() < 0.65 ? 1 + ((rnd() * (tall ? 4 : 2)) | 0) : 0;
      for (let j = 0; j < nWin; j++) {
        const wx = x + w * (0.15 + rnd() * 0.65);
        const wy = y - h * (0.2 + rnd() * 0.6);
        lights[(rnd() * 6) | 0].rect(wx, wy, ws, ws * 1.15);
      }
      x += w + rnd() * 2.5 * k;
    }
    const hz = hazeOf(t);
    const depthCol = (t * 1.1) ** 0.8;
    city.push({
      depth: t,
      draw(ctx, f) {
        const { pal } = f;
        const base = mix(mix(pal.cityFar, pal.cityNear, Math.min(1, depthCol)), pal.haze, hz);
        ctx.fillStyle = css(mix(mix(pal.cityFar, pal.cityTree, Math.min(1, depthCol + 0.2)), pal.haze, hz));
        ctx.fill(trees);
        const tintAmt = (1 - f.night) * (1 - hz) * (1 - f.rain * 0.5);
        for (let b = 0; b < 3; b++) {
          const tc = TINTS[b];
          ctx.fillStyle = css([base[0] + tc[0] * tintAmt, base[1] + tc[1] * tintAmt, base[2] + tc[2] * tintAmt]);
          ctx.fill(bodies[b]);
        }
        ctx.fillStyle = css(mix(mix(pal.cityFar, pal.roof, Math.min(1, depthCol)), pal.haze, hz));
        ctx.fill(roofs);
        ctx.fillStyle = css(mix(mix(pal.cityFar, pal.wall, Math.min(1, depthCol)), pal.haze, hz));
        ctx.fill(tanks);
        // windows: dark specks by day, warm lights by night
        if (f.night < 0.95) {
          ctx.fillStyle = css(mix(base, pal.stone, 0.45), 0.5 * (1 - f.night) * (1 - hz));
          for (const lp of lights) ctx.fill(lp);
        }
        if (f.night > 0.02) {
          for (let g = 0; g < 6; g++) {
            const on = smoothstep(0.08 + g * 0.07, 0.3 + g * 0.07, f.night);
            if (on <= 0) continue;
            const tw = 0.78 + 0.22 * Math.sin(f.time * (0.35 + g * 0.11) + g * 1.7);
            ctx.fillStyle = css(g % 3 === 0 ? [255, 236, 196] : [255, 196, 120], on * tw * (1 - hz * 0.4));
            ctx.fill(lights[g]);
          }
        }
      },
    });
  }
  city.sort((a, b) => a.depth - b.depth);

  /* ---------- hillside forest band ---------- */
  const forestTop = H * cfg.forest;
  const forest = new Path2D();
  const forestLight = new Path2D();
  forest.rect(-40, forestTop + 6 * s, W + 80, H - forestTop);
  for (let x = -40; x < W + 40; ) {
    const r = (10 + rnd() * 16) * s;
    const yy = forestTop + (Math.sin(x * 0.004 + 1) * 6 + rnd() * 8) * s;
    forest.moveTo(x + r, yy);
    forest.arc(x, yy, r, 0, Math.PI * 2);
    if (rnd() < 0.7) {
      const lr = r * 0.55;
      forestLight.moveTo(x - r * 0.2 + lr, yy - r * 0.35);
      forestLight.arc(x - r * 0.2, yy - r * 0.35, lr, 0, Math.PI * 2);
    }
    x += r * (0.9 + rnd() * 0.5);
  }
  for (let x = -40; x < W + 40; ) {
    const r = (14 + rnd() * 20) * s;
    const yy = forestTop + (26 + rnd() * 14) * s;
    forest.moveTo(x + r, yy);
    forest.arc(x, yy, r, 0, Math.PI * 2);
    x += r * 1.1;
  }

  /* ---------- foreground ---------- */
  const fg = view === 'nandi' ? nandiForeground(W, H, s, rnd) : summitForeground(W, H, s, rnd);

  return {
    W,
    H,
    s,
    view,
    horizonY,
    hills,
    city,
    lakes,
    forest,
    forestLight,
    forestTop,
    drawForeground: fg.draw,
    ledgeTop: fg.ledgeTop,
    trees: fg.trees,
    bench: fg.bench,
    palaceX: pal.x,
    palaceY: pal.y,
  };
}

/* ======================= foregrounds ======================= */

function makeTree(x: number, baseY: number, h: number, s: number, rnd: () => number, lean = 0): TreeDef {
  const blobs: TreeDef['blobs'] = [];
  const n = 7 + ((rnd() * 4) | 0);
  const spread = h * 0.42;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.5;
    const rr = spread * (0.35 + rnd() * 0.5);
    blobs.push({ dx: Math.cos(a) * rr, dy: Math.sin(a) * rr * 0.6 - h * 0.05, r: spread * (0.38 + rnd() * 0.25), light: false });
  }
  blobs.push({ dx: 0, dy: -h * 0.05, r: spread * 0.6, light: false });
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (1.05 + rnd() * 0.75); // upper-left, toward the sky
    const rr = spread * (0.35 + rnd() * 0.45);
    blobs.push({ dx: Math.cos(a) * rr, dy: Math.sin(a) * rr * 0.75, r: spread * (0.12 + rnd() * 0.12), light: true });
  }
  return { x, baseY, h, trunkW: Math.max(3 * s, h * 0.045), lean, phase: rnd() * 10, blobs };
}

function rockyEdge(W: number, rnd: () => number, fn: (x: number) => number) {
  const pts: number[] = [];
  for (let x = -60; x <= W + 60; x += 14) pts.push(x, fn(x) + (rnd() - 0.5) * 5);
  const top = (x: number) => {
    const i = Math.max(0, Math.min(pts.length / 2 - 2, Math.floor((x + 60) / 14)));
    const x0 = pts[i * 2];
    const t = (x - x0) / 14;
    return pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * Math.max(0, Math.min(1, t));
  };
  return { pts, top };
}

function ledgePaths(W: number, H: number, pts: number[], s: number) {
  const rock = new Path2D();
  rock.moveTo(-60, H + 60);
  for (let i = 0; i < pts.length; i += 2) rock.lineTo(pts[i], pts[i + 1]);
  rock.lineTo(W + 60, H + 60);
  rock.closePath();
  const light = new Path2D();
  for (let i = 0; i < pts.length - 2; i += 2) {
    light.moveTo(pts[i], pts[i + 1]);
    light.lineTo(pts[i + 2], pts[i + 3]);
    light.lineTo(pts[i + 2], pts[i + 3] + 5 * s);
    light.lineTo(pts[i], pts[i + 1] + 5 * s);
    light.closePath();
  }
  return { rock, light };
}

function nandiForeground(W: number, H: number, s: number, rnd: () => number) {
  const n = Math.min(H * 0.0028, W * 0.0034);
  const nx = Math.max(W * 0.2, 72 * n);
  const outcropR = nx + 80 * n;
  const edge = rockyEdge(W, rnd, (x) => {
    const rise = 1 - smoothstep(outcropR - 40 * n, outcropR + 60 * n, x);
    return H * 0.875 - rise * (H * 0.875 - (H * 0.83 - 4 * n)) + Math.sin(x * 0.01) * 4 * s;
  });
  const { rock, light } = ledgePaths(W, H, edge.pts, s);
  const boulders = new Path2D();
  for (let i = 0; i < 5; i++) {
    const bx = outcropR + 40 * s + rnd() * (W - outcropR);
    const by = edge.top(bx) + 4 * s;
    const br = (8 + rnd() * 14) * s;
    boulders.moveTo(bx + br, by);
    boulders.ellipse(bx, by, br, br * 0.6, 0, Math.PI, 0);
  }
  const bull = nandi(nx, edge.top(nx) - 15 * n, n);
  const bu = n;
  const bx = Math.min(W * 0.6, Math.max(W * 0.47, nx + 72 * n + 95 * bu));
  const bench: BenchSpot = { x: bx, y: edge.top(bx) + 3 * bu, u: bu };
  const trees = [
    makeTree(W - Math.max(60 * s, W * 0.06), edge.top(W * 0.94) + 4, Math.min(H * 0.55, W * 0.6), s, rnd, -0.04),
    makeTree(W * 0.7, edge.top(W * 0.7) + 4, Math.min(H * 0.18, W * 0.22), s, rnd, 0.02),
  ];
  return {
    ledgeTop: edge.top,
    trees,
    bench,
    draw(ctx: CanvasRenderingContext2D, f: Frame) {
      ctx.fillStyle = f.c.rock;
      ctx.fill(rock);
      ctx.fillStyle = f.c.rockLight;
      ctx.fill(light);
      ctx.fill(boulders);
      bull.draw(ctx, f);
    },
  };
}

function summitForeground(W: number, H: number, s: number, rnd: () => number) {
  const edge = rockyEdge(W, rnd, (x) => H * 0.885 + Math.sin(x * 0.006) * 3 * s);
  const { rock, light } = ledgePaths(W, H, edge.pts, s);
  const gw = Math.min(W * 0.3, H * 0.36);
  const gu = gw / 100;
  const gx = W - gw * 0.18;
  const tower = gopuram(gx, H + 2, gu);
  // railing in front of the viewing platform
  const rail = new Path2D();
  const postGap = Math.max(26, 44 * s);
  const railY = H * 0.885 - 30 * s;
  for (let x = -10; x < gx - gw * 0.55; x += postGap) {
    rail.rect(x, railY - 2 * s, 3 * s, 34 * s);
  }
  rail.rect(-20, railY, gx - gw * 0.55 + 20, 3 * s);
  rail.rect(-20, railY + 14 * s, gx - gw * 0.55 + 20, 2.4 * s);
  const su = Math.min(H * 0.0028, W * 0.0034);
  const sx = Math.min(gx - gw * 0.55 - 90 * su, Math.max(W * 0.5, W * 0.33 + 110 * su));
  const bench: BenchSpot = { x: sx, y: edge.top(sx) + 3 * su, u: su };
  const trees = [
    makeTree(Math.max(40 * s, W * 0.05), edge.top(W * 0.05) + 4, Math.min(H * 0.6, W * 0.62), s, rnd, 0.03),
    makeTree(W * 0.33, edge.top(W * 0.33) + 4, Math.min(H * 0.16, W * 0.2), s, rnd, -0.02),
  ];
  return {
    ledgeTop: edge.top,
    trees,
    bench,
    draw(ctx: CanvasRenderingContext2D, f: Frame) {
      ctx.fillStyle = f.c.rock;
      ctx.fill(rock);
      ctx.fillStyle = f.c.rockLight;
      ctx.fill(light);
      ctx.fillStyle = f.c.stone;
      ctx.fill(rail);
      tower.draw(ctx, f);
    },
  };
}
