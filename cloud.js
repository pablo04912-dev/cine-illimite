// Comptes (Google), synchro automatique et amis : Firebase
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithRedirect, signInWithPopup, getRedirectResult,
  onAuthStateChanged, signOut, signInAnonymously
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, collection, getDocs, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const ONLINE = location.hostname === 'pablo04912-dev.github.io';
const app = initializeApp({
  apiKey: 'AIzaSyDNhUKhhoPq4yLlx-hx6xb_cpB5cS36jrw',
  // sur le site : les pages de connexion sont servies par le même domaine (indispensable sur iPhone)
  authDomain: ONLINE ? 'pablo04912-dev.github.io' : 'cine-illimite.firebaseapp.com',
  projectId: 'cine-illimite',
  storageBucket: 'cine-illimite.firebasestorage.app',
  messagingSenderId: '270244100635',
  appId: '1:270244100635:web:0d4894adfa3d2777f196be'
});
const auth = getAuth(app);
auth.languageCode = 'fr';
const db = getFirestore(app);

const SYNC_KEYS = ['liste', 'vus2', 'carte', 'pins', 'fromTime', 'conseils', 'avenir'];
const DEVICE = store.get('device', null) || (() => { const d = Math.random().toString(36).slice(2); store.set('device', d); return d; })();
const C = { user: null, ready: false, profile: null, friends: [], adding: false, unsub: null, applying: false };
window.CLOUD = C;

