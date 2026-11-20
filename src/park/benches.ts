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
  /** listening alone, off the benches (older clients leave it out) */
  solo?: boolean;
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

/** Someone on a shared bench asked to switch its station; benchmates vote. */
export interface StationRequest {
  id: string;
  bench: number;
  seat: number;
  station: string;
  at: number;
}

/** How long a station-change vote stays open. */
export const VOTE_MS = 45_000;

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

/** The first benches start on Kannada Hits. */
export const DEFAULT_STATION = 'kannadahits';
const KANNADA_HITS_BENCHES = 3;

/**
 * Starting station for each bench, until someone sitting there picks another: benches 1–3 play
 * Kannada Hits; the rest go through every other station once, alternating languages
 * (ಕ, हि, EN, ಕ, …) so each language is spread across the hill. With more stations than benches,
 * the last few in that rotation start on no bench (people can still switch to them).
 */
const ROTATION: string[] = (() => {
  const byLang = new Map<string, string[]>();
  for (const s of STATIONS) {
    if (s.id === DEFAULT_STATION) continue;
    byLang.set(s.lang, [...(byLang.get(s.lang) ?? []), s.id]);
  }
  const lanes = [...byLang.values()];
  const out: string[] = [];
  for (let i = 0; out.length < STATIONS.length - 1; i++) for (const l of lanes) if (l[i]) out.push(l[i]);
  return out;
})();

