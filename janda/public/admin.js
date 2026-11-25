'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
const when = (iso) => {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 60) return 'ahora';
  if (d < 3600) return `hace ${Math.floor(d / 60)} min`;
  if (d < 86400) return `hace ${Math.floor(d / 3600)} h`;
  if (d < 604800) return `hace ${Math.floor(d / 86400)} d`;
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
};
const STAGES = { nuevo: 'Nuevo', en_conversacion: 'En conversación', cliente: 'Cliente', perdido: 'Perdido' };
const STATUSES = { nuevo: 'Nuevas', respondido: 'Respondidas', cerrado: 'Cerradas', perdido: 'Perdidas' };
const TYPE = { pedido: 'Pedido', venta: 'Venta', renta: 'Renta', mayoreo: 'Mayoreo', contacto: 'Mensaje' };

async function api(path, opts = {}) {
  const r = await fetch('/api/admin/' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401) { showLogin(); throw new Error('Inicia sesión'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { toast(data.error || 'Error'); throw new Error(data.error); }
  return data;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}
const waLink = (phone, text = '') => `https://wa.me/${String(phone).replace(/\D/g, '')}${text ? '?text=' + encodeURIComponent(text) : ''}`;

// ---------- auth ----------
function showLogin() { $('#login').hidden = false; $('#app').hidden = true; }
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: e.target.password.value }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return ($('#loginErr').textContent = d.error || 'Error');
  e.target.reset();
  boot();
});
$('#logout').addEventListener('click', async () => { await fetch('/api/admin/logout'); showLogin(); });

// ---------- tabs ----------
const loaders = { resumen: loadSummary, solicitudes: loadBoard, contactos: loadContacts, productos: loadProducts, campanas: loadCampaigns, ajustes: loadSettings };
function go(tab) {
  $$('#tabs button').forEach((b) => (b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab));
  try { sessionStorage.setItem('janda_tab', tab); } catch { /* ignore */ }
  loaders[tab]();
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });

// ---------- resumen ----------
async function loadSummary() {
  $('#today').textContent = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  const [s, { inquiries }] = await Promise.all([api('stats'), api('inquiries')]);
  $('#openCount').textContent = s.openInquiries || '';
  $('#kpis').innerHTML = [
    ['Solicitudes abiertas', s.openInquiries, s.pipelineValue ? money(s.pipelineValue) + ' en pedidos' : 'Pedidos, rentas y mayoreo'],
    ['Contactos', s.contacts, `+${s.newContacts30d} en 30 días`],
    ['Club Janda', s.subscribers, 'aceptan novedades'],
    ['Clientas', s.customers, 'con compra cerrada'],
  ].map(([l, v, sub]) => `<div class="kpi"><span>${l}</span><strong>${v}</strong><small>${esc(sub)}</small></div>`).join('');
  $('#recentInq').innerHTML = inquiries.slice(0, 6).map((i) => `
    <li data-contact="${i.contactId}"><div><b>${esc(i.contact?.name || i.contact?.email || i.contact?.phone || 'Sin nombre')}</b><br><small>${esc(i.message?.slice(0, 80) || (i.items.length ? i.items.map((x) => x.name).join(', ') : ''))}</small></div>
    <div style="text-align:right"><span class="tag ${i.type}">${TYPE[i.type]}</span><br><small>${when(i.createdAt)}</small></div></li>`).join('')
    || '<li class="empty">Aún no hay solicitudes. Comparte la tienda en Instagram ✦</li>';
  const max = Math.max(1, ...s.byType.map((t) => t.count));
  $('#byType').innerHTML = s.byType.map((t) => `<li><span>${TYPE[t.type]}</span><i style="width:${(t.count / max) * 100}%"></i><b>${t.count}</b></li>`).join('');
}
$('#recentInq').addEventListener('click', (e) => { const li = e.target.closest('[data-contact]'); if (li) openContact(li.dataset.contact); });

