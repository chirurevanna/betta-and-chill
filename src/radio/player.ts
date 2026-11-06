import { clamp, storageGet, storageSet } from '../util';
import { STATIONS, type Station } from './stations';

const STALL_MS = 10_000;
/** after every station failed, wait this long and try the whole list again */
const RETRY_ALL_MS = 60_000;
const DIRECTORY = 'https://all.api.radio-browser.info/json/stations/byuuid';
const LOG = '%c📻 radio';
const LOG_STYLE = 'color:#e9a23b;font-weight:bold';

export type PlayResult = 'ok' | 'blocked' | 'unavailable';
type Health = 'unknown' | 'up' | 'down';

/**
 * Live radio through a single <audio> element. Deliberately not routed through Web Audio:
 * most streams send no CORS headers, which would make a MediaElementSource output silence.
 *
 * The radio is on by default and keeps playing (reconnecting / failing over) until someone
 * explicitly turns it off; that choice is remembered.
 */
export class Radio {
  private el = new Audio();
  private stations: Station[] = STATIONS.map((s) => ({ ...s }));
  /** Radio Browser's last health check per station id */
  private directory = new Map<string, Health>();
  /** language tag from the directory; anything other than exactly "kannada" is skipped */
  private language = new Map<string, string>();
  /** what actually happened when this browser tried to play it */
  private session = new Map<string, Health>();
  private idx: number;
  private vol: number;
  private duckFactor = 1;
  private wanted = false;
  private failures = 0;
  private stallTimer = 0;
  private retryTimer = 0;
  private _blocked = false;
  private _unavailable = false;
  onChange: () => void = () => {};

  constructor() {
    this.el.preload = 'none';
    const saved = this.stations.findIndex((s) => s.id === storageGet('bc.radio.station'));
    this.idx = saved >= 0 ? saved : 0;
    const v = Number(storageGet('bc.radio.vol'));
    this.vol = Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.7;
    this.applyVolume();

    this.el.addEventListener('playing', () => {
      clearTimeout(this.stallTimer);
      this.failures = 0;
      this._unavailable = false;
      this.mark(this.station, 'up');
      console.info(`${LOG} ▶ now playing: %c${this.station.name}%c  ${this.station.url}`, LOG_STYLE, 'font-weight:bold', '');
      this.onChange();
    });
    this.el.addEventListener('error', () => this.fail('stream error'));
    this.el.addEventListener('stalled', () => this.armStall());
    this.el.addEventListener('waiting', () => this.armStall());
    // a live stream "ending" means the server dropped us: reconnect
    this.el.addEventListener('ended', () => {
      if (!this.wanted) return;
      console.info(`${LOG} stream ended, reconnecting to ${this.station.name}`, LOG_STYLE);
      this.load();
      void this.start();
    });
  }