export const defaultStation = (bench: number) =>
  bench < KANNADA_HITS_BENCHES ? DEFAULT_STATION : (ROTATION[(bench - KANNADA_HITS_BENCHES) % ROTATION.length] ?? DEFAULT_STATION);

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
  /** someone tapped the heart: a benchmate (sameBench) or anyone else on the hill */
  onHeart: (msg: HeartMsg, sameBench: boolean) => void = () => {};
  /** a benchmate asks to change the station: show the vote */
  onRequest: (req: StationRequest) => void = () => {};
  /** the vote I was shown is over (someone answered Yes, it ran out, or the asker left) */
  onRequestClosed: () => void = () => {};
  /** my own request: approved (the station switches) or nobody approved it */
  onRequestResult: (approved: boolean) => void = () => {};

  /** my pending request: how many benchmates could vote, and how many said No */
  private myRequest: { req: StationRequest; voters: number; no: number; timer: number } | null = null;
  /** a benchmate's pending request shown to me */
  private incoming: { req: StationRequest; timer: number } | null = null;

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
  /** how many people (me included) are listening solo right now */
  get soloCount() {
    const all = this.link ? this.link.state() : new Map<string, Sitter>();
    all.set(this.key, this.me);
    const seeds = new Set<string>();
    for (const s of all.values()) if (isSitter(s) && s.bench === null && s.solo) seeds.add(s.seed);
    return seeds.size;
  }
  /** tell everyone I'm listening solo (or not) */
  setSolo(on: boolean) {
    if (!!this.me.solo === on) return;
    this.me = { ...this.me, solo: on };
    this.link?.track(this.me);
    this.onChange();
  }

  async connect() {
    this.link = await joinPresence<Sitter>('bc:park', this.key, {
      onSync: () => this.recompute(),
      onLeave: (_key, metas) => this.hold(metas),
      onMessage: (event, payload) => {
        if (event === 'req' || event === 'vote' || event === 'req-end') return this.onVoteMessage(event, payload);
        if (event !== 'heart' || !isHeart(payload) || payload.bench < 0 || payload.bench >= BENCH_COUNT) return;
        const sameBench = payload.bench === this.me.bench;
        if (sameBench && payload.seat === this.me.seat) return; // my own, already shown
        this.onHeart(payload, sameBench);
      },
      onStatus: (s) => {
        this._shared = s === 'online';
        if (s === 'online') console.info(`${LOG} connected — sharing benches with everyone online`, LOG_STYLE);
        if (s === 'unconfigured') console.info(`${LOG} solo mode (no Supabase keys) — benches are only yours`, LOG_STYLE);
        this.onChange();
      },
    });
    // tracked even off the benches, so solo listeners show up in the counts
    if (this.link && (this.me.bench !== null || this.me.solo)) this.link.track(this.me);
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

  /** Send heart taps to everyone (benchmates see them from my figure, others from afar). */
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
    this.endVotes();
    this.me = {
      ...this.me,
      bench,
      seat: free,
      sitAt: Date.now(),
      // adopt the bench's station without overriding it
      station: b.station,
      stationAt: b.stationAt,
      solo: false,
    };
    this.publish();
    console.info(`${LOG} sat on bench ${bench + 1}, seat ${free + 1}`, LOG_STYLE);
    return true;
  }

  /**
   * Arrival seating: the lowest-numbered bench with nobody on it (held seats count as somebody),
   * so people only share a bench when they choose to. If every bench has someone, the
   * lowest-numbered bench with a free seat. Null when everything is full.
   */
  sitFirstEmpty(): number | null {
    const pick =
      this.benches.find((b) => b.count === 0) ?? this.benches.find((b) => b.count < SEATS);
    if (!pick) return null;
    return this.sit(pick.id) ? pick.id : null;
  }

  leave() {
    if (this.me.bench === null) return;
    this.endVotes();
    console.info(`${LOG} left bench ${this.me.bench + 1}`, LOG_STYLE);
    this.me = { ...this.me, bench: null, seat: 0, sitAt: 0, station: '', stationAt: 0, solo: this.me.solo };
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

  /** Other people on my bench who are here right now (held seats can't vote). */
  othersLive(): number {
    return this.myBench?.seats.filter((s) => s && !s.me && !s.held).length ?? 0;
  }

  /**
   * Ask to change my bench's station. Alone on the bench (or offline): it just changes.
   * With others: they get a vote, and the first Yes switches it for everyone.
   */
  requestStation(station: string): 'applied' | 'pending' | 'busy' {
    if (this.me.bench === null) return 'applied';
    if (!this.link || !this._shared || this.othersLive() === 0) {
      this.setStation(station);
      return 'applied';
    }
    if (this.myRequest || this.incoming) return 'busy';
    const req: StationRequest = { id: randomId(8), bench: this.me.bench, seat: this.me.seat, station, at: Date.now() };
    const timer = window.setTimeout(() => this.finishMine(false), VOTE_MS);
    this.myRequest = { req, voters: this.othersLive(), no: 0, timer };
    this.link.send('req', req);
    console.info(`${LOG} asked the bench to switch to ${station}`, LOG_STYLE);
    return 'pending';
  }

  /** My answer to a benchmate's request. */
  vote(id: string, yes: boolean) {
    if (!this.incoming || this.incoming.req.id !== id) return;
    this.link?.send('vote', { id, bench: this.incoming.req.bench, yes });
    this.clearIncoming();
  }

  private finishMine(approved: boolean) {
    const mine = this.myRequest;
    if (!mine) return;
    clearTimeout(mine.timer);
    this.myRequest = null;
    this.link?.send('req-end', { id: mine.req.id, bench: mine.req.bench });
    if (approved && this.me.bench === mine.req.bench) this.setStation(mine.req.station);
    this.onRequestResult(approved);
  }

  private clearIncoming() {
    if (!this.incoming) return;
    clearTimeout(this.incoming.timer);
    this.incoming = null;
    this.onRequestClosed();
  }

  /** Moving or leaving: drop my request (benchmates' cards close) and any vote shown to me. */
  private endVotes() {
    if (this.myRequest) {
      clearTimeout(this.myRequest.timer);
      this.link?.send('req-end', { id: this.myRequest.req.id, bench: this.myRequest.req.bench });
      this.myRequest = null;
    }
    this.clearIncoming();
  }

  private onVoteMessage(event: string, payload: unknown) {
    if (!payload || typeof payload !== 'object') return;
    const p = payload as Partial<StationRequest> & { yes?: unknown };
    if (p.bench !== this.me.bench || typeof p.id !== 'string') return;
    if (event === 'req') {
      if (!isRequest(payload) || payload.seat === this.me.seat) return;
      if (this.incoming) clearTimeout(this.incoming.timer);
      // a lost "end" message must not leave the card up forever
      const timer = window.setTimeout(() => this.clearIncoming(), VOTE_MS + 2000);
      this.incoming = { req: payload, timer };
      this.onRequest(payload);
    } else if (event === 'vote') {
      if (typeof p.yes !== 'boolean') return;
      if (this.myRequest?.req.id === p.id) {
        if (p.yes) this.finishMine(true);
        else if (++this.myRequest.no >= this.myRequest.voters) this.finishMine(false);
      } else if (this.incoming?.req.id === p.id && p.yes) this.clearIncoming(); // someone else said Yes first
    } else if (this.incoming?.req.id === p.id) this.clearIncoming(); // req-end
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

function isRequest(v: unknown): v is StationRequest {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<StationRequest>;
  return (
    typeof r.id === 'string' &&
    Number.isInteger(r.bench) &&
    Number.isInteger(r.seat) &&
    r.seat! >= 0 &&
    r.seat! < SEATS &&
    typeof r.station === 'string' &&
    STATION_IDS.has(r.station) &&
    typeof r.at === 'number'
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
