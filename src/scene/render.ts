import { Birds, Leaves, Rain } from '../effects/particles';
import type { Effects } from '../effects/manager';
import { clamp, css, lerp, mix, smoothstep } from '../util';
import { BenchScene, drawFarBenches } from './bench';
import { buildLayout, type Layout } from './build';
import { goldenOf, nightOf, paletteAt, type PaletteKey } from './palette';
import { Sky } from './sky';
import type { Frame, TreeDef, ViewId } from './types';

const MAX_SHIFT = 14;
const FADE = 1.5;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private layout!: Layout;
  private sky = new Sky();
  readonly birds = new Birds();
  private leaves = new Leaves();
  private rain = new Rain();
  readonly bench = new BenchScene();
  private W = 0;
  private H = 0;
  private dpr = 1;
  private view: ViewId;
  private ptr = { x: 0, y: 0, sx: 0, sy: 0 };
  private side = -1;
  private fadeFrom: HTMLCanvasElement | null = null;
  private fadeT = 0;
  private time = 0;
  readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(
    private canvas: HTMLCanvasElement,
    view: ViewId,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.view = view;
    this.resize();
    if (!this.reduced) {
      addEventListener('pointermove', (e) => {
        this.ptr.x = (e.clientX / innerWidth) * 2 - 1;
        this.ptr.y = (e.clientY / innerHeight) * 2 - 1;
      });
    }
  }

  get currentView() {
    return this.view;
  }
  get horizonY() {
    return this.layout.horizonY;
  }
  get scale() {
    return this.layout.s;
  }
  get width() {
    return this.W;
  }

  resize() {
    this.W = innerWidth;
    this.H = innerHeight;
    this.dpr = Math.min(devicePixelRatio || 1, this.W < 800 ? 1.5 : 2);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.layout = buildLayout(this.W, this.H, this.view);
    this.sky.resize(this.W, this.H, this.layout.horizonY, this.layout.s);
    this.rain.resize(this.W, this.H);
  }

  /** Cross-fade to another viewpoint. */
  setView(view: ViewId) {
    if (view === this.view) return;
    const snap = document.createElement('canvas');
    snap.width = this.canvas.width;
    snap.height = this.canvas.height;
    snap.getContext('2d')!.drawImage(this.canvas, 0, 0);
    this.fadeFrom = snap;
    this.fadeT = 0;
    this.view = view;
    this.layout = buildLayout(this.W, this.H, view);
    this.sky.resize(this.W, this.H, this.layout.horizonY, this.layout.s);
  }

  private treeSway(t: TreeDef, f: Frame) {
    const calm = this.reduced ? 0.3 : 1;
    return (
      calm *
      (Math.sin(this.time * 0.6 + t.phase) * 0.012 +
        f.wind * (0.05 + 0.025 * Math.sin(this.time * 2.1 + t.phase)) +
        Math.sin(this.time * 4.7 + t.phase * 2) * f.wind * f.wind * 0.012)
    );
  }

  private drawTree(ctx: CanvasRenderingContext2D, t: TreeDef, f: Frame) {
    const sway = this.treeSway(t, f);
    const topX = t.x + (t.lean + sway) * t.h;
    const topY = t.baseY - t.h;
    const midX = t.x + (t.lean + sway * 0.35) * t.h * 0.5;
    ctx.fillStyle = f.c.trunk;
    ctx.beginPath();
    ctx.moveTo(t.x - t.trunkW, t.baseY);
    ctx.quadraticCurveTo(midX - t.trunkW * 0.6, t.baseY - t.h * 0.5, topX - t.trunkW * 0.35, topY + t.h * 0.1);
    ctx.lineTo(topX + t.trunkW * 0.35, topY + t.h * 0.1);
    ctx.quadraticCurveTo(midX + t.trunkW * 0.6, t.baseY - t.h * 0.5, t.x + t.trunkW, t.baseY);
    ctx.closePath();
    ctx.fill();
    // a couple of branches
    ctx.strokeStyle = f.c.trunk;
    ctx.lineWidth = t.trunkW * 0.45;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(midX, t.baseY - t.h * 0.62);
    ctx.quadraticCurveTo(midX - t.h * 0.06, topY + t.h * 0.2, topX - t.h * 0.12, topY + t.h * 0.04);
    ctx.moveTo(midX, t.baseY - t.h * 0.68);
    ctx.quadraticCurveTo(midX + t.h * 0.06, topY + t.h * 0.2, topX + t.h * 0.13, topY + t.h * 0.06);
    ctx.stroke();

    const flutter = f.wind * f.wind;
    const golden = mix(f.pal.fgTreeLight, f.pal.sun, 0.12 * f.golden);
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0 ? f.c.fgTree : css(golden);
      ctx.beginPath();
      for (let i = 0; i < t.blobs.length; i++) {
        const b = t.blobs[i];
        if (b.light !== (pass === 1)) continue;
        const lift = 1 + (-b.dy / t.h) * 0.6;
        const fx = Math.sin(this.time * 6 + i * 1.3 + t.phase) * b.r * 0.08 * flutter;
        const fy = Math.cos(this.time * 5 + i) * b.r * 0.05 * flutter;
        const x = topX + b.dx + sway * t.h * 0.25 * lift + fx;
        const y = topY + b.dy + fy;
        ctx.moveTo(x + b.r, y);
        ctx.arc(x, y, b.r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  render(now: number, dt: number, fx: Effects) {
    this.time = now;
    const { ctx, W, H, layout } = this;
    const p = fx.phase;
    const pal = paletteAt(p, fx.rain);
    const c = {} as Record<PaletteKey, string>;
    for (const k in pal) c[k as PaletteKey] = css(pal[k as PaletteKey]);

    // smoothed parallax
    const k = 1 - Math.exp(-dt * 2.5);
    this.ptr.sx = lerp(this.ptr.sx, this.ptr.x, k);
    this.ptr.sy = lerp(this.ptr.sy, this.ptr.y, k);
    this.side = lerp(this.side, fx.sunSide, 1 - Math.exp(-dt * 0.4));

    const e = smoothstep(0, 0.68, p);
    const night = nightOf(p);
    const f: Frame = {
      pal,
      c,
      p,
      night,
      golden: goldenOf(p),
      rain: fx.rain,
      wind: fx.wind,
      bulbs: smoothstep(0.62, 0.86, p),
      time: now,
      dt,
      px: -this.ptr.sx * MAX_SHIFT,
      py: -this.ptr.sy * MAX_SHIFT * 0.35,
      sunX: W / 2 + this.side * W * (0.06 + 0.16 * e),
      sunY: lerp(-H * 0.1, layout.horizonY + H * 0.05, e ** 0.9),
    };

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.sky.drawBackground(ctx, f, layout.horizonY);
    this.sky.drawClouds(ctx, f, layout.horizonY);

    // far hills
    ctx.save();
    ctx.translate(f.px * 0.12, f.py * 0.12);
    ctx.fillStyle = css(mix(pal.hillFar, pal.haze, 0.25));
    ctx.fill(layout.hills);
    ctx.restore();

    // ground plain under the city
    const gy = layout.horizonY;
    const gg = ctx.createLinearGradient(0, gy, 0, layout.forestTop);
    gg.addColorStop(0, css(mix(pal.ground, pal.haze, 0.7)));
    gg.addColorStop(1, c.ground);
    ctx.fillStyle = gg;
    ctx.fillRect(-20, gy, W + 40, H - gy);

    // city, far → near, with depth-based parallax
    for (const d of layout.city) {
      const sh = 0.2 + d.depth * 0.35;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, f.px * sh * this.dpr, f.py * sh * this.dpr);
      d.draw(ctx, f);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // horizon haze softens everything far away
    const hz = ctx.createLinearGradient(0, gy - H * 0.06, 0, gy + H * 0.1);
    hz.addColorStop(0, css(pal.haze, 0));
    hz.addColorStop(0.45, css(pal.haze, 0.26 + f.rain * 0.3));
    hz.addColorStop(1, css(pal.haze, 0));
    ctx.fillStyle = hz;
    ctx.fillRect(0, gy - H * 0.06, W, H * 0.16);

    // warm sodium glow over the city at night
    if (night > 0.05) {
      // flattened ellipse so the glow hugs the city instead of leaking into the sky
      const r = W * 0.55;
      ctx.save();
      ctx.translate(layout.palaceX, layout.palaceY);
      ctx.scale(1, 0.35);
      const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      cg.addColorStop(0, `rgba(255,170,90,${0.18 * night})`);
      cg.addColorStop(1, 'rgba(255,170,90,0)');
      ctx.fillStyle = cg;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }

    // hillside forest
    ctx.save();
    ctx.translate(f.px * 0.6, f.py * 0.6);
    ctx.fillStyle = c.forest;
    ctx.fill(layout.forest);
    ctx.fillStyle = c.forestLight;
    ctx.fill(layout.forestLight);
    drawFarBenches(ctx, f, W, layout.forestTop, layout.s, layout.bench.x);
    ctx.restore();

    this.birds.draw(ctx, f, W);

    // foreground
    ctx.save();
    ctx.translate(f.px, f.py);
    layout.drawForeground(ctx, f);
    for (const t of layout.trees) this.drawTree(ctx, t, f);
    // after the trees: nothing in the scenery may ever cover the people on the bench
    this.bench.draw(ctx, f, layout.bench, W, this.reduced);
    this.leaves.update(f, layout.trees, W, H, layout.s, (t) => this.treeSway(t, f));
    this.leaves.draw(ctx, f);
    ctx.restore();

    // rain in screen space; splash targets corrected for each layer's parallax
    const lakes = layout.lakes.map((l) => {
      const sh = 0.2 + l.depth * 0.35;
      return { ...l, cx: l.cx + f.px * sh, cy: l.cy + f.py * sh };
    });
    this.rain.draw(ctx, f, (x) => layout.ledgeTop(x - f.px) + f.py, lakes);

    // rain dims the world a touch
    if (f.rain > 0.01) {
      ctx.fillStyle = `rgba(28,36,54,${0.16 * f.rain})`;
      ctx.fillRect(0, 0, W, H);
    }

    // soft vignette
    const vg = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.hypot(W, H) * 0.62);
    vg.addColorStop(0, 'rgba(10,12,24,0)');
    vg.addColorStop(1, `rgba(10,12,24,${0.18 + night * 0.17})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // viewpoint cross-fade
    if (this.fadeFrom) {
      this.fadeT += dt;
      const a = 1 - clamp(this.fadeT / FADE);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = a * a * (3 - 2 * a);
      ctx.drawImage(this.fadeFrom, 0, 0);
      ctx.globalAlpha = 1;
      if (a <= 0) this.fadeFrom = null;
    }
  }

  spawnBirds() {
    this.birds.spawn(this.W, this.layout.horizonY, this.layout.s);
  }
}