// ---------- solicitudes ----------
async function loadBoard() {
  const { inquiries } = await api('inquiries');
  $('#openCount').textContent = inquiries.filter((i) => i.status === 'nuevo').length || '';
  $('#board').innerHTML = Object.entries(STATUSES).map(([st, label]) => {
    const list = inquiries.filter((i) => i.status === st);
    return `<div class="col"><h3>${label}<span>${list.length}</span></h3>${list.map(inqCard).join('') || '<p class="empty">—</p>'}</div>`;
  }).join('');
}
function inqCard(i) {
  const c = i.contact || {};
  const who = c.name || c.email || c.phone || 'Sin nombre';
  const greeting = `Hola ${c.name ? c.name.split(' ')[0] : ''}, te escribimos de Janda ✦`;
  return `<article class="inq">
    <header><b data-contact="${c.id}">${esc(who)}</b><span class="tag ${i.type}">${TYPE[i.type]}</span></header>
    ${i.items?.length ? `<ul>${i.items.map((x) => `<li>${x.qty} × ${esc(x.name)}${x.size ? ' · ' + esc(x.size) : ''}</li>`).join('')}</ul><small>Total ${money(i.total)}</small>` : ''}
    ${i.eventDate ? `<small>Evento: ${esc(i.eventDate)}</small>` : ''}
    ${i.message ? `<p>${esc(i.message)}</p>` : ''}
    <footer>
      <select data-inq="${i.id}" aria-label="Estado">${Object.keys(STATUSES).map((s) => `<option value="${s}" ${s === i.status ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select>
      ${c.phone ? `<a class="wa" href="${waLink(c.phone, greeting)}" target="_blank" rel="noopener">WhatsApp ↗</a>` : c.email ? `<a class="wa" href="mailto:${esc(c.email)}">Correo ↗</a>` : ''}
      <small class="muted">${when(i.createdAt)}</small>
    </footer></article>`;
}
$('#board').addEventListener('change', async (e) => {
  const s = e.target.closest('[data-inq]');
  if (!s) return;
  await api('inquiries/' + s.dataset.inq, { method: 'PATCH', body: { status: s.value } });
  toast('Actualizado');
  loadBoard();
});
$('#board').addEventListener('click', (e) => { const b = e.target.closest('[data-contact]'); if (b) openContact(b.dataset.contact); });

// ---------- contactos ----------
$('#cstage').innerHTML += Object.entries(STAGES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
let cTimer;
$('#cq').addEventListener('input', () => { clearTimeout(cTimer); cTimer = setTimeout(loadContacts, 200); });
$('#cstage').addEventListener('change', loadContacts);
async function loadContacts() {
  const q = new URLSearchParams({ q: $('#cq').value, stage: $('#cstage').value });
  $('#csv').href = '/api/admin/contacts?format=csv&' + q;
  const { contacts, total } = await api('contacts?' + q);
  $('#contactTotal').textContent = `${total} ${total === 1 ? 'persona' : 'personas'}`;
  $('#contactTable tbody').innerHTML = contacts.map((c) => `
    <tr data-contact="${c.id}">
      <td><b>${esc(c.name || '—')}</b></td>
      <td>${esc(c.email)}${c.email && c.phone ? '<br>' : ''}${esc(c.phone)}</td>
      <td><span class="stage ${c.stage}">${STAGES[c.stage]}</span></td>
      <td>${c.tags.map((t) => `<span class="tag ${esc(t)}">${esc(t)}</span>`).join('')}</td>
      <td>${c.marketingConsent ? 'Sí' : '<span class="muted">No</span>'}</td>
      <td class="muted">${when(c.lastActivityAt)}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">Sin contactos todavía.</td></tr>';
}
$('#contactTable').addEventListener('click', (e) => { const r = e.target.closest('[data-contact]'); if (r) openContact(r.dataset.contact); });
$('#newContact').addEventListener('click', async () => {
  const phone = prompt('WhatsApp o correo del nuevo contacto:');
  if (!phone) return;
  const body = phone.includes('@') ? { email: phone } : { phone };
  const c = await api('contacts', { method: 'POST', body: { ...body, tags: ['manual'] } });
  loadContacts();
  openContact(c.id);
});

async function openContact(id) {
  const c = await api('contacts/' + id);
  const d = $('#contactDrawer');
  $('#contactPanel').innerHTML = `
    <button class="x" data-close aria-label="Cerrar">×</button>
    <form class="stack" id="contactForm">
      <h1>${esc(c.name || 'Sin nombre')}</h1>
      <div class="two"><label>Nombre<input name="name" value="${esc(c.name)}"></label>
        <label>Etapa<select name="stage">${Object.entries(STAGES).map(([k, v]) => `<option value="${k}" ${k === c.stage ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
      <div class="two"><label>WhatsApp<input name="phone" value="${esc(c.phone)}"></label><label>Correo<input name="email" value="${esc(c.email)}"></label></div>
      <label>Etiquetas (separadas por coma)<input name="tags" value="${esc(c.tags.join(', '))}"></label>
      <label>Notas privadas<textarea name="notes" rows="3" placeholder="Talla, gustos, fechas importantes…">${esc(c.notes)}</textarea></label>
      <label style="display:flex;align-items:center;gap:8px;color:var(--ink)"><input type="checkbox" name="marketingConsent" ${c.marketingConsent ? 'checked' : ''}> Acepta recibir novedades (el bot solo escribe a quien acepta)</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn">Guardar</button>
        ${c.phone ? `<a class="btn ghost" href="${waLink(c.phone)}" target="_blank" rel="noopener">WhatsApp ↗</a>` : ''}
        ${c.email ? `<a class="btn ghost" href="mailto:${esc(c.email)}">Correo ↗</a>` : ''}
        <button type="button" class="btn ghost danger" id="delContact" style="margin-left:auto">Eliminar</button>
      </div>
    </form>
    <div class="stack">
      <h2>Actividad</h2>
      <div class="note-row"><input id="noteText" placeholder="Agregar una nota…"><button class="btn small" id="addNote">Agregar</button></div>
      <ul class="timeline">${c.activities.map((a) => `<li class="${a.meta?.by === 'bot' ? 'bot' : ''}">${esc(a.summary)}<small>${a.meta?.by === 'bot' ? 'Bot · ' : ''}${when(a.at)}</small></li>`).join('') || '<li class="muted">Sin actividad</li>'}</ul>
    </div>`;
  d.hidden = false;
  $('#contactForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    await api('contacts/' + id, { method: 'PATCH', body: {
      name: f.name.value, stage: f.stage.value, phone: f.phone.value, email: f.email.value, notes: f.notes.value,
      tags: f.tags.value.split(','), marketingConsent: f.marketingConsent.checked,
    } });
    toast('Guardado');
    refreshActive();
  });
  $('#addNote').addEventListener('click', async () => {
    const t = $('#noteText').value.trim();
    if (!t) return;
    await api(`contacts/${id}/activities`, { method: 'POST', body: { type: 'note', summary: t } });
    openContact(id);
  });
  $('#delContact').addEventListener('click', async () => {
    if (!confirm('¿Eliminar este contacto y su historial?')) return;
    await api('contacts/' + id, { method: 'DELETE' });
    d.hidden = true;
    refreshActive();
  });
}
$('#contactDrawer').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) $('#contactDrawer').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#contactDrawer').hidden = true; });

// ---------- productos ----------
let products = [];
async function loadProducts() {
  ({ products } = await api('products'));
  $('#prodGrid').innerHTML = products.map((p) => `
    <button class="prod" data-prod="${p.id}">
      <div class="im" style="background:${esc(p.tone || '#75645A')}">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<em>${esc(p.name.split(' ').pop()[0] || '')}</em>`}
        ${p.published === false ? '<span class="flag">Oculto</span>' : p.stock === 0 ? '<span class="flag">Agotado</span>' : !p.image ? '<span class="flag">Falta foto</span>' : ''}</div>
      <div class="meta"><b>${esc(p.name)}</b><small>${esc(p.category)} · ${p.price ? money(p.price) : p.rentPrice ? 'Renta ' + money(p.rentPrice) : 'Sin precio'} · ${p.stock ?? 0} u.</small></div>
    </button>`).join('');
}
$('#prodGrid').addEventListener('click', (e) => { const b = e.target.closest('[data-prod]'); if (b) editProduct(products.find((p) => p.id === b.dataset.prod)); });
$('#newProduct').addEventListener('click', () => editProduct(null));

const pm = $('#productModal');
let editing = null;
function editProduct(p) {
  editing = p;
  const f = $('#productForm');
  f.reset();
  $('#pmTitle').textContent = p ? p.name : 'Nueva prenda';
  const v = p || { name: '', category: 'Bikinis', price: 0, rentPrice: 0, stock: 0, sizes: ['S', 'M', 'L'], colors: [], modes: ['venta', 'mayoreo'], published: true, image: '' };
  for (const k of ['name', 'category', 'badge', 'description', 'price', 'rentPrice', 'stock', 'image']) f[k].value = v[k] ?? '';
  f.sizes.value = (v.sizes || []).join(', ');
  f.colors.value = (v.colors || []).join(', ');
  for (const m of ['venta', 'renta', 'mayoreo']) f['m_' + m].checked = (v.modes || []).includes(m);
  f.published.checked = v.published !== false;
  setPreview($('#pmPrev'), v.image, v.tone);
  $('#pmDelete').hidden = !p;
  pm.showModal();
}
function setPreview(el, url, tone) {
  el.style.background = tone || '';
  el.innerHTML = url ? `<img src="${esc(url)}" alt="">` : 'J';
}
async function upload(file) {
  if (!file) return '';
  // Resize big phone photos in the browser before upload.
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(img.width, img.height));
  const cv = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  const { url } = await api('uploads', { method: 'POST', body: { dataUrl: cv.toDataURL('image/jpeg', 0.86) } });
  return url;
}
$('#pmFile').addEventListener('change', async (e) => {
  toast('Subiendo foto…');
  const url = await upload(e.target.files[0]);
  $('#productForm').image.value = url;
  setPreview($('#pmPrev'), url);
  toast('Foto lista');
});
$('#productForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    name: f.name.value, category: f.category.value, badge: f.badge.value, description: f.description.value,
    price: f.price.value, rentPrice: f.rentPrice.value, stock: f.stock.value, image: f.image.value,
    sizes: f.sizes.value.split(',').map((s) => s.trim()), colors: f.colors.value.split(',').map((s) => s.trim()),
    modes: ['venta', 'renta', 'mayoreo'].filter((m) => f['m_' + m].checked), published: f.published.checked,
  };
  await api(editing ? 'products/' + editing.id : 'products', { method: editing ? 'PATCH' : 'POST', body });
  pm.close();
  toast('Guardado');
  loadProducts();
});
$('#pmDelete').addEventListener('click', async () => {
  if (!editing || !confirm(`¿Eliminar ${editing.name}?`)) return;
  await api('products/' + editing.id, { method: 'DELETE' });
  pm.close();
  loadProducts();
});
$$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); }));

