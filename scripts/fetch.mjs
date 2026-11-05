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
let blocked = false; // AlloCiné nous a demandé de ralentir : on arrête les pages d'avis pour cette fois
async function politeFetch(url, opts, { tries = 6, gap = 700 } = {}) {
  const isAllo = url.includes('allocine.fr');
  for (let i = 0; i < tries; i++) {
    if (isAllo) {
      const wait = lastAllo + gap - Date.now();
      if (wait > 0) await sleep(wait);
      lastAllo = Date.now();
    }
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
      if (r.status === 429 || r.status >= 500) {
        if (tries === 1) { blocked = r.status === 429; return null; }
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
  const r = await politeFetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } }, { tries: 1, gap: 2500 });
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
// Les avis sont récupérés petit à petit (MAX_REVIEWS films par passage, les plus programmés d'abord)
// pour ne pas se faire bloquer : au bout de quelques nuits, tous les films sont couverts.
async function enrichReviews(films, seances) {
  const MAX = Number(process.env.MAX_REVIEWS || 70);
  const count = {};
  for (const s of seances) count[s.f] = (count[s.f] || 0) + 1;
  const todo = Object.entries(films).filter(([, f]) => !f.reviewsAt).sort((a, b) => (count[b[0]] || 0) - (count[a[0]] || 0)).slice(0, MAX);
  let done = 0;
  for (const [id, f] of todo) {
    if (blocked) { console.log(`AlloCiné demande de ralentir : avis arrêtés après ${done} films, la suite au prochain passage.`); break; }
    done++;
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
    if (!blocked && ph && sh) f.reviewsAt = Date.now();
  }
}

