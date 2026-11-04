'use strict';

// ---------- état ----------
const DEFAULT_POS = { lat: 48.8396, lng: 2.3958, label: 'Paris 12e' };
const store = {
  get(k, d) { try { const v = localStorage.getItem('ci.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ci.' + k, JSON.stringify(v)); } catch { /* stockage indisponible */ } }
};
const S = {
  data: null,
  pos: DEFAULT_POS,
  time: 'soon',
  vo: false, list: false, premium: false,
  radius: 3,
  liste: new Set(store.get('liste', [])),
  vus: store.get('vus', []),
  prix: store.get('prix', { formule: '', plein: 14.9 })
};
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- utilitaires ----------
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
const today = () => ymd(new Date());
const tomorrow = () => ymd(new Date(Date.now() + 86400000));
const hm = (t) => t.slice(11, 16).replace(':', 'h');
const asDate = (t) => new Date(t + ':00'); // heure locale (Paris)
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
  if (m < 60) return `dans ${m} min`;
  const d = t.slice(0, 10);
  if (d === today()) return `dans ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  if (d === tomorrow()) return 'demain';
  return new Date(d).toLocaleDateString('fr-FR', { weekday: 'long' });
}
function quand(t) {
  const d = t.slice(0, 10);
  if (d === today()) return `Auj. ${hm(t)}`;
  if (d === tomorrow()) return `Demain ${hm(t)}`;
  return new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }) + ' ' + hm(t);
}
const posterStyle = (f) => (f && f.poster ? `style="background-image:url('${esc(f.poster)}')"` : '');
const cinema = (id) => S.data.cinemaById[id];

// ---------- goûts / recommandations ----------
function buildTaste() {
  const w = {}; let n = 0;
  for (const e of S.data.journal || []) {
    if (e.rating == null || !e.genres) continue;
    n++;
    for (const g of e.genres) w[g] = (w[g] || 0) + (e.rating - 2.75);
  }
  S.taste = n ? w : null;
}
function score(f) {
  const q = ((f.press || 3) + (f.spect || 3)) / 2; // 0–5
  let s = (q - 2.5) / 2.5; // -1..1
  if (S.taste && f.tmdbGenres?.length) {
    const t = f.tmdbGenres.reduce((a, g) => a + (S.taste[g] || 0), 0) / f.tmdbGenres.length;
    s = s * 0.4 + Math.tanh(t / 2) * 0.6;
  }
  return s;
}
const matchPct = (f) => Math.max(40, Math.min(99, Math.round(70 + score(f) * 29)));

// ---------- filtres séances ----------
function filtered() {
  const now = Date.now();
  const t0 = today(), t1 = tomorrow();
  return S.data.seances.filter((s) => {
    const c = cinema(s.c); if (!c || c.km > S.radius) return false;
    const start = asDate(s.t).getTime();
    if (start < now - 5 * 60000) return false;
    const d = s.t.slice(0, 10);
    if (S.time === 'soon' && start > now + 75 * 60000) return false;
    if (S.time === 'today' && d !== t0) return false;
    if (S.time === 'tonight' && (d !== t0 || s.t.slice(11, 13) < '18')) return false;
    if (S.time === 'tomorrow' && d !== t1) return false;
    if (S.vo && s.v !== 'VOST') return false;
    if (S.list && !S.liste.has(s.f)) return false;
    if (S.premium && !s.x) return false;
    return true;
  });
}

// ---------- rendu : Séances ----------
function renderSeances() {
  $('#now-label').textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' }) +
    ' · ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  $('#loc-label').textContent = S.pos.label;
  const allRows = filtered();
  const list = allRows.slice(0, S.limit || 80);
  const el = $('#seances-list');
  if (!list.length) {
    el.innerHTML = `<p class="empty">Aucune séance avec ces filtres.<br>Essaie « Aujourd'hui » ou un rayon plus grand.</p>`;
    return;
  }
  el.innerHTML = list.map((s) => {
    const f = S.data.films[s.f]; const c = cinema(s.c);
    const note = f.press || f.spect;
    return `<button class="row" data-film="${s.f}" data-day="${s.t.slice(0, 10)}">
      <div class="poster" ${posterStyle(f)}></div>
      <div class="info">
        <div class="l1"><span class="ttl">${esc(f.title)}</span><span class="hour">${hm(s.t)}</span></div>
        <span class="sub">${esc(c.name)} · ${fmtDist(c.km)}</span>
        <div class="tags">
          <span class="tag">${s.v}</span>
          <span class="tag">${dansLabel(s.t)}</span>
          ${s.x ? `<span class="tag acc">${esc(s.x)}</span>` : ''}
          ${s.p ? '<span class="tag acc">Avant-première</span>' : ''}
          ${note ? `<span class="tag">★ ${note}</span>` : ''}
          ${S.liste.has(s.f) ? '<span class="tag acc">Ma liste</span>' : ''}
        </div>
      </div></button>`;
  }).join('') + (allRows.length > list.length
    ? `<button class="btn" id="more" style="width:100%">Afficher plus (${allRows.length - list.length} séances restantes)</button>`
    : '');
  const more = $('#more');
  if (more) more.onclick = () => { S.limit = (S.limit || 80) + 80; renderSeances(); };
}

