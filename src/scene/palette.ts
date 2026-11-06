import { type RGB, hex, mix, clamp } from '../util';

/**
 * Colour keyframes along the sun phase p:
 *   0 = full day, 0.42 = golden hour, 0.58 = sunset, 0.74 = dusk, 1 = night.
 * Everything in the scene reads its colour from here so time-of-day stays coherent.
 */
const STOPS = [0, 0.42, 0.58, 0.74, 1];

const KEYS = {
  skyTop: ['#8cc3e6', '#9cb5d8', '#6f7fb6', '#3a3f72', '#0e1830'],
  skyBottom: ['#e5f0ef', '#f6d8a6', '#f3a479', '#c47488', '#283257'],
  sun: ['#fff6da', '#ffd68c', '#ff9b5e', '#e86a5a', '#e86a5a'],
  cloud: ['#ffffff', '#fbe7cf', '#f7b996', '#9c7896', '#2b3352'],
  hillFar: ['#a8bccb', '#b6a8b6', '#a088a6', '#584f76', '#1a2140'],
  cityFar: ['#c4cac6', '#d4b9a2', '#b68e8d', '#5a5173', '#1b2139'],
  cityNear: ['#f0d9bd', '#ecc79e', '#cc9784', '#5a4a64', '#181c30'],
  wall: ['#dcc4a4', '#dcb088', '#b98374', '#4d415b', '#13172a'],
  roof: ['#c86a4c', '#c96f52', '#a85f55', '#4c3a50', '#12162a'],
  cityTree: ['#78a85e', '#8d9b5f', '#6f7a5b', '#384252', '#121a26'],
  ground: ['#bccb92', '#cdb98d', '#a88d7c', '#43405a', '#121829'],
  forest: ['#5e8a58', '#5f7a4b', '#4e5c4a', '#29313f', '#0c131f'],
  forestLight: ['#79a364', '#7a9055', '#5e6a50', '#323a47', '#111a27'],
  rock: ['#77736a', '#7a6758', '#5c4b4c', '#2c2834', '#0b0e17'],
  rockLight: ['#97907f', '#9a7f66', '#765c58', '#393242', '#121626'],
  fgTree: ['#4d7d4b', '#52703f', '#3f4c3b', '#1e2530', '#090e16'],
  fgTreeLight: ['#6a9b58', '#738c4a', '#56603f', '#2a3139', '#0f151f'],
  trunk: ['#5d4a3c', '#5d4335', '#47363a', '#221d27', '#090b12'],
  stone: ['#3c3c43', '#43393a', '#3a2f38', '#1b1922', '#0a0b11'],
  stoneLight: ['#5d5c66', '#6e5a52', '#5d4650', '#2b2633', '#12131b'],
  palace: ['#efe2c6', '#f6d1a0', '#e0a688', '#776274', '#27253a'],
  palaceShade: ['#cdbb9c', '#d6a77c', '#b87f6e', '#5a4a5f', '#1c1b2c'],
  dome: ['#d08f7c', '#d9805f', '#bb6d61', '#5d4560', '#1d1a2c'],
  white: ['#f5f2ea', '#fbe1bf', '#ecb59b', '#7a6e86', '#2a2b40'],
  gopuram: ['#e7d1a5', '#efc389', '#d79977', '#6c596a', '#1e1c2a'],
  gopuramShade: ['#c6ad80', '#cf9d68', '#b37a62', '#544555', '#16151f'],
  gold: ['#e2b552', '#efb04c', '#dc9050', '#8a6a4a', '#3a3428'],
  haze: ['#e4eef2', '#f7d6ab', '#f0a882', '#93708c', '#283255'],
} satisfies Record<string, string[]>;

export type PaletteKey = keyof typeof KEYS;
export type Palette = Record<PaletteKey, RGB>;

const PARSED = Object.fromEntries(
  Object.entries(KEYS).map(([k, v]) => [k, v.map(hex)]),
) as Record<PaletteKey, RGB[]>;

const RAIN_TINT: RGB = [92, 102, 120];

export function paletteAt(p: number, rain: number): Palette {
  p = clamp(p);
  let i = 0;
  while (i < STOPS.length - 2 && p > STOPS[i + 1]) i++;
  const t = (p - STOPS[i]) / (STOPS[i + 1] - STOPS[i]);
  const out = {} as Palette;
  const r = rain * 0.42;
  for (const k in PARSED) {
    const stops = PARSED[k as PaletteKey];
    let c = mix(stops[i], stops[i + 1], t);
    if (r > 0) {
      // overcast: desaturate and pull toward a cool grey, but keep night dark
      const grey = (c[0] + c[1] + c[2]) / 3;
      const target = mix([grey, grey, grey], RAIN_TINT, 0.5 * (1 - p * 0.8));
      c = mix(c, target, r);
    }
    out[k as PaletteKey] = c;
  }
  return out;
}

/** 0 by day → 1 at full night. */
export const nightOf = (p: number) => clamp((p - 0.58) / 0.34) ** 1.2;
/** Warm rim light, strongest around golden hour and sunset. */
export const goldenOf = (p: number) => Math.max(0, 1 - Math.abs(p - 0.5) / 0.2);
