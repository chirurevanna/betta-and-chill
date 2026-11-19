/**
 * Movie picks: films rated 3.5★ or more in a Letterboxd export, with posters from Wikipedia.
 * The list (movies.json) is built by scripts/build-movies.mjs and loaded only when the card opens.
 */
export interface Film {
  name: string;
  year: number;
  rating: number;
  /** the film on Letterboxd */
  url: string;
  /** poster thumbnail, or null / missing when none was found */
  poster?: string | null;
}

let films: Film[] | null = null;
export async function loadFilms(): Promise<Film[]> {
  films ??= (await import('./movies.json')).default as Film[];
  return films;
}

/** `n` random films, avoiding the ones just shown when there are enough others. */
export function pickFilms(all: Film[], n: number, avoid: Set<string>): Film[] {
  const fresh = all.filter((f) => !avoid.has(f.url));
  const pool = fresh.length >= n ? fresh : all.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}
