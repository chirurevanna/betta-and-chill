/** The sky effects anyone can trigger. */
export type EffectType = 'birds' | 'sun' | 'breeze' | 'rain';
export const EFFECTS: readonly EffectType[] = ['birds', 'sun', 'breeze', 'rain'];

export function isEffect(v: unknown): v is EffectType {
  return typeof v === 'string' && (EFFECTS as readonly string[]).includes(v);
}