// ---------- campañas ----------
let campaigns = [];
async function loadCampaigns() {
  ({ campaigns } = await api('campaigns'));
  $('#camps').innerHTML = campaigns.map((c) => `
    <article class="card camp">
      <div>
        <h3>${esc(c.name)}</h3>
        <small class="muted">${esc(c.channel)} · ${c.audience?.tag ? 'etiqueta “' + esc(c.audience.tag) + '”' : 'todo el Club'} · ${c.createdBy === 'bot' ? 'propuesta por el bot' : 'creada por ti'} · ${when(c.createdAt)}</small>
        ${c.subject ? `<p style="margin:10px 0 0"><b>${esc(c.subject)}</b></p>` : ''}
        <pre>${esc(c.body)}</pre>
      </div>
      <div class="acts">
        <span class="cstatus ${c.status}">${c.status}</span>
        ${c.status === 'borrador' ? `<button class="btn small" data-approve="${c.id}">Aprobar</button>` : ''}
        <button class="btn small ghost" data-aud="${c.id}">Audiencia</button>
        <button class="btn small ghost" data-edit="${c.id}">Editar</button>
        <button class="btn small ghost danger" data-del="${c.id}">×</button>
      </div>
    </article>`).join('') || '<div class="card empty">Cuando conectes el bot, sus propuestas de campaña aparecerán aquí para que las apruebes.</div>';
}
$('#camps').addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.approve) { await api('campaigns/' + t.dataset.approve, { method: 'PATCH', body: { status: 'aprobada' } }); toast('Aprobada: el bot ya puede enviarla'); loadCampaigns(); }
  if (t.dataset.del && confirm('¿Eliminar campaña?')) { await api('campaigns/' + t.dataset.del, { method: 'DELETE' }); loadCampaigns(); }
  if (t.dataset.aud) { const { contacts } = await api(`campaigns/${t.dataset.aud}/audience`); toast(`${contacts.length} personas recibirían esta campaña`); }
  if (t.dataset.edit) editCampaign(campaigns.find((c) => c.id === t.dataset.edit));
});
let editingCamp = null;
function editCampaign(c) {
  editingCamp = c;
  const f = $('#campForm');
  f.reset();
  if (c) { f.name.value = c.name; f.channel.value = c.channel; f.tag.value = c.audience?.tag || ''; f.subject.value = c.subject; f.body.value = c.body; }
  $('#campModal').showModal();
}
$('#newCampaign').addEventListener('click', () => editCampaign(null));
$('#campForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = { name: f.name.value, channel: f.channel.value, audience: { tag: f.tag.value.trim().toLowerCase() }, subject: f.subject.value, body: f.body.value };
  await api(editingCamp ? 'campaigns/' + editingCamp.id : 'campaigns', { method: editingCamp ? 'PATCH' : 'POST', body });
  $('#campModal').close();
  loadCampaigns();
});

