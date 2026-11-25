// اختبارات تكاملية لموديول المخزن.
// التشغيل:  MONGODB_URI=mongodb://127.0.0.1:27017/jasad_wh_test node --test server/tests/warehouse.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import mongoose from 'mongoose';

const PORT = 4101;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/jasad_wh_test';
const PASS = 'Test@12345';

let server;
const sessions = {};
const ids = {};
const { default: User } = await import('../models/User.js');
const { WarehouseItem, WarehouseRequest } = await import('../models/Warehouse.js');
const { hash } = await import('../utils/password.js');

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('server did not start');
}

async function login(email) {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: email, password: PASS }) });
  assert.equal(r.status, 200, `login ${email}`);
  return r.headers.get('set-cookie').split(';')[0];
}

const call = (who, path, { method = 'GET', body, headers = {} } = {}) =>
  fetch(`${BASE}/warehouse${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(who ? { Cookie: sessions[who] } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
const j = r => r.json();

before(async () => {
  await mongoose.connect(MONGO);
  await mongoose.connection.dropDatabase();
  server = spawn('node', ['server/index.js'], { env: { ...process.env, MONGODB_URI: MONGO, PORT: String(PORT), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', d => process.stderr.write(d));
  await waitForServer();

  const specs = {
    keeper: [['STOREKEEPER'], null], admin: [['ADMIN'], null],
    servantA: [['SERVANT'], 1], servantB: [['SERVANT'], 2], sup1: [['SUPERVISOR'], 1], nostage: [['SERVANT'], null]
  };
  for (const [key, [roles, stageId]] of Object.entries(specs)) {
    const u = await User.create({ fullName: `مستخدم ${key}`, email: `${key}@test.local`, passwordHash: hash(PASS), status: 'ACTIVE', roles, stageId });
    ids[key] = u._id.toString();
    sessions[key] = await login(`${key}@test.local`);
  }
});

after(async () => {
  server?.kill();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const S = {}; // sections
const I = {}; // items
const R = {}; // requests

test('1. خادم المخزن يضيف أقسام وأصناف (مع التحقق من المدخلات)', async () => {
  for (const name of ['أدوات كتابة', 'ملابس']) {
    const r = await call('keeper', '/sections', { method: 'POST', body: { name } });
    assert.equal(r.status, 201); S[name] = (await j(r)).data.section.id;
  }
  assert.equal((await call('keeper', '/sections', { method: 'POST', body: { name: 'أدوات كتابة' } })).status, 409, 'duplicate section');
  assert.equal((await call('keeper', '/sections', { method: 'POST', body: { name: '  ' } })).status, 400);

  const mk = async (name, sec, quantity, extra = {}) => {
    const r = await call('keeper', '/items', { method: 'POST', body: { name, sectionId: S[sec], quantity, unit: 'علبة', ...extra } });
    assert.equal(r.status, 201, await r.clone().text()); return (await j(r)).data.item;
  };
  I.pens = await mk('أقلام', 'أدوات كتابة', 10);
  I.paper = await mk('ورق A4', 'أدوات كتابة', 2);
  I.shirt = await mk('تيشرت', 'ملابس', 5);
  I.hidden = await mk('صنف مخفي', 'ملابس', 9, { active: false });
  assert.equal(I.pens.sectionName, 'أدوات كتابة');

  for (const bad of [{ name: 'x', sectionId: 'nope', quantity: 1 }, { name: 'x', sectionId: S['ملابس'], quantity: -1 }, { name: 'x', sectionId: S['ملابس'], quantity: 1.5 }, { name: '', sectionId: S['ملابس'], quantity: 1 }]) {
    assert.equal((await call('keeper', '/items', { method: 'POST', body: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call('keeper', '/items', { method: 'POST', body: { name: 'أقلام', sectionId: S['أدوات كتابة'], quantity: 1 } })).status, 409, 'duplicate item');
});

test('2. غير خادم المخزن لا يعدّل المخزن (خادم / أمين خدمة / أدمن)', async () => {
  for (const who of ['servantA', 'sup1', 'admin']) {
    assert.equal((await call(who, '/sections', { method: 'POST', body: { name: 'هاك' } })).status, 403, who);
    assert.equal((await call(who, '/items', { method: 'POST', body: { name: 'هاك', sectionId: S['ملابس'], quantity: 1 } })).status, 403, who);
    assert.equal((await call(who, `/items/${I.pens.id}`, { method: 'PATCH', body: { quantity: 999 } })).status, 403, who);
    assert.equal((await call(who, `/items/${I.pens.id}`, { method: 'DELETE' })).status, 403, who);
    assert.equal((await call(who, `/sections/${S['ملابس']}`, { method: 'DELETE' })).status, 403, who);
  }
  assert.equal((await call(null, '/items')).status, 401);
  assert.equal((await WarehouseItem.findById(I.pens.id)).quantity, 10);
});

test('3. الخادم يرى الأصناف المتاحة فقط مع الكميات', async () => {
  const r = await j(await call('servantA', '/items'));
  const names = r.data.items.map(i => i.name);
  assert.ok(names.includes('أقلام') && !names.includes('صنف مخفي'));
  assert.equal(r.data.items.find(i => i.name === 'أقلام').quantity, 10);
  const keeper = await j(await call('keeper', '/items'));
  assert.ok(keeper.data.items.some(i => i.name === 'صنف مخفي'), 'keeper sees inactive');
  const sec = await j(await call('servantA', '/sections'));
  assert.equal(sec.data.sections.find(s => s.name === 'ملابس').itemCount, 1, 'inactive not counted for servant');
  const filtered = await j(await call('servantA', `/items?sectionId=${S['ملابس']}`));
  assert.deepEqual(filtered.data.items.map(i => i.name), ['تيشرت']);
  const inj = await call('servantA', '/items?sectionId[$ne]=x');
  assert.ok([400, 200].includes(inj.status));
});

test('4. الخادم وأمين الخدمة يطلبون من المخزن (مع التحقق)', async () => {
  const ok = await call('servantA', '/requests', { method: 'POST', body: { items: [{ itemId: I.pens.id, quantity: 4 }, { itemId: I.shirt.id, quantity: 1 }], note: 'للاجتماع' } });
  assert.equal(ok.status, 201); R.a1 = (await j(ok)).data.request;
  assert.equal(R.a1.status, 'PENDING'); assert.equal(R.a1.stage.id, 1); assert.equal(R.a1.requester.role, 'SERVANT');
  assert.equal(R.a1.items.length, 2);

  const sup = await call('sup1', '/requests', { method: 'POST', body: { items: [{ itemId: I.paper.id, quantity: 5 }] } });
  assert.equal(sup.status, 201); R.sup = (await j(sup)).data.request; assert.equal(R.sup.requester.role, 'SUPERVISOR');

  const b = await call('servantB', '/requests', { method: 'POST', body: { items: [{ itemId: I.pens.id, quantity: 1 }] } });
  assert.equal(b.status, 201); R.b = (await j(b)).data.request; assert.equal(R.b.stage.id, 2);

  const bads = [
    [{ items: [] }, 400], [{}, 400],
    [{ items: [{ itemId: I.pens.id, quantity: 0 }] }, 400],
    [{ items: [{ itemId: I.pens.id, quantity: -2 }] }, 400],
    [{ items: [{ itemId: I.pens.id, quantity: 1.5 }] }, 400],
    [{ items: [{ itemId: I.pens.id, quantity: 1 }, { itemId: I.pens.id, quantity: 2 }] }, 400],
    [{ items: [{ itemId: I.hidden.id, quantity: 1 }] }, 400],
    [{ items: [{ itemId: 'bad', quantity: 1 }] }, 400],
    [{ items: [{ itemId: { $ne: null }, quantity: 1 }] }, 400]
  ];
  for (const [body, st] of bads) assert.equal((await call('servantA', '/requests', { method: 'POST', body })).status, st, JSON.stringify(body));
  assert.equal((await call('nostage', '/requests', { method: 'POST', body: { items: [{ itemId: I.pens.id, quantity: 1 }] } })).status, 403, 'no stage');
  assert.equal((await call('keeper', '/requests', { method: 'POST', body: { items: [{ itemId: I.pens.id, quantity: 1 }] } })).status, 403, 'keeper cannot request');
  assert.equal((await call('admin', '/requests', { method: 'POST', body: { items: [{ itemId: I.pens.id, quantity: 1 }] } })).status, 403, 'admin cannot request');
  assert.equal((await WarehouseItem.findById(I.pens.id)).quantity, 10, 'no deduction on request');
});

test('5. من يرى الطلبات: الخادم طلباته فقط، خادم المخزن والأدمن كل المراحل', async () => {
  const a = await j(await call('servantA', '/requests'));
  assert.deepEqual(a.data.items.map(r => r.id), [R.a1.id]);
  assert.equal(a.data.items[0].canCancel, true); assert.equal(a.data.items[0].canReview, false);

  for (const who of ['keeper', 'admin']) {
    const all = await j(await call(who, '/requests'));
    assert.equal(all.data.total, 3, who);
    assert.deepEqual([...new Set(all.data.items.map(r => r.stage.id))].sort(), [1, 2]);
  }
  const k = await j(await call('keeper', '/requests?status=PENDING&stageId=2'));
  assert.equal(k.data.total, 1);
  assert.equal((await j(await call('keeper', '/requests'))).data.pending, 3);

  // IDOR: خادم آخر لا يصل لطلب غيره
  assert.equal((await call('servantB', `/requests/${R.a1.id}`)).status, 404);
  assert.equal((await call('sup1', `/requests/${R.a1.id}`)).status, 404, 'supervisor sees only own requests');
  assert.equal((await call('servantA', `/requests/${R.b.id}`)).status, 404);
  assert.equal((await call('keeper', `/requests/${R.a1.id}`)).status, 200);
  assert.equal((await call('servantA', '/requests?status[$ne]=x')).status, 200 || 400);
  assert.equal((await call('servantA', '/requests?status=HACK')).status, 400);
});

test('6. القبول يخصم الكمية ويظهر التعليق للخادم', async () => {
  const r = await call('keeper', `/requests/${R.a1.id}/approve`, { method: 'POST', body: { comment: 'تعال خدهم من المخزن الأحد' } });
  assert.equal(r.status, 200);
  const d = (await j(r)).data.request;
  assert.equal(d.status, 'APPROVED'); assert.equal(d.review.comment, 'تعال خدهم من المخزن الأحد'); assert.equal(d.review.by, 'مستخدم keeper');
  assert.equal((await WarehouseItem.findById(I.pens.id)).quantity, 6);
  assert.equal((await WarehouseItem.findById(I.shirt.id)).quantity, 4);

  const mine = await j(await call('servantA', '/requests'));
  assert.equal(mine.data.items[0].status, 'APPROVED');
  assert.equal(mine.data.items[0].review.comment, 'تعال خدهم من المخزن الأحد');
  assert.equal(mine.data.items[0].canCancel, false);

  assert.equal((await call('keeper', `/requests/${R.a1.id}/approve`, { method: 'POST', body: {} })).status, 409, 'cannot approve twice');
  assert.equal((await WarehouseItem.findById(I.pens.id)).quantity, 6, 'no double deduction');
});

test('7. نقص الكمية: لا يتم أي خصم جزئي ويرجع 409', async () => {
  const mixed = await call('servantB', '/requests', { method: 'POST', body: { items: [{ itemId: I.pens.id, quantity: 2 }, { itemId: I.paper.id, quantity: 50 }] } });
  const id = (await j(mixed)).data.request.id;
  const r = await call('keeper', `/requests/${id}/approve`, { method: 'POST', body: {} });
  assert.equal(r.status, 409); assert.equal((await j(r)).code, 'INSUFFICIENT_STOCK');
  assert.equal((await WarehouseItem.findById(I.pens.id)).quantity, 6, 'first line rolled back');
  assert.equal((await WarehouseItem.findById(I.paper.id)).quantity, 2);
  assert.equal((await WarehouseRequest.findById(id)).status, 'PENDING');
  // الرفض مع تعليق يظهر للخادم
  // الرفض بدون تعليق مسموح، ثم طلب جديد لاختبار ظهور التعليق للخادم
  assert.equal((await call('keeper', `/requests/${id}/reject`, { method: 'POST', body: {} })).status, 200, 'comment is optional');
  const id2 = (await j(await call('servantB', '/requests', { method: 'POST', body: { items: [{ itemId: I.pens.id, quantity: 1 }] } }))).data.request.id;
  const rej = await call('keeper', `/requests/${id2}/reject`, { method: 'POST', body: { comment: 'الكمية مش متاحة، اطلب أقل' } });
  assert.equal(rej.status, 200); assert.equal((await j(rej)).data.request.status, 'REJECTED');
  const mine = await j(await call('servantB', '/requests'));
  assert.equal(mine.data.items.find(x => x.id === id2).review.comment, 'الكمية مش متاحة، اطلب أقل');
});

test('8. الخادم / أمين الخدمة / الأدمن لا يراجعون الطلبات', async () => {
  for (const who of ['servantA', 'servantB', 'sup1', 'admin']) {
    assert.equal((await call(who, `/requests/${R.sup.id}/approve`, { method: 'POST', body: {} })).status, 403, who);
    assert.equal((await call(who, `/requests/${R.sup.id}/reject`, { method: 'POST', body: { comment: 'x' } })).status, 403, who);
  }
  assert.equal((await WarehouseRequest.findById(R.sup.id)).status, 'PENDING');
});

test('9. إلغاء الطلب: صاحبه فقط وطالما لم يُراجع', async () => {
  assert.equal((await call('servantB', `/requests/${R.sup.id}`, { method: 'DELETE' })).status, 404, 'other servant');
  assert.equal((await call('keeper', `/requests/${R.sup.id}`, { method: 'DELETE' })).status, 404, 'keeper not owner');
  assert.equal((await call('sup1', `/requests/${R.sup.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call('sup1', `/requests/${R.sup.id}`, { method: 'DELETE' })).status, 404, 'already cancelled');
  assert.equal((await call('servantA', `/requests/${R.a1.id}`, { method: 'DELETE' })).status, 404, 'already approved');
  assert.equal((await call('keeper', `/requests/${R.sup.id}/approve`, { method: 'POST', body: {} })).status, 409, 'cannot approve cancelled');
});

