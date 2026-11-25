'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);

const state = { products: [], settings: {}, filter: 'Todo', bag: load() };

function load() {
  try { return JSON.parse(localStorage.getItem('janda_bag')) || []; } catch { return []; }
}
function persist() {
  try { localStorage.setItem('janda_bag', JSON.stringify(state.bag)); } catch { /* private mode */ }
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Algo salió mal, intenta de nuevo.');
  return data;
}

function isLight(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  if (!m) return false;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 190;
}

// Product photo, or a toned placeholder with the piece's initial until a photo is uploaded.
function media(p, eager) {
  if (p.image) return `<img src="${esc(p.image)}" alt="${esc(p.name)}" ${eager ? '' : 'loading="lazy"'} decoding="async">`;
  const word = p.name.split(' ').slice(-1)[0] || p.name;
  return `<div class="ph ${isLight(p.tone) ? 'light' : ''}" style="background:${esc(p.tone || '#75645A')}" role="img" aria-label="${esc(p.name)}"><b>${esc(word[0])}</b></div>`;
}

function priceLabel(p) {
  if (p.modes?.includes('venta') && p.price) return money(p.price);
  if (p.modes?.includes('renta') && p.rentPrice) return `Renta ${money(p.rentPrice)}`;
  return 'Consultar';
}

// ---------- collection ----------
function renderFilters() {
  const cats = ['Todo', ...new Set(state.products.map((p) => p.category).filter(Boolean))];
  $('#filters').innerHTML = cats
    .map((c) => `<button class="chip" role="tab" aria-selected="${c === state.filter}" data-cat="${esc(c)}">${esc(c)}</button>`)
    .join('');
}

function renderGrid() {
  const list = state.filter === 'Todo' ? state.products : state.products.filter((p) => p.category === state.filter);
  $('#grid').innerHTML = list
    .map((p, i) => `
      <button class="card" data-id="${p.id}" style="animation-delay:${Math.min(i, 8) * 70}ms" aria-label="${esc(p.name)}, ${esc(priceLabel(p))}">
        <div class="card-img">${media(p)}${p.soldOut ? '<span class="badge out">Agotado</span>' : p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ''}</div>
        <div class="card-info"><h3>${esc(p.name)}</h3><span class="price">${esc(priceLabel(p))}</span></div>
        <p class="card-cat">${esc(p.category)}</p>
      </button>`)
    .join('') || '<p class="bag-empty">Muy pronto, nuevas piezas.</p>';
}

$('#filters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  state.filter = b.dataset.cat;
  renderFilters();
  renderGrid();
});
$('#grid').addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (card) openProduct(card.dataset.id);
});

// ---------- quick view ----------
const sheet = $('#productSheet');
let current = null;
let size = '';

function openProduct(id) {
  current = state.products.find((p) => p.id === id);
  if (!current) return;
  size = current.sizes?.length === 1 ? current.sizes[0] : '';
  $('#psImg').innerHTML = media(current, true);
  $('#psCat').textContent = current.category;
  $('#psName').textContent = current.name;
  $('#psPrice').textContent = current.modes?.includes('renta') && current.rentPrice && !current.price
    ? `${money(current.rentPrice)} · renta 3 días` : priceLabel(current);
  $('#psDesc').textContent = current.description || '';
  $('#psColors').textContent = current.colors?.length ? 'Color: ' + current.colors.join(', ') : '';
  $('#psSizes').innerHTML = '<legend>Talla</legend>' + (current.sizes || [])
    .map((s) => `<button type="button" class="size" aria-pressed="${s === size}" data-size="${esc(s)}">${esc(s)}</button>`).join('');

  const actions = [];
  if (current.soldOut) actions.push('<button class="btn btn-dark wide" data-ask="venta">Avísame cuando vuelva</button>');
  else if (current.modes?.includes('venta') && current.price) actions.push('<button class="btn btn-dark wide" data-add>Agregar a la bolsa</button>');
  if (current.modes?.includes('renta')) actions.push('<button class="btn btn-dark wide" data-ask="renta">Reservar renta</button>');
  if (current.modes?.includes('mayoreo')) actions.push('<button class="btn-link" data-ask="mayoreo" style="justify-self:center;margin-top:8px">Precio por mayor</button>');
  $('#psActions').innerHTML = actions.join('');
  sheet.showModal();
}

