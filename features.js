'use strict';
// ================= Double programme =================
// Règle UGC Illimité : au moins 1h30 entre les débuts de deux séances.
const UGC_GAP = 90;
function travelMin(c1, c2) {
  if (c1.id === c2.id) return 0;
  const km = distKm(c1, c2);
  return km * 13 <= 20 ? Math.round(km * 13) : Math.round(12 + km * 3);
}
function doublePairs(fa, fb, day) {
  const now = Date.now();
  const sa = S.data.seances.filter((s) => s.f === fa && s.t.startsWith(day) && cinema(s.c) && asDate(s.t).getTime() > now - 5 * 60000);
  const sb = S.data.seances.filter((s) => s.f === fb && s.t.startsWith(day) && cinema(s.c) && asDate(s.t).getTime() > now - 5 * 60000);
  const out = [];
  const tryPair = (a, b) => {
    const ca = cinema(a.c), cb = cinema(b.c);
    const startGap = (asDate(b.t) - asDate(a.t)) / 60000;
    if (startGap < UGC_GAP) return;
    const travel = travelMin(ca, cb);
    const wait = (asDate(b.t).getTime() - endOf(a).getTime()) / 60000 - travel;
    if (wait < 0 || wait > 120) return;
    const km = Math.min(ca.km ?? 99, cb.km ?? 99);
    out.push({ a, b, travel, wait: Math.round(wait), cost: wait + travel * 1.5 + km * 4 + (ca.id === cb.id ? 0 : 8) });
  };
  for (const a of sa) for (const b of sb) { tryPair(a, b); tryPair(b, a); }
  out.sort((x, y) => x.cost - y.cost);
  const seen = new Set(); const res = [];
  for (const p of out) { const k = p.a.t + p.a.c + '|' + p.b.t + p.b.c; if (seen.has(k)) continue; seen.add(k); res.push(p); if (res.length === 8) break; }
  return res;
}
function openDouble(firstId) {
  const dlg = $('#sheet'); const root = $('#sheet-body');
  const nowMs = Date.now();
  const days = [...new Set(S.data.seances.filter((s) => s.f === firstId && asDate(s.t).getTime() > nowMs).map((s) => s.t.slice(0, 10)))].sort();
  let day = days[0];
  let second = null;
  let q = '';
  const dayLabel = (d) => d === today() ? "Aujourd'hui" : d === tomorrow() ? 'Demain' : new Date(d + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  const back = '<button class="back" id="close" aria-label="Fermer"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>';
  const step = (s, f) => `<button class="step" data-open="${s.f}" data-d="${s.t.slice(0, 10)}"><i style="${bg(f.poster)}"></i><b>${hm(s.t)}</b><span>${esc(f.title)}<small>${esc(shortName(cinema(s.c)))}</small></span></button>`;
  function candidates() {
    const ids = new Set(S.data.seances.filter((s) => s.t.startsWith(day) && s.f !== firstId && cinema(s.c) && asDate(s.t).getTime() > nowMs).map((s) => s.f));
    const seen = new Set(S.vus.map((v) => String(v.f)));
    let list = [...ids].filter((id) => !seen.has(String(id))).map((id) => [id, S.data.films[id]]).filter(([, f]) => f);
    if (q) { const n = norm(q); list = list.filter(([, f]) => norm(f.title).includes(n)); }
    const withPairs = list.map(([id, f]) => ({ id, f, n: doublePairs(firstId, id, day).length })).filter((x) => x.n);
    withPairs.sort((x, y) => (S.liste.has(y.id) - S.liste.has(x.id)) || (score(y.f) - score(x.f)));
    return withPairs.slice(0, 40);
  }
  function paint() {
    const f1 = S.data.films[firstId];
    let html = `<div class="fhead">${back}<h2 id="f-title">Double programme</h2><small>${esc(f1.title)} + un 2e film</small></div><div class="sheet-body">`;
    html += `<div class="days" role="group" aria-label="Jour">${days.map((d) => `<button data-dd="${d}" aria-pressed="${d === day}">${dayLabel(d)}</button>`).join('')}</div>`;
    if (!second) {
      const cands = candidates();
      html += `<input class="dsearch" id="dq" type="search" placeholder="Chercher le 2e film…" value="${esc(q)}" autocomplete="off">`;
      html += cands.length ? `<p class="m" style="margin:0;font-size:12px;color:var(--mut)">Films qui s'enchaînent avec ${esc(f1.title)} ce jour-là (1h30 minimum entre les deux séances, pub et trajet compris).</p>` + cands.map((x) => `<button class="card notif" data-second="${x.id}"><i style="${bg(x.f.poster)}"></i><span class="fi"><b>${esc(x.f.title)}</b><small>${x.n} enchaînement${x.n > 1 ? 's' : ''} possible${x.n > 1 ? 's' : ''}${S.liste.has(x.id) ? ' · dans ta liste' : ''}</small></span></button>`).join('')
        : '<p class="empty">Aucun film ne s\'enchaîne ce jour-là. Essaie un autre jour.</p>';
    } else {
      const f2 = S.data.films[second];
      const pairs = doublePairs(firstId, second, day);
      html += `<button class="btn sm" id="change" style="align-self:flex-start">← Changer le 2e film (${esc(f2.title)})</button>`;
      html += pairs.length ? pairs.map((p) => {
        const fa = S.data.films[p.a.f], fb = S.data.films[p.b.f];
        const endH = endOf(p.a).toTimeString().slice(0, 5).replace(':', 'h');
        const same = p.a.c === p.b.c;
        return `<div class="pair">${step(p.a, fa)}<div class="gap">Fin vers ${endH} · ${same ? 'même cinéma' : `${p.travel} min de trajet`} · ${p.wait} min de pause</div>${step(p.b, fb)}</div>`;
      }).join('') : '<p class="empty">Pas d\'enchaînement possible ce jour-là.</p>';
    }
    html += '</div>';
    root.innerHTML = html;
    $('#close', root).onclick = () => dlg.close();
    root.querySelectorAll('[data-dd]').forEach((b) => (b.onclick = () => { day = b.dataset.dd; paint(); }));
    root.querySelectorAll('[data-second]').forEach((b) => (b.onclick = () => { second = b.dataset.second; paint(); dlg.scrollTop = 0; }));
    root.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openFilm(b.dataset.open, b.dataset.d)));
    if ($('#change', root)) $('#change', root).onclick = () => { second = null; paint(); };
    const dq = $('#dq', root);
    if (dq) dq.oninput = () => { q = dq.value; const pos = dq.selectionStart; paint(); const n = $('#dq', root); n.focus(); n.setSelectionRange(pos, pos); };
  }
  if (!day) { toast('Plus de séance à venir pour ce film'); return; }
  paint();
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}
window.openDouble = openDouble;

