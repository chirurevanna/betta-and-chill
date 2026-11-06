import type { Palette, PaletteKey } from './palette';

export type ViewId = 'nandi' | 'summit';

/** Everything that varies per animation frame. */
export interface Frame {
  pal: Palette;
  c: Record<PaletteKey, string>;
  p: number; // sun phase 0 day … 1 night
  night: number;
  golden: number;
  rain: number;
  wind: number;
  bulbs: number; // palace illumination 0..1
  time: number; // seconds since start
  dt: number;
  /** parallax offset in px at depth 1 */
  px: number;
  py: number;
  sunX: number;
  sunY: number;
}

export interface Drawable {
  depth: number; // 0 horizon … 1 near
  draw(ctx: CanvasRenderingContext2D, f: Frame): void;
}

export interface Lake {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  depth: number;
}

export interface TreeDef {
  x: number;
  baseY: number;
  h: number;
  trunkW: number;
  lean: number;
  phase: number;
  blobs: { dx: number; dy: number; r: number; light: boolean }[];
}