// ---------- lecture / écriture des données locales ----------
function localItems() {
  const o = {};
  for (const k of SYNC_KEYS) { const v = store.get(k, undefined); if (v !== undefined) o[k] = v; }
  return o;
}
function applyItems(items) {
  C.applying = true;
  try {
    for (const k of SYNC_KEYS) if (items[k] !== undefined) store.set(k, items[k]);
  } finally { C.applying = false; }
  S.liste = new Set(store.get('liste', []));
  S.vus = store.get('vus2', []);
  S.carte = Object.assign({ formule: 'duo', prix: 39.9, partage: 2, plein: 14.9 }, store.get('carte', {}));
  S.pins = store.get('pins', ['C0065']);
  S.fromTime = store.get('fromTime', '19:00');
  S.conseils = store.get('conseils', []);
  S.avenir = store.get('avenir', []);
  const ft = document.getElementById('from-time'); if (ft) ft.value = S.fromTime;
  if (S.data) { buildTaste(); renderAll(); syncChips(); }
}
const vuKey = (v) => v.f + '|' + v.date;
const richness = (v) => (v.review ? v.review.length + 10 : 0) + (v.rating ? 5 : 0);
// localWins : modifs faites sur ce téléphone pas encore envoyées (hors ligne)
function merge(cloud, local, localWins) {
  const out = localWins ? Object.assign({}, cloud, local) : Object.assign({}, local, cloud);
  out.liste = [...new Set([...(cloud.liste || []), ...(local.liste || [])])];
  const m = new Map();
  for (const v of cloud.vus2 || []) m.set(vuKey(v), v);
  for (const v of local.vus2 || []) { const c = m.get(vuKey(v)); if (!c || richness(v) > richness(c)) m.set(vuKey(v), v); }
  out.vus2 = [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
  const cs = new Map();
  for (const x of [...(local.conseils || []), ...(cloud.conseils || [])]) cs.set(x.f, x);
  out.conseils = [...cs.values()];
  return out;
}

// ---------- envoi ----------
let pushT = null;
const DIRTY = 'ci.dirty';
window.onStoreSet = (k) => {
  if (C.applying || !SYNC_KEYS.includes(k)) return;
  try { localStorage.setItem(DIRTY, '1'); } catch { /* */ }
  if (!C.user) return;
  clearTimeout(pushT);
  pushT = setTimeout(push, 800);
};
async function push() {
  if (!C.user) return;
  try {
    await setDoc(doc(db, 'users', C.user.uid), { items: localItems(), dev: DEVICE, at: Date.now() });
    try { localStorage.removeItem(DIRTY); } catch { /* */ }
    await saveProfile();
  } catch (e) { console.warn('synchro', e); }
}
function filmInfo(id) {
  const f = S.data?.films?.[id];
  return f ? { f: id, title: f.title, poster: f.poster || '' } : null;
}
async function saveProfile() {
  if (!C.user || !C.profile) return;
  const p = C.profile;
  p.vus = S.vus.slice(-200).map((v) => ({ f: v.f, title: v.title, poster: v.poster || '', date: v.date, rating: v.rating || 0, review: v.review || '' }));
  p.conseils = (S.conseils || []).slice(-100);
  p.liste = [...S.liste].map(filmInfo).filter(Boolean).slice(0, 100);
  p.at = Date.now();
  await setDoc(doc(db, 'profiles', C.user.uid), p);
}

// ---------- démarrage de la synchro ----------
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
async function ensureProfile(u) {
  const ref = doc(db, 'profiles', u.uid);
  const snap = await getDoc(ref);
  const p = snap.exists() ? snap.data() : { friends: [] };
  p.name = (u.displayName || p.name || 'Ami').trim();
  p.photo = u.photoURL || p.photo || '';
  p.friends = p.friends || [];
  if (!p.code) {
    for (let i = 0; i < 6 && !p.code; i++) {
      const c = newCode();
      const ex = await getDoc(doc(db, 'codes', c));
      if (!ex.exists()) { await setDoc(doc(db, 'codes', c), { uid: u.uid }); p.code = c; }
    }
  }
  C.profile = p;
}
async function readInvites() {
  const col = collection(db, 'invites', C.user.uid, 'from');
  const snap = await getDocs(col);
  let added = 0;
  for (const d of snap.docs) {
    if (!C.profile.friends.includes(d.id)) { C.profile.friends.push(d.id); added++; }
    await deleteDoc(d.ref);
  }
  return added;
}
async function loadFriends() {
  if (!C.profile) return;
  const out = [];
  for (const uid of C.profile.friends) {
    try { const s = await getDoc(doc(db, 'profiles', uid)); if (s.exists()) out.push(Object.assign({ uid }, s.data())); } catch { /* profil indisponible */ }
  }
  C.friends = out;
  renderCompte();
  window.renderAlerts?.();
  window.renderActivity?.();
}
async function startSync(u) {
  C.user = u; C.ready = false; renderCompte();
  try {
    const ref = doc(db, 'users', u.uid);
    const snap = await getDoc(ref);
    const local = localItems();
    const cloud = snap.exists() ? (snap.data().items || {}) : null;
    const owner = store.get('owner', null);
    let merged;
    if (owner && owner !== u.uid) {
      // ce téléphone appartenait à un autre compte : on ne mélange pas, on prend celui du compte
      merged = Object.assign({ liste: [], vus2: [], conseils: [], pins: ['C0065'], fromTime: '19:00', carte: {} }, cloud || {});
    } else if (cloud) {
      merged = merge(cloud, local, !!localStorage.getItem(DIRTY));
    } else merged = local;
    applyItems(merged);
    store.set('owner', u.uid);
    await ensureProfile(u);
    const added = await readInvites();
    await setDoc(ref, { items: localItems(), dev: DEVICE, at: Date.now() });
    try { localStorage.removeItem(DIRTY); } catch { /* */ }
    await saveProfile();
    if (added) toast(added > 1 ? `${added} amis t'ont ajouté` : "Un ami t'a ajouté");
    C.unsub?.();
    C.unsub = onSnapshot(ref, (s) => {
      if (s.metadata.hasPendingWrites || !s.exists()) return;
      const d = s.data();
      if (d.dev === DEVICE) return;
      applyItems(d.items || {});
    });
    C.ready = true;
    renderCompte();
    loadFriends();
  } catch (e) {
    console.warn(e);
    toast('Synchro impossible pour le moment');
  }
}
onAuthStateChanged(auth, (u) => {
  if (u) startSync(u);
  else { C.unsub?.(); C.unsub = null; C.user = null; C.profile = null; C.friends = []; C.ready = true; renderCompte(); }
});
getRedirectResult(auth).catch((e) => { console.warn(e); toast('Connexion annulée ou impossible'); });
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !C.user || !C.profile) return;
  try { if (await readInvites()) await saveProfile(); } catch { /* hors ligne */ }
  loadFriends();
});

