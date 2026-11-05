'use strict';
// Numéro de version : doit être égal au ?v= de app.js dans index.html (à augmenter à chaque mise à jour)
const APP_VERSION = 22;

// ================= état =================
const DEFAULT_POS = { lat: 48.8396, lng: 2.3958, label: 'Paris 12e' };
const store = {
  get(k, d) { try { const v = localStorage.getItem('ci.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ci.' + k, JSON.stringify(v)); } catch { /* stockage indisponible */ } window.onStoreSet?.(k); }
};
const FORMULES = {
  m26: { label: 'UGC Illimité −26 ans', prix: 19.9 },
  solo: { label: 'UGC Illimité Solo', prix: 23.9 },
  duo: { label: 'UGC Illimité Duo', prix: 39.9 },
  autre: { label: 'Autre montant', prix: null }
};
const S = {
  data: null,
  pos: DEFAULT_POS,
  sv: 'all', // all | classics
  mode: 'now', // now | tonight | from | all
  fromTime: store.get('fromTime', '19:00'),
  tomorrow: false,
  vo: false, indie: false, list: false, premium: false, fav: false, special: false,
  radius: 3,
  limit: 30,
  liste: new Set(store.get('liste', [])),
  vus: store.get('vus2', []),
  carte: Object.assign({ formule: 'duo', prix: 39.9, partage: 2, plein: 14.9 }, store.get('carte', {})),
  theme: store.get('theme', 'light'),
  pins: store.get('pins', ['C0065']), // Grand Rex épinglé par défaut
  conseils: store.get('conseils', []) // films que tu conseilles à tes amis
};
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => parseFloat(String(v).replace(',', '.'));
const euro = (v) => (Math.round(v * 100) / 100).toFixed(2).replace('.', ',') + ' €';