// paris-cine.info : notes (Letterboxd, IMDb, SensCritique…), repérage des classiques,
// et pour les salles indé : salle exacte (places, taille d'écran) + lien de réservation
const PC = 'https://paris-cine.info';
let lastPc = 0;
async function pcJson(path) {
  const wait = lastPc + 1200 - Date.now();
  if (wait > 0) await sleep(wait);
  lastPc = Date.now();
  try {
    const r = await fetch(PC + path, { headers: { 'User-Agent': UA, Accept: 'application/json', Referer: PC + '/' }, signal: AbortSignal.timeout(15000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function enrichParisCine(films, seances, cinemas, prevScreens) {
  const mv = await pcJson('/get_movies.php');
  const byId = {};
  for (const m of mv?.data || []) byId[String(m.id)] = m;
  let n = 0;
  for (const [id, f] of Object.entries(films)) {
    const m = byId[id]; if (!m) continue;
    n++;
    f.classic = m.ret === 1;
    f.notes = { lb: m.lb_r || null, imdb: m.im_r || null, sc: m.sc_r || null, rt: m.rt_r || null, mc: m.mc_r || null };
    if (m.lb_u) f.lb = m.lb_u;
    if (!f.year && m.ye) f.year = Number(m.ye);
  }
  console.log(`paris-cine : ${n} films reconnus, ${Object.values(films).filter((f) => f.classic).length} classiques`);
  const indie = new Set(cinemas.filter((c) => !/^(UGC|MK2)\b/i.test(c.name)).map((c) => c.id));
  const want = [...new Set(seances.filter((s) => indie.has(s.c)).map((s) => s.f))].filter((id) => byId[id]);
  const idx = new Map(seances.map((s) => [`${s.f}|${s.c}|${s.t}`, s]));
  const screens = { ...prevScreens };
  const missing = new Set();
  let k = 0;
  for (const id of want) {
    if (++k % 50 === 0) console.log(`paris-cine : ${k}/${want.length} films`);
    const j = await pcJson(`/get_showtimes.php?mov_id=${id}`);
    for (const st of j?.showtimes || []) {
      const s = idx.get(`${id}|${st.tid}|${String(st.start).slice(0, 16)}`);
      if (!s) continue;
      if (Number(st.screen_id) > 0) { s.sc = `${st.tid}:${st.screen_id}`; if (!screens[s.sc]) missing.add(s.sc); }
      if (st.book) s.bk = st.book;
      if (st.com) s.ev = String(st.com).trim().slice(0, 160); // rencontre, débat, ciné-club…
    }
  }
  for (const key of missing) {
    const [tid, sid] = key.split(':');
    const j = await pcJson(`/get_pcitheatre.php?theatre_id=${tid}&screen_id=${sid}`);
    const t = j?.theater?.[0];
    screens[key] = t ? { name: t.screen_name || '', seats: Number(t.seatCount) || null, width: Number(t.screenWidth) || null } : {};
  }
  console.log(`paris-cine : salles précisées pour ${want.length} films, ${Object.keys(screens).length} écrans connus`);
  return screens;
}

// Films à venir en France (sorties des 3 prochains mois), avec leur vraie date de sortie française
async function fetchUpcoming(prev) {
  if (!TMDB_TOKEN) return prev || [];
  const today = parisDate(0);
  const until = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const known = new Map((prev || []).map((u) => [u.id, u]));
  const list = [];
  const seen = new Set();
  for (let page = 1; page <= 4; page++) {
    const r = await tmdb(`/discover/movie?region=FR&language=fr-FR&sort_by=popularity.desc&with_release_type=3&release_date.gte=${today}&release_date.lte=${until}&page=${page}`);
    for (const m of r?.results || []) {
      if (seen.has(m.id) || !m.poster_path) continue;
      seen.add(m.id);
      let date = null;
      const k = known.get(m.id);
      if (k && k.checkedAt && Date.now() - k.checkedAt < 5 * 86400000) date = k.date;
      else {
        const rd = await tmdb(`/movie/${m.id}/release_dates`);
        const fr = rd?.results?.find((x) => x.iso_3166_1 === 'FR');
        const th = (fr?.release_dates || []).filter((x) => x.type === 3 || x.type === 2).map((x) => x.release_date.slice(0, 10)).sort()[0];
        date = th || null;
        await sleep(150);
      }
      if (!date || date <= today || date > until) continue;
      list.push({ id: m.id, title: m.title, poster: `https://image.tmdb.org/t/p/w500${m.poster_path}`, date, synopsis: (m.overview || '').slice(0, 400), genres: m.genre_ids || [], pop: Math.round(m.popularity || 0), checkedAt: Date.now() });
    }
  }
  list.sort((a, b) => a.date.localeCompare(b.date) || b.pop - a.pop);
  console.log(`TMDB : ${list.length} films à venir`);
  return list;
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
let prevScreens = {};
let prevUpcoming = [];
try {
  const old = JSON.parse(await readFile(new URL('data/seances.json', root), 'utf8'));
  previous = old.films || {};
  prevScreens = old.screens || {};
  prevUpcoming = old.upcoming || [];
} catch { /* premier lancement */ }
// PC_ONLY=1 : ne refait que la partie paris-cine.info sur les données existantes (pour tester)
if (process.env.PC_ONLY) {
  const old = JSON.parse(await readFile(new URL('data/seances.json', root), 'utf8'));
  old.cinemas = cinemas;
  old.screens = await enrichParisCine(old.films, old.seances, cinemas, prevScreens);
  await writeFile(new URL('data/seances.json', root), JSON.stringify(old));
  console.log('paris-cine seul : écrit.');
  process.exit(0);
}
if (process.env.UPCOMING_ONLY) {
  const old = JSON.parse(await readFile(new URL('data/seances.json', root), 'utf8'));
  old.upcoming = await fetchUpcoming(old.upcoming || []);
  await writeFile(new URL('data/seances.json', root), JSON.stringify(old));
  console.log('à venir seul : écrit.');
  process.exit(0);
}
const { films, seances } = await fetchShowtimes(cinemas);
// on réutilise ce qu'on connaît déjà (bandes-annonces, avis) pour ne pas tout redemander chaque nuit
const FRESH = 14 * 86400000;
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
await enrichReviews(films, seances);
let screens = prevScreens;
try { screens = await enrichParisCine(films, seances, cinemas, prevScreens); } catch (e) { console.warn('paris-cine indisponible : ' + e.message); }
const journal = await fetchLetterboxd();
let upcoming = prevUpcoming;
try { upcoming = await fetchUpcoming(prevUpcoming); } catch (e) { console.warn('à venir indisponible : ' + e.message); }
await mkdir(new URL('data/', root), { recursive: true });
await writeFile(
  new URL('data/seances.json', root),
  JSON.stringify({ generatedAt: new Date().toISOString(), cinemas, films, seances, screens, journal, upcoming })
);
console.log('data/seances.json écrit.');