// ---------- rendu : Pour toi ----------
function pairsTonight() {
  const now = Date.now(); const d0 = today();
  const todays = S.data.seances.filter((s) => s.t.slice(0, 10) === d0 && asDate(s.t).getTime() > now && cinema(s.c)?.km <= Math.max(S.radius, 3));
  const out = [];
  for (const a of todays) {
    const fa = S.data.films[a.f];
    const end = asDate(a.t).getTime() + (15 + runtimeMin(fa.runtime)) * 60000;
    for (const b of todays) {
      if (b.c !== a.c || b.f === a.f) continue;
      const gap = (asDate(b.t).getTime() - end) / 60000;
      if (gap < 5 || gap > 45) continue;
      out.push({ a, b, end, gap: Math.round(gap), s: score(fa) + score(S.data.films[b.f]) - gap / 200 });
    }
  }
  out.sort((x, y) => y.s - x.s);
  const seen = new Set(); const res = [];
  for (const p of out) { const k = [p.a.f, p.b.f].sort().join(); if (seen.has(k)) continue; seen.add(k); res.push(p); if (res.length === 3) break; }
  return res;
}
function renderPourToi() {
  const films = Object.entries(S.data.films).filter(([id]) => S.data.seances.some((s) => s.f === id && cinema(s.c)?.km <= Math.max(S.radius, 3) && asDate(s.t) > Date.now()));
  const d0 = today();
  const auj = new Set(S.data.seances.filter((s) => s.t.startsWith(d0) && asDate(s.t) > Date.now() && cinema(s.c)?.km <= Math.max(S.radius, 3)).map((s) => s.f));
  const rank = (f, id) => score(f) + (auj.has(id) ? 0.15 : 0);
  films.sort((a, b) => rank(b[1], b[0]) - rank(a[1], a[0]));
  $('#pt-kicker').textContent = S.taste ? 'Selon ton Letterboxd' : 'Selon la presse et le public';
  const next = (id) => S.data.seances.find((s) => s.f === id && asDate(s.t) > Date.now() && cinema(s.c)?.km <= Math.max(S.radius, 3));
  const mini = ([id, f]) => { const n = next(id); return `<button class="mini" data-film="${id}" data-day="${n ? n.t.slice(0, 10) : ''}"><div class="poster" ${posterStyle(f)}></div><b>${esc(f.title)}</b><small>${n ? quand(n.t) + ' · ' : ''}${matchPct(f)} %</small></button>`; };

  const top = films.find(([id]) => auj.has(id)) || films[0];
  const counts = {}; for (const s of S.data.seances) counts[s.f] = (counts[s.f] || 0) + 1;
  const old = films.filter(([id, f]) => f.release && (Date.now() - new Date(f.release)) > 21 * 86400000 && counts[id] <= 6).slice(0, 8);
  const pairs = pairsTonight();
  const listed = films.filter(([id]) => S.liste.has(id));

  let html = '';
  if (top) {
    const [id, f] = top; const n = next(id);
    html += `<div class="card"><span class="sub" style="color:var(--acc);font-weight:600">Ton meilleur match à l'affiche</span>
      <button class="row" style="border:none;padding:10px 0 0;background:none" data-film="${id}" data-day="${n ? n.t.slice(0, 10) : ''}">
        <div class="poster" style="width:84px;height:120px;${f.poster ? `background-image:url('${esc(f.poster)}')` : ''}"></div>
        <div class="info"><span class="ttl" style="font-size:18px;white-space:normal">${esc(f.title)}</span>
        <span class="sub">${esc(f.director || '')}</span>
        <span class="sub" style="color:var(--soft)">${esc((f.genres || []).slice(0, 2).join(', '))} · match ${matchPct(f)} %</span>
        ${n ? `<span style="color:var(--acc);font-size:13px;font-weight:600">Prochaine : ${quand(n.t)} · ${esc(cinema(n.c).name)}</span>` : ''}</div></button></div>`;
  }
  if (listed.length) html += `<div class="stack" style="gap:10px"><h2>Ma liste</h2><div class="hscroll">${listed.map(mini).join('')}</div></div>`;
  html += `<div class="stack" style="gap:10px"><h2>Recommandés</h2><div class="hscroll">${films.filter((x) => x !== top).slice(0, 12).map(mini).join('')}</div></div>`;
  if (pairs.length) {
    html += `<div class="stack" style="gap:10px"><h2>Enchaîne deux films aujourd'hui</h2>${pairs.map((p) => {
      const fa = S.data.films[p.a.f], fb = S.data.films[p.b.f];
      const endH = new Date(p.end).toTimeString().slice(0, 5).replace(':', 'h');
      return `<div class="card pair">
        <button class="step" data-film="${p.a.f}" data-day="${today()}"><span class="hour">${hm(p.a.t)}</span><span>${esc(fa.title)}</span><small class="sub">${p.a.v}</small></button>
        <div class="gap">Fin vers ${endH} · ${p.gap} min de battement · ${esc(cinema(p.a.c).name)}</div>
        <button class="step" data-film="${p.b.f}" data-day="${today()}"><span class="hour">${hm(p.b.t)}</span><span>${esc(fb.title)}</span><small class="sub">${p.b.v}</small></button>
      </div>`;
    }).join('')}</div>`;
  }
  if (old.length) html += `<div class="stack" style="gap:10px"><h2>Dernières chances</h2><div class="hscroll">${old.map(mini).join('')}</div></div>`;
  $('#pourtoi').innerHTML = html || '<p class="empty">Pas encore de données.</p>';
}