// ================= utilitaires =================
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
const today = () => ymd(new Date());
const tomorrow = () => ymd(new Date(Date.now() + 86400000));
const hm = (t) => t.slice(11, 16).replace(':', 'h');
const asDate = (t) => new Date(t + ':00');
const minutesUntil = (t) => Math.round((asDate(t) - Date.now()) / 60000);
function runtimeMin(r) {
  if (!r) return 110;
  const h = /(\d+)\s*h/.exec(r); const m = /(\d+)\s*min/.exec(r);
  return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) || 110;
}
function distKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const fmtDist = (km) => (km < 1 ? Math.round(km * 10) * 100 + ' m' : km.toFixed(1).replace('.', ',') + ' km');
function trajet(km) {
  const walk = Math.round(km * 13);
  return walk <= 20 ? `${walk} min à pied` : `≈ ${Math.round(12 + km * 3)} min en métro`;
}
function dansLabel(t) {
  const m = minutesUntil(t);
  if (m < 0) return 'a commencé';
  if (m === 0) return 'maintenant';
  if (m < 60) return `dans ${m} min`;
  const d = t.slice(0, 10);
  if (d === today()) return `dans ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  if (d === tomorrow()) return 'demain';
  return new Date(d).toLocaleDateString('fr-FR', { weekday: 'long' });
}
function dayShort(t) {
  const d = t.slice(0, 10);
  if (d === today()) return "Aujourd'hui";
  if (d === tomorrow()) return 'Demain';
  return new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}
function quand(t) {
  const d = t.slice(0, 10);
  if (d === today()) return `Auj. ${hm(t)}`;
  if (d === tomorrow()) return `Demain ${hm(t)}`;
  return new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }) + ' ' + hm(t);
}
const bg = (url) => (url ? `background-image:url('${esc(url)}')` : '');
const cinema = (id) => S.data.cinemaById[id];
const isIndie = (c) => !/^(UGC|MK2)\b/i.test(c.name);
const shortName = (c) => c.name.replace(/^UGC Ciné Cité /, 'UGC ').replace(/\s*\(.*\)$/, '');
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}
const ICON_ARROW = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>';

// ================= goûts / recommandations =================
function buildTaste() {
  const w = {}; let n = 0;
  const add = (genres, rating) => { n++; for (const g of genres) w[g] = (w[g] || 0) + (rating - 2.75); };
  for (const e of S.data.journal || []) if (e.rating != null && e.genres) add(e.genres, e.rating);
  for (const v of S.vus) { const f = S.data.films[v.f]; if (v.rating && f?.tmdbGenres?.length) add(f.tmdbGenres, v.rating); }
  S.taste = n ? w : null;
}
function score(f) {
  const q = ((f.press || 3) + (f.spect || 3)) / 2;
  let s = (q - 2.5) / 2.5;
  if (S.taste && f.tmdbGenres?.length) {
    const t = f.tmdbGenres.reduce((a, g) => a + (S.taste[g] || 0), 0) / f.tmdbGenres.length;
    s = s * 0.4 + Math.tanh(t / 2) * 0.6;
  }
  return s;
}
const matchPct = (f) => Math.max(40, Math.min(99, Math.round(70 + score(f) * 29)));
const seenIds = () => new Set(S.vus.map((v) => v.f));

// ================= filtres =================
function window_() {
  const day = S.tomorrow ? tomorrow() : today();
  let from = '00:00';
  if (S.mode === 'tonight') from = '18:00';
  if (S.mode === 'from') from = S.fromTime;
  return { day, from };
}
function filtered() {
  const { day, from } = window_();
  const nowMs = Date.now() - 5 * 60000;
  return S.data.seances.filter((s) => {
    const c = cinema(s.c); if (!c) return false;
    if (S.cine) { if (s.c !== S.cine) return false; } else if (S.fav) { if (!S.pins.includes(s.c)) return false; } else if (c.km > S.radius) return false;
    if (s.t.slice(0, 10) !== day) return false;
    if (s.t.slice(11, 16) < from) return false;
    if (asDate(s.t).getTime() < nowMs) return false;
    if (S.vo && s.v !== 'VOST') return false;
    if (S.indie && !isIndie(c)) return false;
    if (S.list && !S.liste.has(s.f)) return false;
    if (S.premium && !s.x) return false;
    if (S.special && !(s.p || s.ev)) return false;
    return true;
  });
}
// regroupe par film, sans doublons : à heure égale on garde la salle la plus proche
function groupByFilm(list) {
  const by = new Map();
  for (const s of list) {
    if (!by.has(s.f)) by.set(s.f, new Map());
    const m = by.get(s.f);
    const prev = m.get(s.t);
    if (!prev || cinema(s.c).km < cinema(prev.c).km) m.set(s.t, s);
  }
  const out = [];
  for (const [f, m] of by) {
    const arr = [...m.values()].sort((a, b) => a.t.localeCompare(b.t) || cinema(a.c).km - cinema(b.c).km);
    out.push({ f, seances: arr });
  }
  out.sort((a, b) => a.seances[0].t.localeCompare(b.seances[0].t) || cinema(a.seances[0].c).km - cinema(b.seances[0].c).km);
  return out;
}

// ================= liens pratiques : itinéraire, agenda =================
const cineAddr = (c) => c.addr || `${c.name}, ${c.cp} Paris`;
const mapsUrl = (c) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.name + ', ' + cineAddr(c))}`;
// pubs + bandes-annonces avant le film : estimation par type de salle (aucune source ne donne le chiffre exact)
function adMin(c) {
  if (!c) return 10;
  if (c.ads != null) return c.ads;
  const n = c.name;
  if (/^UGC/.test(n)) return 15;
  if (/Grand Rex/.test(n)) return 15;
  if (/^MK2/.test(n)) return 10;
  if (/Forum des images|Jeu de Paume/.test(n)) return 0;
  return 5; // salles indé et cinémas de patrimoine : 1 ou 2 bandes-annonces
}
function filmStart(s) { return new Date(asDate(s.t).getTime() + adMin(cinema(s.c)) * 60000); }
function endOf(s) {
  const f = S.data.films[s.f];
  return new Date(filmStart(s).getTime() + runtimeMin(f.runtime) * 60000);
}
const gstamp = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
};
function seanceDetails(s) {
  const c = cinema(s.c); const scr = s.sc && S.data.screens?.[s.sc];
  return [
    `${s.v}${s.x ? ' · ' + s.x : ''}`,
    scr && scr.name ? `Salle ${scr.name}${scr.seats ? ' · ' + scr.seats + ' places' : ''}${scr.width ? ' · écran ' + scr.width + ' m' : ''}` : '',
    `${c.name}, ${cineAddr(c)}`,
    s.bk ? `Réserver : ${s.bk}` : '',
    'Carte UGC Illimité acceptée' + (c.extra ? ` (supplément ${c.extra})` : '')
  ].filter(Boolean).join('\n');
}
function gcalUrl(s) {
  const f = S.data.films[s.f]; const c = cinema(s.c);
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Ciné : ${f.title}`,
    dates: `${gstamp(asDate(s.t))}/${gstamp(endOf(s))}`,
    ctz: 'Europe/Paris',
    location: `${c.name}, ${cineAddr(c)}`,
    details: seanceDetails(s)
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}
function downloadIcs(s) {
  const f = S.data.films[s.f]; const c = cinema(s.c);
  const e = (t) => String(t).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cine Illimite//FR', 'BEGIN:VEVENT',
    `UID:${s.f}-${s.c}-${s.t}@cine-illimite`, `DTSTAMP:${gstamp(new Date())}`,
    `DTSTART;TZID=Europe/Paris:${gstamp(asDate(s.t))}`, `DTEND;TZID=Europe/Paris:${gstamp(endOf(s))}`,
    `SUMMARY:${e('Ciné : ' + f.title)}`, `LOCATION:${e(c.name + ', ' + cineAddr(c))}`, `DESCRIPTION:${e(seanceDetails(s))}`,
    'COLOR:hotpink', 'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Séance de ciné dans 1 h', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'seance.ics'; a.click();
}
// notes des sites, avec leur petit logo (favicon du site)
function notesHtml(f) {
  const n = f.notes || {};
  const ico = (dom) => `<img src="https://www.google.com/s2/favicons?domain=${dom}&sz=64" alt="" width="18" height="18" loading="lazy">`;
  const fr = (v) => String(v).replace('.', ',');
  const items = [
    n.lb ? `<div class="note-site">${ico('letterboxd.com')}<span><small>Letterboxd</small><b>${fr(n.lb)}<i>/5</i></b></span></div>` : '',
    n.imdb ? `<div class="note-site">${ico('imdb.com')}<span><small>IMDb</small><b>${fr(n.imdb)}<i>/10</i></b></span></div>` : '',
    n.sc ? `<div class="note-site">${ico('senscritique.com')}<span><small>SensCritique</small><b>${fr(n.sc)}<i>/10</i></b></span></div>` : '',
    n.rt ? `<div class="note-site">${ico('rottentomatoes.com')}<span><small>Rotten Tomatoes</small><b>${n.rt}<i> %</i></b></span></div>` : ''
  ].filter(Boolean).join('');
  return items ? `<div class="notes-sites">${items}</div>` : '';
}
// note « classique » : moyenne des notes disponibles ramenées sur 1
function classicScore(f) {
  const n = f.notes || {}; const v = [];
  if (n.lb) v.push(n.lb / 5); if (n.imdb) v.push(n.imdb / 10); if (n.sc) v.push(n.sc / 10);
  if (n.rt) v.push(n.rt / 100); if (n.mc) v.push(n.mc / 100); if (f.press) v.push(f.press / 5);
  if (!v.length) return 0;
  return v.reduce((a, b) => a + b, 0) / v.length - (v.length < 2 ? 0.05 : 0);
}

// ================= Classiques =================
function renderClassics() {
  const nowMs = Date.now() - 5 * 60000;
  const list = Object.entries(S.data.films).filter(([, f]) => f.classic).map(([id, f]) => {
    const ss = S.data.seances.filter((s) => s.f === id && asDate(s.t).getTime() > nowMs);
    const near = ss.slice().sort((a, b) => cinema(a.c).km - cinema(b.c).km || a.t.localeCompare(b.t))[0];
    return { id, f, ss, near };
  }).filter((x) => x.ss.length).sort((a, b) => classicScore(b.f) - classicScore(a.f));
  $('#count-label').textContent = `${list.length} classiques à l'affiche cette semaine, classés par leurs notes (Letterboxd, IMDb, SensCritique…)`;
  const el = $('#seances-grid');
  el.innerHTML = list.slice(0, S.limit).map(({ id, f, ss, near }, i) => {
    const nCines = new Set(ss.map((s) => s.c)).size;
    return `<button class="classic" data-film="${id}" data-day="${near.t.slice(0, 10)}">
      <span class="rank">${i + 1}</span>
      <i style="${bg(f.poster)}"></i>
      <div class="body">
        <span class="t">${esc(f.title)}</span>
        <span class="m">${esc([f.director, f.year].filter(Boolean).join(' · '))}</span>
        <div class="bubbles">
          <span class="b-day">${dayShort(near.t)}</span>
          <span class="b-hour">${hm(near.t)}</span>
          <span class="b-place">${esc(shortName(cinema(near.c)))}<small>${fmtDist(cinema(near.c).km)}</small></span>
        </div>
        <span class="m">${ss.length > 1 ? `+ ${ss.length - 1} autre${ss.length > 2 ? 's' : ''} séance${ss.length > 2 ? 's' : ''} cette semaine` : 'Seule séance de la semaine'}${nCines > 1 ? ` · ${nCines} salles` : ''}</span>
      </div>
    </button>`;
  }).join('') + (list.length > S.limit ? `<button class="btn btn-more" id="more">Afficher plus (${list.length - S.limit})</button>` : '');
  const more = $('#more');
  if (more) more.onclick = () => { S.limit += 30; renderSeances(); };
}

// ================= Séances =================
function renderSeances() {
  $('#filters').hidden = S.sv !== 'all';
  $('#seances-grid').className = 'pad ' + (S.sv === 'classics' ? 'classics' : S.sv === 'upcoming' ? 'upcoming' : 'grid');
  window.renderActivity?.();
  if (S.sv === 'upcoming') {
    $('#now-label').textContent = 'Près de toi · Prochaines sorties';
    renderUpcoming(); return;
  }
  if (S.sv === 'classics') {
    const now = new Date();
    $('#now-label').textContent = 'Près de toi · ' + now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
    renderClassics(); return;
  }
  const now = new Date();
  $('#now-label').textContent = 'Près de toi · ' + now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' }) + ' · ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  window.renderAlerts?.();
  const groups = groupByFilm(filtered());
  const shown = groups.slice(0, S.limit);
  $('#count-label').textContent = `${groups.length} film${groups.length > 1 ? 's' : ''} · salles qui acceptent ta carte UGC Illimité`;
  const el = $('#seances-grid');
  if (!groups.length) {
    el.innerHTML = `<p class="empty">Aucune séance avec ces filtres.<br>Essaie un rayon plus grand ou une autre heure.</p>`;
    return;
  }
  el.innerHTML = shown.map(({ f: id, seances }) => {
    const f = S.data.films[id]; const s = seances[0]; const c = cinema(s.c);
    const others = seances.slice(1, 4).map((x) => `<span>${hm(x.t)}</span>`).join('');
    return `<button class="fcard" data-film="${id}" data-day="${s.t.slice(0, 10)}">
      <div class="pic" style="${bg(f.poster)}">
        <div class="badges">
          <span class="badge">${s.v}</span>
          ${s.x ? `<span class="badge acc">${esc(s.x)}</span>` : ''}
          ${s.p ? '<span class="badge acc">Avant-première</span>' : ''}
          ${s.ev && !s.p ? '<span class="badge acc">Événement</span>' : ''}
          ${S.liste.has(id) ? '<span class="badge acc">Ma liste</span>' : ''}
        </div>
        <span class="ttl">${esc(f.title)}</span>
      </div>
      <div class="info">
        <div class="when"><b>${hm(s.t)}</b><span>${dansLabel(s.t)}</span></div>
        <div class="where">${esc(shortName(c))}<small>${fmtDist(c.km)}${isIndie(c) ? ' · salle indé' : ''}${c.extra ? ' · ' + esc(c.extra) : ''}</small></div>
        ${others ? `<div class="more">${others}${seances.length > 4 ? `<span>+${seances.length - 4}</span>` : ''}</div>` : ''}
      </div>
    </button>`;
  }).join('') + (groups.length > shown.length ? `<button class="btn btn-more" id="more">Afficher plus (${groups.length - shown.length} films)</button>` : '');
  const more = $('#more');
  if (more) more.onclick = () => { S.limit += 30; renderSeances(); };
}