// ---------- ajustes ----------
async function loadSettings() {
  const s = await api('settings');
  const f = $('#settingsForm');
  f.whatsapp.value = s.whatsapp || '';
  f.instagram.value = s.instagram || '';
  f.heroImage.value = s.heroImage || '';
  setPreview($('#heroPrev'), s.heroImage || '/img/arena.jpg');
  const st = $('#botStatus');
  st.className = 'status ' + (s.botEnabled ? 'on' : 'off');
  st.textContent = s.botEnabled
    ? `API del bot activa${s.webhook ? ' · avisos en tiempo real activados' : ''}`
    : 'API del bot apagada: configura BOT_API_KEY en el servidor para activarla.';
}
$('#heroFile').addEventListener('change', async (e) => {
  toast('Subiendo foto…');
  const url = await upload(e.target.files[0]);
  $('#settingsForm').heroImage.value = url;
  setPreview($('#heroPrev'), url);
  toast('Foto lista, recuerda guardar');
});
$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  await api('settings', { method: 'PATCH', body: { whatsapp: f.whatsapp.value, instagram: f.instagram.value, heroImage: f.heroImage.value } });
  $('#settingsMsg').textContent = 'Guardado ✓';
  setTimeout(() => ($('#settingsMsg').textContent = ''), 2000);
});

// ---------- boot ----------
function refreshActive() {
  const tab = $('#tabs [aria-current]')?.dataset.tab || 'resumen';
  loaders[tab]();
}
async function boot() {
  const r = await fetch('/api/admin/stats');
  if (r.status === 401) return showLogin();
  $('#login').hidden = true;
  $('#app').hidden = false;
  let tab = 'resumen';
  try { tab = sessionStorage.getItem('janda_tab') || tab; } catch { /* ignore */ }
  go(loaders[tab] ? tab : 'resumen');
}
boot();