  /** On unless someone turned it off (remembered across visits). */
  get preferredOn() {
    return storageGet('bc.radio') !== 'off';
  }
  get on() {
    return this.wanted;
  }
  get station(): Station {
    return this.stations[this.idx];
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

  /** Ask Radio Browser which stations currently pass its health check, then log the list. */
  async checkDirectory() {
    try {
      const uuids = this.stations.map((s) => s.uuid).join(',');
      const res = await fetch(`${DIRECTORY}?uuids=${uuids}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(4000), // never hold up the music for the health check
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as { stationuuid: string; lastcheckok: number; language: string }[];
      for (const r of rows) {
        const s = this.stations.find((x) => x.uuid === r.stationuuid);
        if (!s) continue;
        this.directory.set(s.id, r.lastcheckok === 1 ? 'up' : 'down');
        this.language.set(s.id, r.language.trim().toLowerCase());
      }
    } catch (e) {
      console.warn(`${LOG} could not reach radio-browser.info for station health`, LOG_STYLE, e);
    }
    this.logStations();
  }

  /** Print every station with its availability. */
  logStations() {
    const label: Record<Health, string> = { unknown: '–', up: '✅ up', down: '❌ down' };
    const rows = this.stations.map((s, i) => ({
      station: s.name,
      language: this.language.get(s.id) ?? '–',
      directory: label[this.directory.get(s.id) ?? 'unknown'],
      'this browser': label[this.session.get(s.id) ?? 'unknown'],
      playing: this.wanted && i === this.idx ? '▶' : '',
      url: s.url,
    }));
    const up = this.stations.filter((s) => this.isAvailable(s)).length;
    console.groupCollapsed(`${LOG} ${up}/${this.stations.length} stations available`, LOG_STYLE);
    console.table(rows);
    console.groupEnd();
  }

  async play(): Promise<PlayResult> {
    clearTimeout(this.retryTimer);
    this.wanted = true;
    this._unavailable = false;
    if (!this.isAvailable(this.station)) this.skipToAvailable();
    this.load();
    const r = await this.start();
    this.onChange();
    return r;
  }

  /** An explicit "turn it off" from a person: remembered. */
  turnOff() {
    storageSet('bc.radio', 'off');
    this.stop();
    console.info(`${LOG} ⏸ turned off`, LOG_STYLE);
    this.onChange();
  }

  async turnOn(): Promise<PlayResult> {
    storageSet('bc.radio', 'on');
    return this.play();
  }

  toggle(): Promise<PlayResult> | PlayResult {
    if (this.wanted) {
      this.turnOff();
      return 'ok';
    }
    return this.turnOn();
  }

  /** All selectable (Kannada) stations with their current availability. */
  list(): { id: string; name: string; available: boolean }[] {
    return this.stations
      .filter((s) => this.isKannada(s))
      .map((s) => ({ id: s.id, name: s.name, available: this.isAvailable(s) }));
  }

  /** A person picked a station: switch to it and make sure the radio is on. */
  async select(id: string): Promise<PlayResult> {
    const i = this.stations.findIndex((s) => s.id === id);
    if (i < 0 || !this.isKannada(this.stations[i])) return 'ok';
    if (i === this.idx && this.wanted) return 'ok';
    this.idx = i;
    storageSet('bc.radio.station', this.station.id);
    this.failures = 0;
    this.session.delete(this.station.id); // give it a fresh chance even if it failed before
    console.info(`${LOG} station picked: ${this.station.name}`, LOG_STYLE);
    storageSet('bc.radio', 'on');
    clearTimeout(this.retryTimer);
    this.wanted = true;
    this._unavailable = false;
    this.load();
    const r = await this.start();
    this.onChange();
    return r;
  }

  /**
   * Follow a station chosen by someone else (the bench): switch if playing, otherwise just
   * remember it so it plays when this listener turns the radio on. Never forces sound on.
   */
  async tune(id: string): Promise<PlayResult> {
    if (id === this.station.id && (this.wanted || this._blocked)) return 'ok';
    if (this.wanted) {
      const i = this.stations.findIndex((s) => s.id === id);
      if (i < 0) return 'ok';
      this.idx = i;
      storageSet('bc.radio.station', id);
      this.failures = 0;
      this.session.delete(id);
      console.info(`${LOG} bench switched to ${this.station.name}`, LOG_STYLE);
      this.load();
      const r = await this.start();
      this.onChange();
      return r;
    }
    const i = this.stations.findIndex((s) => s.id === id);
    if (i >= 0) {
      this.idx = i;
      storageSet('bc.radio.station', id);
      this.onChange();
    }
    return 'ok';
  }

  /** The station `step` places away (skipping non-Kannada ones), without switching to it. */
  stationIdAt(step: number): string {
    const n = this.stations.length;
    let j = this.idx;
    for (let i = 0; i < n; i++) {
      j = (j + step + n) % n;
      if (this.isKannada(this.stations[j])) break;
    }
    return this.stations[j].id;
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

  private isKannada(s: Station) {
    const lang = this.language.get(s.id);
    return lang === undefined || lang === 'kannada'; // unknown = trust the curated list
  }

  private isAvailable(s: Station) {
    return this.isKannada(s) && this.session.get(s.id) !== 'down' && this.directory.get(s.id) !== 'down';
  }

  private mark(s: Station, h: Health) {
    if (this.session.get(s.id) === h) return;
    this.session.set(s.id, h);
  }

  /** Move to the next station not known to be down (stays put if all are). */
  private skipToAvailable() {
    for (let i = 1; i <= this.stations.length; i++) {
      const j = (this.idx + i) % this.stations.length;
      if (this.isAvailable(this.stations[j])) {
        this.idx = j;
        return;
      }
    }
  }

  private stop() {
    this.wanted = false;
    clearTimeout(this.stallTimer);
    clearTimeout(this.retryTimer);
    this.el.pause();
    // drop the connection: a paused live stream would otherwise keep buffering
    this.el.removeAttribute('src');
    this.el.load();
  }

  private applyVolume() {
    this.el.volume = clamp(this.vol * this.duckFactor, 0, 1);
  }

  private async go(step: number): Promise<PlayResult> {
    const n = this.stations.length;
    for (let i = 0; i < n; i++) {
      this.idx = (this.idx + step + n) % n;
      if (this.isKannada(this.station)) break; // never land on a non-Kannada station
    }
    storageSet('bc.radio.station', this.station.id);
    this.failures = 0;
    if (!this.wanted) {
      this.onChange();
      return 'ok';
    }
    // a person picked this station: give it a fresh chance even if it failed before
    this.session.delete(this.station.id);
    this.load();
    const r = await this.start();
    this.onChange();
    return r;
  }

  private load() {
    clearTimeout(this.stallTimer);
    console.info(`${LOG} connecting to ${this.station.name}…`, LOG_STYLE);
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
        // autoplay policy: needs a tap or key press on this screen first
        clearTimeout(this.stallTimer);
        this.wanted = false;
        this._blocked = true;
        console.info(`${LOG} waiting for a tap or key press — the browser blocks autoplay with sound`, LOG_STYLE);
        return 'blocked';
      }
      // NotSupportedError / AbortError: the error/stall path fails over
      return 'ok';
    }
  }

  private armStall() {
    if (!this.wanted) return;
    clearTimeout(this.stallTimer);
    this.stallTimer = window.setTimeout(() => this.fail('no audio for 10s'), STALL_MS);
  }

  /** Current station failed: try the next one; after a full cycle, pause and retry later. */
  private fail(reason: string) {
    if (!this.wanted) return;
    clearTimeout(this.stallTimer);
    const dead = this.station;
    this.mark(dead, 'down');
    this.failures++;
    console.warn(`${LOG} ✖ ${dead.name} failed (${reason})`, LOG_STYLE);

    if (this.failures >= this.stations.length) {
      this._unavailable = true;
      this.el.removeAttribute('src');
      this.el.load();
      console.warn(`${LOG} no station reachable — retrying in ${RETRY_ALL_MS / 1000}s`, LOG_STYLE);
      this.logStations();
      this.onChange();
      this.retryTimer = window.setTimeout(() => {
        if (!this.wanted) return;
        this.session.clear();
        this.failures = 0;
        void this.play();
      }, RETRY_ALL_MS);
      return;
    }

    this.idx = (this.idx + 1) % this.stations.length;
    if (!this.isAvailable(this.station)) this.skipToAvailable();
    storageSet('bc.radio.station', this.station.id);
    this.logStations();
    this.load();
    void this.start().then(() => this.onChange());
  }
}