// ================= Pour toi =================
function upcomingNear(id, maxKm) {
  return S.data.seances.find((s) => s.f === id && asDate(s.t) > Date.now() && cinema(s.c)?.km <= maxKm);
}
function pairsToday(maxKm) {
  const now = Date.now(); const d0 = today();
  const todays = S.data.seances.filter((s) => s.t.startsWith(d0) && asDate(s.t).getTime() > now && cinema(s.c)?.km <= maxKm);
  const byC = {};
  for (const s of todays) (byC[s.c] ||= []).push(s);
  const out = [];
  for (const list of Object.values(byC)) {
    for (const a of list) {
      const end = endOf(a).getTime();
      for (const b of list) {
        if (b.f === a.f) continue;
        if (asDate(b.t) - asDate(a.t) < 90 * 60000) continue; // règle UGC : 1h30 entre deux séances
        const gap = (asDate(b.t).getTime() - end) / 60000;
        if (gap < 5 || gap > 45) continue;
        out.push({ a, b, end, gap: Math.round(gap), s: score(S.data.films[a.f]) + score(S.data.films[b.f]) - gap / 200 });
      }
    }
  }
  out.sort((x, y) => y.s - x.s);
  const seen = new Set(); const res = [];
  for (const p of out) { const k = [p.a.f, p.b.f].sort().join(); if (seen.has(k)) continue; seen.add(k); res.push(p); if (res.length === 3) break; }
  return res;
}
function renderPourToi() {
  const maxKm = Math.max(S.radius, 3);
  const vus = seenIds();
  const films = Object.entries(S.data.films).filter(([id]) => !vus.has(id) && upcomingNear(id, maxKm));
  const d0 = today();
  const auj = new Set(S.data.seances.filter((s) => s.t.startsWith(d0) && asDate(s.t) > Date.now() && cinema(s.c)?.km <= maxKm).map((s) => s.f));
  const rank = ([id, f]) => score(f) + (auj.has(id) ? 0.15 : 0);
  films.sort((a, b) => rank(b) - rank(a));
  $('#pt-kicker').textContent = S.taste ? 'Selon tes notes' : 'Selon la presse et le public';

  const top = films.find(([id]) => auj.has(id)) || films[0];
  const rest = films.filter((x) => x !== top);
  const counts = {}; for (const s of S.data.seances) counts[s.f] = (counts[s.f] || 0) + 1;
  const lastChance = rest.filter(([id, f]) => f.release && (Date.now() - new Date(f.release)) > 21 * 86400000 && counts[id] <= 6).slice(0, 8);
  const listed = films.filter(([id]) => S.liste.has(id));
  const pairs = pairsToday(maxKm);
  const sub = (id) => { const n = upcomingNear(id, maxKm); return n ? `${quand(n.t)} · ${esc(shortName(cinema(n.c)))}` : ''; };
  const mini = ([id, f]) => { const n = upcomingNear(id, maxKm); return `<button class="mini" data-film="${id}" data-day="${n ? n.t.slice(0, 10) : ''}"><i style="${bg(f.poster)}"></i><b>${esc(f.title)}</b><small>${n ? quand(n.t) : ''}</small></button>`; };

  let html = '';
  if (top) {
    const [id, f] = top; const n = upcomingNear(id, maxKm);
    html += `<button class="feature" data-film="${id}" data-day="${n ? n.t.slice(0, 10) : ''}">
      <div class="in">
        <span class="bk">Ton film du jour · ${matchPct(f)} %</span>
        <span class="bt">${esc(f.title)}</span>
        <span class="bs">${esc([f.director, (f.genres || []).slice(0, 2).join(', ')].filter(Boolean).join(' · '))}</span>
        <span class="bs"><b>${sub(id)}</b></span>
      </div>
      <div class="img" style="${bg(f.poster)}"></div>
    </button>`;
  }
  if (listed.length) html += `<div class="stack" style="gap:10px"><h2>Ma liste</h2><div class="hscroll">${listed.map(mini).join('')}</div></div>`;
  html += `<h2>Recommandés</h2>` + rest.slice(0, 8).map(([id, f]) => {
    const n = upcomingNear(id, maxKm);
    return `<button class="banner" data-film="${id}" data-day="${n ? n.t.slice(0, 10) : ''}" style="${bg(f.poster)}">
      <div class="in"><span class="bt">${esc(f.title)}</span><span class="bs">${sub(id)}</span><span class="bs">${esc((f.genres || []).slice(0, 2).join(', '))}</span></div>
      <span class="go">${ICON_ARROW}</span><span class="pill">${matchPct(f)} %</span>
    </button>`;
  }).join('');
  if (pairs.length) {
    html += `<h2>Enchaîne deux films</h2>` + pairs.map((p) => {
      const fa = S.data.films[p.a.f], fb = S.data.films[p.b.f];
      const endH = new Date(p.end).toTimeString().slice(0, 5).replace(':', 'h');
      return `<div class="pair">
        <button class="step" data-film="${p.a.f}" data-day="${today()}"><i style="${bg(fa.poster)}"></i><b>${hm(p.a.t)}</b><span>${esc(fa.title)}</span></button>
        <div class="gap">Fin vers ${endH} · ${p.gap} min de pause · ${esc(shortName(cinema(p.a.c)))}</div>
        <button class="step" data-film="${p.b.f}" data-day="${today()}"><i style="${bg(fb.poster)}"></i><b>${hm(p.b.t)}</b><span>${esc(fb.title)}</span></button>
      </div>`;
    }).join('');
  }
  if (lastChance.length) html += `<div class="stack" style="gap:10px"><h2>Dernières chances</h2><div class="hscroll">${lastChance.map(mini).join('')}</div></div>`;
  $('#pourtoi').innerHTML = html || '<p class="empty">Pas encore de données.</p>';
}