// ---------- actions ----------
async function login() {
  if (!ONLINE && /[?&]test=anon/.test(location.search)) return signInAnonymously(auth);
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  if (ONLINE) return signInWithRedirect(auth, p);
  return signInWithPopup(auth, p);
}
async function addFriend(code) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) { toast('Le code fait 6 caractères'); return false; }
  if (code === C.profile.code) { toast("C'est ton propre code"); return false; }
  const s = await getDoc(doc(db, 'codes', code));
  if (!s.exists()) { toast('Code introuvable'); return false; }
  const uid = s.data().uid;
  if (!C.profile.friends.includes(uid)) C.profile.friends.push(uid);
  await setDoc(doc(db, 'invites', uid, 'from', C.user.uid), { name: C.profile.name, at: Date.now() });
  await saveProfile();
  await loadFriends();
  const f = C.friends.find((x) => x.uid === uid);
  toast(f ? `${f.name.split(' ')[0]} est dans tes amis` : 'Ami ajouté');
  return true;
}
async function removeFriend(uid) {
  C.profile.friends = C.profile.friends.filter((x) => x !== uid);
  C.friends = C.friends.filter((x) => x.uid !== uid);
  await saveProfile();
  renderCompte();
}

// ---------- affichage ----------
const first = (n) => esc(String(n || 'Ami').split(' ')[0]);
const avatar = (p, size = 44) => p.photo
  ? `<img class="avatar" src="${esc(p.photo)}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer">`
  : `<span class="avatar" style="width:${size}px;height:${size}px">${esc((p.name || '?')[0].toUpperCase())}</span>`;
const starsTxt = (r) => r ? '★'.repeat(Math.floor(r)) + (r % 1 ? '½' : '') : '';
const posterCell = (x) => `<button class="mini" ${S.data?.films?.[x.f] ? `data-film="${esc(x.f)}"` : 'disabled'}><i style="${bg(x.poster)}"></i><span>${esc(x.title)}</span></button>`;