sheet.addEventListener('click', (e) => {
  if (e.target === sheet || e.target.closest('[data-close]')) return sheet.close();
  const s = e.target.closest('[data-size]');
  if (s) {
    size = s.dataset.size;
    $$('.size', sheet).forEach((b) => b.setAttribute('aria-pressed', b === s));
  }
  if (e.target.closest('[data-add]')) {
    if (current.sizes?.length && !size) {
      $('#psSizes legend').textContent = 'Elige tu talla';
      $('#psSizes legend').style.color = 'var(--coral)';
      return;
    }
    addToBag(current, size);
    sheet.close();
    openBag();
  }
  const ask = e.target.closest('[data-ask]');
  if (ask) {
    sheet.close();
    openInquiry(ask.dataset.ask, `Me interesa: ${current.name}${size ? ' (talla ' + size + ')' : ''}`);
  }
});

// ---------- bag ----------
function addToBag(p, sz) {
  const line = state.bag.find((x) => x.id === p.id && x.size === sz);
  if (line) line.qty++;
  else state.bag.push({ id: p.id, size: sz, qty: 1 });
  persist();
  renderBag();
  const c = $('#bagCount');
  c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
}

function bagLines() {
  return state.bag.map((l) => ({ ...l, p: state.products.find((p) => p.id === l.id) })).filter((l) => l.p);
}

function renderBag() {
  const lines = bagLines();
  $('#bagCount').textContent = lines.reduce((s, l) => s + l.qty, 0);
  $('#bagTotal').textContent = money(lines.reduce((s, l) => s + l.p.price * l.qty, 0));
  $('#bagItems').innerHTML = lines.length
    ? lines.map((l, i) => `
      <li>
        <div class="bag-thumb">${media(l.p)}</div>
        <div><h4>${esc(l.p.name)}</h4><small>${l.size ? 'Talla ' + esc(l.size) + ' · ' : ''}${money(l.p.price)}</small></div>
        <div class="qty"><button data-q="${i}" data-d="-1" aria-label="Quitar uno">−</button>${l.qty}<button data-q="${i}" data-d="1" aria-label="Agregar uno">+</button></div>
      </li>`).join('')
    : '<li class="bag-empty">Tu bolsa está vacía.<br>El mar te espera.</li>';
  $('#bagForm button[type=submit]').disabled = !lines.length;
}

