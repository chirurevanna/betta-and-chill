/** Messages exchanged between the big screen and phone remotes over one broadcast channel. */

export type EffectType = 'birds' | 'sun' | 'breeze' | 'rain';
export const EFFECTS: readonly EffectType[] = ['birds', 'sun', 'breeze', 'rain'];

/** remote → screen */
export interface CmdMsg {
  type: EffectType;
  from: string;
}

export type RadioAction = 'toggle' | 'next' | 'prev' | 'vol' | 'select';
const RADIO_ACTIONS: readonly RadioAction[] = ['toggle', 'next', 'prev', 'vol', 'select'];

/** remote → screen */
export interface RadioCmd {
  action: RadioAction;
  /** volume 0..1, only for 'vol' */
  value?: number;
  /** station id, only for 'select' */
  station?: string;
  from: string;
}

export interface RadioStationInfo {
  id: string;
  name: string;
  available: boolean;
}

export interface RadioState {
  on: boolean;
  station: string;
  stationId: string;
  stations: RadioStationInfo[];
  volume: number;
  /** the screen's browser needs a tap before it may play audio */
  blocked: boolean;
  /** every station failed */
  unavailable: boolean;
}

/** screen → remotes */
export interface StateMsg {
  isNight: boolean;
  /** milliseconds until each effect can be triggered again (0 = ready) */
  cooldowns: Record<EffectType, number>;
  view: string;
  /** 1-based bench number the screen is sitting on, null when standing */
  bench?: number | null;
  radio?: RadioState;
}

export const EV_CMD = 'cmd';
export const EV_RADIO = 'radio';
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

export function isRadioCmd(v: unknown): v is RadioCmd {
  if (!v || typeof v !== 'object') return false;
  const c = v as Partial<RadioCmd>;
  if (!(RADIO_ACTIONS as readonly unknown[]).includes(c.action)) return false;
  if (c.action === 'select') return typeof c.station === 'string' && c.station.length <= 64;
  return c.action !== 'vol' || (typeof c.value === 'number' && Number.isFinite(c.value));
}

export function isEffect(v: unknown): v is EffectType {
  return typeof v === 'string' && (EFFECTS as readonly string[]).includes(v);
}
