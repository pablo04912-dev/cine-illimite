// Récupère les séances (Allociné) des salles de cinemas.json pour les 7 prochains jours,
// ajoute les bandes-annonces TMDB et le journal Letterboxd, et écrit data/seances.json.
// Usage : TMDB_TOKEN=... LETTERBOXD_USER=... node scripts/fetch.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parse } from 'node-html-parser';

const DAYS = Number(process.env.DAYS || 7);
let TMDB_TOKEN = process.env.TMDB_TOKEN || '';
if (!TMDB_TOKEN) {
  try { TMDB_TOKEN = (await readFile(new URL('../.tmdb_token', import.meta.url), 'utf8')).trim(); } catch { /* pas de fichier */ }
}
const LB_USER = (process.env.LETTERBOXD_USER || '').trim();
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = new URL('..', import.meta.url);

// Requête polie : pause entre chaque appel AlloCiné, et longue attente si le site dit « trop de requêtes » (429)
let lastAllo = 0;
async function politeFetch(url, opts) {
  const isAllo = url.includes('allocine.fr');
  for (let i = 0; i < 6; i++) {
    if (isAllo) {
      const wait = lastAllo + 700 - Date.now();
      if (wait > 0) await sleep(wait);
      lastAllo = Date.now();
    }
    try {
      const r = await fetch(url, opts);
      if (r.status === 429 || r.status >= 500) {
        const pause = Math.min(120, 15 * 2 ** i);
        console.warn(`HTTP ${r.status} ${url} : pause ${pause}s`);
        await sleep(pause * 1000);
        continue;
      }
      return r;
    } catch (e) {
      console.warn(`Erreur ${url}: ${e.message}`);
      await sleep(3000 * (i + 1));
    }
  }
  return null;
}
async function getJson(url, headers = {}) {
  const r = await politeFetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
  if (!r || !r.ok) return null;
  try { return await r.json(); } catch { return null; }
}

function parisDate(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d); // AAAA-MM-JJ
}

function versionOf(key) {
  if (key.startsWith('original')) return 'VOST';
  return 'VF';
}

function formatOf(s) {
  const tags = [s.experience, s.picture, s.sound, s.comfort]
    .flat()
    .filter(Boolean)
    .map((t) => String(t).toUpperCase());
  const out = [];
  if (tags.some((t) => t.includes('IMAX'))) out.push('IMAX');
  if (tags.some((t) => t.includes('DOLBY'))) out.push('Dolby');
  if (tags.some((t) => t.includes('4DX'))) out.push('4DX');
  if (tags.some((t) => t.includes('SCREENX'))) out.push('ScreenX');
  if (tags.some((t) => t.includes('3D'))) out.push('3D');
  return out.join(' ');
}

function filmFrom(m) {
  const director = (m.credits || [])
    .filter((c) => c.position && c.position.name === 'DIRECTOR')
    .map((c) => [c.person.firstName, c.person.lastName].filter(Boolean).join(' '))
    .join(', ');
  const release = (m.releases || []).find((r) => r.releaseDate)?.releaseDate?.date || null;
  return {
    title: m.title,
    originalTitle: m.originalTitle,
    poster: m.poster?.url || null,
    runtime: m.runtime || null,
    genres: (m.genres || []).map((g) => g.translate),
    director,
    year: m.data?.productionYear || null,
    synopsis: m.synopsis || '',
    press: m.stats?.pressReview?.score ? Math.round(m.stats.pressReview.score * 10) / 10 : null,
    spect: m.stats?.userRating?.score ? Math.round(m.stats.userRating.score * 10) / 10 : null,
    release,
    trailer: null,
    tmdbId: null,
    tmdbGenres: []
  };
}