// ---------- rendu : Journal ----------
function renderJournal() {
  const month = today().slice(0, 7);
  $('#j-kicker').textContent = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const ce = S.vus.filter((v) => v.date.startsWith(month));
  const formule = parseFloat(String(S.prix.formule).replace(',', '.'));
  const plein = parseFloat(String(S.prix.plein).replace(',', '.')) || 0;
  const parSeance = formule && ce.length ? (formule / ce.length).toFixed(2).replace('.', ',') + ' €' : '–';
  const eco = formule ? Math.round(ce.length * plein - formule) : null;
  let html = `<div class="stat">
    <small style="font-weight:600;letter-spacing:.06em;text-transform:uppercase">Ma carte ce mois</small>
    <div class="grid">
      <div><span class="n">${ce.length}</span><small>séance${ce.length > 1 ? 's' : ''}</small></div>
      <div><span class="n">${parSeance}</span><small>par séance</small></div>
      <div><span class="n">${eco == null ? '–' : (eco >= 0 ? '+' : '') + eco + ' €'}</span><small>${eco != null && eco < 0 ? 'à rattraper' : 'économisés'}</small></div>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <label>Ma formule <input id="p-formule" inputmode="decimal" value="${esc(S.prix.formule)}" placeholder="€/mois"></label>
      <label>Plein tarif <input id="p-plein" inputmode="decimal" value="${esc(S.prix.plein)}"></label>
    </div>
  </div>`;
  if (S.vus.length) {
    html += `<div class="stack" style="gap:10px"><h2>Vus avec la carte</h2>${S.vus.slice().reverse().slice(0, 30).map((v, i) => {
      const f = S.data.films[v.f];
      return `<div class="card diary"><div class="poster" ${posterStyle(f || v)}></div><div class="info" style="display:flex;flex-direction:column;gap:4px;flex:1">
        <b>${esc(v.title)}</b><span class="sub">${new Date(v.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}${v.cinema ? ' · ' + esc(v.cinema) : ''}</span>
        <button class="btn" style="height:32px;align-self:flex-start;font-size:12px" data-del="${S.vus.length - 1 - i}">Retirer</button></div></div>`;
    }).join('')}</div>`;
  }
  const j = S.data.journal || [];
  if (j.length) {
    html += `<div class="stack" style="gap:10px"><h2>Letterboxd</h2>${j.slice(0, 30).map((e) => `<div class="card diary">
      <div class="poster" ${e.poster ? `style="background-image:url('${esc(e.poster)}')"` : ''}></div>
      <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0">
        <b>${esc(e.title)} <span class="sub">${esc(e.year || '')}</span></b>
        <span class="stars">${e.rating != null ? '★'.repeat(Math.floor(e.rating)) + (e.rating % 1 ? '½' : '') : ''}</span>
        ${e.date ? `<span class="sub">${new Date(e.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>` : ''}
        ${e.review ? `<span style="font-size:13px;color:var(--soft)">${esc(e.review)}</span>` : ''}
      </div></div>`).join('')}</div>`;
  } else {
    html += `<div class="card"><h2>Letterboxd</h2><p class="syn" style="margin-top:8px">Pas encore branché. Ajoute ton pseudo Letterboxd dans les réglages du projet (variable LETTERBOXD_USER) : ton journal et tes notes apparaîtront ici et les recommandations se baseront dessus.</p></div>`;
  }
  $('#journal').innerHTML = html;
  const save = () => { S.prix = { formule: $('#p-formule').value, plein: $('#p-plein').value }; store.set('prix', S.prix); renderJournal(); };
  $('#p-formule').addEventListener('change', save);
  $('#p-plein').addEventListener('change', save);
}

// ---------- fiche film ----------
function openFilm(id, day) {
  const f = S.data.films[id]; if (!f) return;
  const all = S.data.seances.filter((s) => s.f === id && cinema(s.c));
  const days = [...new Set(all.map((s) => s.t.slice(0, 10)))].filter((d) => d >= today());
  let cur = day && days.includes(day) ? day : days[0];
  const dayLabel = (d) => d === today() ? "Aujourd'hui" : d === tomorrow() ? 'Demain' : new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });

  function body() {
    const byC = {};
    for (const s of all.filter((s) => s.t.startsWith(cur))) (byC[s.c] ||= []).push(s);
    const cines = Object.keys(byC).sort((a, b) => cinema(a).km - cinema(b).km);
    return `
    <div class="hero" ${f.poster ? `style="background-image:url('${esc(f.poster)}')"` : ''}>
      <button class="back" id="close" aria-label="Fermer"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
      <div>
        ${f.trailer ? `<button class="play" id="play"><svg width="18" height="18" viewBox="0 0 24 24" fill="#FFB547" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>Bande-annonce</button>` : ''}
        <h2 id="f-title">${esc(f.title)}</h2>
        <div class="meta">${esc([f.director, f.runtime, (f.genres || []).slice(0, 2).join(', ')].filter(Boolean).join(' · '))}</div>
      </div>
    </div>
    <div class="sheet-body">
      <div id="video"></div>
      <div class="scores">
        <div><small>Presse</small><b>${f.press ?? '–'}</b></div>
        <div><small>Spectateurs</small><b>${f.spect ?? '–'}</b></div>
        <div class="acc"><small>Match pour toi</small><b>${matchPct(f)} %</b></div>
      </div>
      <div class="actions">
        <button class="btn ${S.liste.has(id) ? 'on' : 'pri'}" id="toggle-list">${S.liste.has(id) ? '✓ Dans ma liste' : '+ Ma liste'}</button>
        <button class="btn" id="seen">J'y étais</button>
      </div>
      ${f.synopsis ? `<p class="syn">${esc(f.synopsis)}</p>` : ''}
      <h2>Séances</h2>
      <div class="days" role="group" aria-label="Jour">${days.map((d) => `<button data-day="${d}" aria-pressed="${d === cur}">${dayLabel(d)}</button>`).join('')}</div>
      ${cines.length ? cines.map((cid) => { const c = cinema(cid); return `<div class="card cine">
        <div class="head"><b>${esc(c.name)}</b><span class="sub">${trajet(c.km)}</span></div>
        <div class="times">${byC[cid].map((s) => `<span class="${asDate(s.t) < Date.now() ? 'past' : ''}">${hm(s.t)} <small>${s.v}${s.x ? ' ' + esc(s.x) : ''}</small></span>`).join('')}</div>
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
    $('#toggle-list', root).onclick = () => {
      S.liste.has(id) ? S.liste.delete(id) : S.liste.add(id);
      store.set('liste', [...S.liste]); paint(); renderAll();
    };
    $('#seen', root).onclick = () => {
      // salle la plus proche parmi les séances d'aujourd'hui déjà commencées (sinon la prochaine)
      const auj = all.filter((x) => x.t.startsWith(today()));
      const started = auj.filter((x) => asDate(x.t) <= Date.now() + 30 * 60000);
      const pool = started.length ? started : auj;
      const s = pool.slice().sort((a, b) => cinema(a.c).km - cinema(b.c).km || b.t.localeCompare(a.t))[0];
      S.vus.push({ f: id, title: f.title, poster: f.poster, date: today(), cinema: s ? cinema(s.c).name : '' });
      store.set('vus', S.vus); $('#seen', root).textContent = '✓ Ajouté au journal'; renderJournal();
    };
    root.querySelectorAll('.days button').forEach((b) => (b.onclick = () => { cur = b.dataset.day; paint(); }));
  };
  paint();
  dlg.showModal();
  dlg.scrollTop = 0;
}

