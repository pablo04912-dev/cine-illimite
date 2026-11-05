// Envoi des notifications Projo (lancé toutes les 5 min par GitHub Actions)
import admin from 'firebase-admin';
import webpush from 'web-push';
import { readFile } from 'node:fs/promises';

const VAPID_PUBLIC = 'BEXcRTvtcAJRRnsstdM6ze0jiAlpyMeEJG_ei2y8gw0EXTUBVbgTZHRAtGSobU62gDDyTbhziX5OLOZPIX36uYE';
const SITE = 'https://pablo04912-dev.github.io/cine-illimite/';
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
const db = admin.firestore();
webpush.setVapidDetails(SITE, VAPID_PUBLIC, process.env.VAPID_PRIVATE);

const data = JSON.parse(await readFile(new URL('../data/seances.json', import.meta.url), 'utf8'));
const cinemas = Object.fromEntries(data.cinemas.map((c) => [c.id, c]));
const MIN = 60000;
const now = Date.now();

// heure de Paris
const parisParts = (ms) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
function parisEpoch(t) { // 'YYYY-MM-DDTHH:MM' heure de Paris -> ms
  const guess = Date.parse(t + ':00Z');
  const p = parisParts(guess);
  const asUtc = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  return guess - (asUtc - guess);
}
const P = parisParts(now);
const today = `${P.year}-${P.month}-${P.day}`;
const hour = +P.hour;
const daytime = hour >= 9 && hour < 21;
const hm = (t) => t.slice(11, 16).replace(':', 'h');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
let horizon = '';
for (const s of data.seances) { const d = s.t.slice(0, 10); if (d > horizon) horizon = d; }
const future = data.seances.filter((s) => cinemas[s.c] && parisEpoch(s.t) > now);
const byFilm = {};
for (const s of future) (byFilm[s.f] ||= []).push(s);

const pushSnap = await db.collection('push').get();
let sentCount = 0;
for (const pdoc of pushSnap.docs) {
  const uid = pdoc.id;
  const p = pdoc.data();
  const subs = Object.entries(p.subs || {}).filter(([, v]) => v && v.endpoint);
  if (!subs.length) continue;
  const sent = p.sent || {};
  const firstRun = !p.init;
  const items = (await db.doc(`users/${uid}`).get()).data()?.items || {};
  const notes = [];
  const add = (key, title, body, url, urgent) => { if (!sent[key]) notes.push({ key, title, body, url, urgent }); };

  // 1. rappels de séance
  for (const r of items.rappels || []) {
    const start = parisEpoch(r.t);
    if (start < now) continue;
    const filmAt = new Date(start + (r.ads || 0) * MIN).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
    const url = `${SITE}?film=${r.f}&day=${r.t.slice(0, 10)}`;
    if (r.travel >= 10) {
      const leave = start - (r.travel + 5) * MIN;
      if (now >= leave - 5 * MIN && now < start - 20 * MIN) add(`l:${r.k}`, `Pars maintenant pour ${r.title}`, `Séance à ${hm(r.t)} au ${r.cine} · environ ${r.travel} min de trajet`, url, true);
    }
    if (now >= start - 20 * MIN) add(`r:${r.k}`, `${r.title} commence bientôt`, `Séance à ${hm(r.t)} au ${r.cine}${r.ads ? ` · le film démarre vers ${filmAt}` : ''}`, url, true);
  }
  // 2. derniers jours des films de « Ma liste »
  const vus = new Set((items.vus2 || []).map((v) => String(v.f)));
  if (daytime) {
    for (const id of items.liste || []) {
      if (vus.has(String(id)) || !byFilm[id]) continue;
      const last = byFilm[id].reduce((a, b) => (b.t > a.t ? b : a));
      const lastDay = last.t.slice(0, 10);
      if (lastDay >= horizon) continue;
      const n = dayDiff(today, lastDay);
      if (n > 2) continue;
      const f = data.films[id] || {};
      const c = cinemas[last.c];
      const when = n <= 0 ? `Dernière séance aujourd'hui à ${hm(last.t)}` : n === 1 ? `Dernière séance demain à ${hm(last.t)}` : `Plus que ${n} jours pour le voir`;
      add(`end:${id}:${lastDay}:${n <= 0 ? 0 : 1}`, f.title || 'Un film de ta liste', `${when} · ${c?.name || ''}`, `${SITE}?film=${id}&day=${lastDay}`, false);
    }
    // 3. films attendus qui sortent
    for (const u of items.avenir || []) {
      const fid = Object.keys(byFilm).find((id) => data.films[id]?.tmdbId === u.id || norm(data.films[id]?.title) === norm(u.title));
      if (!fid) continue;
      const n = new Set(byFilm[fid].map((s) => s.c)).size;
      add(`out:${u.id}`, `${u.title} est sorti`, `À l'affiche dans ${n} salle${n > 1 ? 's' : ''} qui acceptent ta carte`, `${SITE}?film=${fid}`, false);
    }
    // 4. conseils des amis
    const prof = (await db.doc(`profiles/${uid}`).get()).data() || {};
    for (const fu of prof.friends || []) {
      const fp = (await db.doc(`profiles/${fu}`).get()).data(); if (!fp) continue;
      const first = String(fp.name || 'Un ami').split(' ')[0];
      for (const x of fp.conseils || []) {
        if (vus.has(String(x.f))) continue;
        add(`cons:${fu}:${x.f}`, `${first} te conseille un film`, x.title, byFilm[x.f] ? `${SITE}?film=${x.f}` : `${SITE}?notifs=1`, false);
      }
    }
  }

  // premier passage : on marque l'existant comme déjà vu (pas de rafale), sauf les rappels
  const toSend = firstRun ? notes.filter((n) => n.urgent) : notes;
  const newSent = { ...sent };
  for (const n of notes) newSent[n.key] = now;
  for (const [k, t] of Object.entries(newSent)) if (now - t > 40 * 86400000) delete newSent[k];
  const deadSubs = [];
  for (const n of toSend.slice(0, 3)) {
    const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.key });
    for (const [dev, sub] of subs) {
      try { await webpush.sendNotification(sub, payload, { TTL: 3600 }); sentCount++; }
      catch (e) { if (e.statusCode === 404 || e.statusCode === 410) deadSubs.push(dev); else console.warn('envoi', e.statusCode, e.body); }
    }
  }
  const upd = { sent: newSent, init: true };
  for (const dev of new Set(deadSubs)) upd[`subs.${dev}`] = admin.firestore.FieldValue.delete();
  if (notes.length || firstRun || deadSubs.length) await pdoc.ref.update(upd);
}
console.log(`${pushSnap.size} abonnés, ${sentCount} notifications envoyées`);
