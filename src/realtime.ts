export type LinkStatus = 'connecting' | 'online' | 'offline' | 'unconfigured';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const realtimeConfigured = Boolean(URL_ && KEY);

type Client = InstanceType<typeof import('@supabase/realtime-js').RealtimeClient>;
let clientP: Promise<Client> | null = null;

/** One shared socket for every channel; the library is loaded on demand so it never delays first paint. */
function getClient(): Promise<Client> {
  clientP ??= import('@supabase/realtime-js').then(
    ({ RealtimeClient }) =>
      new RealtimeClient(`${URL_!.replace(/\/$/, '')}/realtime/v1`, {
        params: { apikey: KEY! },
      }),
  );
  return clientP;
}

export interface PresenceLink<M> {
  /** publish (or replace) this tab's presence */
  track(meta: M): void;
  /** everyone currently present, including this tab, keyed by presence key */
  state(): Map<string, M>;
  /** broadcast a small message to everyone else on the channel */
  send(event: string, payload: unknown): void;
  close(): void;
}

export interface PresenceHandlers<M> {
  onSync(): void;
  onStatus?(s: LinkStatus): void;
  /** presences that just went away (tab closed, phone locked, connection lost, or re-tracked) */
  onLeave?(key: string, metas: M[]): void;
  onMessage?(event: string, payload: unknown): void;
}

/**
 * Presence + broadcast channel: each tab publishes one small object, which disappears
 * automatically when the tab closes, and can send small broadcast messages to the others.
 * Returns null when Supabase isn't configured.
 */
export async function joinPresence<M extends object>(
  channel: string,
  key: string,
  h: PresenceHandlers<M>,
): Promise<PresenceLink<M> | null> {
  if (!URL_ || !KEY) {
    h.onStatus?.('unconfigured');
    return null;
  }
  h.onStatus?.('connecting');
  const client = await getClient();
  const ch = client.channel(channel, {
    config: { presence: { key, enabled: true }, broadcast: { self: false, ack: false } },
  });
  let current: M | null = null;
  let subscribed = false;

  ch.on('presence', { event: 'sync' }, () => h.onSync());
  ch.on('presence', { event: 'leave' }, (e: { key: string; leftPresences: M[] }) => h.onLeave?.(e.key, e.leftPresences));
  ch.on('broadcast', { event: '*' }, (msg: { event: string; payload: unknown }) => h.onMessage?.(msg.event, msg.payload));
  ch.subscribe((status: string) => {
    if (status === 'SUBSCRIBED') {
      subscribed = true;
      h.onStatus?.('online');
      if (current) void ch.track(current);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      subscribed = false;
      h.onStatus?.('offline');
    }
  });

  // phones drop the socket while locked or in the background: reconnect and re-announce on return
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (!client.isConnected()) client.connect();
    if (subscribed && current) void ch.track(current);
  });

  return {
    track(meta) {
      current = meta;
      if (subscribed) void ch.track(meta);
    },
    state() {
      const out = new Map<string, M>();
      const raw = ch.presenceState() as Record<string, (M & { presence_ref?: string })[]>;
      for (const [k, metas] of Object.entries(raw)) {
        const last = metas[metas.length - 1];
        if (last) out.set(k, last);
      }
      return out;
    },
    send(event, payload) {
      if (subscribed) void ch.send({ type: 'broadcast', event, payload });
    },
    close() {
      void ch.unsubscribe();
    },
  };
}

/**
 * Add `n` heart taps (0–50) to the shared all-visitor total and get the new total back.
 * Uses the `add_hearts` Postgres function (supabase/hearts.sql) over plain fetch. Null when
 * Supabase isn't configured or the call fails.
 */
export async function addHearts(n: number): Promise<number | null> {
  if (!URL_ || !KEY) return null;
  try {
    const res = await fetch(`${URL_.replace(/\/$/, '')}/rest/v1/rpc/add_hearts`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ n: Math.max(0, Math.min(50, Math.round(n))) }),
    });
    if (!res.ok) return null;
    const total = Number(await res.json());
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}