// ================= Films à venir =================
S.avenir = store.get('avenir', []); // [{id (tmdb), title, poster, date}]
const isWaited = (id) => S.avenir.some((x) => x.id === id);
function toggleWaited(u) {
  if (isWaited(u.id)) { S.avenir = S.avenir.filter((x) => x.id !== u.id); toast('Retiré'); }
  else { S.avenir.push({ id: u.id, title: u.title, poster: u.poster, date: u.date }); toast('Je te préviens le jour de sa sortie'); }
  store.set('avenir', S.avenir);
}
// un film attendu est sorti ? on retrouve sa fiche dans les séances (par TMDB, sinon par titre)
function releasedFilm(u) {
  for (const [id, f] of Object.entries(S.data.films)) {
    if (f.tmdbId === u.id || norm(f.title) === norm(u.title)) {
      if (S.data.seances.some((s) => s.f === id && cinema(s.c) && asDate(s.t).getTime() > Date.now())) return id;
    }
  }
  return null;
}
function renderUpcoming() {
  const el = $('#seances-grid');
  const list = (S.data.upcoming || []).filter((u) => u.date > today());
  $('#count-label').textContent = `${list.length} films à venir · touche ☆ pour être prévenu à la sortie`;
  if (!list.length) { el.innerHTML = '<p class="empty">Pas encore de sorties à venir. La liste se met à jour chaque nuit.</p>'; return; }
  const byDate = {};
  for (const u of list) (byDate[u.date] ||= []).push(u);
  el.innerHTML = Object.entries(byDate).map(([d, us]) => `<h2 class="up-day">${new Date(d + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
    <div class="grid">${us.map((u) => `<div class="fcard up">
      <button class="pic" data-up="${u.id}" style="${bg(u.poster)}"><span class="ttl">${esc(u.title)}</span></button>
      <button class="waitbtn ${isWaited(u.id) ? 'on' : ''}" data-wait="${u.id}">${isWaited(u.id) ? '★ Prévenu' : '☆ Me prévenir'}</button>
    </div>`).join('')}</div>`).join('');
}
function openUpcoming(id) {
  const u = (S.data.upcoming || []).find((x) => x.id === id); if (!u) return;
  const dlg = $('#sheet'); const root = $('#sheet-body');
  const paint = () => {
    root.innerHTML = `<div class="hero" style="${bg(u.poster)}">
      <button class="back glass" id="close" aria-label="Fermer"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
      <div><h2 id="f-title">${esc(u.title)}</h2><div class="meta">Sortie le ${new Date(u.date + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div></div></div>
      <div class="sheet-body">
        <button class="btn big ${isWaited(u.id) ? 'on' : 'pri'}" id="wait">${isWaited(u.id) ? '★ Je serai prévenu à la sortie' : '☆ Me prévenir à la sortie'}</button>
        ${u.synopsis ? `<p class="syn">${esc(u.synopsis)}</p>` : ''}
      </div>`;
    $('#close', root).onclick = () => dlg.close();
    $('#wait', root).onclick = () => { toggleWaited(u); paint(); if (S.sv === 'upcoming') renderUpcoming(); };
  };
  paint();
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}
document.addEventListener('click', (e) => {
  const w = e.target.closest('[data-wait]');
  if (w) { const u = (S.data.upcoming || []).find((x) => x.id === +w.dataset.wait); if (u) { toggleWaited(u); renderUpcoming(); } return; }
  const up = e.target.closest('[data-up]');
  if (up) openUpcoming(+up.dataset.up);
});

