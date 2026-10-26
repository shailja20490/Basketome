(() => {
'use strict';

/* ---------- helpers & storage ---------- */
const $ = (s, r = document) => r.querySelector(s);
const KEY = 'basketopia.v1';
const COLORS = ['#ff6b4a', '#ffb703', '#2ec4a6', '#3a86ff', '#8338ec', '#e63f7a', '#6a994e', '#14183a'];
const PH = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#ece8ff"/><text x="150" y="170" font-size="90" text-anchor="middle">🛍️</text></svg>');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + (Number(n) || 0).toFixed(2);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const total = b => b.items.reduce((s, i) => s + (+i.price || 0), 0);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let baskets = load();
let results = [];
let cat = 'all';
let reqId = 0;

function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(d) ? d : []; } catch (e) { return []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(baskets)); }
  catch (e) { toast('Could not save. Browser storage is full or blocked.', 'error'); }
}
document.addEventListener('error', e => {
  const t = e.target;
  if (t.tagName === 'IMG' && !t.dataset.f) { t.dataset.f = 1; t.src = PH; }
}, true);

/* ---------- toast & modal ---------- */
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
const modal = $('#modal');
function openModal(html) {
  modal.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + html + '</div>';
  modal.hidden = false; document.body.classList.add('lock');
  return modal.firstElementChild;
}
function closeModal() { modal.hidden = true; modal.innerHTML = ''; document.body.classList.remove('lock'); }
modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

/* ---------- 3D baskets (one shared WebGL renderer, drawn onto 2D canvases) ---------- */
let renderer = null;
const views = new Set();
const texCache = new Map();
const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');

function getRenderer() {
  if (renderer !== null) return renderer;
  try {
    if (!window.THREE) throw new Error('Three.js missing');
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (e) {
    renderer = false;
    toast('3D view is unavailable on this device. Everything else still works.', 'error');
  }
  return renderer;
}

function canvasTex(draw, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  return new THREE.CanvasTexture(c);
}
let weave = null;
function weaveTex() {
  if (weave) return weave;
  weave = canvasTex((g, s) => {
    g.fillStyle = '#8c8c8c'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? '#ffffff' : '#d4d4d4';
      g.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
    }
  });
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping; weave.repeat.set(10, 3);
  return weave;
}
let shadowTex = null;
function getShadow() {
  return shadowTex || (shadowTex = canvasTex((g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(20,24,58,.45)'); r.addColorStop(1, 'rgba(20,24,58,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  }, 256));
}

function makeBasket(color) {
  const g = new THREE.Group(), col = new THREE.Color(color);
  const mat = new THREE.MeshStandardMaterial({ color: col, map: weaveTex(), roughness: .7, metalness: .05, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(.75), roughness: .45 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1, 1.1, 56, 1, true), mat); body.position.y = .55;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 48), mat); floor.rotation.x = -Math.PI / 2; floor.position.y = .03;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.35, .07, 12, 64), dark); rim.rotation.x = Math.PI / 2; rim.position.y = 1.1;
  const foot = new THREE.Mesh(new THREE.TorusGeometry(1, .05, 10, 48), dark); foot.rotation.x = Math.PI / 2; foot.position.y = .04;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(1.35, .06, 12, 48, Math.PI), dark); handle.position.y = 1.1; handle.scale.y = .85;
  g.add(body, floor, rim, foot, handle);
  return g;
}

function loadTex(url, cb) {
  const c = texCache.get(url);
  if (c && c.tex) return cb(c);
  if (c) return c.cbs.push(cb);
  const e = { tex: null, aspect: 1, cbs: [cb] };
  texCache.set(url, e);
  const done = (t, a) => { e.tex = t; e.aspect = a; e.cbs.forEach(f => f(e)); e.cbs = []; };
  loader.load(url, t => done(t, (t.image.height / t.image.width) || 1), undefined, () => {
    done(canvasTex((g, s) => { g.fillStyle = '#ece8ff'; g.fillRect(0, 0, s, s); g.font = '110px serif'; g.textAlign = 'center'; g.fillText('🛍️', s / 2, s / 2 + 38); }, 256), 1);
  });
}

