/** Messages exchanged between the big screen and phone remotes over one broadcast channel. */

export type EffectType = 'birds' | 'sun' | 'breeze' | 'rain';
export const EFFECTS: readonly EffectType[] = ['birds', 'sun', 'breeze', 'rain'];

/** remote → screen */
export interface CmdMsg {
  type: EffectType;
  from: string;
}

/** screen → remotes */
export interface StateMsg {
  isNight: boolean;
  /** milliseconds until each effect can be triggered again (0 = ready) */
  cooldowns: Record<EffectType, number>;
  view: string;
}

export const EV_CMD = 'cmd';
export const EV_STATE = 'state';
export const EV_HELLO = 'hello';

const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_RE = /^[A-HJKMNP-Z2-9]{6}$/;

export function newRoomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
}

export const channelName = (room: string) => `bc:${room}`;

export function isEffect(v: unknown): v is EffectType {
  return typeof v === 'string' && (EFFECTS as readonly string[]).includes(v);
}
