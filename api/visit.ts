/**
 * "Someone opened Betta & Chill": the page POSTs here once per open, and this sends a push to
 * the owner's phone through ntfy (https://ntfy.sh). The ntfy topic lives only in the Vercel env
 * var NTFY_TOPIC, never in the repo or the browser, so nobody else can read or spam the alerts.
 *
 * Sends: app or website, city/country (from Vercel's network headers), device type, new or
 * returning. Nothing is stored. Bots, link previews and non-production deploys are skipped.
 */

const BOT = /bot|crawl|spider|slurp|lighthouse|headless|preview|facebookexternalhit|whatsapp|telegram|discord|embedly|vercel-screenshot|curl|wget|python|node-fetch/i;
const RATE_MS = 30_000;
const lastByIp = new Map<string, number>();

function device(ua: string): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return 'Linux';
  return 'a device';
}

function place(h: Headers): string {
  const decode = (v: string | null) => {
    try {
      return v ? decodeURIComponent(v) : '';
    } catch {
      return v ?? '';
    }
  };
  const city = decode(h.get('x-vercel-ip-city'));
  const code = h.get('x-vercel-ip-country') ?? '';
  let country = code;
  try {
    country = (code && new Intl.DisplayNames(['en'], { type: 'region' }).of(code)) || code;
  } catch {
    /* keep the code */
  }
  return [city, country].filter(Boolean).join(', ') || 'somewhere';
}

const done = () => new Response(null, { status: 204 });

export async function POST(request: Request): Promise<Response> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic || process.env.VERCEL_ENV !== 'production') return done();

  const ua = request.headers.get('user-agent') ?? '';
  if (!ua || BOT.test(ua)) return done();

  let body: { mode?: unknown; returning?: unknown };
  try {
    body = await request.json();
  } catch {
    return done();
  }
  if ((body.mode !== 'app' && body.mode !== 'website') || typeof body.returning !== 'boolean') return done();

  // best-effort spam guard: at most one alert per IP every 30 s (per function instance)
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  if (now - (lastByIp.get(ip) ?? 0) < RATE_MS) return done();
  lastByIp.set(ip, now);
  if (lastByIp.size > 5000) lastByIp.clear();

  const who = body.returning ? 'Returning listener' : 'New listener';
  const where = body.mode === 'app' ? 'App' : 'Website';
  const message = `${who} · ${where} · ${place(request.headers)} · ${device(ua)}`;

  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: {
        Title: 'Someone opened Betta & Chill',
        Tags: body.mode === 'app' ? 'radio' : 'globe_with_meridians',
        Click: 'https://betta-and-chill.vercel.app/',
      },
      body: message,
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    /* ntfy down: the listener's page is unaffected */
  }
  return done();
}