test('10. إدارة المخزون: تعديل الكمية وحذف الأقسام والأصناف', async () => {
  const up = await call('keeper', `/items/${I.paper.id}`, { method: 'PATCH', body: { quantity: 100, description: 'ورق أبيض' } });
  assert.equal(up.status, 200); assert.equal((await j(up)).data.item.quantity, 100);
  assert.equal((await call('keeper', `/items/${I.paper.id}`, { method: 'PATCH', body: { quantity: -5 } })).status, 400);
  assert.equal((await call('keeper', `/sections/${S['ملابس']}`, { method: 'DELETE' })).status, 409, 'section with items');
  assert.equal((await call('keeper', `/items/${I.shirt.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call('keeper', `/items/${I.hidden.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call('keeper', `/sections/${S['ملابس']}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call('keeper', '/items/not-an-id', { method: 'DELETE' })).status, 404);
  // الطلبات القديمة تحتفظ بلقطة الصنف حتى بعد حذفه
  const old = await j(await call('keeper', `/requests/${R.a1.id}`));
  assert.ok(old.data.request.items.some(i => i.name === 'تيشرت'));
});


test('11. خادم المخزن يعدّل الكميات قبل المراجعة فقط مع تسجيل العملية', async () => {
  const created = await call('servantA', '/requests', { method: 'POST', body: { items: [{ itemId: I.pens.id, quantity: 1 }] } });
  const req = (await j(created)).data.request;
  const edited = await call('keeper', `/requests/${req.id}/items`, { method: 'PATCH', body: { items: [{ itemId: I.pens.id, quantity: 2 }] } });
  assert.equal(edited.status, 200);
  const editedBody = await j(edited);
  assert.equal(editedBody.data.request.items[0].quantity, 2);
  assert.equal(editedBody.data.request.auditTrail.length, 1);
  assert.equal((await call('servantA', `/requests/${req.id}/items`, { method: 'PATCH', body: { items: [{ itemId: I.pens.id, quantity: 3 }] } })).status, 403);
  assert.equal((await call('keeper', `/requests/${req.id}/approve`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await call('keeper', `/requests/${req.id}/items`, { method: 'PATCH', body: { items: [{ itemId: I.pens.id, quantity: 4 }] } })).status, 409);
  assert.equal((await WarehouseItem.findById(I.pens.id)).quantity, 4);
  R.edited = req;
});

test('12. صاحب الطلب يرسل طلب تعديل منفصل والخصم يسوى الفرق تلقائيًا', async () => {
  const amend = await call('servantA', `/requests/${R.edited.id}/amendment`, { method: 'POST', body: { items: [{ itemId: I.pens.id, quantity: 3 }] } });
  assert.equal(amend.status, 201);
  const a = (await j(amend)).data.request;
  assert.equal(a.isAmendment, true);
  assert.equal((await call('servantA', `/requests/${R.edited.id}/amendment`, { method: 'POST', body: { items: [{ itemId: I.pens.id, quantity: 4 }] } })).status, 409);
  assert.equal((await call('keeper', `/requests/${a.id}/approve`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await WarehouseItem.findById(I.pens.id)).quantity, 3, 'only the difference is deducted');
  const original = await j(await call('servantA', `/requests/${R.edited.id}`));
  assert.equal(original.data.request.status, 'APPROVED');
  assert.ok(original.data.request.auditTrail.some(x => x.action === 'AMENDMENT_APPROVED'));
});