async function fetchShowtimes(cinemas) {
  const films = {};
  const seances = [];
  for (const c of cinemas) {
    for (let d = 0; d < DAYS; d++) {
      const date = parisDate(d);
      let page = 1;
      let pages = 1;
      do {
        const url = `https://www.allocine.fr/_/showtimes/theater-${c.id}/d-${date}/${page > 1 ? `p-${page}/` : ''}`;
        const j = await getJson(url);
        await sleep(400);
        if (!j || !j.results) break;
        pages = j.pagination?.totalPages || 1;
        for (const r of j.results) {
          const m = r.movie;
          if (!m) continue;
          const fid = String(m.internalId);
          if (!films[fid]) films[fid] = filmFrom(m);
          for (const [key, list] of Object.entries(r.showtimes || {})) {
            for (const s of list || []) {
              if (!s.startsAt) continue;
              seances.push({ f: fid, c: c.id, t: s.startsAt.slice(0, 16), v: versionOf(key), x: formatOf(s), p: !!s.isPreview });
            }
          }
        }
        page++;
      } while (page <= pages);
    }
    console.log(`${c.name} : ok`);
  }
  seances.sort((a, b) => a.t.localeCompare(b.t));
  return { films, seances };
}

// Avis AlloCiné : la critique presse la plus enthousiaste et la plus sévère,
// idem pour les spectateurs (première page). Extraits courts + lien vers la page.
async function getHtml(url) {
  const r = await politeFetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!r || !r.ok) return null;
  try { return await r.text(); } catch { return null; }
}
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const cut = (s, n = 320) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s);
const noteOf = (el) => {
  const m = el?.querySelector('.rating-mdl')?.getAttribute('class')?.match(/\bn(\d+)\b/);
  return m ? Number(m[1]) / 10 : null;
};
function pickExtremes(list) {
  const rated = list.filter((x) => x.note != null && x.text);
  if (!rated.length) return {};
  const sorted = rated.slice().sort((a, b) => b.note - a.note);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  return worst !== best && worst.note < best.note ? { pos: best, neg: worst } : { pos: best };
}
async function enrichReviews(films) {
  for (const [id, f] of Object.entries(films)) {
    if (f.reviewsAt) continue;
    f.reviewsAt = Date.now();
    const base = `https://www.allocine.fr/film/fichefilm-${id}/critiques`;
    const ph = await getHtml(`${base}/presse/`);
    if (ph) {
      const root = parse(ph);
      const press = root.querySelectorAll('.reviews-press-comment .item').map((el) => ({
        who: clean(el.querySelector('.title')?.text),
        note: noteOf(el),
        text: cut(clean(el.querySelector('.text')?.text))
      }));
      f.pressReviews = pickExtremes(press);
    }
    await sleep(250);
    const sh = await getHtml(`${base}/spectateurs/`);
    if (sh) {
      const root = parse(sh);
      const users = root.querySelectorAll('.review-card').map((el) => ({
        who: clean(el.querySelector('.meta-title')?.text),
        note: Number((clean(el.querySelector('.stareval-note')?.text) || '').replace(',', '.')) || null,
        text: cut(clean(el.querySelector('.content-txt')?.text))
      }));
      f.userReviews = pickExtremes(users);
    }
    await sleep(250);
  }
}

const tmdb = (path) =>
  getJson(`https://api.themoviedb.org/3${path}`, { Authorization: `Bearer ${TMDB_TOKEN}` });

async function enrichTmdb(films) {
  if (!TMDB_TOKEN) {
    console.log('Pas de TMDB_TOKEN : bandes-annonces ignorées.');
    return;
  }
  for (const f of Object.values(films)) {
    if (f.tmdbChecked) continue;
    f.tmdbChecked = true;
    const q = encodeURIComponent(f.originalTitle || f.title);
    let res = await tmdb(`/search/movie?query=${q}&language=fr-FR${f.year ? `&year=${f.year}` : ''}`);
    if (!res?.results?.length && f.year) res = await tmdb(`/search/movie?query=${q}&language=fr-FR`);
    const hit = res?.results?.[0];
    if (!hit) continue;
    f.tmdbId = hit.id;
    f.tmdbGenres = hit.genre_ids || [];
    if (!f.poster && hit.poster_path) f.poster = `https://image.tmdb.org/t/p/w500${hit.poster_path}`;
    for (const lang of ['fr-FR', 'en-US']) {
      const v = await tmdb(`/movie/${hit.id}/videos?language=${lang}`);
      const yt = (v?.results || []).filter((x) => x.site === 'YouTube');
      const best = yt.find((x) => x.type === 'Trailer') || yt.find((x) => x.type === 'Teaser') || yt[0];
      if (best) {
        f.trailer = best.key;
        break;
      }
    }
    await sleep(120);
  }
}

