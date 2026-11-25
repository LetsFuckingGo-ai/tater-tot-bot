// Janda — storefront + CRM + bot API. Zero dependencies: `node server.js`.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOADS = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const BOT_API_KEY = process.env.BOT_API_KEY || '';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const MAX_BODY = 8 * 1024 * 1024; // 8 MB, enough for a phone photo

fs.mkdirSync(UPLOADS, { recursive: true });

// ---------- storage ----------
const STAGES = ['nuevo', 'en_conversacion', 'cliente', 'perdido'];
const INQUIRY_STATUS = ['nuevo', 'respondido', 'cerrado', 'perdido'];
const INQUIRY_TYPES = ['pedido', 'venta', 'renta', 'mayoreo', 'contacto'];

function seed() {
  return {
    settings: {
      whatsapp: process.env.WHATSAPP_NUMBER || '',
      instagram: 'janda.clothing',
      currency: 'COP',
    },
    products: require('./seed-products.json').map((p) => ({ ...p, id: id(), createdAt: now() })),
    contacts: [],
    inquiries: [],
    activities: [],
    campaigns: [],
  };
}

let saveTimer = null;
let db;
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch {
  db = seed();
  save();
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }, 50);
}

function id() {
  return crypto.randomBytes(6).toString('hex');
}
function now() {
  return new Date().toISOString();
}
function clean(v, max = 500) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function normEmail(v) {
  const e = clean(v, 200).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : '';
}
function normPhone(v) {
  const p = clean(v, 40).replace(/[^\d+]/g, '');
  return p.length >= 7 ? p : '';
}

// Find or create a contact by email/phone, merging new info in.
function upsertContact({ name, email, phone, source, tags = [], consent }) {
  email = normEmail(email);
  phone = normPhone(phone);
  if (!email && !phone) return null;
  let c = db.contacts.find((x) => (email && x.email === email) || (phone && x.phone === phone));
  if (!c) {
    c = { id: id(), name: '', email: '', phone: '', stage: 'nuevo', tags: [], source, notes: '', marketingConsent: false, createdAt: now(), lastActivityAt: now() };
    db.contacts.unshift(c);
  }
  if (name && !c.name) c.name = clean(name, 120);
  if (email && !c.email) c.email = email;
  if (phone && !c.phone) c.phone = phone;
  if (consent) c.marketingConsent = true;
  for (const t of tags) if (t && !c.tags.includes(t)) c.tags.push(t);
  c.lastActivityAt = now();
  return c;
}

function logActivity(contactId, type, summary, meta = {}) {
  const a = { id: id(), contactId, type, summary: clean(summary, 1000), meta, at: now() };
  db.activities.unshift(a);
  if (db.activities.length > 5000) db.activities.length = 5000;
  return a;
}

function emit(event, payload) {
  if (!WEBHOOK_URL) return;
  fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event, at: now(), data: payload }),
  }).catch((err) => console.warn('webhook failed:', err.message));
}

// ---------- auth ----------
const sessions = new Map(); // token -> expiry
function adminOk(req) {
  const token = parseCookies(req).janda_admin;
  const exp = token && sessions.get(token);
  return Boolean(exp && exp > Date.now());
}
function botOk(req) {
  const h = req.headers.authorization || '';
  const key = h.startsWith('Bearer ') ? h.slice(7) : '';
  return Boolean(BOT_API_KEY && key && safeEqual(key, BOT_API_KEY));
}
function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Simple per-IP rate limit for public forms.
const hits = new Map();
function rateLimited(req, limit = 20) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const minute = Math.floor(Date.now() / 60000);
  const key = ip + ':' + minute;
  const n = (hits.get(key) || 0) + 1;
  hits.set(key, n);
  if (hits.size > 10000) hits.clear();
  return n > limit;
}

// ---------- http helpers ----------
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'content-type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Archivo demasiado grande'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON inválido'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
function serveFile(res, base, rel) {
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep) && file !== base) return send(res, 404, 'No encontrado');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'No encontrado');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- public API ----------
function publicProduct(p) {
  const { id, name, category, price, rentPrice, description, colors, sizes, image, tone, badge, modes, stock } = p;
  return { id, name, category, price, rentPrice, description, colors, sizes, image, tone, badge, modes, soldOut: stock === 0 };
}