function addItem(group, it, i, n) {
  const ring = i < 6 ? 0 : 1, idx = ring ? i - 6 : i, cnt = ring ? Math.min(n - 6, 4) : Math.min(n, 6);
  const piv = new THREE.Group(); piv.rotation.y = idx / cnt * Math.PI * 2 + ring * .7;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.visible = false; mesh.rotation.x = ring ? .04 : .13;
  piv.add(mesh); group.add(piv);
  loadTex(it.image || PH, e => {
    const w = 1.0, h = Math.min(Math.max(w * e.aspect, .65), 1.3);
    mesh.material.map = e.tex; mesh.material.needsUpdate = true;
    mesh.scale.set(w, h, 1);
    mesh.position.set(0, .22 + h / 2 + ring * .22, ring ? .22 : .68);
    mesh.visible = true;
  });
}

function createView(canvas, basket) {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(36, 1, .1, 50);
  cam.position.set(0, 3.5, 6.4); cam.lookAt(0, .7, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa4d8, .95));
  const sun = new THREE.DirectionalLight(0xffffff, .8); sun.position.set(3, 6, 4); scene.add(sun);
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), new THREE.MeshBasicMaterial({ map: getShadow(), transparent: true, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = -.02; scene.add(sh);
  const pivot = new THREE.Group(); scene.add(pivot);
  const v = { canvas, scene, cam, pivot, rot: Math.random() * 6, vel: 0, drag: false, sig: '', ctx: canvas.getContext('2d') };
  v.update = b => {
    const sig = b.color + '|' + b.items.map(i => i.id).join(',');
    if (sig === v.sig) return; v.sig = sig;
    pivot.clear(); pivot.add(makeBasket(b.color));
    b.items.slice(0, 10).forEach((it, i, a) => addItem(pivot, it, i, a.length));
  };
  let lastX = 0;
  canvas.addEventListener('pointerdown', e => { v.drag = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (!v.drag) return; const d = (e.clientX - lastX) * .012; lastX = e.clientX; v.rot += d; v.vel = d; });
  const end = () => { v.drag = false; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  v.update(basket); views.add(v);
  return v;
}

function frame() {
  requestAnimationFrame(frame);
  const R = views.size ? getRenderer() : null;
  if (!R) return;
  for (const v of views) {
    if (!v.canvas.isConnected) { views.delete(v); continue; }
    const r = v.canvas.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
    const d = Math.min(devicePixelRatio || 1, 2), w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (v.canvas.width !== w || v.canvas.height !== h) { v.canvas.width = w; v.canvas.height = h; }
    if (R.domElement.width !== w || R.domElement.height !== h) R.setSize(w, h, false);
    v.cam.aspect = w / h; v.cam.updateProjectionMatrix();
    if (!v.drag) { v.rot += v.vel + (reduceMotion ? 0 : .004); v.vel *= .94; }
    v.pivot.rotation.y = v.rot;
    R.render(v.scene, v.cam);
    v.ctx.clearRect(0, 0, w, h); v.ctx.drawImage(R.domElement, 0, 0, w, h);
  }
}

/* ---------- basket actions ---------- */
const find = id => baskets.find(b => b.id === id);

function openBasketForm(id, pendingProduct) {
  const b = id ? find(id) : null;
  let color = b ? b.color : COLORS[baskets.length % COLORS.length];
  const m = openModal(`<form class="mform"><h3>${b ? 'Edit basket' : 'New basket'}</h3>
    <label for="bn">Name</label><input id="bn" name="name" maxlength="30" required placeholder="My Wishlist" value="${esc(b ? b.name : '')}">
    <div class="lbl">Color</div>
    <div class="swatches">${COLORS.map(c => `<button type="button" class="sw" data-c="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('')}<input type="color" class="cpick" value="${color}" aria-label="Custom color"></div>
    <div class="err" hidden></div>
    <div class="row"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${b ? 'Save changes' : 'Create basket'}</button></div></form>`);
  const mark = () => m.querySelectorAll('.sw').forEach(s => s.classList.toggle('sel', s.dataset.c === color));
  mark();
  m.querySelectorAll('.sw').forEach(s => s.onclick = () => { color = s.dataset.c; m.querySelector('.cpick').value = color; mark(); });
  m.querySelector('.cpick').oninput = e => { color = e.target.value; mark(); };
  m.querySelector('input[name=name]').focus();
  m.querySelector('form').onsubmit = e => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) { const er = m.querySelector('.err'); er.textContent = 'Give your basket a name first.'; er.hidden = false; return; }
    if (b) { b.name = name; b.color = color; toast('Basket updated.', 'ok'); }
    else {
      const nb = { id: uid(), name, color, items: [] }; baskets.push(nb);
      toast(`"${name}" created.`, 'ok');
      if (pendingProduct) { nb.items.push(pendingProduct); toast(`Added to "${name}".`, 'ok'); }
    }
    save(); closeModal(); route();
  };
}

function openPicker(p) {
  const m = openModal(`<h3>Add to which basket?</h3>
    ${baskets.map(b => `<button class="pick" data-id="${b.id}"><span class="dot" style="background:${b.color}"></span><b>${esc(b.name)}</b><small>${b.items.some(i => i.id === p.id) ? 'Already inside' : b.items.length + ' items'}</small></button>`).join('')}
    <button class="pick" data-new="1"><span class="dot" style="background:#fff;box-shadow:inset 0 0 0 2px var(--ink)"></span><b>+ New basket</b></button>
    <div class="row"><button class="btn" data-close>Cancel</button></div>`);
  m.onclick = e => {
    const t = e.target.closest('.pick'); if (!t) return;
    if (t.dataset.new) { closeModal(); openBasketForm(null, p); } else { addToBasket(t.dataset.id, p); closeModal(); }
  };
}

function addToBasket(id, p) {
  const b = find(id); if (!b) return;
  if (b.items.some(i => i.id === p.id)) return toast(`That's already in "${b.name}".`, 'error');
  b.items.push({ ...p }); save(); toast(`Added to "${b.name}".`, 'ok'); route();
}
function startAdd(p) { baskets.length ? openPicker(p) : openBasketForm(null, { ...p }); }

function removeItem(bid, iid) {
  const b = find(bid); if (!b) return;
  b.items = b.items.filter(i => i.id !== iid); save(); toast('Removed from basket.'); route();
}
function confirmDelete(id) {
  const b = find(id); if (!b) return;
  const m = openModal(`<h3>Delete "${esc(b.name)}"?</h3><p class="muted">This removes the basket and its ${b.items.length} item(s). It can't be undone.</p>
    <div class="row"><button class="btn" data-close>Keep it</button><button class="btn danger" id="yes">Delete basket</button></div>`);
  m.querySelector('#yes').onclick = () => { baskets = baskets.filter(x => x.id !== id); save(); closeModal(); toast('Basket deleted.'); location.hash = '#/'; route(); };
}
function showDetails(p, basketId) {
  const m = openModal(`<img class="dimg" src="${esc(p.image || PH)}" alt="${esc(p.title)}"><h3 style="margin-top:14px">${esc(p.title)}</h3>
    <div class="muted">${esc(p.meta)}</div><div class="price">${money(p.price)}${p.est ? '<small> estimated</small>' : ''}</div>
    <p>${esc(p.desc || 'No description available.')}</p>
    <div class="row"><button class="btn" data-close>Close</button>${basketId ? '<button class="btn danger" id="act">Remove</button>' : '<button class="btn primary" id="act">Add to basket</button>'}</div>`);
  m.querySelector('#act').onclick = () => { closeModal(); basketId ? removeItem(basketId, p.id) : startAdd(p); };
}

/* ---------- views ---------- */
function itemCard(it, i, mode) {
  return `<article class="card prod item"><button class="pimg" data-act="view" data-i="${i}" aria-label="Details for ${esc(it.title)}"><img src="${esc(it.image || PH)}" alt="${esc(it.title)}" loading="lazy"></button>
    <div class="pbody"><h3>${esc(it.title)}</h3><div class="price">${money(it.price)}${it.est ? '<small> est.</small>' : ''}</div>
    <div class="row">${mode === 'basket' ? `<button class="btn danger sm" data-act="rm" data-i="${i}">Remove</button><button class="btn sm" data-act="view" data-i="${i}">Details</button>` : `<button class="btn primary sm" data-act="add" data-i="${i}">Add to basket</button><button class="btn sm" data-act="view" data-i="${i}">Details</button>`}</div></div></article>`;
}

function renderHome() {
  $('#homeView').hidden = false; $('#basketView').hidden = true;
  views.clear();
  const grid = $('#basketGrid');
  grid.innerHTML = baskets.map(b => `<article class="card bcard" data-id="${b.id}"><canvas aria-label="3D basket ${esc(b.name)}. Drag to rotate."></canvas>
    <div class="info"><h3><span class="dot" style="background:${b.color}"></span>${esc(b.name)}</h3>
    <div class="muted">${b.items.length} ${b.items.length === 1 ? 'item' : 'items'}, about ${money(total(b))}</div>
    <div class="row"><button class="btn primary sm" data-act="open">Open</button><button class="btn sm" data-act="edit">Edit</button><button class="btn danger sm" data-act="del">Delete</button></div></div></article>`).join('')
    + `<button class="newcard" data-act="new" type="button"><span>+</span>${baskets.length ? 'Create new basket' : 'Create your first basket'}</button>`;
  grid.querySelectorAll('.bcard').forEach(el => createView($('canvas', el), find(el.dataset.id)));
}

function renderBasket(b) {
  $('#homeView').hidden = true;
  const v = $('#basketView'); v.hidden = false; views.clear();
  v.innerHTML = `<div class="bhead"><button class="btn" data-act="back">&larr; All baskets</button>
    <h1><span class="dot" style="background:${b.color}"></span>${esc(b.name)}</h1>
    <button class="btn" data-act="edit">Rename / recolor</button><button class="btn danger" data-act="del">Delete</button></div>
    <div class="bwrap"><div class="card stage"><canvas aria-label="3D basket. Drag to rotate."></canvas></div>
    <div><div class="card stat"><div><b>${b.items.length}</b><span class="muted">${b.items.length === 1 ? 'product' : 'products'}</span></div><div><b>${money(total(b))}</b><span class="muted">estimated total</span></div></div>
    <div class="row"><button class="btn primary" data-act="more">+ Add products</button></div>
    ${b.items.length ? `<div class="items">${b.items.map((it, i) => itemCard(it, i, 'basket')).join('')}</div>`
      : `<div class="card empty" style="margin-top:20px"><h3>This basket is waiting for treasures</h3><p class="muted">Search for products and add your favorites. They'll appear right here, inside the basket.</p><button class="btn primary" data-act="more">Find products</button></div>`}</div></div>`;
  createView($('canvas', v), b);
}

function route() {
  const m = location.hash.match(/^#\/b\/(.+)$/), b = m && find(m[1]);
  if (b) { renderBasket(b); window.scrollTo(0, 0); } else { if (m) location.hash = '#/'; renderHome(); }
  renderResults();
}
window.addEventListener('hashchange', route);

/* ---------- event delegation ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act, card = t.closest('.bcard');
  const id = card ? card.dataset.id : (location.hash.match(/^#\/b\/(.+)$/) || [])[1];
  const bk = id && find(id), i = +t.dataset.i;
  if (act === 'new') openBasketForm();
  else if (act === 'open') location.hash = '#/b/' + id;
  else if (act === 'edit') openBasketForm(id);
  else if (act === 'del') confirmDelete(id);
  else if (act === 'back') location.hash = '#/';
  else if (act === 'more') { location.hash = '#/'; setTimeout(() => { $('#discover').scrollIntoView(); $('#q').focus(); }, 60); }
  else if (act === 'rm' && bk) removeItem(id, bk.items[i].id);
  else if (act === 'add' && results[i]) startAdd(results[i]);
  else if (act === 'view') {
    if (t.closest('#basketView') && bk) showDetails(bk.items[i], id); else if (results[i]) showDetails(results[i]);
  }
});
$('#newBtn').onclick = () => openBasketForm();

/* ---------- product search ---------- */
const SEL = 'select=title,price,thumbnail,description,category,brand';
const CATS = {
  all: { label: 'All' },
  beauty: { label: 'Beauty', dj: ['beauty', 'fragrances', 'skin-care'] },
  fashion: { label: 'Fashion', dj: ['womens-dresses', 'mens-shirts', 'tops', 'womens-shoes'] },
  electronics: { label: 'Electronics', dj: ['smartphones', 'laptops', 'tablets'] },
  accessories: { label: 'Accessories', dj: ['sunglasses', 'womens-watches', 'mens-watches', 'womens-bags', 'womens-jewellery'] },
  home: { label: 'Home decor', dj: ['home-decoration', 'furniture', 'kitchen-accessories'] },
  books: { label: 'Books', books: true }
};
$('#chips').innerHTML = Object.entries(CATS).map(([k, c]) => `<button class="chip${k === cat ? ' on' : ''}" data-cat="${k}" type="button">${c.label}</button>`).join('');
$('#chips').onclick = e => {
  const c = e.target.closest('.chip'); if (!c) return;
  cat = c.dataset.cat;
  document.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c));
  search();
};
$('#searchForm').onsubmit = e => { e.preventDefault(); search(); };

async function getJSON(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
const fromDJ = p => ({ id: 'dj-' + p.id, title: p.title, price: p.price, image: p.thumbnail, desc: p.description || '', meta: [p.brand, (p.category || '').replace(/-/g, ' ')].filter(Boolean).join(', '), raw: p.category });
async function searchBooks(q) {
  const d = await getJSON('https://openlibrary.org/search.json?limit=30&fields=key,title,author_name,cover_i,first_publish_year&q=' + encodeURIComponent(q));
  return (d.docs || []).filter(b => b.cover_i).map(b => {
    let h = 0; for (const ch of b.key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return { id: 'ol-' + b.key.replace(/\W/g, ''), title: b.title, price: +(7 + h % 16 + .99).toFixed(2), est: true, image: `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg`, desc: `Book by ${(b.author_name || ['an unknown author']).slice(0, 2).join(' and ')}${b.first_publish_year ? ', first published ' + b.first_publish_year : ''}. Price is an estimate.`, meta: 'Book' };
  });
}
async function fetchProducts(q) {
  const c = CATS[cat];
  if (c.books) return searchBooks(q || 'bestsellers');
  let items;
  if (q) {
    const d = await getJSON(`https://dummyjson.com/products/search?q=${encodeURIComponent(q)}&limit=40&${SEL}`);
    items = d.products.map(fromDJ);
    if (cat !== 'all') items = items.filter(p => c.dj.includes(p.raw));
    else items = items.concat(await searchBooks(q).then(b => b.slice(0, 6)).catch(() => []));
  } else if (cat !== 'all') {
    const parts = await Promise.all(c.dj.map(k => getJSON(`https://dummyjson.com/products/category/${k}?limit=8&${SEL}`)));
    items = parts.flatMap(d => d.products.map(fromDJ));
  } else {
    items = (await getJSON(`https://dummyjson.com/products?limit=30&${SEL}`)).products.map(fromDJ);
  }
  return items;
}
async function search() {
  const q = $('#q').value.trim(), my = ++reqId, st = $('#status');
  st.className = 'status'; st.innerHTML = '<span class="spin"></span>Searching products...';
  try {
    const items = await fetchProducts(q);
    if (my !== reqId) return;
    results = items;
    st.textContent = items.length ? `${items.length} products${q ? ` for "${q}"` : ''}` : `No products found${q ? ` for "${q}"` : ''}. Try a different word or another category.`;
    renderResults();
  } catch (err) {
    if (my !== reqId) return;
    results = []; renderResults();
    st.className = 'status err';
    st.textContent = err.name === 'AbortError' ? 'The search took too long. Check your connection and try again.' : 'Could not reach the product service. Check your connection and try again.';
  }
}
function renderResults() { $('#results').innerHTML = results.map((p, i) => itemCard(p, i, 'search')).join(''); }

/* ---------- start ---------- */
route();
search();
requestAnimationFrame(frame);
})();
