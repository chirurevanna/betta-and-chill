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
  close(): void;
}

/**
 * Presence-only channel: each tab publishes one small object; it disappears automatically when
 * the tab closes. Returns null when Supabase isn't configured.
 */
export async function joinPresence<M extends object>(
  channel: string,
  key: string,
  h: { onSync(): void; onStatus?(s: LinkStatus): void },
): Promise<PresenceLink<M> | null> {
  if (!URL_ || !KEY) {
    h.onStatus?.('unconfigured');
    return null;
  }
  h.onStatus?.('connecting');
  const client = await getClient();
  const ch = client.channel(channel, { config: { presence: { key, enabled: true } } });
  let current: M | null = null;
  let subscribed = false;

  ch.on('presence', { event: 'sync' }, () => h.onSync());
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
    close() {
      void ch.unsubscribe();
    },
  };
}
