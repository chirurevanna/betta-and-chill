/**
 * Builds src/movies/movies.json for the Movies card from a Letterboxd ratings export.
 *
 *   npm run movies            (or: node scripts/build-movies.mjs [data/letterboxd-ratings.csv])
 *
 * Keeps films rated 3.5★ or more and finds each one's poster: TMDB first (needs TMDB_KEY in the
 * environment or .env.local), then the lead image of its English Wikipedia article as a backup.
 * Films with no confident match keep `poster: null` and show a plain title card instead. Results
 * already in movies.json are reused, so re-running after a new export only looks up new films.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const SRC = process.argv[2] ?? 'data/letterboxd-ratings.csv';
const OUT = 'src/movies/movies.json';
const MIN = 3.5;
const UA = 'betta-and-chill-movies/1.0 (build script)';

/** Minimal CSV parser (handles quoted fields with commas). */
function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One API call, about one a second, waiting and retrying when Wikipedia asks us to slow down. */
async function wiki(params) {
  const url = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(1100);
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (r.status === 429 || r.status >= 500) {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (!r.ok) throw new Error(`wikipedia ${r.status}`);
    return r.json();
  }
  throw new Error('wikipedia kept rate-limiting');
}

/** The lead image of the film's Wikipedia article, if one clearly matches the title. */
async function posterFor(name, year) {
  for (const q of [`${name} ${year} film`, `${name} film`]) {
    const d = await wiki({
      action: 'query',
      generator: 'search',
      gsrsearch: q,
      gsrlimit: '5',
      prop: 'pageimages',
      piprop: 'thumbnail',
      pilicense: 'any', // film posters are non-free images; without this none are returned
      pithumbsize: '320',
    });
    const want = norm(name);
    // not the soundtrack, the novel, the TV series…: the film itself, best match first
    const NOT_FILM = /\((soundtrack|album|novel|book|tv series|web series|miniseries|song|play|comics?|character|video game)/i;
    const pages = (d.query?.pages ?? [])
      .filter((p) => p.thumbnail?.source && !NOT_FILM.test(p.title))
      .map((p) => {
        const t = norm(p.title);
        const close = t === want || t.startsWith(want) || (want.length > 6 && want.startsWith(t));
        const score = (t === want ? 4 : 0) + (/\(.*film\)/i.test(p.title) ? 2 : 0) + (p.title.includes(String(year)) ? 1 : 0);
        return { p, close, score };
      })
      .filter((x) => x.close)
      .sort((a, b) => b.score - a.score || a.p.index - b.p.index);
    if (pages.length) return pages[0].p.thumbnail.source;
  }
  return null;
}

/* ---------- TMDB: for films Wikipedia has no poster for ---------- */
// The key comes from the TMDB_KEY env var or .env.local (git-ignored); it is never shipped.
function tmdbKey() {
  if (process.env.TMDB_KEY) return process.env.TMDB_KEY;
  if (!existsSync('.env.local')) return null;
  const m = readFileSync('.env.local', 'utf8').match(/^TMDB_KEY=(.+)$/m);
  return m ? m[1].trim() : null;
}

async function tmdb(path, params, key) {
  const url = `https://api.themoviedb.org/3/${path}?` + new URLSearchParams({ api_key: key, ...params });
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(120);
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (r.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!r.ok) throw new Error(`tmdb ${r.status}`);
    return r.json();
  }
  throw new Error('tmdb kept rate-limiting');
}

/** A TMDB poster for the film (or a TV special of that name), matched on title and year. */
async function tmdbPoster(name, year, key) {
  const want = norm(name);
  for (const [path, yearParam, dateKey, titleKeys] of [
    ['search/movie', 'year', 'release_date', ['title', 'original_title']],
    ['search/movie', null, 'release_date', ['title', 'original_title']],
    ['search/tv', 'first_air_date_year', 'first_air_date', ['name', 'original_name']],
  ]) {
    const d = await tmdb(path, { query: name, ...(yearParam ? { [yearParam]: String(year) } : {}), include_adult: 'false' }, key);
    const hit = (d.results ?? []).find((r) => {
      if (!r.poster_path) return false;
      const y = Number((r[dateKey] ?? '').slice(0, 4));
      const titleOk = titleKeys.some((k) => r[k] && norm(r[k]) === want) || titleKeys.some((k) => r[k] && norm(r[k]).startsWith(want));
      return titleOk && (!y || Math.abs(y - year) <= 1);
    });
    if (hit) return `https://image.tmdb.org/t/p/w342${hit.poster_path}`;
  }
  return null;
}

const rows = parseCsv(readFileSync(SRC, 'utf8'));
const head = rows.shift();
const col = (n) => head.indexOf(n);
const films = rows
  .map((r) => ({ name: r[col('Name')], year: Number(r[col('Year')]), rating: Number(r[col('Rating')]), url: r[col('Letterboxd URI')] }))
  .filter((f) => f.rating >= MIN);

const old = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
// a film already looked up keeps its result (a poster, or null for a confirmed miss);
// films whose lookup failed have no `poster` key and are tried again
const known = new Map(old.filter((f) => 'poster' in f).map((f) => [f.url, f.poster]));

const key = tmdbKey();
if (!key) console.log('(no TMDB_KEY in env or .env.local: using Wikipedia only)');

let found = 0;
let fromWiki = 0;
for (const f of films) {
  if (known.has(f.url)) f.poster = known.get(f.url);
  else {
    try {
      // TMDB first (it's where Letterboxd's posters come from); Wikipedia only when TMDB has none
      f.poster = key ? await tmdbPoster(f.name, f.year, key) : null;
      if (!f.poster) {
        f.poster = await posterFor(f.name, f.year);
        if (f.poster) fromWiki++;
      }
    } catch (e) {
      delete f.poster;
      console.warn(`  ! ${f.name}: ${e.message} (will retry next run)`);
    }
  }
  if (f.poster) found++;
  else if (f.poster === null) console.log(`  no poster: ${f.name} (${f.year})`);
}
console.log(`${fromWiki} posters came from Wikipedia (the rest from TMDB)`);

mkdirSync('src/movies', { recursive: true });
writeFileSync(OUT, JSON.stringify(films, null, 0).replace(/},{/g, '},\n{') + '\n');
console.log(`${films.length} films rated ${MIN}★+ → ${OUT} (${found} with posters)`);
