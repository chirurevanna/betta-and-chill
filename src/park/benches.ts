import { STATIONS } from '../radio/stations';
import { joinPresence, type PresenceLink } from '../realtime';
import { storageGet, storageSet } from '../util';

export const BENCH_COUNT = 100;
export const SEATS = 4;

/** What each tab publishes on the shared `bc:park` presence channel. */
export interface Sitter {
  /** per-device look (hair, shirt, headphones…) */
  seed: string;
  bench: number | null;
  seat: number;
  sitAt: number;
  /** this sitter's view of the bench station, with the time it was chosen (0 = bench default) */
  station: string;
  stationAt: number;
}

export interface SeatView {
  seed: string;
  me: boolean;
}

export interface BenchView {
  id: number;
  seats: (SeatView | null)[];
  count: number;
  station: string;
  stationAt: number;
}

const LOG = '%c🪑 benches';
const LOG_STYLE = 'color:#7fb36a;font-weight:bold';

function randomId(n = 10) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('');
}

const STATION_IDS = new Set(STATIONS.map((s) => s.id));

export const defaultStation =(bench: number) => STATIONS[bench % STATIONS.length].id;

/**
 * 100 shared benches with 4 seats each. No login and no database: every tab publishes where it
 * sits through Supabase presence, so a seat frees itself when the tab closes. Each bench has one
 * station; the most recent pick by anyone on the bench wins.
 */
export class BenchPark {
  readonly seed: string;
  private key = `t-${randomId(8)}`;
  private link: PresenceLink<Sitter> | null = null;
  private me: Sitter;
  private benches: BenchView[] = [];
  private lastStation = '';
  private _shared = false;

  /** anything changed (occupancy, my seat, stations) */
  onChange: () => void = () => {};
  /** my bench's station changed: follow it */
  onStation: (id: string) => void = () => {};
  /** someone else got my seat at the same instant and the bench is full */
  onBumped: () => void = () => {};

  constructor() {
    let seed = storageGet('bc.me');
    if (!seed) {
      seed = randomId(12);
      storageSet('bc.me', seed);
    }
    this.seed = seed;
    this.me = { seed, bench: null, seat: 0, sitAt: 0, station: '', stationAt: 0 };
    this.recompute();
  }

  /** true once connected to other visitors (false in solo mode) */
  get shared() {
    return this._shared;
  }
  get mine(): number | null {
    return this.me.bench;
  }
  get myBench(): BenchView | null {
    return this.me.bench === null ? null : this.benches[this.me.bench];
  }
  list(): readonly BenchView[] {
    return this.benches;
  }
  get sittingCount() {
    return this.benches.reduce((n, b) => n + b.count, 0);
  }

  async connect() {
    this.link = await joinPresence<Sitter>('bc:park', this.key, {
      onSync: () => this.recompute(),
      onStatus: (s) => {
        this._shared = s === 'online';
        if (s === 'online') console.info(`${LOG} connected — sharing benches with everyone online`, LOG_STYLE);
        if (s === 'unconfigured') console.info(`${LOG} solo mode (no Supabase keys) — benches are only yours`, LOG_STYLE);
        this.onChange();
      },
    });
    if (this.link && this.me.bench !== null) this.link.track(this.me);
  }

  /** Re-take the bench this tab sat on before a reload, if there's still room. */
  restore(): boolean {
    const raw = storageGet('bc.bench', 'session');
    if (!raw || !/^\d+$/.test(raw)) return false;
    const b = Number(raw);
    return b < BENCH_COUNT && this.sit(b);
  }

  sit(bench: number): boolean {
    if (bench === this.me.bench) return true;
    const b = this.benches[bench];
    const free = b?.seats.findIndex((s) => s === null) ?? -1;
    if (free < 0) return false;
    this.me = {
      ...this.me,
      bench,
      seat: free,
      sitAt: Date.now(),
      // adopt the bench's station without overriding it
      station: b.station,
      stationAt: b.stationAt,
    };
    storageSet('bc.bench', String(bench), 'session');
    this.publish();
    console.info(`${LOG} sat on bench ${bench + 1}, seat ${free + 1}`, LOG_STYLE);
    return true;
  }