// ================= Fil d'activité des amis =================
function renderActivity() {
  const el = document.getElementById('activity'); if (!el) return;
  const friends = window.CLOUD?.friends || [];
  const since = new Date(Date.now() - 21 * 86400000).toISOString().slice(0, 10);
  const items = [];
  for (const fr of friends) for (const v of fr.vus || []) if (v.date >= since) items.push({ fr, v });
  items.sort((a, b) => b.v.date.localeCompare(a.v.date));
  if (!items.length || S.sv !== 'all') { el.hidden = true; return; }
  el.hidden = false;
  const ago = (d) => { const n = Math.round((new Date(today() + 'T12:00') - new Date(d + 'T12:00')) / 86400000); return n <= 0 ? "aujourd'hui" : n === 1 ? 'hier' : `il y a ${n} j`; };
  el.innerHTML = `<h2>Chez tes potes</h2><div class="hscroll">${items.slice(0, 15).map(({ fr, v }) => `<button class="act-card" ${S.data.films[v.f] ? `data-film="${esc(v.f)}"` : `data-friend="${esc(fr.uid)}"`}>
    <i style="${bg(v.poster)}"></i>
    <span><b>${esc(String(fr.name || 'Ami').split(' ')[0])}</b> a vu <b>${esc(v.title)}</b></span>
    <small>${v.rating ? `<b class="st">${'★'.repeat(Math.floor(v.rating))}${v.rating % 1 ? '½' : ''}</b> · ` : ''}${ago(v.date)}</small>
    ${v.review ? `<em>« ${esc(v.review.slice(0, 80))}${v.review.length > 80 ? '…' : ''} »</em>` : ''}
  </button>`).join('')}</div>`;
}
window.renderActivity = renderActivity;

// ================= Note de la bande =================
window.bandNote = (id) => {
  const notes = (window.CLOUD?.friends || []).map((f) => (f.vus || []).filter((x) => String(x.f) === String(id) && x.rating).pop()?.rating).filter(Boolean);
  if (!notes.length) return null;
  return { avg: notes.reduce((a, b) => a + b, 0) / notes.length, n: notes.length };
};

