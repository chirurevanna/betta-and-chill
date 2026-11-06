import { css, mix, type RGB } from '../util';
import type { Frame, Lake, TreeDef } from '../scene/types';

/* ---------------- birds ---------------- */

interface Bird {
  dx: number;
  dy: number;
  size: number;
  ph: number;
}
interface Flock {
  x: number;
  y: number;
  dir: number;
  speed: number;
  t: number;
  birds: Bird[];
}

export class Birds {
  private flocks: Flock[] = [];

  spawn(W: number, horizonY: number, s: number) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const n = 7 + ((Math.random() * 6) | 0);
    const size = (7 + Math.random() * 3) * s;
    const birds: Bird[] = [];
    for (let i = 0; i < n; i++) {
      const rank = Math.ceil(i / 2);
      const side = i % 2 === 0 ? 1 : -1;
      birds.push({
        dx: -rank * size * 2.6 + (Math.random() - 0.5) * size,
        dy: side * rank * size * 1.5 + (Math.random() - 0.5) * size,
        size: size * (0.85 + Math.random() * 0.3),
        ph: Math.random() * 6,
      });
    }
    this.flocks.push({
      x: dir > 0 ? -size * 30 : W + size * 30,
      y: horizonY * (0.25 + Math.random() * 0.4),
      dir,
      speed: W / (11 + Math.random() * 3),
      t: 0,
      birds,
    });
  }

  draw(ctx: CanvasRenderingContext2D, f: Frame, W: number) {
    if (!this.flocks.length) return;
    const col = mix(f.pal.stone, f.pal.skyTop, 0.15);
    ctx.strokeStyle = css(col, 0.9);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const fl of this.flocks) {
      fl.t += f.dt;
      fl.x += fl.dir * fl.speed * f.dt;
      const baseY = fl.y + Math.sin(fl.t * 0.35) * 18;
      ctx.lineWidth = Math.max(1.2, fl.birds[0].size * 0.16);
      ctx.beginPath();
      for (const b of fl.birds) {
        const bx = fl.x + fl.dir * b.dx;
        const by = baseY + b.dy + Math.sin(fl.t * 1.3 + b.ph) * b.size * 0.3;
        const flap = Math.sin(fl.t * 7 + b.ph);
        const wy = flap * b.size * 0.55;
        const ws = b.size;
        ctx.moveTo(bx - ws, by - wy);
        ctx.quadraticCurveTo(bx - ws * 0.45, by - wy * 0.2 - ws * 0.25, bx, by);
        ctx.quadraticCurveTo(bx + ws * 0.45, by - wy * 0.2 - ws * 0.25, bx + ws, by - wy);
      }
      ctx.stroke();
    }
    this.flocks = this.flocks.filter((fl) => (fl.dir > 0 ? fl.x < W + 600 : fl.x > -600));
  }
}

/* ---------------- leaves (breeze) ---------------- */

interface Leaf {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  hue: number;
  life: number;
}

export class Leaves {
  private leaves: Leaf[] = [];
  private acc = 0;

  update(f: Frame, trees: TreeDef[], W: number, H: number, s: number, sway: (t: TreeDef) => number) {
    const rate = Math.max(0, f.wind - 0.3) * 40;
    this.acc += rate * f.dt;
    while (this.acc > 1 && this.leaves.length < 90) {
      this.acc -= 1;
      const fromTree = Math.random() < 0.7 && trees.length;
      let x: number;
      let y: number;
      if (fromTree) {
        const t = trees[(Math.random() * trees.length) | 0];
        const b = t.blobs[(Math.random() * t.blobs.length) | 0];
        x = t.x + t.lean * t.h + sway(t) * t.h + b.dx;
        y = t.baseY - t.h + b.dy;
      } else {
        x = -20;
        y = H * (0.45 + Math.random() * 0.45);
      }
      this.leaves.push({
        x,
        y,
        vx: (40 + Math.random() * 90) * s,
        vy: (-10 + Math.random() * 30) * s,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 6,
        size: (3 + Math.random() * 3) * s,
        hue: Math.random(),
        life: 0,
      });
    }
    if (this.acc > 1) this.acc = 1;
    for (const l of this.leaves) {
      l.life += f.dt;
      l.vx += (f.wind * 160 * s - l.vx) * 0.6 * f.dt;
      l.vy += (18 * s - l.vy) * 0.5 * f.dt;
      l.x += l.vx * f.dt;
      l.y += (l.vy + Math.sin(l.life * 3 + l.hue * 6) * 22 * s) * f.dt;
      l.rot += l.vr * f.dt;
    }
    this.leaves = this.leaves.filter((l) => l.x < W + 30 && l.y < H + 30 && l.life < 14);
  }