// ================= Historique =================
function starsHtml(i, r) {
  return `<div class="stars" role="group" aria-label="Ta note">${[1, 2, 3, 4, 5].map((k) =>
    `<button data-star="${k}" data-i="${i}" class="${r >= k ? 'on' : r >= k - 0.5 ? 'half' : ''}" aria-label="${k} étoile${k > 1 ? 's' : ''}">★</button>`).join('')}
    <span class="m" style="margin-left:6px;align-self:center">${r ? String(r).replace('.', ',') + '/5' : 'Pas noté'}</span></div>`;
}
function renderHisto() {
  const el = $('#histo');
  let html = '';
  html += S.showAdd ? addFormHtml() : `<button class="btn pri" id="add-open" style="align-self:flex-start">+ Ajouter une séance passée</button>`;
  if (!S.vus.length) {
    html += `<div class="card dark"><h2 style="color:var(--acc)">Rien pour l'instant</h2><p class="syn" style="color:var(--dark-mut);margin-top:8px">Dans la fiche d'un film, touche « Je l'ai vu » : il arrive ici, tu peux le noter, écrire ton avis et l'envoyer sur Letterboxd.</p></div>`;
  } else {
    html += `<div class="row-actions"><button class="btn sm dark" id="export-lb">Exporter pour Letterboxd (CSV)</button></div>`;
    html += S.vus.map((v, i) => ({ v, i })).reverse().map(({ v, i }) => {
      const f = S.data.films[v.f] || v;
      return `<div class="card hist">
        <i style="${bg(f.poster || v.poster)}"></i>
        <div class="body">
          <span class="t">${esc(v.title)}</span>
          <span class="m">${new Date(v.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}${v.cinema ? ' · ' + esc(v.cinema) : ''}</span>
          ${starsHtml(i, v.rating || 0)}
          <label class="sr" for="rev-${i}">Ton avis</label>
          <textarea id="rev-${i}" data-rev="${i}" placeholder="Ton avis en quelques mots…">${esc(v.review || '')}</textarea>
          <div class="row-actions">
            <button class="btn sm pri" data-lb="${i}">Publier sur Letterboxd</button>
            <button class="btn sm" data-del="${i}">Retirer</button>
          </div>
        </div>
      </div>`;
    }).join('');
  }
  const j = S.data.journal || [];
  if (j.length) {
    html += `<h2>Sur ton Letterboxd</h2>` + j.slice(0, 20).map((e) => `<div class="card hist"><i style="${bg(e.poster)}"></i><div class="body">
      <span class="t">${esc(e.title)}</span><span class="m">${esc(e.year || '')}${e.date ? ' · ' + new Date(e.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : ''}${e.rating != null ? ' · ' + String(e.rating).replace('.', ',') + '/5' : ''}</span>
      ${e.review ? `<p class="syn">${esc(e.review)}</p>` : ''}</div></div>`).join('');
  }
  el.innerHTML = html;
}
function letterboxdPublish(i) {
  const v = S.vus[i]; const f = S.data.films[v.f] || {};
  const text = v.review || '';
  const url = f.lb ? `https://letterboxd.com/film/${f.lb}/` : f.tmdbId ? `https://letterboxd.com/tmdb/${f.tmdbId}/` : `https://letterboxd.com/search/${encodeURIComponent(v.title)}/`;
  const go = () => window.open(url, '_blank', 'noopener');
  if (text && navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => { toast('Avis copié : colle-le sur Letterboxd'); go(); }, () => go());
  } else go();
}
function exportLetterboxd() {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [['Title', 'Year', 'tmdbID', 'WatchedDate', 'Rating', 'Review']];
  for (const v of S.vus) {
    const f = S.data.films[v.f] || {};
    rows.push([v.title, f.year || '', f.tmdbId || '', v.date, v.rating || '', v.review || '']);
  }
  const blob = new Blob([rows.map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'letterboxd-import.csv'; a.click();
  toast('Fichier prêt : Letterboxd › Settings › Import & Export');
}

// ================= Ma carte =================
function renderCarte() {
  const month = today().slice(0, 7);
  $('#c-kicker').textContent = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const c = S.carte;
  const prix = num(c.prix) || 0; const plein = num(c.plein) || 0; const n = Math.max(1, +c.partage || 1);
  const part = prix / n;
  const ce = S.vus.filter((v) => v.date.startsWith(month)).length;
  const seuil = plein ? Math.ceil(part / plein) : 0;
  const eco = ce * plein - part;
  const an = S.vus.filter((v) => v.date.startsWith(month.slice(0, 4))).length;
  $('#carte').innerHTML = `
    <div id="compte" class="stack"></div>
    <h2 style="margin-top:6px">Ma carte</h2>
    <div class="stat">
      <small style="font-weight:700;letter-spacing:.08em;text-transform:uppercase">Ce mois-ci</small>
      <div style="display:flex;align-items:flex-end;gap:10px"><span class="big">${eco >= 0 ? '+' : ''}${euro(eco)}</span></div>
      <small>${eco >= 0 ? 'économisés par rapport au plein tarif' : 'encore à rattraper avant que la carte soit rentable'}</small>
      <div class="bar" aria-hidden="true"><i style="width:${seuil ? Math.min(100, (ce / seuil) * 100) : 0}%"></i></div>
      <small>${ce} séance${ce > 1 ? 's' : ''} sur ${seuil} pour être rentable${ce >= seuil && seuil ? ' : c\'est fait ✓' : ''}</small>
      <div class="grid3">
        <div><span class="n">${euro(part)}</span><small>ta part / mois</small></div>
        <div><span class="n">${ce ? euro(part / ce) : '–'}</span><small>par séance</small></div>
        <div><span class="n">${an}</span><small>films en ${month.slice(0, 4)}</small></div>
      </div>
    </div>
    <div class="card form">
      <h2>Mon abonnement</h2>
      <label>Formule
        <select id="c-formule">${Object.entries(FORMULES).map(([k, f]) => `<option value="${k}" ${c.formule === k ? 'selected' : ''}>${f.label}${f.prix ? ' · ' + euro(f.prix) : ''}</option>`).join('')}</select>
      </label>
      <label>Prix mensuel total <input id="c-prix" inputmode="decimal" value="${(num(c.prix) || 0).toFixed(2).replace('.', ',')}"></label>
      <div><span style="font-size:13px;font-weight:600">Payé à</span>
        <div class="seg" role="group" aria-label="Partage">${[1, 2, 3].map((k) => `<button data-part="${k}" aria-pressed="${n === k}">${k === 1 ? 'Seul' : 'À ' + k}</button>`).join('')}</div></div>
      <label>Prix d'une place plein tarif <input id="c-plein" inputmode="decimal" value="${(num(c.plein) || 0).toFixed(2).replace('.', ',')}"></label>
      <small style="color:var(--mut)">Tarifs indicatifs : vérifie le montant exact dans ton espace UGC.</small>
    </div>
    <div class="card form">
      <h2>Sauvegarde</h2>
      <small style="color:var(--mut);line-height:1.5">Ta liste, ton historique, tes notes et tes réglages sont rangés sur ce téléphone. Fais une sauvegarde avant de changer d'iPhone, puis « Restaurer » sur le nouveau.</small>
      <div class="row-actions">
        <button class="btn pri" id="backup">Sauvegarder mes données</button>
        <label class="btn" for="restore-file" style="cursor:pointer">Restaurer</label>
        <input type="file" id="restore-file" accept=".json,application/json" hidden>
      </div>
    </div>
    <div class="card form">
      <h2>Apparence</h2>
      <div class="seg" role="group" aria-label="Thème">
        <button data-theme-set="light" aria-pressed="${S.theme === 'light'}">Clair</button>
        <button data-theme-set="dark" aria-pressed="${S.theme === 'dark'}">Sombre</button>
      </div>
    </div>`;
  window.renderCompte?.();
  $('#backup').onclick = backupData;
  $('#restore-file').onchange = (e) => { const f = e.target.files[0]; if (f) restoreData(f); };
  const save = () => { store.set('carte', S.carte); renderCarte(); };
  $('#c-formule').onchange = (e) => { S.carte.formule = e.target.value; const p = FORMULES[e.target.value].prix; if (p) S.carte.prix = p; save(); };
  // enregistré à chaque chiffre tapé (sur iPhone, quitter l'appli clavier ouvert ne déclenche pas « change »)
  $('#c-prix').oninput = (e) => { S.carte.prix = num(e.target.value) || 0; store.set('carte', S.carte); };
  $('#c-plein').oninput = (e) => { S.carte.plein = num(e.target.value) || 0; store.set('carte', S.carte); };
  $('#c-prix').onchange = save;
  $('#c-plein').onchange = save;
}
// ================= sauvegarde / restauration =================
const BACKUP_KEYS = ['liste', 'vus2', 'carte', 'theme', 'pins', 'fromTime', 'geoOk', 'conseils', 'avenir'];
async function backupData() {
  const data = { app: 'cine-illimite', version: 1, date: new Date().toISOString(), items: {} };
  for (const k of BACKUP_KEYS) { const v = store.get(k, undefined); if (v !== undefined) data.items[k] = v; }
  const name = `cine-sauvegarde-${today()}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Sauvegarde Projo' });
      toast('Sauvegarde prête : garde-la dans Fichiers ou envoie-la-toi');
      return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; a.click();
  toast('Sauvegarde téléchargée');
}
function restoreData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (d.app !== 'cine-illimite' || !d.items) throw new Error();
      if (!confirm(`Restaurer la sauvegarde du ${new Date(d.date).toLocaleDateString('fr-FR')} ? Les données actuelles de ce téléphone seront remplacées.`)) return;
      for (const [k, v] of Object.entries(d.items)) if (BACKUP_KEYS.includes(k)) store.set(k, v);
      location.reload();
    } catch { toast("Ce fichier n'est pas une sauvegarde de l'appli"); }
  };
  r.readAsText(file);
}
function applyTheme() {
  document.documentElement.dataset.theme = S.theme;
  $('meta[name="theme-color"]').content = S.theme === 'dark' ? '#0F0F11' : '#ECE9E4';
}

// ================= fiche film =================
function isSeenToday(id) { return S.vus.findIndex((v) => v.f === id && v.date === today()); }
function reviewsHtml(f, kind) {
  const r = kind === 'press' ? f.pressReviews : f.userReviews;
  const id = f._id;
  const link = `https://www.allocine.fr/film/fichefilm-${id}/critiques/${kind === 'press' ? 'presse' : 'spectateurs'}/`;
  if (!r || (!r.pos && !r.neg)) return `<div class="rev"><p>Pas encore d'avis disponibles.</p><a href="${link}" target="_blank" rel="noopener">Voir sur AlloCiné</a></div>`;
  const one = (x, cls, lbl) => x ? `<div class="rev ${cls}"><div class="h"><span>${lbl} · ${esc(x.who || '')}</span><span>${x.note != null ? String(x.note).replace('.', ',') + '/5' : ''}</span></div><p>${esc(x.text)}</p></div>` : '';
  return one(r.pos, 'pos', 'Le plus enthousiaste') + one(r.neg, 'neg', 'Le plus sévère') + `<a href="${link}" target="_blank" rel="noopener" style="font-size:12px;font-weight:600">Tous les avis sur AlloCiné</a>`;
}
function openFilm(id, day) {
  const f = S.data.films[id]; if (!f) return;
  f._id = id;
  closeSearch();
  const all = S.data.seances.filter((s) => s.f === id && cinema(s.c));
  const days = [...new Set(all.map((s) => s.t.slice(0, 10)))].filter((d) => d >= today()).sort();
  let cur = day && days.includes(day) ? day : days[0];
  let open = null; // 'press' | 'user'
  let pick = null; // index de la séance choisie dans all
  function pickHtml(s) {
    const c = cinema(s.c); const scr = s.sc && S.data.screens?.[s.sc];
    const day = s.t.slice(0, 10);
    const dl = day === today() ? "Aujourd'hui" : day === tomorrow() ? 'Demain' : new Date(day).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const fin = endOf(s).toTimeString().slice(0, 5).replace(':', 'h');
    const ic = {
      cal: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/></svg>',
      map: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
      tix: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 6v12" stroke-dasharray="2 2"/></svg>',
      app: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>'
    };
    const acts = [
      `<a class="act" href="${esc(gcalUrl(s))}" target="_blank" rel="noopener">${ic.cal}<span>Agenda</span></a>`,
      `<a class="act" href="${esc(mapsUrl(c))}" target="_blank" rel="noopener">${ic.map}<span>Itinéraire</span></a>`,
      c.ugc ? `<a class="act" href="https://www.ugc.fr/cinema.html?id=${c.ugc}">${ic.app}<span>Appli UGC</span></a>` : '',
      s.bk ? `<a class="act" href="${esc(s.bk)}" target="_blank" rel="noopener">${ic.tix}<span>Réserver</span></a>` : ''
    ].filter(Boolean);
    return `<div class="pick">
      <div class="pick-top">
        <span class="pick-hour">${hm(s.t)}</span>
        <span class="pick-day"><b>${dl}</b><small>${s.v}${s.x ? ' · ' + esc(s.x) : ''} · fin vers ${fin}</small></span>
      </div>
      ${s.p || s.ev ? `<p class="evt"><b>${s.p ? 'Avant-première' : 'Séance spéciale'}</b>${s.ev ? ' · ' + esc(s.ev) : ''}</p>` : ''}
      <p class="ads">${adMin(c) ? `+${adMin(c)} min de pub · film vers ${filmStart(s).toTimeString().slice(0, 5).replace(':', 'h')}` : 'Pas de pub · le film démarre à l\'heure'}<small>estimation</small></p>
      <ul class="pick-info">
        ${scr && scr.name ? `<li><small>Salle</small><b>${esc(scr.name)}</b></li>` : ''}
        ${scr && scr.seats ? `<li><small>Places</small><b>${scr.seats}</b></li>` : ''}
        ${scr && scr.width ? `<li><small>Écran</small><b>${scr.width} m</b></li>` : ''}
      </ul>
      <p class="pick-addr">${esc(c.name)} · ${esc(cineAddr(c))}</p>
      <div class="acts" style="grid-template-columns:repeat(${acts.length},minmax(0,1fr))">${acts.join('')}</div>
    </div>`;
  }
  const dayLabel = (d) => d === today() ? "Aujourd'hui" : d === tomorrow() ? 'Demain' : new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });

  function body() {
    const byC = {};
    for (const s of all.filter((s) => s.t.startsWith(cur))) (byC[s.c] ||= []).push(s);
    const cines = Object.keys(byC).sort((a, b) => cinema(a).km - cinema(b).km);
    const seen = isSeenToday(id) >= 0;
    const conseille = S.conseils.some((x) => String(x.f) === String(id));
    return `
    <div class="hero" style="${bg(f.poster)}">
      <button class="back glass" id="close" aria-label="Fermer"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
      <div>
        ${f.trailer ? `<button class="play glass" id="play"><svg width="18" height="18" viewBox="0 0 24 24" fill="#F3EC3A" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>Bande-annonce</button>` : ''}
        <h2 id="f-title">${esc(f.title)}</h2>
        <div class="meta">${esc([f.director, f.runtime, (f.genres || []).slice(0, 2).join(', ')].filter(Boolean).join(' · '))}</div>
      </div>
    </div>
    <div class="sheet-body">
      <div id="video"></div>
      <div class="scores">
        <button id="sc-press" aria-expanded="${open === 'press'}"><small>Presse</small><b>${f.press ?? '–'}</b><em>Voir les avis</em></button>
        <button id="sc-user" aria-expanded="${open === 'user'}"><small>Spectateurs</small><b>${f.spect ?? '–'}</b><em>Voir les avis</em></button>
        <div class="acc"><small>Match pour toi</small><b>${matchPct(f)} %</b></div>
      </div>
      ${open ? `<div class="reviews">${reviewsHtml(f, open === 'press' ? 'press' : 'user')}</div>` : ''}
      ${notesHtml(f)}
      <div class="actions">
        <button class="btn ${S.liste.has(id) ? 'on' : 'pri'}" id="toggle-list">${S.liste.has(id) ? '✓ Dans ma liste' : '+ Ma liste'}</button>
        <button class="btn ${seen ? 'on' : 'dark'}" id="seen">${seen ? '✓ Vu · annuler' : "Je l'ai vu"}</button>
        <button class="btn ${conseille ? 'on' : ''}" id="conseil">${conseille ? '✓ Conseillé' : 'Conseiller'}</button>
      </div>
      ${days.length ? '<button class="btn big dbl" id="double"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="2" y="6" width="9" height="12" rx="2"/><rect x="13" y="6" width="9" height="12" rx="2"/></svg>Double programme : enchaîner avec un 2e film</button>' : ''}
      ${window.friendsOnFilm ? window.friendsOnFilm(id) : ''}
      ${f.synopsis ? `<p class="syn">${esc(f.synopsis)}</p>` : ''}
      <h2>Séances</h2>
      <div class="days" role="group" aria-label="Jour">${days.map((d) => `<button data-day="${d}" aria-pressed="${d === cur}">${dayLabel(d)}</button>`).join('')}</div>
      ${cines.length ? `<p class="m" style="margin:-6px 0 0;font-size:12px;color:var(--mut)">Touche un horaire pour l'ajouter à ton agenda, voir l'itinéraire ou réserver.</p>` : ''}
      ${cines.length ? cines.map((cid) => { const c = cinema(cid); return `<div class="card cine">
        <div class="head"><b>${esc(c.name)}${isIndie(c) ? ' <span class="tag">indé</span>' : ''}${c.extra ? ` <span class="tag">${esc(c.extra)}</span>` : ''}</b><span>${fmtDist(c.km)} · ${trajet(c.km)}</span></div>
        <div class="times">${byC[cid].map((s) => { const k = all.indexOf(s); return `<button data-pick="${k}" aria-pressed="${pick === k}" class="${asDate(s.t) < Date.now() ? 'past' : ''}">${hm(s.t)} <small>${s.v}${s.x ? ' ' + esc(s.x) : ''}</small></button>`; }).join('')}</div>
        ${pick != null && all[pick]?.c === cid ? pickHtml(all[pick]) : ''}
      </div>`; }).join('') : '<p class="empty">Pas de séance ce jour-là.</p>'}
    </div>`;
  }
  const dlg = $('#sheet'); const root = $('#sheet-body');
  const paint = () => {
    root.innerHTML = body();
    $('#close', root).onclick = () => dlg.close();
    if ($('#play', root)) $('#play', root).onclick = () => {
      $('#video', root).innerHTML = `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(f.trailer)}?autoplay=1&playsinline=1" title="Bande-annonce" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
      $('#video', root).scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    $('#sc-press', root).onclick = () => { open = open === 'press' ? null : 'press'; paint(); };
    $('#sc-user', root).onclick = () => { open = open === 'user' ? null : 'user'; paint(); };
    $('#toggle-list', root).onclick = () => {
      S.liste.has(id) ? S.liste.delete(id) : S.liste.add(id);
      store.set('liste', [...S.liste]); paint(); renderSeances(); renderPourToi();
    };
    $('#seen', root).onclick = () => {
      const k = isSeenToday(id);
      if (k >= 0) { S.vus.splice(k, 1); toast("Retiré de l'historique"); }
      else {
        const auj = all.filter((x) => x.t.startsWith(today()));
        const started = auj.filter((x) => asDate(x.t) <= Date.now() + 30 * 60000);
        const pool = started.length ? started : auj;
        const s = pool.slice().sort((a, b) => cinema(a.c).km - cinema(b.c).km || b.t.localeCompare(a.t))[0];
        S.vus.push({ f: id, title: f.title, poster: f.poster, date: today(), cinema: s ? cinema(s.c).name : '', rating: 0, review: '' });
        toast("Ajouté à ton historique : note-le quand tu veux");
      }
      store.set('vus2', S.vus); paint(); renderHisto(); renderCarte(); renderPourToi();
    };
    if ($('#double', root)) $('#double', root).onclick = () => openDouble(id);
    $('#conseil', root).onclick = () => {
      const k = S.conseils.findIndex((x) => String(x.f) === String(id));
      if (k >= 0) { S.conseils.splice(k, 1); toast('Conseil retiré'); }
      else { S.conseils.push({ f: id, title: f.title, poster: f.poster || '' }); toast(window.CLOUD?.user ? 'Tes amis le verront dans ton profil' : 'Connecte-toi dans Profil pour que tes amis le voient'); }
      store.set('conseils', S.conseils); paint();
    };
    root.querySelectorAll('.days button').forEach((b) => (b.onclick = () => { cur = b.dataset.day; pick = null; paint(); }));
    root.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => {
      const k = +b.dataset.pick; pick = pick === k ? null : k;
      const y = dlg.scrollTop; paint(); dlg.scrollTop = y;
    }));
  };
  paint();
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}

// ================= recherche (films + salles) =================
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function renderSearch() {
  const q = norm($('#q').value);
  const box = $('#q-results');
  if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
  const words = q.split(' ');
  const hit = (s) => { const n = norm(s); return words.every((w) => n.includes(w)); };
  const cines = S.data.cinemas.filter((c) => hit(c.name + ' ' + c.cp)).sort((a, b) => a.km - b.km).slice(0, 6);
  const nowMs = Date.now() - 5 * 60000;
  const films = Object.entries(S.data.films)
    .filter(([id, f]) => hit(f.title + ' ' + (f.originalTitle || '') + ' ' + (f.director || '')))
    .map(([id, f]) => ({ id, f, next: S.data.seances.filter((s) => s.f === id && asDate(s.t).getTime() > nowMs).sort((a, b) => cinema(a.c).km - cinema(b.c).km)[0] }))
    .filter((x) => x.next).slice(0, 8);
  let html = '';
  if (cines.length) html += '<h3>Salles</h3>' + cines.map((c) => `<button class="res" data-cine="${c.id}"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/></svg></span><span><b>${esc(c.name)}</b><small>${fmtDist(c.km)} · ${esc(c.cp)}${isIndie(c) ? ' · salle indé' : ''}</small></span></button>`).join('');
  if (films.length) html += '<h3>Films</h3>' + films.map(({ id, f, next }) => `<button class="res" data-film="${id}" data-day="${next.t.slice(0, 10)}"><i style="${bg(f.poster)}"></i><span><b>${esc(f.title)}</b><small>${quand(next.t)} · ${esc(shortName(cinema(next.c)))}</small></span></button>`).join('');
  box.innerHTML = html || `<p class="res-empty">Rien trouvé pour « ${esc($('#q').value)} » dans les salles qui acceptent ta carte.</p>`;
  box.hidden = false;
}
function closeSearch() { $('#q-results').hidden = true; }

// ================= salles épinglées =================
// les salles épinglées deviennent des filtres à côté de VO, Salles indé, Ma liste…
function renderPins() {
  if (S.cine && !S.pins.includes(S.cine)) S.cine = null;
  $('#pin-chips').innerHTML = S.pins.map((id) => cinema(id)).filter(Boolean).map((c) =>
    `<button data-pinf="${c.id}" aria-pressed="${S.cine === c.id}">★ ${esc(shortName(c))}</button>`).join('');
}

// ================= fiche salle =================
function openCinema(cid) {
  const c = cinema(cid); if (!c) return;
  closeSearch();
  const all = S.data.seances.filter((s) => s.c === cid);
  const days = [...new Set(all.map((s) => s.t.slice(0, 10)))].filter((d) => d >= today()).sort();
  let cur = days[0];
  let vo = false; let from = '00:00';
  const dayLabel = (d) => d === today() ? "Aujourd'hui" : d === tomorrow() ? 'Demain' : new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  function body() {
    const nowMs = Date.now() - 5 * 60000;
    const list = all.filter((s) => s.t.startsWith(cur) && s.t.slice(11, 16) >= from && asDate(s.t).getTime() > nowMs && (!vo || s.v === 'VOST'));
    const byF = {};
    for (const s of list) (byF[s.f] ||= []).push(s);
    const ids = Object.keys(byF).sort((a, b) => byF[a][0].t.localeCompare(byF[b][0].t));
    return `
    <div class="chero">
      <button class="back" id="close" aria-label="Fermer"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
      <h2 id="f-title">${esc(c.name)}</h2>
      <p>${esc(c.cp)} Paris · ${fmtDist(c.km)} · ${trajet(c.km)}${isIndie(c) ? ' · salle indé' : ''}${c.extra ? ' · supplément ' + esc(c.extra) : ''}</p>
      <div class="row-actions"><a class="btn pri" href="${esc(mapsUrl(c))}" target="_blank" rel="noopener">Itinéraire</a>${c.addr ? `<span style="font-size:12px;color:var(--dark-mut);align-self:center">${esc(c.addr)}</span>` : ''}</div>
      <button class="pin-toggle" id="pin-toggle" aria-pressed="${S.pins.includes(cid)}">${S.pins.includes(cid) ? '★ Dans mes cinémas favoris' : '☆ Ajouter à mes cinémas favoris'}</button>
    </div>
    <div class="sheet-body">
      <div class="days" role="group" aria-label="Jour">${days.map((d) => `<button data-day="${d}" aria-pressed="${d === cur}">${dayLabel(d)}</button>`).join('')}</div>
      <div class="chips" style="margin-top:0" role="group" aria-label="Filtres de la salle">
        <button data-cf="vo" aria-pressed="${vo}">VO</button>
        ${['00:00', '18:00', '20:00'].map((t) => `<button data-from="${t}" aria-pressed="${from === t}">${t === '00:00' ? 'Toute la journée' : 'Dès ' + t.replace(':', 'h')}</button>`).join('')}
      </div>
      ${ids.length ? ids.map((id) => { const f = S.data.films[id]; return `<button class="crow" data-film="${id}" data-day="${cur}">
        <i style="${bg(f.poster)}"></i>
        <div class="body"><span class="t">${esc(f.title)}</span><span class="m" style="font-size:12px;color:var(--mut)">${esc([f.runtime, (f.genres || [])[0]].filter(Boolean).join(' · '))}${f.press ? ' · presse ' + f.press : ''}</span>
        <div class="times">${byF[id].map((s) => `<span>${hm(s.t)} <small>${s.v}</small></span>`).join('')}</div></div>
      </button>`; }).join('') : '<p class="empty">Plus de séance avec ces filtres ce jour-là.</p>'}
    </div>`;
  }
  const dlg = $('#sheet'); const root = $('#sheet-body');
  const paint = () => {
    root.innerHTML = body();
    $('#close', root).onclick = () => dlg.close();
    root.querySelectorAll('.days button').forEach((b) => (b.onclick = () => { cur = b.dataset.day; paint(); }));
    root.querySelectorAll('[data-cf]').forEach((b) => (b.onclick = () => { vo = !vo; paint(); }));
    $('#pin-toggle', root).onclick = () => {
      S.pins = S.pins.includes(cid) ? S.pins.filter((x) => x !== cid) : [...S.pins, cid];
      store.set('pins', S.pins); renderPins(); renderFavBar(); renderSeances(); paint();
    };
    root.querySelectorAll('[data-from]').forEach((b) => (b.onclick = () => { from = b.dataset.from; paint(); }));
    root.querySelectorAll('.crow').forEach((b) => (b.onclick = () => openFilm(b.dataset.film, b.dataset.day)));
  };
  paint();
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}

// ================= ajout manuel à l'historique =================
function addFormHtml() {
  const titles = [...new Set(Object.values(S.data.films).map((f) => f.title))].sort((a, b) => a.localeCompare(b, 'fr'));
  const cines = S.data.cinemas.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return `<div class="card addform" id="addform">
    <h2>Ajouter une séance</h2>
    <label>Film <input id="add-title" list="add-films" placeholder="Titre du film" autocomplete="off"></label>
    <datalist id="add-films">${titles.map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist>
    <label>Date <input id="add-date" type="date" value="${today()}" max="${today()}"></label>
    <label>Salle <select id="add-cine"><option value="">Je ne sais plus</option>${cines.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}<option value="Autre salle">Autre salle</option></select></label>
    <div class="row-actions"><button class="btn pri" id="add-ok">Ajouter</button><button class="btn" id="add-cancel">Annuler</button></div>
  </div>`;
}
function addManual() {
  const title = $('#add-title').value.trim();
  const date = $('#add-date').value || today();
  if (!title) { toast('Indique le titre du film'); return; }
  const entry = Object.entries(S.data.films).find(([, f]) => norm(f.title) === norm(title));
  const f = entry ? entry[1] : null;
  S.vus.push({ f: entry ? entry[0] : null, title: f ? f.title : title, poster: f ? f.poster : null, date, cinema: $('#add-cine').value, rating: 0, review: '' });
  S.vus.sort((a, b) => a.date.localeCompare(b.date));
  store.set('vus2', S.vus); S.showAdd = false;
  renderHisto(); renderCarte(); toast('Séance ajoutée');
}

// ================= géolocalisation =================
function setLoc(label, sub) { $('#loc-label').textContent = label; $('#loc-sub').textContent = sub; }
function locate(silent) {
  const help = $('#geo-help');
  if (!navigator.geolocation) { setLoc(DEFAULT_POS.label, 'Géolocalisation non disponible'); return; }
  if (!silent) setLoc(S.pos.label, 'Recherche de ta position…');
  navigator.geolocation.getCurrentPosition(
    (p) => {
      S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, label: 'Ta position' };
      store.set('geoOk', true); help.hidden = true;
      setLoc('Ta position', `Précision ±${Math.round(p.coords.accuracy)} m · ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
      computeDistances(); S.limit = 30; renderAll();
    },
    (err) => {
      if (silent) return;
      if (err.code === 1) {
        setLoc(DEFAULT_POS.label, 'Position refusée · touche pour réessayer');
        help.hidden = false;
        help.innerHTML = `<b>La localisation est bloquée.</b> Sur iPhone : <b>Réglages › Confidentialité et sécurité › Service de localisation</b>, active-le, puis <b>Sites web Safari › « Lorsque l'app est active »</b>. Reviens ensuite ici et touche ta position.`;
      } else {
        setLoc(DEFAULT_POS.label, 'Position introuvable · touche pour réessayer');
      }
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 }
  );
}
function computeDistances() { for (const c of S.data.cinemas) c.km = distKm(S.pos, c); }

// ================= événements =================
function renderAll() { renderPins(); renderSeances(); renderPourToi(); renderHisto(); renderCarte(); }
document.addEventListener('click', (e) => {
  const film = e.target.closest('[data-film]');
  if (film && !e.target.closest('dialog')) { openFilm(film.dataset.film, film.dataset.day); return; }
  const star = e.target.closest('[data-star]');
  if (star) {
    const i = +star.dataset.i, k = +star.dataset.star; const v = S.vus[i];
    v.rating = v.rating === k ? k - 0.5 : v.rating === k - 0.5 ? 0 : k;
    store.set('vus2', S.vus); buildTaste(); renderHisto(); return;
  }
  const del = e.target.closest('[data-del]');
  if (del) { S.vus.splice(+del.dataset.del, 1); store.set('vus2', S.vus); renderHisto(); renderCarte(); toast('Retiré'); return; }
  const lb = e.target.closest('[data-lb]');
  if (lb) { letterboxdPublish(+lb.dataset.lb); return; }
  if (e.target.closest('#export-lb')) { exportLetterboxd(); return; }
  if (e.target.closest('#add-open')) { S.showAdd = true; renderHisto(); $('#add-title').focus(); return; }
  if (e.target.closest('#add-cancel')) { S.showAdd = false; renderHisto(); return; }
  if (e.target.closest('#add-ok')) { addManual(); return; }
  if (e.target.closest('#fav-add')) { const q = $('#q'); q.value = ''; q.placeholder = 'Nom du cinéma à ajouter…'; q.focus(); q.scrollIntoView({ block: 'center' }); toast('Cherche la salle, puis « Ajouter à mes cinémas favoris »'); return; }
  const cineBtn = e.target.closest('[data-cine]');
  if (cineBtn) { openCinema(cineBtn.dataset.cine); return; }
  if (!e.target.closest('.search')) closeSearch();
  const part = e.target.closest('[data-part]');
  if (part) { S.carte.partage = +part.dataset.part; store.set('carte', S.carte); renderCarte(); return; }
  const th = e.target.closest('[data-theme-set]');
  if (th) { S.theme = th.dataset.themeSet; store.set('theme', S.theme); applyTheme(); renderCarte(); }
});
document.addEventListener('input', (e) => {
  const t = e.target.closest('[data-rev]');
  if (t) { S.vus[+t.dataset.rev].review = t.value; clearTimeout(t._t); t._t = setTimeout(() => store.set('vus2', S.vus), 300); }
});
function syncChips() {
  document.querySelectorAll('#chips button[data-f]').forEach((b) => {
    const f = b.dataset.f;
    const on = ['now', 'tonight', 'from'].includes(f) ? S.mode === f : f === 'tomorrow' ? S.tomorrow : S[f];
    b.setAttribute('aria-pressed', String(!!on));
  });
  $('#chip-from-label').textContent = S.mode === 'from' ? 'Dès ' + S.fromTime.replace(':', 'h') : 'Dès…';
  $('#from-picker').hidden = S.mode !== 'from';
  renderFavBar();
}
// barre « Favoris » : tes salles préférées, touche-en une pour voir sa fiche
function renderFavBar() {
  const bar = $('#fav-bar'); if (!bar) return;
  bar.hidden = !S.fav;
  if (!S.fav) return;
  const list = S.pins.map((id) => cinema(id)).filter(Boolean);
  bar.innerHTML = (list.length
    ? list.map((c) => `<button data-cine="${c.id}">${esc(shortName(c))}</button>`).join('')
    : '<span>Aucun cinéma favori pour l\'instant.</span>')
    + '<button class="add" id="fav-add">+ Ajouter un cinéma</button>';
}
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.pinf) {
    S.cine = S.cine === b.dataset.pinf ? null : b.dataset.pinf;
    if (S.cine && S.mode === 'now') S.mode = 'all';
    S.limit = 30; renderPins(); syncChips(); renderSeances(); return;
  }
  const f = b.dataset.f;
  if (['now', 'tonight', 'from'].includes(f)) S.mode = S.mode === f && f !== 'from' ? 'all' : f;
  else if (f === 'tomorrow') { S.tomorrow = !S.tomorrow; if (S.tomorrow && S.mode === 'now') S.mode = 'all'; }
  else S[f] = !S[f];
  if (f === 'fav' && S.fav) { S.cine = null; renderPins(); }
  S.limit = 30; syncChips(); renderSeances();
});
$('#from-time').addEventListener('change', (e) => { if (e.target.value) { S.fromTime = e.target.value; store.set('fromTime', S.fromTime); S.limit = 30; syncChips(); renderSeances(); } });
$('#from-picker').addEventListener('click', (e) => {
  const q = e.target.closest('[data-t]'); if (!q) return;
  S.fromTime = q.dataset.t; $('#from-time').value = S.fromTime; store.set('fromTime', S.fromTime); S.limit = 30; syncChips(); renderSeances();
});
document.querySelectorAll('[data-sv]').forEach((b) => b.addEventListener('click', () => {
  S.sv = b.dataset.sv; S.limit = 30;
  document.querySelectorAll('[data-sv]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  renderSeances();
}));
$('#radius').addEventListener('change', (e) => { S.radius = +e.target.value; S.limit = 30; renderAll(); });
$('#btn-locate').addEventListener('click', () => locate(false));
$('#q').addEventListener('input', () => { if (S.data) renderSearch(); });
$('#q').addEventListener('focus', () => { if (S.data) renderSearch(); });
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#q').value = ''; closeSearch(); } });
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + b.dataset.v));
  window.scrollTo(0, 0);
}));
$('#sheet').addEventListener('close', () => { if (!$('#sheet').open) $('#sheet-body').innerHTML = ''; });