  /** Prefer a bench that already has company and a free seat; otherwise a random empty one. */
  sitAnywhere(): number | null {
    const open = this.benches.filter((b) => b.count < SEATS && b.id !== this.me.bench);
    if (!open.length) return null;
    const company = open.filter((b) => b.count > 0);
    const pool = company.length ? company : open;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return this.sit(pick.id) ? pick.id : null;
  }

  leave() {
    if (this.me.bench === null) return;
    console.info(`${LOG} left bench ${this.me.bench + 1}`, LOG_STYLE);
    this.me = { ...this.me, bench: null, seat: 0, sitAt: 0, station: '', stationAt: 0 };
    storageSet('bc.bench', '', 'session');
    this.lastStation = '';
    this.publish();
  }

  /** Change the station for everyone on my bench. */
  setStation(id: string) {
    if (this.me.bench === null) return;
    this.me = { ...this.me, station: id, stationAt: Date.now() };
    this.lastStation = id; // we already play it locally
    this.publish();
  }

  private publish() {
    this.link?.track(this.me);
    this.recompute();
  }

  private everyone(): [string, Sitter][] {
    const all = this.link ? this.link.state() : new Map<string, Sitter>();
    all.set(this.key, this.me); // local truth beats a presence echo that may lag
    return [...all].filter(([, s]) => isSitter(s) && s.bench !== null);
  }

  private recompute() {
    const people = this.everyone();
    // earliest claim on a seat keeps it
    people.sort(([ka, a], [kb, b]) => a.sitAt - b.sitAt || (ka < kb ? -1 : 1));

    const benches: BenchView[] = Array.from({ length: BENCH_COUNT }, (_, id) => ({
      id,
      seats: Array<SeatView | null>(SEATS).fill(null),
      count: 0,
      station: defaultStation(id),
      stationAt: 0,
    }));
    const losers: [string, Sitter][] = [];
    for (const [k, s] of people) {
      const b = benches[s.bench!];
      if (STATION_IDS.has(s.station) && s.stationAt > b.stationAt) {
        b.station = s.station;
        b.stationAt = s.stationAt;
      }
      if (b.seats[s.seat] === null) {
        b.seats[s.seat] = { seed: s.seed, me: k === this.key };
        b.count++;
      } else losers.push([k, s]);
    }
    // a second claim on the same seat: slide over to a free seat on that bench if there is one
    for (const [k, s] of losers) {
      const b = benches[s.bench!];
      const free = b.seats.findIndex((x) => x === null);
      if (free >= 0) {
        b.seats[free] = { seed: s.seed, me: k === this.key };
        b.count++;
        if (k === this.key) {
          this.me = { ...this.me, seat: free };
          this.link?.track(this.me);
        }
      } else if (k === this.key) {
        this.benches = benches;
        this.leave();
        this.onBumped();
        return;
      }
    }
    this.benches = benches;

    const mine = this.myBench;
    if (mine && mine.station !== this.lastStation) {
      this.lastStation = mine.station;
      if (mine.stationAt > this.me.stationAt) this.me = { ...this.me, station: mine.station, stationAt: mine.stationAt };
      this.onStation(mine.station);
    }
    this.onChange();
  }
}

function isSitter(v: unknown): v is Sitter {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<Sitter>;
  return (
    typeof s.seed === 'string' &&
    (s.bench === null || (Number.isInteger(s.bench) && s.bench! >= 0 && s.bench! < BENCH_COUNT)) &&
    Number.isInteger(s.seat) &&
    s.seat! >= 0 &&
    s.seat! < SEATS &&
    typeof s.sitAt === 'number' &&
    typeof s.station === 'string' &&
    typeof s.stationAt === 'number'
  );
}
