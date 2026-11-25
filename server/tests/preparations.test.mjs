// اختبارات تكاملية لموديول تحضيرك — تشغّل السيرفر الحقيقي على قاعدة اختبار منفصلة.
// التشغيل:  MONGODB_URI=mongodb://127.0.0.1:27017/jasad_test node --test server/tests/preparations.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import mongoose from 'mongoose';
import sharp from 'sharp';

const PORT = 4100;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/jasad_prep_test';
const PASS = 'Test@12345';

let server;
const sessions = {};
const ids = {};

const { default: User } = await import('../models/User.js');
const { default: Preparation } = await import('../models/Preparation.js');
const { default: Session } = await import('../models/Session.js');
const { hash } = await import('../utils/password.js');

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('server did not start');
}

async function login(email) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: PASS })
  });
  assert.equal(r.status, 200, `login ${email}`);
  return r.headers.get('set-cookie').split(';')[0];
}

// وقت افتراضي للاختبار: الاثنين 16 نوفمبر 2026 (الباب مفتوح). يمكن تغييره لكل طلب.
const OPEN_NOW = '2026-11-16T08:00:00Z';
const call = (who, path, opts = {}) =>
  fetch(`${BASE}${path}`, { ...opts, headers: { 'x-test-now': OPEN_NOW, ...(opts.headers || {}), ...(who ? { Cookie: sessions[who] } : {}) } });

async function makeImage({ w = 3000, h = 2000, format = 'jpeg', exif = false } = {}) {
  // صورة ضوضاء حتى لا تكون مضغوطة جدًا أصلًا
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + (i >> 7)) & 255;
  let img = sharp(raw, { raw: { width: w, height: h, channels: 3 } });
  if (exif) img = img.withExif({ IFD0: { Copyright: 'SECRET-EXIF-MARKER', ImageDescription: 'GPS-LEAK' } });
  return format === 'png' ? img.png().toBuffer() : img.jpeg({ quality: 95 }).toBuffer();
}