function openBag() { $('#bag').hidden = false; document.body.style.overflow = 'hidden'; }
function closeBag() { $('#bag').hidden = true; document.body.style.overflow = ''; }
$('#bagBtn').addEventListener('click', openBag);
$('#bag').addEventListener('click', (e) => {
  if (e.target.closest('[data-close-bag]')) return closeBag();
  const q = e.target.closest('[data-q]');
  if (q) {
    const lines = bagLines();
    const line = lines[+q.dataset.q];
    const real = state.bag.find((x) => x.id === line.id && x.size === line.size);
    real.qty += +q.dataset.d;
    if (real.qty < 1) state.bag.splice(state.bag.indexOf(real), 1);
    persist();
    renderBag();
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#bag').hidden) closeBag(); });

$('#bagForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const msg = $('#bagMsg');
  msg.className = 'form-msg';
  if (!f.name.value.trim() || f.phone.value.replace(/\D/g, '').length < 7) {
    msg.textContent = 'Déjanos tu nombre y WhatsApp para confirmar.';
    msg.classList.add('err');
    return;
  }
  const lines = bagLines();
  const btn = f.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    await post('/api/inquiries', {
      type: 'pedido', name: f.name.value, phone: f.phone.value, consent: f.consent.checked, website: f.website.value,
      items: lines.map((l) => ({ id: l.id, size: l.size, qty: l.qty })),
    });
    const text = `Hola Janda, soy ${f.name.value.trim()}. Quiero pedir:\n` +
      lines.map((l) => `• ${l.qty} × ${l.p.name}${l.size ? ' (talla ' + l.size + ')' : ''} — ${money(l.p.price * l.qty)}`).join('\n') +
      `\nTotal: ${money(lines.reduce((s, l) => s + l.p.price * l.qty, 0))}`;
    state.bag = [];
    persist();
    renderBag();
    f.reset();
    msg.textContent = '¡Gracias! Recibimos tu pedido.';
    if (state.settings.whatsapp) window.open(`https://wa.me/${state.settings.whatsapp}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    else msg.textContent += ' Te escribiremos por WhatsApp muy pronto.';
  } catch (err) {
    msg.textContent = err.message;
    msg.classList.add('err');
  } finally {
    btn.disabled = !bagLines().length;
  }
});

// ---------- inquiries ----------
const inq = $('#inquirySheet');
const COPY = {
  renta: ['Renta', 'Reserva tu pieza'],
  mayoreo: ['Mayoreo', 'Lleva Janda a tu tienda'],
  venta: ['Disponibilidad', 'Te avisamos'],
  contacto: ['Contacto', 'Escríbenos'],
};
function openInquiry(type, message = '') {
  const f = $('#inqForm');
  f.reset();
  f.type.value = type;
  f.message.value = message;
  f.classList.toggle('is-renta', type === 'renta');
  [$('#inqEyebrow').textContent, $('#inqTitle').textContent] = COPY[type] || COPY.contacto;
  $('#inqMsg').textContent = '';
  inq.showModal();
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-inquiry]');
  if (t) { e.preventDefault(); openInquiry(t.dataset.inquiry); }
});
inq.addEventListener('click', (e) => { if (e.target === inq || e.target.closest('[data-close]')) inq.close(); });

$('#inqForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const msg = $('#inqMsg');
  msg.className = 'form-msg';
  const btn = f.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    await post('/api/inquiries', {
      type: f.type.value === 'venta' ? 'contacto' : f.type.value,
      name: f.name.value, phone: f.phone.value, email: f.email.value, eventDate: f.eventDate.value,
      message: f.message.value, consent: f.consent.checked, website: f.website.value,
    });
    msg.textContent = '¡Gracias! Te respondemos muy pronto.';
    setTimeout(() => inq.close(), 1800);
  } catch (err) {
    msg.textContent = err.message;
    msg.classList.add('err');
  } finally {
    btn.disabled = false;
  }
});

// ---------- club ----------
$('#clubForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const msg = $('#clubMsg');
  msg.className = 'form-msg';
  try {
    await post('/api/subscribe', { email: f.email.value, website: f.website.value });
    f.reset();
    msg.textContent = 'Bienvenida al Club Janda ✦';
  } catch (err) {
    msg.textContent = err.message;
    msg.classList.add('err');
  }
});

// ---------- chrome ----------
$('#year').textContent = new Date().getFullYear();
const nav = $('#nav');
addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 10), { passive: true });

const io = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
}, { threshold: 0.15 });
$$('.reveal').forEach((el) => io.observe(el));

function applySettings(s) {
  if (s.whatsapp) {
    $$('[data-wa]').forEach((a) => { a.href = `https://wa.me/${s.whatsapp}`; a.target = '_blank'; a.rel = 'noopener'; a.hidden = false; });
  } else {
    $$('[data-wa]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openInquiry('contacto'); }));
  }
  if (s.instagram) $$('[data-ig]').forEach((a) => { a.href = `https://instagram.com/${s.instagram}`; if (a.textContent.startsWith('@')) a.textContent = '@' + s.instagram; });
  if (s.heroImage) $('#heroArt .arch').innerHTML = `<img src="${esc(s.heroImage)}" alt="" fetchpriority="high">`;
}

fetch('/api/products')
  .then((r) => r.json())
  .then(({ products, settings }) => {
    state.products = products;
    state.settings = settings || {};
    applySettings(state.settings);
    renderFilters();
    renderGrid();
    renderBag();
  })
  .catch(() => { $('#grid').innerHTML = '<p class="bag-empty">No pudimos cargar la colección. Recarga la página.</p>'; });