// Bandeau sur l'accueil tant que tu n'es pas connecté
function renderNudge() {
  let n = document.getElementById('login-nudge');
  const show = C.ready && !C.user && !store.get('nudgeOff', false);
  if (!show) { n?.remove(); return; }
  if (n) return;
  n = document.createElement('div');
  n.id = 'login-nudge'; n.className = 'card dark nudge';
  n.innerHTML = `<div class="fi"><b style="color:var(--acc)">Connecte-toi avec Google</b><small style="color:var(--dark-mut)">Tes films et tes notes sont sauvegardés, et tu peux ajouter tes amis.</small></div>
    <button class="btn pri sm" id="nudge-go">Se connecter</button><button class="x" id="nudge-x" aria-label="Plus tard">✕</button>`;
  const pad = document.querySelector('#view-seances .pad'); pad.insertBefore(n, pad.firstChild);
  n.querySelector('#nudge-go').onclick = (e) => { e.target.disabled = true; e.target.textContent = 'Connexion…'; login().catch(() => { toast('Connexion impossible'); e.target.disabled = false; e.target.textContent = 'Se connecter'; }); };
  n.querySelector('#nudge-x').onclick = () => { store.set('nudgeOff', true); n.remove(); };
}
function renderCompte() {
  renderNudge();
  const el = document.getElementById('compte'); if (!el) return;
  const h1 = document.getElementById('t-carte');
  if (!C.user) {
    if (h1) h1.textContent = 'Profil';
    el.innerHTML = `<div class="card dark">
      <h2 style="color:var(--acc)">Ton compte</h2>
      <p class="syn" style="color:var(--dark-mut);margin:8px 0 14px">Connecte-toi avec Google : ta liste, ton historique et tes notes sont sauvegardés tout seuls, tu les retrouves sur n'importe quel téléphone, et tu peux ajouter tes amis.</p>
      <button class="btn pri" id="login" ${C.ready ? '' : 'disabled'}>${C.ready ? 'Se connecter avec Google' : 'Chargement…'}</button>
    </div>`;
    const b = document.getElementById('login');
    if (b) b.onclick = () => { b.disabled = true; b.textContent = 'Connexion…'; login().catch((e) => { console.warn(e); toast('Connexion impossible'); renderCompte(); }); };
    return;
  }
  if (h1) h1.textContent = C.user.displayName ? C.user.displayName.split(' ')[0] : 'Profil';
  const p = C.profile;
  const friends = C.friends.map((f) => `<button class="friend" data-friend="${esc(f.uid)}">
      ${avatar(f)}<span class="fi"><b>${esc(f.name)}</b><small>${(f.vus || []).length} film${(f.vus || []).length > 1 ? 's' : ''} vu${(f.vus || []).length > 1 ? 's' : ''}${(f.conseils || []).length ? ' · ' + f.conseils.length + ' conseil' + (f.conseils.length > 1 ? 's' : '') : ''}</small></span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>`).join('');
  el.innerHTML = `<div class="card me">
      ${avatar({ name: C.user.displayName || 'Moi', photo: C.user.photoURL }, 52)}
      <span class="fi"><b>${esc(C.user.displayName || 'Compte invité')}</b><small>${esc(C.user.email || '')}</small>
      <small class="ok">${C.ready ? '✓ Synchronisé automatiquement' : 'Synchronisation…'}</small></span>
      <button class="btn sm" id="logout">Déconnexion</button>
    </div>
    <div class="card form">
      <h2>Amis</h2>
      ${friends || '<small style="color:var(--mut);line-height:1.5">Ajoute ton frère ou tes potes : tu verras les films qu\'ils ont vus, leurs notes, leurs avis et ce qu\'ils te conseillent.</small>'}
      ${C.adding ? `<div class="addfriend">
          <label for="friend-code">Code de ton ami</label>
          <input id="friend-code" maxlength="7" autocapitalize="characters" autocomplete="off" placeholder="EX. K7P2QD">
          <div class="row-actions"><button class="btn pri" id="friend-ok">Ajouter</button><button class="btn" id="friend-cancel">Annuler</button></div>
        </div>` : `<button class="btn pri big" id="friend-add">+ Ajouter un ami</button>`}
      <div class="mycode"><small>Ton code ami</small><b>${esc(p?.code || '……')}</b>
        <button class="btn sm" id="code-share">Envoyer</button></div>
      <small style="color:var(--mut);line-height:1.5">Ton ami tape ton code (ou toi le sien) : vous vous voyez tous les deux.</small>
    </div>`;
  const q = (id) => document.getElementById(id);
  if (q('friend-add')) q('friend-add').onclick = () => { C.adding = true; renderCompte(); q('friend-code').focus(); };
  if (q('friend-cancel')) q('friend-cancel').onclick = () => { C.adding = false; renderCompte(); };
  if (q('friend-ok')) q('friend-ok').onclick = async () => {
    const b = q('friend-ok'); b.disabled = true;
    try { if (await addFriend(q('friend-code').value)) { C.adding = false; renderCompte(); } } catch (e) { console.warn(e); toast('Impossible pour le moment'); }
    if (q('friend-ok')) q('friend-ok').disabled = false;
  };
  if (q('friend-code')) q('friend-code').onkeydown = (e) => { if (e.key === 'Enter') q('friend-ok').click(); };
  q('code-share').onclick = async () => {
    const url = location.origin + location.pathname;
    if (!p?.code) return;
    const text = `Ajoute-moi sur Projo : mon code ami est ${p.code}\n${url}`;
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast('Code copié'); } catch { toast('Ton code : ' + p.code); }
  };
}
window.renderCompte = renderCompte;

