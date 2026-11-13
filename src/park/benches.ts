import { STATIONS } from '../radio/stations';
import { joinPresence, type PresenceLink } from '../realtime';
import { storageGet, storageSet } from '../util';

export const BENCH_COUNT = 20;
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
  /** this person's connection dropped (phone locked, app switched); their seat is kept a while */
  held?: boolean;
}

/** A heart tap sent to everyone on the same bench. */
export interface HeartMsg {
  bench: number;
  seat: number;
  n: number;
}

/** How long a seat is kept for someone whose connection dropped. */
export const HOLD_MS = 5 * 60_000;

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

/** Every bench starts on Kannada Hits until someone sitting there picks another station. */
export const DEFAULT_STATION = 'kannadahits';
export const defaultStation = (_bench: number) => DEFAULT_STATION;

/**
 * BENCH_COUNT shared benches with 4 seats each. No login and no database: every tab publishes where
 * it sits through Supabase presence. When someone's connection drops (phone locked, app switched)
 * their seat is held, dimmed, for 5 minutes; coming back within that time returns them to it.
 * Each bench has one station; the most recent pick by anyone on the bench wins. Heart taps are
 * broadcast to the bench.
 */
export class BenchPark {
  readonly seed: string;
  private key = `t-${randomId(8)}`;
  private link: PresenceLink<Sitter> | null = null;
  private me: Sitter;
  private benches: BenchView[] = [];
  private lastStation = '';
  private _shared = false;
  /** seats of people whose connection dropped, kept until `until` (keyed by their seed) */
  private held = new Map<string, { s: Sitter; until: number }>();

  /** anything changed (occupancy, my seat, stations) */
  onChange: () => void = () => {};
  /** my bench's station changed: follow it */
  onStation: (id: string) => void = () => {};
  /** someone else got my seat at the same instant and the bench is full */
  onBumped: () => void = () => {};
  /** a benchmate tapped the heart */
  onHeart: (msg: HeartMsg) => void = () => {};

  constructor() {
    let seed = storageGet('bc.me');
    if (!seed) {
      seed = randomId(12);
      storageSet('bc.me', seed);
    }
    this.seed = seed;
    this.me = { seed, bench: null, seat: 0, sitAt: 0, station: '', stationAt: 0 };
    this.recompute();
    // let held seats run out, and keep "last seen" fresh so a locked phone can come back to its seat
    setInterval(() => {
      if (this.held.size) this.recompute();
      this.remember();
    }, 15_000);
    addEventListener('pagehide', () => this.remember());
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
      onLeave: (_key, metas) => this.hold(metas),
      onMessage: (event, payload) => {
        if (event === 'heart' && isHeart(payload) && payload.bench === this.me.bench && payload.seat !== this.me.seat) {
          this.onHeart(payload);
        }
      },
      onStatus: (s) => {
        this._shared = s === 'online';
        if (s === 'online') console.info(`${LOG} connected — sharing benches with everyone online`, LOG_STYLE);
        if (s === 'unconfigured') console.info(`${LOG} solo mode (no Supabase keys) — benches are only yours`, LOG_STYLE);
        this.onChange();
      },
    });
    if (this.link && this.me.bench !== null) this.link.track(this.me);
  }

  /**
   * Back within 5 minutes (reload, phone unlocked, app reopened): take the same seat again with
   * the original sit-down time, so the earliest-claim rule hands it back even if someone grabbed it.
   */
  restore(): boolean {
    let saved: { bench: number; seat: number; sitAt: number; at: number } | null = null;
    try {
      saved = JSON.parse(storageGet('bc.seat') ?? 'null');
    } catch {
      saved = null;
    }
    if (
      !saved ||
      Date.now() - saved.at > HOLD_MS ||
      !Number.isInteger(saved.bench) ||
      saved.bench < 0 ||
      saved.bench >= BENCH_COUNT ||
      !Number.isInteger(saved.seat) ||
      saved.seat < 0 ||
      saved.seat >= SEATS
    ) {
      return false;
    }
    const b = this.benches[saved.bench];
    this.held.delete(this.seed);
    this.me = { ...this.me, bench: saved.bench, seat: saved.seat, sitAt: saved.sitAt, station: b.station, stationAt: b.stationAt };
    this.publish();
    console.info(`${LOG} back on bench ${saved.bench + 1}, seat ${saved.seat + 1}`, LOG_STYLE);
    return this.me.bench !== null; // false if the bench filled up meanwhile and we got bumped
  }

  /** Send heart taps to everyone on my bench. */
  sendHeart(n: number) {
    if (this.me.bench === null || n <= 0) return;
    const msg: HeartMsg = { bench: this.me.bench, seat: this.me.seat, n: Math.min(n, 20) };
    this.link?.send('heart', msg);
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
    storageSet('bc.seat', ''); // chose to go: nothing to come back to
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
    this.remember();
  }

  /** Save my seat with a "last seen" time, for coming back after a locked phone or relaunch. */
  private remember() {
    if (this.me.bench === null) return;
    const { bench, seat, sitAt } = this.me;
    storageSet('bc.seat', JSON.stringify({ bench, seat, sitAt, at: Date.now() }));
  }

  /** Someone's presence went away: keep their seat for a while (dropped unless they're back). */
  private hold(metas: Sitter[]) {
    const until = Date.now() + HOLD_MS;
    for (const s of metas) {
      if (isSitter(s) && s.bench !== null && s.seed !== this.seed) this.held.set(s.seed, { s, until });
    }
    this.recompute();
  }

  private everyone(): [string, Sitter][] {
    const all = this.link ? this.link.state() : new Map<string, Sitter>();
    all.set(this.key, this.me); // local truth beats a presence echo that may lag
    return [...all].filter(([, s]) => isSitter(s) && s.bench !== null);
  }

  private recompute() {
    const people = this.everyone();
    // a held seat ends when time runs out or its owner is present again (back, re-tracked, or left on purpose)
    const now = Date.now();
    const present = new Set([...(this.link?.state().values() ?? [])].map((s) => (s as Sitter).seed));
    for (const [seed, h] of this.held) if (h.until < now || present.has(seed)) this.held.delete(seed);
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
    // held seats count as taken, but any live claim on the same seat wins
    for (const { s } of this.held.values()) {
      const b = benches[s.bench!];
      if (b.seats[s.seat] === null) {
        b.seats[s.seat] = { seed: s.seed, me: false, held: true };
        b.count++;
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

function isHeart(v: unknown): v is HeartMsg {
  if (!v || typeof v !== 'object') return false;
  const h = v as Partial<HeartMsg>;
  return (
    Number.isInteger(h.bench) &&
    Number.isInteger(h.seat) &&
    h.seat! >= 0 &&
    h.seat! < SEATS &&
    typeof h.n === 'number' &&
    h.n > 0 &&
    h.n <= 20
  );
}