  draw(ctx: CanvasRenderingContext2D, f: Frame) {
    if (!this.leaves.length) return;
    const a = f.pal.fgTreeLight;
    const b: RGB = mix(f.pal.gold, f.pal.fgTreeLight, 0.4);
    for (const l of this.leaves) {
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.rot);
      ctx.fillStyle = css(l.hue < 0.7 ? a : b);
      ctx.beginPath();
      ctx.ellipse(0, 0, l.size, l.size * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

/* ---------------- rain ---------------- */

export class Rain {
  private drops = new Float32Array(0);
  private splashes: { x: number; y: number; t: number; r: number; lake: boolean }[] = [];
  private W = 0;
  private H = 0;

  resize(W: number, H: number) {
    this.W = W;
    this.H = H;
    const n = Math.round(Math.min(700, (W * H) / 2600));
    this.drops = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) this.reset(i, Math.random() * H);
  }

  private reset(i: number, y = -20) {
    const d = this.drops;
    d[i * 4] = Math.random() * (this.W + 200) - 100;
    d[i * 4 + 1] = y;
    d[i * 4 + 2] = 10 + Math.random() * 14; // length
    d[i * 4 + 3] = 0.8 + Math.random() * 0.5; // speed factor
  }

  draw(ctx: CanvasRenderingContext2D, f: Frame, ledgeTop: (x: number) => number, lakes: Lake[]) {
    const { W, H } = this;
    if (f.rain <= 0.005 && !this.splashes.length) return;
    const d = this.drops;
    const n = d.length / 4;
    const active = Math.floor(n * f.rain);
    const slant = 0.12 + f.wind * 0.3;
    const fall = H * 1.25;
    ctx.strokeStyle = css(mix([200, 212, 228], f.pal.skyTop, 0.3), 0.32 + 0.1 * (1 - f.night));
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < active; i++) {
      const sp = fall * d[i * 4 + 3];
      d[i * 4 + 1] += sp * f.dt;
      d[i * 4] += sp * slant * f.dt;
      const x = d[i * 4];
      const y = d[i * 4 + 1];
      const len = d[i * 4 + 2];
      ctx.moveTo(x, y);
      ctx.lineTo(x - len * slant, y - len);
      if (y > H || x > W + 100) this.reset(i);
    }
    ctx.stroke();

    // splashes on the ledge, ripples on the lakes
    if (f.rain > 0.05) {
      const k = f.rain * f.dt;
      if (Math.random() < k * 30) {
        const x = Math.random() * W;
        this.splashes.push({ x, y: ledgeTop(x) + 2 + Math.random() * 12, t: 0, r: 3 + Math.random() * 3, lake: false });
      }
      for (const lk of lakes) {
        if (Math.random() < k * 8 * (lk.rx / 60)) {
          const a = Math.random() * Math.PI * 2;
          const rr = Math.sqrt(Math.random()) * 0.8;
          this.splashes.push({ x: lk.cx + Math.cos(a) * lk.rx * rr, y: lk.cy + Math.sin(a) * lk.ry * rr, t: 0, r: Math.max(1.5, lk.ry * 0.25), lake: true });
        }
      }
    }
    ctx.lineWidth = 1;
    for (const sp of this.splashes) {
      sp.t += f.dt;
      const p = sp.t / 0.6;
      ctx.strokeStyle = css([220, 228, 240], 0.45 * (1 - p));
      ctx.beginPath();
      if (sp.lake) ctx.ellipse(sp.x, sp.y, sp.r * (0.4 + p * 1.5), sp.r * 0.35 * (0.4 + p * 1.5), 0, 0, Math.PI * 2);
      else ctx.arc(sp.x, sp.y, sp.r * (0.5 + p), Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
    this.splashes = this.splashes.filter((sp) => sp.t < 0.6);
  }
}