// ================= Carrousel de l'accueil (glisser à gauche / à droite) =================
function heroRow(s, f, sub) {
  return `<button class="hrow" data-film="${esc(s.f)}" data-day="${s.t.slice(0, 10)}"><i style="${bg(f.poster)}"></i><span><b>${esc(f.title)}</b><small>${sub}</small></span></button>`;
}
function renderHero() {
  const wrap = document.getElementById('hero-wrap'); if (!wrap || !S.data) return;
  if (S.sv !== 'all') { wrap.hidden = true; return; }
  const slides = [];
  const nowMs = Date.now();
  // 1. ton film du jour
  const top = topPick();
  if (top) {
    const { id, f, n } = top;
    slides.push(`<button class="feature hslide" data-film="${id}" data-day="${n ? n.t.slice(0, 10) : ''}">
      <div class="in">
        <span class="bk">Ton film du jour · ${matchPct(f)} %</span>
        <span class="bt">${esc(f.title)}</span>
        <span class="bs">${esc([f.director, (f.genres || []).slice(0, 2).join(', ')].filter(Boolean).join(' · '))}</span>
        ${n ? `<span class="bs"><b>${quand(n.t)} · ${esc(shortName(cinema(n.c)))}</b></span>` : ''}
      </div>
      <div class="img" style="${bg(f.poster)}"></div>
    </button>`);
  }
  // 2. ma liste : prochaine séance de chaque film
  const liste = [...S.liste].map((id) => ({ id, f: S.data.films[id], n: upcomingNear(id, Math.max(S.radius, 5)) || upcomingNear(id, 50) }))
    .filter((x) => x.f && x.n).sort((a, b) => a.n.t.localeCompare(b.n.t)).slice(0, 4);
  if (liste.length) slides.push(`<div class="hcard hslide"><span class="hk">Ma liste</span>${liste.map((x) => heroRow(x.n, x.f, `${quand(x.n.t)} · ${esc(shortName(cinema(x.n.c)))}`)).join('')}</div>`);
  // 3. dernières chances (films de ta liste qui partent)
  const urgent = (window.computeAlerts?.() || []).filter((a) => a.urgent).slice(0, 3);
  if (urgent.length) slides.push(`<div class="hcard hslide"><span class="hk">Dernière chance</span>${urgent.map((a) => `<button class="hrow" data-film="${esc(a.f)}"><i style="${bg(a.poster)}"></i><span><b>${esc(a.title)}</b><small>${esc(a.text)}</small></span></button>`).join('')}</div>`);
  // 4. avant-premières et événements des 7 prochains jours
  const until = nowMs + 7 * 86400000;
  const seen = new Set();
  const evs = S.data.seances.filter((s) => (s.p || s.ev) && cinema(s.c) && asDate(s.t).getTime() > nowMs && asDate(s.t).getTime() < until)
    .sort((a, b) => (b.ev ? 1 : 0) - (a.ev ? 1 : 0) || a.t.localeCompare(b.t))
    .filter((s) => { const k = s.f + (s.ev || ''); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 4).sort((a, b) => a.t.localeCompare(b.t));
  if (evs.length) slides.push(`<div class="hcard hslide"><span class="hk">Avant-premières &amp; événements</span>${evs.map((s) => heroRow(s, S.data.films[s.f], `${s.ev ? esc(s.ev.slice(0, 60)) : 'Avant-première'} · ${quand(s.t)} · ${esc(shortName(cinema(s.c)))}`)).join('')}</div>`);
  if (!slides.length) { wrap.hidden = true; return; }
  const html = slides.join('');
  const car = document.getElementById('hero-car');
  if (car._sig !== html) { // pas de redessin inutile : sinon le carrousel revient au début
    car._sig = html; car.innerHTML = html;
    document.getElementById('hero-dots').innerHTML = slides.length > 1 ? slides.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('') : '';
    car.scrollLeft = 0;
  }
  wrap.hidden = false;
}
document.getElementById('hero-car')?.addEventListener('scroll', (e) => {
  const car = e.currentTarget; const i = Math.round(car.scrollLeft / Math.max(1, car.clientWidth));
  document.querySelectorAll('#hero-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
}, { passive: true });
window.renderHero = renderHero;