// ---------- géoloc ----------
function locate(silent) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (p) => { S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, label: 'Ta position' }; computeDistances(); renderAll(); },
    () => { if (!silent) alert('Géolocalisation refusée : on reste sur Paris 12e.'); },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
  );
}
function computeDistances() {
  for (const c of S.data.cinemas) c.km = distKm(S.pos, c);
}

// ---------- événements ----------
function renderAll() { renderSeances(); renderPourToi(); renderJournal(); }
document.addEventListener('click', (e) => {
  const film = e.target.closest('[data-film]');
  if (film && !e.target.closest('dialog')) { openFilm(film.dataset.film, film.dataset.day); return; }
  const del = e.target.closest('[data-del]');
  if (del) { S.vus.splice(+del.dataset.del, 1); store.set('vus', S.vus); renderJournal(); }
});
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const f = b.dataset.f;
  if (['soon', 'today', 'tonight', 'tomorrow'].includes(f)) {
    S.time = S.time === f ? 'all' : f;
    $('#chips').querySelectorAll('[data-f="soon"],[data-f="today"],[data-f="tonight"],[data-f="tomorrow"]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.f === S.time)));
  } else {
    S[f] = !S[f]; b.setAttribute('aria-pressed', String(S[f]));
  }
  S.limit = 80;
  renderSeances();
});
$('#radius').addEventListener('change', (e) => { S.radius = +e.target.value; renderAll(); });
$('#btn-locate').addEventListener('click', () => locate(false));
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + b.dataset.v));
  window.scrollTo(0, 0);
}));
$('#sheet').addEventListener('close', () => { $('#sheet-body').innerHTML = ''; });

// ---------- démarrage ----------
(async function init() {
  try {
    const r = await fetch('data/seances.json', { cache: 'no-cache' });
    S.data = await r.json();
  } catch {
    $('#seances-list').innerHTML = '<p class="empty">Impossible de charger les séances.</p>';
    return;
  }
  S.data.cinemaById = Object.fromEntries(S.data.cinemas.map((c) => [c.id, c]));
  computeDistances();
  buildTaste();
  const g = new Date(S.data.generatedAt);
  $('#updated').textContent = 'Mis à jour le ' + g.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' à ' + g.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '.';
  renderAll();
  locate(true);
  setInterval(renderSeances, 60000);
})();