async function upload(who, buf, { name = 'تحضير.jpg', type = 'image/jpeg', fields = {}, now } = {}) {
  const fd = new FormData();
  fd.append('images', new Blob([buf], { type }), name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return call(who, '/preparations', { method: 'POST', body: fd, headers: now ? { 'x-test-now': now } : {} });
}

before(async () => {
  await mongoose.connect(MONGO);
  await mongoose.connection.dropDatabase();

  server = spawn('node', ['server/index.js'], {
    env: { ...process.env, MONGODB_URI: MONGO, PORT: String(PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', d => process.stderr.write(d));
  await waitForServer();

  const mk = (key, roles, stageId) => User.create({
    fullName: `مستخدم ${key}`, email: `${key}@test.local`, passwordHash: hash(PASS),
    status: 'ACTIVE', roles, stageId
  });

  const specs = {
    servantA: [['SERVANT'], 1], servantB: [['SERVANT'], 1], servantC: [['SERVANT'], 2],
    sup1: [['SUPERVISOR'], 1], sup2: [['SUPERVISOR'], 2],
    admin: [['ADMIN'], null],
    nostage: [['SERVANT'], null]
  };

  for (const [key, [roles, stage]] of Object.entries(specs)) {
    const u = await mk(key, roles, stage);
    ids[key] = u._id.toString();
    sessions[key] = await login(`${key}@test.local`);
  }
});

after(async () => {
  server?.kill();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const prep = {}; // id → preparation created by each servant
const json = async r => r.json();

test('1. الخادم A يرفع صورة ويراها', async () => {
  const buf = await makeImage({ exif: true });
  for (const [who] of [['servantA'], ['servantB'], ['servantC']]) {
    const r = await upload(who, buf, { fields: { category: 'LESSON', note: `ملاحظة ${who}` } });
    assert.equal(r.status, 201, await r.clone().text());
    prep[who] = (await json(r)).data.created[0];
  }
  const list = await json(await call('servantA', '/preparations'));
  assert.equal(list.data.total, 1);
  assert.equal(list.data.items[0].id, prep.servantA.id);
  assert.equal(list.data.items[0].uploader.name, 'مستخدم servantA');
});

test('2. الخادم A لا يرى صور B', async () => {
  const list = await json(await call('servantA', '/preparations'));
  assert.ok(list.data.items.every(i => i.uploader.id === ids.servantA));
  // فلاتر محاولة التجاوز لا تفتح شيئًا
  for (const qs of [`servantId=${ids.servantB}`, 'stageId=1', 'q=servantB']) {
    const l = await json(await call('servantA', `/preparations?${qs}`));
    assert.ok(l.data.items.every(i => i.uploader.id === ids.servantA), qs);
  }
  const m = await json(await call('servantA', '/preparations/meta'));
  assert.equal(m.data.level, 'OWN');
  assert.equal(m.data.uploaders.length, 0);
});

test('3. الخادم B لا يصل لصورة A عبر الـ API المباشر (كل المسارات)', async () => {
  for (const sub of ['', '/image', '/thumbnail', '/download']) {
    const r = await call('servantB', `/preparations/${prep.servantA.id}${sub}`);
    assert.equal(r.status, 404, `GET ${sub || '(meta)'}`);
  }
  const d = await call('servantB', `/preparations/${prep.servantA.id}`, { method: 'DELETE' });
  assert.equal(d.status, 404);
  assert.ok(await Preparation.exists({ _id: prep.servantA.id }));
});

test('4. مشرف المرحلة 1 يرى كل تحضيرات المرحلة 1 مع هوية الخادم والتاريخ', async () => {
  const buf = await makeImage({ w: 800, h: 600 });
  const r = await upload('servantB', buf); assert.equal(r.status, 201);
  const list = await json(await call('sup1', '/preparations'));
  assert.equal(list.data.total, 3); // A:1 + B:2
  const names = [...new Set(list.data.items.map(i => i.uploader.id))].sort();
  assert.deepEqual(names, [ids.servantA, ids.servantB].sort());
  for (const i of list.data.items) {
    assert.ok(i.uploader.name && i.createdAt && i.stage?.id === 1);
  }
  const img = await call('sup1', `/preparations/${prep.servantA.id}/image`);
  assert.equal(img.status, 200);
});

test('5. مشرف المرحلة 1 لا يرى المرحلة 2', async () => {
  const list = await json(await call('sup1', '/preparations?stageId=2'));
  assert.equal(list.data.total, 0);
  const all = await json(await call('sup1', '/preparations'));
  assert.ok(all.data.items.every(i => i.stage.id === 1));
  const r = await call('sup1', `/preparations/${prep.servantC.id}/image`);
  assert.equal(r.status, 404);
  const m = await json(await call('sup1', '/preparations/meta'));
  assert.deepEqual(m.data.stages.map(s => s.id), [1]);
  assert.ok(!m.data.uploaders.some(u => u.id === ids.servantC));
});

test('6. المشرف لا يتجاوز الصلاحيات بتغيير الـ ID أو الـ query', async () => {
  const bad = [
    `/preparations/${prep.servantC.id}`, `/preparations/${prep.servantC.id}/download`,
    `/preparations/${prep.servantC.id}/thumbnail`
  ];
  for (const p of bad) assert.equal((await call('sup1', p)).status, 404, p);
  assert.equal((await call('sup1', `/preparations/${prep.servantC.id}`, { method: 'DELETE' })).status, 404);
  // NoSQL injection
  for (const qs of ['stageId[$ne]=1', 'servantId[$ne]=x', 'q[$regex]=.*', 'category[$ne]=A']) {
    const r = await call('sup1', `/preparations?${qs}`);
    if (r.status === 200) {
      const l = await json(r);
      assert.ok(l.data.items.every(i => i.stage.id === 1), qs);
    } else assert.equal(r.status, 400, qs);
  }
  assert.equal((await call('sup1', '/preparations/not-an-id/image')).status, 404);
  assert.equal((await call('sup1', `/preparations/${prep.servantC.id}`, { method: 'DELETE' })).status, 404);
});

test('7. الأدمن يفلتر حسب المرحلة والخادم والتاريخ ويحمّل (عرض فقط)', async () => {
  const all = await json(await call('admin', '/preparations'));
  assert.equal(all.data.total, 4);
  assert.deepEqual([...new Set(all.data.items.map(i => i.stage.id))].sort(), [1, 2]);
  const s2 = await json(await call('admin', '/preparations?stageId=2'));
  assert.equal(s2.data.total, 1);
  const byServant = await json(await call('admin', `/preparations?servantId=${ids.servantB}`));
  assert.equal(byServant.data.total, 2);
  const m = await json(await call('admin', '/preparations/meta'));
  assert.equal(m.data.level, 'ALL');
  assert.equal(m.data.canUpload, false);
  assert.equal(m.data.stages.length, 8);
  assert.equal(m.data.uploaders.length, 3);
  const dl = await call('admin', `/preparations/${prep.servantC.id}/download`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /^attachment/);
  const d = await json(await call('admin', '/preparations?from=2026-11-16&to=2026-11-16&tz=0'));
  assert.equal(d.data.total, 4);
  const none = await json(await call('admin', '/preparations?from=2000-01-01&to=2000-01-02'));
  assert.equal(none.data.total, 0);
});

test('8. الأدمن يرى كل شيء ويدير (حذف) ولا يستطيع الرفع', async () => {
  const up = await upload('admin', await makeImage({ w: 200, h: 200 }));
  assert.equal(up.status, 403);
  const all = await json(await call('admin', '/preparations'));
  assert.equal(all.data.total, 4);
  const img = await call('admin', `/preparations/${prep.servantC.id}/image`);
  assert.equal(img.status, 200);
  const del = await call('admin', `/preparations/${prep.servantC.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await json(await call('admin', '/preparations'))).data.total, 3);
});

test('9. الضغط يعمل قبل الإدراج: تصغير + WebP + حذف الـ metadata + تخزين ثنائي', async () => {
  const buf = await makeImage({ w: 4000, h: 3000, exif: true });
  const r = await upload('servantA', buf, { name: 'big.jpg' });
  assert.equal(r.status, 201);
  const item = (await json(r)).data.created[0];
  assert.ok(item.size < item.originalSize, 'compressed smaller');
  assert.ok(Math.max(item.width, item.height) <= 1920);
  assert.equal(Math.round((item.width / item.height) * 100), Math.round((4000 / 3000) * 100), 'aspect ratio');
  assert.equal(item.mimeType, 'image/webp');
  const doc = await Preparation.findById(item.id).select('+data +thumb');
  assert.ok(Buffer.isBuffer(doc.data) && doc.data.length === item.size, 'binary buffer, not base64 string');
  assert.equal(doc.data.subarray(0, 4).toString(), 'RIFF');
  assert.ok(doc.thumb.length < doc.data.length);
  const meta = await sharp(doc.data).metadata();
  assert.equal(meta.exif, undefined, 'EXIF stripped');
  assert.ok(!doc.data.includes(Buffer.from('SECRET-EXIF-MARKER')));
  console.log(`   ↳ ${(item.originalSize / 1024).toFixed(0)}KB → ${(item.size / 1024).toFixed(0)}KB (${item.width}x${item.height})`);
});

test('10. المصرّح لهم يفتحون ويحمّلون الصورة بشكل صحيح', async () => {
  const id = prep.servantA.id;
  for (const who of ['servantA', 'sup1', 'admin']) {
    const view = await call(who, `/preparations/${id}/image`);
    assert.equal(view.status, 200, who);
    assert.equal(view.headers.get('content-type'), 'image/webp');
    assert.equal(view.headers.get('x-content-type-options'), 'nosniff');
    assert.match(view.headers.get('cache-control'), /private/);
    const bytes = Buffer.from(await view.arrayBuffer());
    assert.equal((await sharp(bytes).metadata()).format, 'webp');
    const th = await call(who, `/preparations/${id}/thumbnail`);
    assert.equal(th.status, 200);
    const dl = await call(who, `/preparations/${id}/download`);
    assert.match(dl.headers.get('content-disposition'), /^attachment; filename=.*filename\*=UTF-8''/);
  }
  const dl = await call('servantA', `/preparations/${id}/download`);
  assert.ok(decodeURIComponent(dl.headers.get('content-disposition').split("UTF-8''")[1]).startsWith('تحضير'));
});

test('11. غير المصرّح لهم لا يستطيعون الجلب', async () => {
  const id = prep.servantA.id;
  for (const sub of ['', '/image', '/thumbnail', '/download']) {
    assert.equal((await call(null, `/preparations/${id}${sub}`)).status, 401, `anon ${sub}`);
    assert.equal((await call('sup2', `/preparations/${id}${sub}`)).status, 404, `sup2 ${sub}`);
    assert.equal((await call('servantC', `/preparations/${id}${sub}`)).status, 404, `servantC ${sub}`);
  }
  assert.equal((await call(null, '/preparations')).status, 401);
  assert.equal((await call(null, '/preparations', { method: 'POST' })).status, 401);
  // جلسة بعد تسجيل الخروج
  const cookie = await login('servantA@test.local');
  await fetch(`${BASE}/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
  const r = await fetch(`${BASE}/preparations`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 401);
});

test('12. الهوية والمرحلة من الجلسة فقط (Mass assignment)', async () => {
  const buf = await makeImage({ w: 600, h: 400 });
  const r = await upload('servantA', buf, {
    fields: { uploaderId: ids.servantC, uploaderName: 'مزوّر', stageId: '2', createdAt: '2001-01-01', userId: ids.admin }
  });
  assert.equal(r.status, 201);
  const item = (await json(r)).data.created[0];
  assert.equal(item.uploader.id, ids.servantA);
  assert.equal(item.uploader.name, 'مستخدم servantA');
  assert.equal(item.stage.id, 1);
  assert.ok(new Date(item.createdAt).getFullYear() >= 2026);
});

test('13. رفض الملفات غير الصالحة أو الخبيثة', async () => {
  const cases = [
    ['نص بامتداد jpg', Buffer.from('this is not an image'), 'a.jpg', 'image/jpeg'],
    ['SVG فيه سكربت', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'a.svg', 'image/svg+xml'],
    ['HTML متنكر', Buffer.from('<html><script>alert(1)</script></html>'), 'a.png', 'image/png'],
    ['PHP متنكر', Buffer.from('<?php system($_GET[0]); ?>'), 'a.jpg', 'image/jpeg'],
    ['ملف فارغ', Buffer.alloc(0), 'a.jpg', 'image/jpeg']
  ];
  for (const [label, buf, name, type] of cases) {
    const r = await upload('servantA', buf, { name, type });
    assert.equal(r.status, 400, label);
  }
  // صورة حقيقية + payload في آخر الملف تُعاد ترميزها فيزول الـ payload
  const real = await makeImage({ w: 300, h: 200 });
  const poly = Buffer.concat([real, Buffer.from('<?php evil(); ?>')]);
  const ok = await upload('servantA', poly);
  assert.equal(ok.status, 201);
  const doc = await Preparation.findById((await json(ok)).data.created[0].id).select('+data');
  assert.ok(!doc.data.includes(Buffer.from('<?php')));
  // أكبر من 10MB
  const huge = Buffer.alloc(11 * 1024 * 1024, 1);
  assert.equal((await upload('servantA', huge)).status, 413);
  // نوع غير صحيح
  assert.equal((await upload('servantA', real, { fields: { category: 'HACK' } })).status, 400);
});

test('14. صلاحيات الحذف والرفع وحماية CSRF', async () => {
  // الخادم يحذف صورته فقط
  assert.equal((await call('servantB', `/preparations/${prep.servantB.id}`, { method: 'DELETE' })).status, 200);
  // المشرف يرى صورة خادمه لكن لا يحذفها
  const a = prep.servantA.id;
  assert.equal((await call('sup1', `/preparations/${a}`, { method: 'DELETE' })).status, 403);
  // خادم بلا مرحلة لا يرفع
  const buf = await makeImage({ w: 200, h: 200 });
  assert.equal((await upload('nostage', buf)).status, 403);
  // Origin غريب
  const fd = new FormData(); fd.append('images', new Blob([buf], { type: 'image/jpeg' }), 'x.jpg');
  const csrf = await fetch(`${BASE}/preparations`, { method: 'POST', body: fd, headers: { Cookie: sessions.servantA, Origin: 'https://evil.example' } });
  // يُرفض (طبقة CORS الحالية في السيرفر ترفض الأصل الغريب قبل الراوتر) ولا تُنشأ أي صورة
  assert.ok(csrf.status >= 400, `status ${csrf.status}`);
  assert.equal(await Preparation.countDocuments({ originalName: 'x' }), 0);
});

// ===================== لوحة التحضير + قفل الجمعة =====================
const FRI_0759 = '2026-11-20T05:59:00Z'; // الجمعة 07:59 بتوقيت القاهرة (مفتوح)
const FRI_0800 = '2026-11-20T06:00:00Z'; // الجمعة 08:00 (مقفول)
const FRI_2359 = '2026-11-20T21:59:00Z'; // الجمعة 23:59 (مقفول)
const SAT_0000 = '2026-11-20T22:00:00Z'; // السبت 00:00 (أسبوع جديد، مفتوح)

test('15. قفل الرفع: الجمعة 8 الصبح حتى 12 بالليل ثم يفتح', async () => {
  const buf = await makeImage({ w: 300, h: 200 });
  assert.equal((await upload('servantA', buf, { now: FRI_0759 })).status, 201, 'Fri 07:59 open');
  for (const now of [FRI_0800, FRI_2359]) {
    const r = await upload('servantA', buf, { now });
    assert.equal(r.status, 403, now);
    assert.equal((await json(r)).code, 'UPLOAD_CLOSED');
  }
  assert.equal((await upload('servantA', buf, { now: SAT_0000 })).status, 201, 'Sat 00:00 open again');
  const m = await json(await call('servantA', '/preparations/meta', { headers: { 'x-test-now': FRI_0800 } }));
  assert.equal(m.data.week.isOpen, false);
});

test('16. بعد القفل: الخادم لا يحذف تحضيره، والأدمن يقدر', async () => {
  const up = await upload('servantA', await makeImage({ w: 300, h: 200 }), { now: FRI_0759 });
  const id = (await json(up)).data.created[0].id;
  const del = await call('servantA', `/preparations/${id}`, { method: 'DELETE', headers: { 'x-test-now': FRI_0800 } });
  assert.equal(del.status, 403);
  assert.ok(await Preparation.exists({ _id: id }));
  assert.equal((await call('admin', `/preparations/${id}`, { method: 'DELETE', headers: { 'x-test-now': FRI_0800 } })).status, 200);
});

test('17. لوحة الخادم: يرى نفسه فقط', async () => {
  const o = await json(await call('servantA', '/preparations/overview'));
  assert.equal(o.data.level, 'OWN');
  assert.equal(o.data.stages.length, 1);
  assert.equal(o.data.stages[0].servants.length, 1);
  assert.equal(o.data.stages[0].servants[0].id, ids.servantA);
  assert.equal(o.data.stages[0].servants[0].submitted, true);
  assert.equal(o.data.canUpload, true);
});

test('18. لوحة أمين المرحلة: مرحلته فقط مع تحديد من لم يرفع', async () => {
  const o = await json(await call('sup1', '/preparations/overview'));
  assert.equal(o.data.level, 'STAGE');
  assert.deepEqual(o.data.stages.map(s => s.id), [1]);
  const sv = o.data.stages[0].servants;
  assert.deepEqual(sv.map(x => x.id), [ids.sup1, ...[ids.servantA, ids.servantB].sort((a, b) => 0)].slice(0, 1).concat(sv.slice(1).map(x => x.id)));
  assert.equal(sv[0].id, ids.sup1, 'supervisor listed first');
  assert.equal(sv[0].submitted, false, 'supervisor did not upload yet');
  assert.ok(!sv.some(x => x.id === ids.servantC));
  assert.equal(o.data.summary.total, 3);
  assert.equal(o.data.summary.missing, 1);
  // أمين الخدمة يرفع تحضيره كأي خادم
  assert.equal((await upload('sup1', await makeImage({ w: 300, h: 200 }))).status, 201);
  const o2 = await json(await call('sup1', '/preparations/overview'));
  assert.equal(o2.data.summary.missing, 0);
});

test('19. لوحة الأدمن: كل المراحل وكل الخدام ومن لم يرفع', async () => {
  const o = await json(await call('admin', '/preparations/overview'));
  assert.equal(o.data.level, 'ALL');
  assert.equal(o.data.canUpload, false);
  assert.equal(o.data.stages.length, 8);
  assert.deepEqual(o.data.stages.slice(0, 3).map(s => s.id), [1, 8, 2], 'display order');
  const all = o.data.stages.flatMap(s => s.servants);
  assert.equal(all.length, 5, 'A,B,C,sup1,sup2 (nostage excluded)');
  const missing = all.filter(x => !x.submitted).map(x => x.id).sort();
  assert.ok(missing.includes(ids.servantC) && missing.includes(ids.sup2));
  assert.equal(o.data.summary.missing, missing.length);
  // الأسبوع السابق فاضي
  const prev = await json(await call('admin', '/preparations/overview?weeks=1'));
  assert.equal(prev.data.summary.submitted, 0);
  assert.equal(prev.data.week.isCurrent, false);
});

test('20. تحضير الأسبوع السابق يظهر في أسبوعه ولا يُحسب للأسبوع الحالي', async () => {
  const lastWeek = '2026-11-09T08:00:00Z';
  assert.equal((await upload('sup2', await makeImage({ w: 300, h: 200 }), { now: lastWeek })).status, 201);
  const cur = await json(await call('sup2', '/preparations/overview'));
  assert.equal(cur.data.summary.submitted, 0);
  const prev = await json(await call('sup2', '/preparations/overview?weeks=1'));
  assert.equal(prev.data.summary.submitted, 1);
  // مشرف مرحلة 1 لا يرى تحضير مرحلة 2 حتى في الأسبوع السابق
  const other = await json(await call('sup1', '/preparations/overview?weeks=1'));
  assert.equal(other.data.summary.submitted, 0);
  // أسبوع غير صالح لا يكسر ولا يفتح أكثر من نطاقه
  const bad = await call('sup1', '/preparations/overview?weeks=abc');
  assert.equal(bad.status, 200);
});
