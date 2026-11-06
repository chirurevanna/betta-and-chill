import { EFFECTS, type EffectType } from '../protocol';
import { easeInOutSine, smoothstep } from '../util';

const COOLDOWN: Record<EffectType, number> = { birds: 8, sun: 0, breeze: 10, rain: 20 };
const SUN_DURATION = 40;
const BREEZE = { up: 3, hold: 9, down: 3 };
const RAIN = { up: 5, hold: 34, down: 6 };

const envelope = (e: number, c: { up: number; hold: number; down: number }) =>
  e < 0 ? 0 : smoothstep(0, c.up, e) * (1 - smoothstep(c.up + c.hold, c.up + c.hold + c.down, e));
const total = (c: { up: number; hold: number; down: number }) => c.up + c.hold + c.down;

/** Time-based state for every effect. All times in seconds. */
export class Effects {
  phase: number;
  private from = 0;
  private to = 0;
  private sunStart = -1e9;
  /** -1 = sun sets/rises on the left (west), +1 = on the right (east) */
  sunSide = -1;
  private breezeStart = -1e9;
  private rainStart = -1e9;
  private last: Record<EffectType, number> = { birds: -1e9, sun: -1e9, breeze: -1e9, rain: -1e9 };
  wind = 0.12;
  rain = 0;
  /** Set by the scene so it can spawn birds when asked. */
  onBirds: (() => void) | null = null;

  /** phase: 0 day … 1 night (intermediate values show golden hour / sunset). */
  constructor(phase: number) {
    this.phase = this.from = this.to = phase;
  }

  get sunBusy() {
    return this.from !== this.to;
  }
  /** What the scene is heading toward: true if night is (or will be) the resting state. */
  get isNight() {
    return this.to >= 0.5;
  }

  cooldownMs(type: EffectType, now: number): number {
    if (type === 'sun') {
      return this.sunBusy ? Math.max(0, (this.sunStart + SUN_DURATION - now) * 1000) : 0;
    }
    return Math.max(0, (this.last[type] + COOLDOWN[type] - now) * 1000);
  }

  cooldowns(now: number): Record<EffectType, number> {
    const out = {} as Record<EffectType, number>;
    for (const e of EFFECTS) out[e] = Math.round(this.cooldownMs(e, now));
    return out;
  }

  /** Returns false if the effect is still cooling down. */
  trigger(type: EffectType, now: number): boolean {
    if (this.cooldownMs(type, now) > 0) return false;
    this.last[type] = now;
    switch (type) {
      case 'birds':
        this.onBirds?.();
        break;
      case 'sun':
        this.from = this.phase;
        this.to = this.phase < 0.5 ? 1 : 0;
        // sunset in the west (left); sunrise in the east (right)
        this.sunSide = this.to === 1 ? -1 : 1;
        this.sunStart = now;
        break;
      case 'breeze': {
        const e = now - this.breezeStart;
        this.breezeStart = e < total(BREEZE) ? now - Math.min(e, BREEZE.up) : now;
        break;
      }
      case 'rain': {
        const e = now - this.rainStart;
        this.rainStart = e < total(RAIN) ? now - Math.min(e, RAIN.up) : now;
        break;
      }
    }
    return true;
  }

  update(now: number) {
    if (this.sunBusy) {
      const t = Math.min(1, (now - this.sunStart) / SUN_DURATION);
      this.phase = this.from + (this.to - this.from) * easeInOutSine(t);
      if (t >= 1) this.from = this.to;
    }
    const breeze = envelope(now - this.breezeStart, BREEZE);
    this.rain = envelope(now - this.rainStart, RAIN);
    this.wind = 0.12 + 0.88 * Math.max(breeze, this.rain * 0.35);
  }
}