// Journal Letterboxd via le flux RSS public
async function fetchLetterboxd() {
  if (!LB_USER) return [];
  let xml = '';
  try {
    const r = await fetch(`https://letterboxd.com/${encodeURIComponent(LB_USER)}/rss/`, { headers: { 'User-Agent': UA } });
    if (!r.ok) return [];
    xml = await r.text();
  } catch {
    return [];
  }
  const items = xml.split('<item>').slice(1);
  const tag = (s, t) => {
    const m = s.match(new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`));
    return m ? m[1].trim() : null;
  };
  const out = [];
  for (const it of items) {
    const title = tag(it, 'letterboxd:filmTitle');
    if (!title) continue;
    const desc = tag(it, 'description') || '';
    const img = desc.match(/<img src="([^"]+)"/);
    const review = desc
      .replace(/<p><img[^>]*><\/p>/, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    out.push({
      title,
      year: tag(it, 'letterboxd:filmYear'),
      rating: tag(it, 'letterboxd:memberRating') ? Number(tag(it, 'letterboxd:memberRating')) : null,
      date: tag(it, 'letterboxd:watchedDate'),
      tmdbId: tag(it, 'tmdb:movieId') ? Number(tag(it, 'tmdb:movieId')) : null,
      poster: img ? img[1] : null,
      review: review.startsWith('Watched on') ? '' : review.slice(0, 280)
    });
  }
  // genres TMDB des films notés, pour les recommandations
  if (TMDB_TOKEN) {
    for (const e of out) {
      if (!e.tmdbId) continue;
      const d = await tmdb(`/movie/${e.tmdbId}?language=fr-FR`);
      e.genres = (d?.genres || []).map((g) => g.id);
      await sleep(100);
    }
  }
  return out;
}

const cinemas = JSON.parse(await readFile(new URL('cinemas.json', root), 'utf8'));
let previous = {};
try { previous = JSON.parse(await readFile(new URL('data/seances.json', root), 'utf8')).films || {}; } catch { /* premier lancement */ }
const { films, seances } = await fetchShowtimes(cinemas);
// on réutilise ce qu'on connaît déjà (bandes-annonces, avis) pour ne pas tout redemander chaque nuit
const FRESH = 4 * 86400000;
for (const [id, f] of Object.entries(films)) {
  const p = previous[id]; if (!p) continue;
  if (p.tmdbChecked) Object.assign(f, { tmdbId: p.tmdbId, tmdbGenres: p.tmdbGenres, trailer: p.trailer, tmdbChecked: true, poster: f.poster || p.poster });
  if (p.reviewsAt && Date.now() - p.reviewsAt < FRESH) Object.assign(f, { pressReviews: p.pressReviews, userReviews: p.userReviews, reviewsAt: p.reviewsAt });
}
console.log(`${Object.keys(films).length} films, ${seances.length} séances`);
if (!seances.length) {
  console.error('Aucune séance récupérée : fichier non modifié.');
  process.exit(1);
}
await enrichTmdb(films);
await enrichReviews(films);
const journal = await fetchLetterboxd();
await mkdir(new URL('data/', root), { recursive: true });
await writeFile(
  new URL('data/seances.json', root),
  JSON.stringify({ generatedAt: new Date().toISOString(), cinemas, films, seances, journal })
);
console.log('data/seances.json écrit.');