// ================= mises à jour automatiques =================
// L'iPhone garde la page en cache : à chaque ouverture on vérifie s'il existe une version plus récente
// de l'appli (et des séances) et on recharge tout seul si besoin.
async function checkForUpdate() {
  try {
    const html = await (await fetch(`index.html?check=${Date.now()}`, { cache: 'no-store' })).text();
    const m = html.match(/app\.js\?v=(\d+)/);
    if (m && Number(m[1]) > APP_VERSION) {
      location.replace(location.pathname + '?v=' + m[1]);
      return true;
    }
  } catch { /* hors ligne */ }
  return false;
}
async function refreshData() {
  try {
    const d = await (await fetch(`data/seances.json?t=${Date.now()}`, { cache: 'no-store' })).json();
    if (!S.data || d.generatedAt === S.data.generatedAt) return;
    d.cinemaById = Object.fromEntries(d.cinemas.map((c) => [c.id, c]));
    S.data = d; computeDistances(); buildTaste();
    const g = new Date(d.generatedAt);
    $('#updated').textContent = 'Mis à jour le ' + g.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' à ' + g.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '.';
    renderAll();
  } catch { /* hors ligne */ }
}
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (await checkForUpdate()) return;
  refreshData();
  renderSeances();
  setTimeout(() => window.popAlerts?.(), 1200);
});

