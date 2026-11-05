// Synchro Letterboxd -> Projo (lancé avec les notifications, toutes les 5 min ; chaque compte est relu toutes les 3 h ou à la demande)
import admin from 'firebase-admin';
import { readFile } from 'node:fs/promises';

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
const db = admin.firestore();
const TMDB = process.env.TMDB_TOKEN;
const data = JSON.parse(await readFile(new URL('../data/seances.json', import.meta.url), 'utf8'));
const byTmdb = {};
for (const [id, f] of Object.entries(data.films)) if (f.tmdbId) byTmdb[f.tmdbId] = id;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const keyOf = (v) => norm(v.title) + '|' + v.date;
const now = Date.now();
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const tag = (it, t) => { const m = it.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? m[1].trim() : ''; };
const decode = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
async function tmdb(path) {
  if (!TMDB) return null;
  try { const r = await fetch('https://api.themoviedb.org/3' + path, { headers: { Authorization: `Bearer ${TMDB}` } }); return r.ok ? r.json() : null; } catch { return null; }
}
async function readRss(user) {
  const r = await fetch(`https://letterboxd.com/${encodeURIComponent(user)}/rss/`, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml,text/xml' } });
  if (r.status === 404) throw new Error('pseudo introuvable');
  if (!r.ok) throw new Error('Letterboxd a répondu ' + r.status);
  const xml = await r.text();
  const out = [];
  for (const it of xml.split('<item>').slice(1)) {
    const date = tag(it, 'letterboxd:watchedDate'); const title = decode(tag(it, 'letterboxd:filmTitle'));
    if (!date || !title) continue; // listes, pas des films vus
    const desc = decode(tag(it, 'description'));
    const poster = (desc.match(/<img src="([^"]+)"/) || [])[1] || '';
    const paras = [...desc.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]).filter((p) => !/<img|^Watched on|^Rewatched on|^Added /i.test(p.trim()));
    const review = paras.map((p) => p.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').trim()).filter(Boolean).join('\n\n');
    const tm = Number(tag(it, 'tmdb:movieId')) || null;
    out.push({ title, year: Number(tag(it, 'letterboxd:filmYear')) || null, date, rating: Number(tag(it, 'letterboxd:memberRating')) || 0, review: review.slice(0, 2000), poster, tmdb: tm, lb: tag(it, 'link') });
  }
  return out;
}

const snap = await db.collection('lbsync').get();
let synced = 0;
for (const d of snap.docs) {
  const s = d.data(); const uid = d.id;
  const due = (s.req && s.req > (s.lastSync || 0)) || now - (s.lastSync || 0) > 3 * 3600000 || s.needPosters;
  if (!due || (!s.user && !s.needPosters)) continue;
  const ref = db.doc(`users/${uid}`);
  const items = (await ref.get()).data()?.items || {};
  const vus = items.vus2 || [];
  const idx = new Map(vus.map((v) => [keyOf(v), v]));
  let added = 0; let error = null;
  if (s.user) {
    try {
      for (const e of await readRss(s.user)) {
        const k = keyOf(e);
        const cur = idx.get(k);
        if (cur) {
          if (!cur.rating && e.rating) cur.rating = e.rating;
          if (!cur.review && e.review) cur.review = e.review;
          if (!cur.poster && e.poster) cur.poster = e.poster;
          continue;
        }
        const v = { f: (e.tmdb && byTmdb[e.tmdb]) || (e.tmdb ? `tmdb:${e.tmdb}` : `lb:${norm(e.title)}`), title: e.title, poster: e.poster, date: e.date, rating: e.rating, review: e.review, lb: e.lb, tmdb: e.tmdb };
        vus.push(v); idx.set(k, v); added++;
      }
    } catch (e) { error = e.message; }
  }
  // affiches manquantes (import du fichier Letterboxd) : TMDB, 40 par passage
  let fixed = 0;
  for (const v of vus) {
    if (v.poster || fixed >= 40) continue;
    let p = null;
    if (v.tmdb) p = (await tmdb(`/movie/${v.tmdb}?language=fr-FR`))?.poster_path;
    else {
      const r = await tmdb(`/search/movie?query=${encodeURIComponent(v.title)}&language=fr-FR${v.year ? `&year=${v.year}` : ''}`);
      const hit = r?.results?.[0];
      if (hit) { p = hit.poster_path; v.tmdb = hit.id; if (byTmdb[hit.id] && String(v.f).startsWith('lb:')) v.f = byTmdb[hit.id]; }
    }
    v.poster = p ? `https://image.tmdb.org/t/p/w342${p}` : '-';
    fixed++;
  }
  const morePosters = vus.some((v) => !v.poster);
  if (added || fixed) {
    vus.sort((a, b) => a.date.localeCompare(b.date));
    await ref.set({ items: { ...items, vus2: vus }, dev: 'letterboxd', at: now }, { merge: true });
  }
  await d.ref.set({ lastSync: now, added: (s.added || 0) + added, error, needPosters: morePosters }, { merge: true });
  synced++;
  console.log(`letterboxd : ${added} nouveaux films, ${fixed} affiches${error ? ' · ' + error : ''}`);
}
console.log(`letterboxd : ${synced} comptes traités`);
