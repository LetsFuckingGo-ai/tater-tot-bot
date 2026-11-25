'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'janda-'));
process.env.ADMIN_PASSWORD = 'secret';
process.env.BOT_API_KEY = 'bot-key';
const { server } = require('../server.js');

let base, cookie;
before(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const req = (p, { method = 'GET', body, headers = {} } = {}) =>
  fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) });

test('storefront lists seeded products and serves pages', async () => {
  const r = await req('/api/products');
  const { products } = await r.json();
  assert.ok(products.length >= 6);
  assert.equal((await req('/')).status, 200);
  assert.equal((await req('/admin')).status, 200);
  assert.equal((await req('/../server.js')).status, 404);
});

test('an order creates a contact and an inquiry with totals', async () => {
  const { products } = await (await req('/api/products')).json();
  const p = products.find((x) => x.price > 0);
  const r = await req('/api/inquiries', { method: 'POST', body: { type: 'pedido', name: 'Ana', phone: '+57 300 111 2222', items: [{ id: p.id, size: 'M', qty: 2 }] } });
  assert.equal(r.status, 201);
  assert.equal((await req('/api/inquiries', { method: 'POST', body: { type: 'renta', message: 'hola' } })).status, 400);
});

test('admin routes require login', async () => {
  assert.equal((await req('/api/admin/contacts')).status, 401);
  assert.equal((await req('/api/admin/login', { method: 'POST', body: { password: 'nope' } })).status, 401);
  const r = await req('/api/admin/login', { method: 'POST', body: { password: 'secret' } });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  const { contacts } = await (await req('/api/admin/contacts', { headers: { cookie } })).json();
  assert.equal(contacts[0].name, 'Ana');
  const { inquiries } = await (await req('/api/admin/inquiries', { headers: { cookie } })).json();
  assert.equal(inquiries[0].items[0].qty, 2);
  assert.ok(inquiries[0].total > 0);
});

test('bot only sees consenting contacts it asks for and cannot approve campaigns', async () => {
  assert.equal((await req('/api/bot/contacts')).status, 401);
  const auth = { authorization: 'Bearer bot-key' };
  await req('/api/subscribe', { method: 'POST', body: { email: 'Luz@Mail.com' } });
  const { contacts } = await (await req('/api/bot/contacts?consent=true', { headers: auth })).json();
  assert.deepEqual(contacts.map((c) => c.email), ['luz@mail.com']);

  const a = await req(`/api/bot/contacts/${contacts[0].id}/activities`, { method: 'POST', headers: auth, body: { type: 'email', summary: 'Envió bienvenida' } });
  assert.equal(a.status, 201);

  const camp = await (await req('/api/bot/campaigns', { method: 'POST', headers: auth, body: { name: 'Lanzamiento', body: 'Hola' } })).json();
  assert.equal(camp.status, 'borrador');
  assert.equal((await req('/api/bot/campaigns/' + camp.id, { method: 'PATCH', headers: auth, body: { status: 'aprobada' } })).status, 403);
  assert.equal((await req('/api/admin/campaigns/' + camp.id, { method: 'PATCH', headers: { cookie }, body: { status: 'aprobada' } })).status, 200);
  const sent = await (await req('/api/bot/campaigns/' + camp.id, { method: 'PATCH', headers: auth, body: { status: 'enviada' } })).json();
  assert.equal(sent.status, 'enviada');
  assert.equal((await req('/api/bot/products', { method: 'POST', headers: auth, body: {} })).status, 404);
});
