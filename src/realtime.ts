import { channelName } from './protocol';

export type Role = 'screen' | 'remote';
export type LinkStatus = 'connecting' | 'online' | 'offline' | 'unconfigured';

export interface Link {
  send(event: string, payload: unknown): void;
  close(): void;
}

export interface LinkHandlers {
  onMessage(event: string, payload: unknown): void;
  /** number of peers of each role currently present (excluding self) */
  onPresence?(counts: Record<Role, number>): void;
  onStatus?(status: LinkStatus): void;
}

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const realtimeConfigured = Boolean(URL_ && KEY);

/**
 * Joins a broadcast + presence channel for one room. The Supabase client is
 * loaded on demand so it never delays the first paint.
 */
export async function joinRoom(room: string, role: Role, h: LinkHandlers): Promise<Link | null> {
  if (!URL_ || !KEY) {
    h.onStatus?.('unconfigured');
    return null;
  }
  h.onStatus?.('connecting');
  const { RealtimeClient } = await import('@supabase/realtime-js');
  const client = new RealtimeClient(`${URL_.replace(/\/$/, '')}/realtime/v1`, {
    params: { apikey: KEY },
  });
  const me = `${role}-${Math.random().toString(36).slice(2, 10)}`;
  const ch = client.channel(channelName(room), {
    config: { broadcast: { self: false, ack: false }, presence: { key: me, enabled: true } },
  });

  ch.on('broadcast', { event: '*' }, (msg: { event: string; payload: unknown }) => {
    h.onMessage(msg.event, msg.payload);
  });
  ch.on('presence', { event: 'sync' }, () => {
    const counts: Record<Role, number> = { screen: 0, remote: 0 };
    for (const key of Object.keys(ch.presenceState())) {
      if (key === me) continue;
      if (key.startsWith('screen-')) counts.screen++;
      else if (key.startsWith('remote-')) counts.remote++;
    }
    h.onPresence?.(counts);
  });

  ch.subscribe(async (status: string) => {
    if (status === 'SUBSCRIBED') {
      h.onStatus?.('online');
      await ch.track({ role, at: Date.now() });
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      h.onStatus?.('offline');
    }
  });

  return {
    send(event, payload) {
      void ch.send({ type: 'broadcast', event, payload });
    },
    close() {
      void ch.unsubscribe();
      client.disconnect();
    },
  };
}
