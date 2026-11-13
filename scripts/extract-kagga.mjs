// Usage: node scripts/extract-kagga.mjs ../mankuthimma src/kagga/excerpts.json
// Reads the mankuthimma repo's data and writes: verse number, the full original Kannada verse
// (all four lines), its chapter (for links to mankuthimma.vercel.app) and the English translation. The English
// translations are used with the mankuthimma project's permission; the Kannada explanations are not used.
import { readFileSync, writeFileSync } from 'node:fs';
const [, , repo, out] = process.argv;
const arrayLiteral = (src, marker) => {
  const start = src.indexOf('= [', src.indexOf(marker)) + 2;
  let depth = 0, i = start, inStr = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) break;
  }
  return Function(`"use strict"; return (${src.slice(start, i + 1)});`)();
};
const verses = arrayLiteral(readFileSync(`${repo}/src/api/verses.ts`, 'utf8'), 'const kaggaData');
const chapters = arrayLiteral(readFileSync(`${repo}/src/api/chapters.ts`, 'utf8'), 'const chapterData');
const chapterOf = new Map();
for (const c of chapters) for (const v of c.verses) chapterOf.set(v, c.slug);
const rows = [];
for (const v of verses) {
  const lines = String(v.kannada).replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const slug = chapterOf.get(v.number);
  if (!lines.length || !slug) continue;
  const english = String(v.english ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—]\s*Mankut+imma\.?\s*$/i, '')
    .trim();
  rows.push([v.number, lines.join('\n'), slug, english]);
}
rows.sort((a, b) => a[0] - b[0]);
writeFileSync(out, JSON.stringify(rows));
console.log(`wrote ${rows.length} excerpts (of ${verses.length} verses)`);
console.log('sample:', JSON.stringify(rows[0]), JSON.stringify(rows[rows.length - 1]));
