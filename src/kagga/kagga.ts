/**
 * Mankuthimmana Kagga by D.V. Gundappa. We show the full original Kannada verse, with its English
 * translation one tap away. Both come from the Mankuthimma project (mankuthimma.vercel.app,
 * github.com/banagere/mankuthimma), used with its permission, as rows of
 * [number, "four lines joined by \n", chapterSlug, english]. Regenerate with scripts/extract-kagga.mjs.
 */
export interface Kagga {
  number: number;
  /** the full verse, four lines */
  lines: string[];
  /** English translation from the Mankuthimma project, used with its permission */
  english: string;
  url: string;
}

type Row = [number, string, string, string];

/** The Mankuthimma app; each verse lives at /kagga/<chapter>#verse-<n>. */
const SITE = 'https://mankuthimma.vercel.app';
let rows: Row[] | null = null;
let recent: number[] = [];

/** Loaded on first use (≈50 KB gzipped), so it never weighs on the first page load. */
async function load(): Promise<Row[]> {
  rows ??= (await import('./excerpts.json')).default as Row[];
  return rows;
}

/** A random kagga, avoiding the last few shown. */
export async function randomKagga(): Promise<Kagga> {
  const all = await load();
  let r: Row;
  do r = all[Math.floor(Math.random() * all.length)];
  while (recent.includes(r[0]) && recent.length < all.length);
  recent = [r[0], ...recent].slice(0, 20);

  const url = `${SITE}/kagga/${r[2]}#verse-${r[0]}`;
  return { number: r[0], lines: r[1].split('\n'), english: r[3] ?? '', url };
}

const KN_DIGITS = '೦೧೨೩೪೫೬೭೮೯';
export const knNumber = (n: number) => String(n).replace(/\d/g, (d) => KN_DIGITS[Number(d)]);
