import { css, mix, mulberry32 } from '../util';
import type { Frame } from './types';

interface Cloud {
  x: number;
  y: number;
  speed: number;
  scale: number;
  path: Path2D;
  w: number;
}

export class Sky {
  private stars: Float32Array = new Float32Array(0);
  private clouds: Cloud[] = [];
  private W = 0;
  private H = 0;

  resize(W: number, H: number, horizonY: number, s: number) {
    this.W = W;
    this.H = H;
    const rnd = mulberry32(42);
    const n = Math.round(Math.min(220, (W * horizonY) / 5200));
    this.stars = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      this.stars[i * 4] = rnd() * W;
      this.stars[i * 4 + 1] = rnd() ** 1.4 * horizonY * 0.92;
      this.stars[i * 4 + 2] = 0.5 + rnd() * 1.1;
      this.stars[i * 4 + 3] = rnd() * 10;
    }
    this.clouds = [];
    const count = W < 700 ? 4 : 7;
    for (let i = 0; i < count; i++) {
      const path = new Path2D();
      const blobs = 4 + ((rnd() * 4) | 0);
      let w = 0;
      for (let b = 0; b < blobs; b++) {
        const r = (16 + rnd() * 22) * (b === 0 || b === blobs - 1 ? 0.7 : 1);
        const bx = w + r * 0.6;
        path.moveTo(bx + r, -r * 0.3);
        path.arc(bx, -r * 0.3, r, 0, Math.PI * 2);
        w = bx + r * 0.6;
      }
      path.rect(4, -10, w - 8, 10);
      this.clouds.push({
        x: rnd() * (W + 300) - 150,
        y: horizonY * (0.12 + rnd() * 0.55),
        speed: (3 + rnd() * 5) * s,
        scale: s * (0.6 + rnd() * 0.7),
        path,
        w,
      });
    }
  }

  drawBackground(ctx: CanvasRenderingContext2D, f: Frame, horizonY: number) {
    const { W, H } = this;
    const { pal } = f;
    const grd = ctx.createLinearGradient(0, 0, 0, horizonY * 1.05);
    grd.addColorStop(0, f.c.skyTop);
    grd.addColorStop(0.65, css(mix(pal.skyTop, pal.skyBottom, 0.6)));
    grd.addColorStop(1, f.c.skyBottom);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    // stars
    if (f.night > 0.05) {
      const a = f.night * (1 - f.rain * 0.9);
      ctx.fillStyle = '#fff8e8';
      const st = this.stars;
      for (let i = 0; i < st.length; i += 4) {
        ctx.globalAlpha = a * (0.45 + 0.55 * Math.sin(f.time * 0.8 + st[i + 3]) ** 2);
        ctx.fillRect(st[i], st[i + 1], st[i + 2], st[i + 2]);
      }
      ctx.globalAlpha = 1;
    }

    // moon
    if (f.night > 0.02) {
      const mx = W * 0.78 + f.px * 0.05;
      const my = horizonY * 0.3;
      const r = Math.max(9, H * 0.022);
      const a = f.night * (1 - f.rain * 0.7);
      const g = ctx.createRadialGradient(mx, my, r * 0.5, mx, my, r * 6);
      g.addColorStop(0, `rgba(230,232,255,${0.22 * a})`);
      g.addColorStop(1, 'rgba(230,232,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(mx - r * 6, my - r * 6, r * 12, r * 12);
      ctx.fillStyle = `rgba(250,246,230,${a})`;
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(210,205,200,${0.35 * a})`;
      ctx.beginPath();
      ctx.arc(mx - r * 0.3, my - r * 0.2, r * 0.22, 0, Math.PI * 2);
      ctx.arc(mx + r * 0.35, my + r * 0.25, r * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }

    // sun + glow
    const sunVis = 1 - f.night;
    if (sunVis > 0.01) {
      const sx = f.sunX;
      const sy = f.sunY;
      const r = Math.max(14, H * 0.036);
      const glowR = H * (0.35 + f.golden * 0.25);
      const g = ctx.createRadialGradient(sx, sy, r * 0.6, sx, sy, glowR);
      g.addColorStop(0, css(pal.sun, 0.55 * sunVis * (1 - f.rain * 0.8)));
      g.addColorStop(1, css(pal.sun, 0));
      ctx.fillStyle = g;
      ctx.fillRect(sx - glowR, sy - glowR, glowR * 2, glowR * 2);
      ctx.fillStyle = css(pal.sun, sunVis * (1 - f.rain * 0.85));
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawClouds(ctx: CanvasRenderingContext2D, f: Frame, horizonY: number) {
    const { W } = this;
    const { pal } = f;
    const dark = mix(pal.cloud, [70, 78, 96], f.rain * (0.55 - f.night * 0.3));
    const under = mix(dark, pal.skyBottom, 0.35);
    for (const c of this.clouds) {
      c.x += c.speed * f.dt * (1 + f.wind * 3);
      if (c.x > W + 40) c.x = -c.w * c.scale - 40;
      ctx.save();
      ctx.translate(c.x + f.px * 0.08, c.y);
      ctx.scale(c.scale, c.scale * 0.85);
      ctx.fillStyle = css(under, 0.9);
      ctx.translate(0, 4);
      ctx.fill(c.path);
      ctx.translate(0, -4);
      ctx.fillStyle = css(dark, 0.92);
      ctx.fill(c.path);
      ctx.restore();
    }
    if (f.rain > 0.01) {
      // overcast deck rolling in from the top
      const g = ctx.createLinearGradient(0, 0, 0, horizonY * 1.1);
      const deck = mix([96, 104, 122], pal.skyTop, 0.25 + f.night * 0.5);
      g.addColorStop(0, css(deck, 0.88 * f.rain));
      g.addColorStop(0.7, css(deck, 0.55 * f.rain));
      g.addColorStop(1, css(deck, 0.15 * f.rain));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, horizonY * 1.1);
    }
  }
}