// ================= démarrage =================
(async function init() {
  applyTheme();
  if (await checkForUpdate()) return;
  $('#from-time').value = S.fromTime;
  syncChips();
  try {
    const r = await fetch(`data/seances.json?t=${Date.now()}`, { cache: 'no-store' });
    S.data = await r.json();
  } catch {
    $('#seances-grid').innerHTML = '<p class="empty">Impossible de charger les séances.</p>';
    return;
  }
  S.data.cinemaById = Object.fromEntries(S.data.cinemas.map((c) => [c.id, c]));
  computeDistances();
  buildTaste();
  const g = new Date(S.data.generatedAt);
  $('#updated').textContent = 'Mis à jour le ' + g.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' à ' + g.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '.';
  renderAll();
  // position : automatique si déjà autorisée, sinon on attend que tu touches le bouton
  let granted = store.get('geoOk', false);
  try { const p = await navigator.permissions?.query({ name: 'geolocation' }); if (p) granted = p.state === 'granted'; } catch { /* Safari ancien */ }
  if (granted) locate(true);
  setTimeout(() => window.popAlerts?.(), 1200);
  setInterval(renderSeances, 60000);
})();

// pas de zoom (pincement ou double-tap) : c'est une appli, pas une page web
['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => { const n = Date.now(); if (n - lastTouchEnd < 300 && !e.target.closest('input,textarea,select')) e.preventDefault(); lastTouchEnd = n; }, { passive: false });
