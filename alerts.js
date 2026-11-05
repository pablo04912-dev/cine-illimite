'use strict';
// ================= notifications (cloche en haut de l'accueil) =================
// - films de « Ma liste » qui vont bientôt quitter l'affiche
// - films que tes amis te conseillent
const dayDiff = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 86400000);
const longDay = (d) => new Date(d + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
function computeAlerts() {
  if (!S.data) return [];
  const out = [];
  const t0 = today();
  const nowMs = Date.now();
  let horizon = '';
  for (const s of S.data.seances) { const d = s.t.slice(0, 10); if (d > horizon) horizon = d; }
  const seenIds = new Set(S.vus.map((v) => String(v.f)));
  for (const id of S.liste) {
    if (seenIds.has(String(id))) continue;
    const f = S.data.films[id]; if (!f) continue;
    const fut = S.data.seances.filter((s) => s.f === id && cinema(s.c) && asDate(s.t).getTime() > nowMs);
    if (!fut.length) continue;
    const last = fut.reduce((a, b) => (b.t > a.t ? b : a));
    const lastDay = last.t.slice(0, 10);
    if (lastDay >= horizon) continue; // encore à l'affiche au-delà des séances connues
    const n = dayDiff(t0, lastDay);
    if (n > 3) continue;
    const c = cinema(last.c);
    const quand = n <= 0 ? `Dernière séance aujourd'hui à ${hm(last.t)}` : n === 1 ? `Dernière séance demain à ${hm(last.t)}` : `Plus que ${n} jours : dernière séance ${longDay(lastDay)}`;
    out.push({ key: `end:${id}:${lastDay}`, f: id, urgent: true, title: f.title, poster: f.poster, text: `${quand} · ${shortName(c)}` });
  }
  for (const fr of window.CLOUD?.friends || []) {
    for (const x of (fr.conseils || []).slice().reverse()) {
      if (seenIds.has(String(x.f))) continue;
      out.push({ key: `cons:${fr.uid}:${x.f}`, f: x.f, urgent: false, title: x.title, poster: x.poster, text: `${String(fr.name || 'Un ami').split(' ')[0]} te le conseille` });
    }
  }
  return out;
}
function alertsSeen() { return new Set(store.get('alertsSeen', [])); }
function renderAlerts() {
  const btn = document.getElementById('bell'); if (!btn) return;
  const list = computeAlerts(); const seen = alertsSeen();
  const fresh = list.filter((a) => !seen.has(a.key)).length;
  btn.querySelector('.dot').textContent = fresh || '';
  btn.querySelector('.dot').hidden = !fresh;
  btn.setAttribute('aria-label', fresh ? `Notifications, ${fresh} nouvelle${fresh > 1 ? 's' : ''}` : 'Notifications');
  return list;
}
function openAlerts() {
  const list = computeAlerts(); const seen = alertsSeen();
  const dlg = $('#sheet'); const root = $('#sheet-body');
  root.innerHTML = `<div class="fhead">
      <button class="back" id="close" aria-label="Fermer"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
      <h2 id="f-title">Notifications</h2></div>
    <div class="sheet-body">
      ${list.length ? list.map((a) => `<button class="card notif ${a.urgent ? 'urgent' : ''} ${seen.has(a.key) ? '' : 'new'}" ${S.data.films[a.f] ? `data-open="${esc(a.f)}"` : 'disabled'}>
        <i style="${bg(a.poster)}"></i><span class="fi"><b>${esc(a.title)}</b><small>${esc(a.text)}</small></span></button>`).join('')
      : `<p class="empty">Rien pour l'instant. Ajoute des films à « Ma liste » : je te préviens quand il ne reste que quelques jours pour les voir.</p>`}
    </div>`;
  $('#close', root).onclick = () => dlg.close();
  root.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openFilm(b.dataset.open)));
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  store.set('alertsSeen', [...new Set([...seen, ...list.map((a) => a.key)])].slice(-300));
  renderAlerts();
}
// petite fenêtre à l'ouverture de l'appli pour ce qui est urgent et pas encore vu
function popAlerts() {
  const seen = alertsSeen();
  const urgent = computeAlerts().filter((a) => a.urgent && !seen.has(a.key) && !(S.popped || []).includes(a.key));
  if (!urgent.length || document.getElementById('alert-pop')) return;
  S.popped = [...(S.popped || []), ...urgent.map((a) => a.key)];
  const a = urgent[0];
  const el = document.createElement('button');
  el.id = 'alert-pop'; el.className = 'alert-pop';
  el.innerHTML = `<i style="${bg(a.poster)}"></i><span class="fi"><b>${esc(a.title)}</b><small>${esc(a.text)}${urgent.length > 1 ? ` · et ${urgent.length - 1} autre${urgent.length > 2 ? 's' : ''}` : ''}</small></span><span class="x" aria-hidden="true">✕</span>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));
  const close = () => { el.classList.remove('on'); setTimeout(() => el.remove(), 300); };
  el.onclick = (e) => { close(); if (!e.target.closest('.x')) openAlerts(); };
  setTimeout(close, 7000);
}
window.renderAlerts = renderAlerts;
window.popAlerts = popAlerts;
document.getElementById('bell')?.addEventListener('click', openAlerts);
