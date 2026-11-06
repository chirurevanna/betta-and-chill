import { clamp, storageGet, storageSet } from '../util';
import { STATIONS, type Station } from './stations';

const STALL_MS = 10_000;

export type PlayResult = 'ok' | 'blocked' | 'unavailable';

/**
 * Live radio through a single <audio> element. Deliberately not routed through Web Audio:
 * most streams send no CORS headers, which would make a MediaElementSource output silence.
 */
export class Radio {
  private el = new Audio();
  private idx: number;
  private vol: number;
  private duckFactor = 1;
  private wanted = false;
  private failures = 0;
  private stallTimer = 0;
  private _blocked = false;
  private _unavailable = false;
  onChange: () => void = () => {};

  constructor() {
    this.el.preload = 'none';
    const saved = STATIONS.findIndex((s) => s.id === storageGet('bc.radio.station'));
    this.idx = saved >= 0 ? saved : 0;
    const v = Number(storageGet('bc.radio.vol'));
    this.vol = Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.7;
    this.applyVolume();

    this.el.addEventListener('playing', () => {
      clearTimeout(this.stallTimer);
      this.failures = 0;
      this._unavailable = false;
      this.onChange();
    });
    this.el.addEventListener('error', () => this.fail());
    this.el.addEventListener('stalled', () => this.armStall());
    this.el.addEventListener('waiting', () => this.armStall());
  }

  get on() {
    return this.wanted;
  }
  get station(): Station {
    return STATIONS[this.idx];
  }
  get volume() {
    return this.vol;
  }
  get blocked() {
    return this._blocked;
  }
  get unavailable() {
    return this._unavailable;
  }

  async play(): Promise<PlayResult> {
    this.wanted = true;
    this._unavailable = false;
    this.load();
    const r = await this.start();
    this.onChange();
    return r;
  }

  pause() {
    this.wanted = false;
    clearTimeout(this.stallTimer);
    this.el.pause();
    // drop the connection: a paused live stream would otherwise keep buffering
    this.el.removeAttribute('src');
    this.el.load();
    this.onChange();
  }

  toggle(): Promise<PlayResult> | PlayResult {
    if (this.wanted) {
      this.pause();
      return 'ok';
    }
    return this.play();
  }

  next() {
    return this.go(1);
  }
  prev() {
    return this.go(-1);
  }

  setVolume(v: number) {
    this.vol = clamp(v, 0, 1);
    storageSet('bc.radio.vol', this.vol.toFixed(2));
    this.applyVolume();
    this.onChange();
  }

  /** Lower the radio while rain is heavy so the synthesized rain still comes through. */
  duck(rain: number) {
    const f = 1 - clamp(rain) * 0.45;
    if (Math.abs(f - this.duckFactor) < 0.01) return;
    this.duckFactor = f;
    this.applyVolume();
  }

  private applyVolume() {
    this.el.volume = clamp(this.vol * this.duckFactor, 0, 1);
  }

  private async go(step: number): Promise<PlayResult> {
    this.idx = (this.idx + step + STATIONS.length) % STATIONS.length;
    storageSet('bc.radio.station', this.station.id);
    this.failures = 0;
    if (!this.wanted) {
      this.onChange();
      return 'ok';
    }
    return this.play();
  }

  private load() {
    clearTimeout(this.stallTimer);
    this.el.src = this.station.url;
    this.armStall();
  }

  private async start(): Promise<PlayResult> {
    try {
      await this.el.play();
      this._blocked = false;
      return 'ok';
    } catch (e) {
      if ((e as DOMException)?.name === 'NotAllowedError') {
        // autoplay policy: needs a tap on this screen first
        clearTimeout(this.stallTimer);
        this.wanted = false;
        this._blocked = true;
        return 'blocked';
      }
      // NotSupportedError / AbortError: let the error/stall path fail over
      return 'ok';
    }
  }

  private armStall() {
    if (!this.wanted) return;
    clearTimeout(this.stallTimer);
    this.stallTimer = window.setTimeout(() => this.fail(), STALL_MS);
  }

  /** Current station failed: try the next one, give up after a full cycle. */
  private fail() {
    if (!this.wanted) return;
    clearTimeout(this.stallTimer);
    this.failures++;
    if (this.failures >= STATIONS.length) {
      this.wanted = false;
      this._unavailable = true;
      this.el.removeAttribute('src');
      this.el.load();
      this.onChange();
      return;
    }
    this.idx = (this.idx + 1) % STATIONS.length;
    storageSet('bc.radio.station', this.station.id);
    this.load();
    void this.start().then(() => this.onChange());
  }
}