function openFriend(uid) {
  const f = C.friends.find((x) => x.uid === uid); if (!f) return;
  const vus = (f.vus || []).slice().reverse();
  const cons = (f.conseils || []).slice().reverse();
  const liste = f.liste || [];
  const dlg = document.getElementById('sheet'); const root = document.getElementById('sheet-body');
  root.innerHTML = `<div class="fhead">
      <button class="back" id="close" aria-label="Fermer"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
      ${avatar(f, 64)}<h2 id="f-title">${esc(f.name)}</h2><small>${vus.length} film${vus.length > 1 ? 's' : ''} vu${vus.length > 1 ? 's' : ''}</small>
    </div>
    <div class="sheet-body">
      <h2>${first(f.name)} te conseille</h2>
      ${cons.length ? `<div class="minis">${cons.map(posterCell).join('')}</div>` : `<p class="empty">Pas encore de conseil.</p>`}
      <h2>Ses films vus</h2>
      ${vus.length ? vus.slice(0, 60).map((v) => `<div class="card hist"><i style="${bg(v.poster)}"></i><div class="body">
        <span class="t">${S.data?.films?.[v.f] ? `<button class="link" data-film="${esc(v.f)}">${esc(v.title)}</button>` : esc(v.title)}</span>
        <span class="m">${new Date(v.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}${v.rating ? ` · <b class="st">${starsTxt(v.rating)}</b>` : ''}</span>
        ${v.review ? `<p class="syn">« ${esc(v.review)} »</p>` : ''}
      </div></div>`).join('') : '<p class="empty">Rien pour l\'instant.</p>'}
      ${liste.length ? `<h2>Sa liste</h2><div class="minis">${liste.map(posterCell).join('')}</div>` : ''}
      <button class="btn sm" id="unfriend" style="align-self:flex-start;margin-top:10px">Retirer de mes amis</button>
    </div>`;
  root.querySelector('#close').onclick = () => dlg.close();
  root.querySelector('#unfriend').onclick = async () => {
    if (!confirm(`Retirer ${f.name} de tes amis ?`)) return;
    await removeFriend(uid); dlg.close(); toast('Retiré');
  };
  root.querySelectorAll('[data-film]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openFilm(b.dataset.film); }));
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}

// Dans la fiche d'un film : ce qu'en pensent tes amis
window.friendsOnFilm = (id) => {
  if (!C.friends.length) return '';
  const rows = [];
  for (const f of C.friends) {
    const v = (f.vus || []).filter((x) => String(x.f) === String(id)).pop();
    const c = (f.conseils || []).some((x) => String(x.f) === String(id));
    const l = (f.liste || []).some((x) => String(x.f) === String(id));
    if (!v && !c && !l) continue;
    const what = [c ? '<b class="tag">Te le conseille</b>' : '', v ? `A vu${v.rating ? ' · <b class="st">' + starsTxt(v.rating) + '</b>' : ''}` : l ? 'Veut le voir' : ''].filter(Boolean).join(' · ');
    rows.push(`<button class="friend" data-friend="${esc(f.uid)}">${avatar(f, 36)}<span class="fi"><b>${esc(f.name.split(' ')[0])}</b><small>${what}</small>${v?.review ? `<small class="rv">« ${esc(v.review)} »</small>` : ''}</span></button>`);
  }
  const bn = window.bandNote?.(id);
  const head = bn ? `<h2>Tes potes <span class="band">★ ${bn.avg.toFixed(1).replace('.', ',')}/5 · ${bn.n} note${bn.n > 1 ? 's' : ''}</span></h2>` : '<h2>Tes potes</h2>';
  return rows.length ? `<div class="card form friends-film">${head}${rows.join('')}</div>` : '';
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-friend]');
  if (b) { e.stopPropagation(); openFriend(b.dataset.friend); return; }
  if (e.target.closest('#logout')) {
    if (!confirm('Te déconnecter ? Tes films restent sauvegardés dans ton compte Google.')) return;
    // on vide ce téléphone (tout est dans le compte) pour que le compte suivant ne récupère pas tes données
    signOut(auth).then(() => {
      for (const k of [...SYNC_KEYS, 'owner', 'dirty', 'alertsSeen']) { try { localStorage.removeItem('ci.' + k); } catch { /* */ } }
      location.reload();
    });
  }
}, true);

renderCompte();