async function handleInquiry(req, res) {
  if (rateLimited(req, 10)) return send(res, 429, { error: 'Demasiados intentos, intenta en un minuto.' });
  const b = await readBody(req);
  if (b.website) return send(res, 200, { ok: true }); // honeypot
  const type = INQUIRY_TYPES.includes(b.type) ? b.type : 'contacto';
  const contact = upsertContact({ name: b.name, email: b.email, phone: b.phone, source: 'web:' + type, tags: [type], consent: b.consent === true });
  if (!contact) return send(res, 400, { error: 'Déjanos un correo o WhatsApp para responderte.' });
  const items = Array.isArray(b.items)
    ? b.items.slice(0, 30).map((it) => {
        const p = db.products.find((x) => x.id === it.id);
        return p ? { productId: p.id, name: p.name, size: clean(it.size, 10), qty: Math.max(1, Math.min(99, Number(it.qty) || 1)), price: p.price } : null;
      }).filter(Boolean)
    : [];
  const inquiry = {
    id: id(), contactId: contact.id, type, status: 'nuevo', message: clean(b.message, 2000),
    items, total: items.reduce((s, it) => s + (it.price || 0) * it.qty, 0),
    eventDate: clean(b.eventDate, 20), createdAt: now(),
  };
  db.inquiries.unshift(inquiry);
  logActivity(contact.id, 'inquiry', `Nueva solicitud (${type})${inquiry.message ? ': ' + inquiry.message.slice(0, 140) : ''}`, { inquiryId: inquiry.id });
  save();
  emit('inquiry.created', { inquiry, contact });
  send(res, 201, { ok: true, id: inquiry.id });
}

async function handleSubscribe(req, res) {
  if (rateLimited(req, 10)) return send(res, 429, { error: 'Demasiados intentos, intenta en un minuto.' });
  const b = await readBody(req);
  if (b.website) return send(res, 200, { ok: true });
  const contact = upsertContact({ email: b.email, name: b.name, source: 'web:newsletter', tags: ['newsletter'], consent: true });
  if (!contact) return send(res, 400, { error: 'Revisa tu correo.' });
  logActivity(contact.id, 'subscribe', 'Se suscribió al Club Janda');
  save();
  emit('contact.subscribed', { contact });
  send(res, 201, { ok: true });
}

// ---------- admin + bot API ----------
function contactView(c) {
  return { ...c, inquiries: db.inquiries.filter((i) => i.contactId === c.id).length };
}

function filterContacts(q) {
  let list = db.contacts;
  const term = (q.get('q') || '').toLowerCase();
  if (term) list = list.filter((c) => [c.name, c.email, c.phone, c.notes, c.tags.join(' ')].join(' ').toLowerCase().includes(term));
  if (q.get('tag')) list = list.filter((c) => c.tags.includes(q.get('tag')));
  if (q.get('stage')) list = list.filter((c) => c.stage === q.get('stage'));
  if (q.get('consent') === 'true') list = list.filter((c) => c.marketingConsent);
  if (q.get('since')) list = list.filter((c) => c.createdAt >= q.get('since'));
  return list;
}

function patchContact(c, b) {
  if (typeof b.name === 'string') c.name = clean(b.name, 120);
  if (typeof b.email === 'string') c.email = normEmail(b.email) || c.email;
  if (typeof b.phone === 'string') c.phone = normPhone(b.phone) || c.phone;
  if (typeof b.notes === 'string') c.notes = clean(b.notes, 5000);
  if (STAGES.includes(b.stage)) c.stage = b.stage;
  if (Array.isArray(b.tags)) c.tags = [...new Set(b.tags.map((t) => clean(t, 40).toLowerCase()).filter(Boolean))];
  if (typeof b.marketingConsent === 'boolean') c.marketingConsent = b.marketingConsent;
  c.lastActivityAt = now();
}

function patchProduct(p, b) {
  for (const k of ['name', 'category', 'description', 'badge', 'image', 'tone']) if (typeof b[k] === 'string') p[k] = clean(b[k], k === 'description' ? 1000 : 300);
  for (const k of ['price', 'rentPrice', 'stock']) if (b[k] !== undefined) p[k] = Math.max(0, Number(b[k]) || 0);
  for (const k of ['colors', 'sizes', 'modes']) if (Array.isArray(b[k])) p[k] = b[k].map((x) => clean(String(x), 40)).filter(Boolean);
  if (typeof b.published === 'boolean') p.published = b.published;
}

function stats() {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const open = db.inquiries.filter((i) => i.status === 'nuevo');
  return {
    contacts: db.contacts.length,
    newContacts30d: db.contacts.filter((c) => c.createdAt >= since).length,
    subscribers: db.contacts.filter((c) => c.marketingConsent).length,
    openInquiries: open.length,
    pipelineValue: open.reduce((s, i) => s + (i.total || 0), 0),
    byType: INQUIRY_TYPES.map((t) => ({ type: t, count: db.inquiries.filter((i) => i.type === t).length })),
    customers: db.contacts.filter((c) => c.stage === 'cliente').length,
  };
}

function toCsv(rows) {
  const cols = ['name', 'email', 'phone', 'stage', 'tags', 'marketingConsent', 'source', 'createdAt'];
  const esc = (v) => '"' + String(Array.isArray(v) ? v.join('|') : v ?? '').replace(/"/g, '""') + '"';
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

async function saveUpload(b) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(b.dataUrl || '');
  if (!m) throw Object.assign(new Error('Sube una imagen JPG, PNG o WEBP'), { status: 400 });
  const name = id() + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
  await fs.promises.writeFile(path.join(UPLOADS, name), Buffer.from(m[2], 'base64'));
  return '/uploads/' + name;
}

// Routes shared by admin (cookie) and bot (Bearer key).
async function crmRoutes(req, res, url, parts, actor) {
  const [resource, rid, sub] = parts;
  const m = req.method;

  if (resource === 'stats' && m === 'GET') return send(res, 200, stats());

  if (resource === 'contacts') {
    if (!rid && m === 'GET') {
      const list = filterContacts(url.searchParams);
      if (url.searchParams.get('format') === 'csv')
        return send(res, 200, toCsv(list), { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="janda-contactos.csv"' });
      return send(res, 200, { contacts: list.slice(0, 1000).map(contactView), total: list.length });
    }
    if (!rid && m === 'POST') {
      const b = await readBody(req);
      const c = upsertContact({ ...b, source: b.source || actor, consent: b.marketingConsent === true });
      if (!c) return send(res, 400, { error: 'Necesita correo o teléfono' });
      patchContact(c, b);
      logActivity(c.id, 'note', `Contacto creado por ${actor}`);
      save();
      return send(res, 201, c);
    }
    const c = db.contacts.find((x) => x.id === rid);
    if (!c) return send(res, 404, { error: 'Contacto no encontrado' });
    if (!sub && m === 'GET')
      return send(res, 200, { ...c, inquiries: db.inquiries.filter((i) => i.contactId === c.id), activities: db.activities.filter((a) => a.contactId === c.id).slice(0, 200) });
    if (!sub && m === 'PATCH') {
      patchContact(c, await readBody(req));
      save();
      return send(res, 200, c);
    }
    if (!sub && m === 'DELETE' && actor === 'admin') {
      db.contacts = db.contacts.filter((x) => x.id !== c.id);
      db.inquiries = db.inquiries.filter((x) => x.contactId !== c.id);
      db.activities = db.activities.filter((x) => x.contactId !== c.id);
      save();
      return send(res, 200, { ok: true });
    }
    if (sub === 'activities' && m === 'POST') {
      const b = await readBody(req);
      const type = ['note', 'message', 'email', 'whatsapp', 'call', 'campaign'].includes(b.type) ? b.type : 'note';
      const a = logActivity(c.id, type, b.summary, { by: actor, channel: clean(b.channel, 40) });
      c.lastActivityAt = now();
      save();
      return send(res, 201, a);
    }
  }

  if (resource === 'inquiries') {
    if (!rid && m === 'GET') {
      let list = db.inquiries;
      const s = url.searchParams.get('status');
      if (s) list = list.filter((i) => i.status === s);
      return send(res, 200, { inquiries: list.slice(0, 500).map((i) => ({ ...i, contact: db.contacts.find((c) => c.id === i.contactId) || null })) });
    }
    const i = db.inquiries.find((x) => x.id === rid);
    if (!i) return send(res, 404, { error: 'Solicitud no encontrada' });
    if (m === 'PATCH') {
      const b = await readBody(req);
      if (INQUIRY_STATUS.includes(b.status) && b.status !== i.status) {
        i.status = b.status;
        logActivity(i.contactId, 'status', `Solicitud ${i.type} → ${b.status}`, { by: actor });
        const c = db.contacts.find((x) => x.id === i.contactId);
        if (c && b.status === 'cerrado') c.stage = 'cliente';
        if (c && b.status === 'respondido' && c.stage === 'nuevo') c.stage = 'en_conversacion';
      }
      save();
      return send(res, 200, i);
    }
  }

  if (resource === 'products') {
    if (!rid && m === 'GET') return send(res, 200, { products: db.products });
    if (!rid && m === 'POST' && actor === 'admin') {
      const p = { id: id(), name: 'Nueva prenda', category: 'Bikinis', price: 0, rentPrice: 0, description: '', colors: [], sizes: ['S', 'M', 'L'], modes: ['venta'], image: '', badge: '', stock: 0, published: false, createdAt: now() };
      patchProduct(p, await readBody(req));
      db.products.unshift(p);
      save();
      return send(res, 201, p);
    }
    const p = db.products.find((x) => x.id === rid);
    if (!p) return send(res, 404, { error: 'Producto no encontrado' });
    if (m === 'PATCH' && actor === 'admin') {
      patchProduct(p, await readBody(req));
      save();
      return send(res, 200, p);
    }
    if (m === 'DELETE' && actor === 'admin') {
      db.products = db.products.filter((x) => x.id !== p.id);
      save();
      return send(res, 200, { ok: true });
    }
  }

  if (resource === 'campaigns') {
    if (!rid && m === 'GET') return send(res, 200, { campaigns: db.campaigns });
    if (!rid && m === 'POST') {
      const b = await readBody(req);
      const c = {
        id: id(), name: clean(b.name, 120) || 'Campaña', channel: ['email', 'whatsapp', 'instagram'].includes(b.channel) ? b.channel : 'email',
        audience: { tag: clean(b.audience?.tag, 40), stage: STAGES.includes(b.audience?.stage) ? b.audience.stage : '' },
        subject: clean(b.subject, 200), body: clean(b.body, 5000), status: 'borrador', createdBy: actor, createdAt: now(),
      };
      db.campaigns.unshift(c);
      save();
      return send(res, 201, c);
    }
    const c = db.campaigns.find((x) => x.id === rid);
    if (!c) return send(res, 404, { error: 'Campaña no encontrada' });
    if (sub === 'audience' && m === 'GET') {
      const q = new URLSearchParams({ consent: 'true', ...(c.audience.tag && { tag: c.audience.tag }), ...(c.audience.stage && { stage: c.audience.stage }) });
      return send(res, 200, { contacts: filterContacts(q) });
    }
    if (m === 'PATCH') {
      const b = await readBody(req);
      for (const k of ['name', 'subject', 'body']) if (typeof b[k] === 'string') c[k] = clean(b[k], k === 'body' ? 5000 : 200);
      if (['email', 'whatsapp', 'instagram'].includes(b.channel)) c.channel = b.channel;
      if (b.audience && typeof b.audience === 'object') c.audience = { tag: clean(b.audience.tag, 40), stage: STAGES.includes(b.audience.stage) ? b.audience.stage : '' };
      // Any edit by the bot sends an approved campaign back to draft, so Alba re-approves what goes out.
      if (actor === 'bot' && c.status === 'aprobada' && b.status !== 'enviada') c.status = 'borrador';
      if (['borrador', 'aprobada', 'enviada'].includes(b.status)) {
        // Only Alba approves; the bot may only mark an approved campaign as sent.
        if (actor === 'admin' || (b.status === 'enviada' && c.status === 'aprobada')) c.status = b.status;
        else return send(res, 403, { error: 'Solo la dueña puede aprobar campañas' });
      }
      save();
      return send(res, 200, c);
    }
    if (m === 'DELETE' && actor === 'admin') {
      db.campaigns = db.campaigns.filter((x) => x.id !== c.id);
      save();
      return send(res, 200, { ok: true });
    }
  }

  if (resource === 'settings' && actor === 'admin') {
    if (m === 'GET') return send(res, 200, { ...db.settings, botEnabled: Boolean(BOT_API_KEY), webhook: Boolean(WEBHOOK_URL) });
    if (m === 'PATCH') {
      const b = await readBody(req);
      if (typeof b.whatsapp === 'string') db.settings.whatsapp = b.whatsapp.replace(/[^\d]/g, '').slice(0, 20);
      if (typeof b.instagram === 'string') db.settings.instagram = clean(b.instagram, 60).replace(/^@/, '');
      if (typeof b.heroImage === 'string') db.settings.heroImage = clean(b.heroImage, 300);
      save();
      return send(res, 200, db.settings);
    }
  }

  if (resource === 'uploads' && m === 'POST' && actor === 'admin') return send(res, 201, { url: await saveUpload(await readBody(req)) });

  send(res, 404, { error: 'Ruta no encontrada' });
}

// ---------- router ----------
async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/api/products' && req.method === 'GET')
    return send(res, 200, { products: db.products.filter((x) => x.published !== false).map(publicProduct), settings: { whatsapp: db.settings.whatsapp, instagram: db.settings.instagram, heroImage: db.settings.heroImage || '' } });
  if (p === '/api/inquiries' && req.method === 'POST') return handleInquiry(req, res);
  if (p === '/api/subscribe' && req.method === 'POST') return handleSubscribe(req, res);

  if (p === '/api/admin/login' && req.method === 'POST') {
    if (rateLimited(req, 8)) return send(res, 429, { error: 'Demasiados intentos' });
    const b = await readBody(req);
    if (!ADMIN_PASSWORD) return send(res, 503, { error: 'Falta configurar ADMIN_PASSWORD en el servidor' });
    if (!safeEqual(String(b.password || ''), ADMIN_PASSWORD)) return send(res, 401, { error: 'Contraseña incorrecta' });
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, Date.now() + 30 * 864e5);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(res, 200, { ok: true }, { 'set-cookie': `janda_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86400}${secure}` });
  }
  if (p === '/api/admin/logout') {
    sessions.delete(parseCookies(req).janda_admin);
    return send(res, 200, { ok: true }, { 'set-cookie': 'janda_admin=; Path=/; Max-Age=0' });
  }
  if (p.startsWith('/api/admin/')) {
    if (!adminOk(req)) return send(res, 401, { error: 'Inicia sesión' });
    return crmRoutes(req, res, url, p.slice(11).split('/').filter(Boolean), 'admin');
  }
  if (p.startsWith('/api/bot/')) {
    if (!botOk(req)) return send(res, 401, { error: 'API key inválida o BOT_API_KEY sin configurar' });
    return crmRoutes(req, res, url, p.slice(9).split('/').filter(Boolean), 'bot');
  }

  if (p.startsWith('/uploads/')) return serveFile(res, UPLOADS, p.slice(9));
  if (p === '/admin' || p === '/admin/') return serveFile(res, PUBLIC, 'admin.html');
  if (p === '/') return serveFile(res, PUBLIC, 'index.html');
  return serveFile(res, PUBLIC, p.slice(1));
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    if (!err.status) console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Error del servidor' });
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Janda → http://localhost:${PORT}   CRM → http://localhost:${PORT}/admin`);
    if (!ADMIN_PASSWORD) console.warn('⚠ ADMIN_PASSWORD no está configurado: el CRM no permitirá entrar.');
  });
}

module.exports = { server, flush: () => { clearTimeout(saveTimer); fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } };
