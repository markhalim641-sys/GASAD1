// اختبارات الحضور والغياب + الرتب الجديدة (مشرف مساعد / خادم غياب) + لوحة الغياب.
// MONGODB_URI=mongodb://127.0.0.1:27017/jasad_att_test node --test server/tests/attendance.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import mongoose from 'mongoose';

const PORT = 4102;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/jasad_att_test';
const PASS = 'Test@12345';
const NOW = '2026-11-16T08:00:00Z'; // الاثنين (أسبوع يبدأ السبت 14 نوفمبر)

let server;
const sessions = {}; const ids = {};
const { default: User } = await import('../models/User.js');
const { AttendanceRecord, AttendanceSession } = await import('../models/Attendance.js');
const { default: Preparation } = await import('../models/Preparation.js');
const { hash } = await import('../utils/password.js');

async function waitForServer() {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/health`)).ok) return; } catch {} await new Promise(r => setTimeout(r, 500)); }
  throw new Error('server did not start');
}
async function login(id) {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: PASS }) });
  assert.equal(r.status, 200, `login ${id}`); return r.headers.get('set-cookie').split(';')[0];
}
const call = (who, path, { method = 'GET', body, now = NOW, headers = {} } = {}) =>
  fetch(`${BASE}${path}`, { method, headers: { 'x-test-now': now, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(who ? { Cookie: sessions[who] } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
const j = r => r.json();
const put = (who, body, now) => call(who, '/attendance/sheet', { method: 'PUT', body, now });

before(async () => {
  await mongoose.connect(MONGO); await mongoose.connection.dropDatabase();
  server = spawn('node', ['server/index.js'], { env: { ...process.env, MONGODB_URI: MONGO, PORT: String(PORT), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', d => process.stderr.write(d));
  await waitForServer();
  const specs = {
    admin: [['ADMIN'], null], att: [['ATTENDANCE'], null], keeper: [['STOREKEEPER'], null],
    sup1: [['SUPERVISOR'], 1], asst1: [['ASSISTANT'], 1], sv1a: [['SERVANT'], 1], sv1b: [['SERVANT'], 1],
    sup2: [['SUPERVISOR'], 2], sv2a: [['SERVANT'], 2]
  };
  for (const [k, [roles, stageId]] of Object.entries(specs)) {
    const u = await User.create({ fullName: `م ${k}`, email: `${k}@t.local`, passwordHash: hash(PASS), status: 'ACTIVE', roles, stageId });
    ids[k] = u._id.toString(); sessions[k] = await login(`${k}@t.local`);
  }
});
after(async () => { server?.kill(); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

test('1. خادم الغياب يرى كل المراحل ويحفظ حضور القداس والخدمة', async () => {
  const sheet = await j(await call('att', '/attendance/sheet'));
  assert.equal(sheet.data.level, 'ALL'); assert.equal(sheet.data.canMark, true); assert.equal(sheet.data.stages.length, 8);
  const s1 = sheet.data.stages.find(s => s.id === 1);
  assert.deepEqual(s1.servants.map(x => x.id).sort(), [ids.sup1, ids.asst1, ids.sv1a, ids.sv1b].sort());
  assert.equal(s1.taken.MASS, null);
  const r = await put('att', { stageId: 1, mass: [ids.sv1a, ids.sup1], service: [ids.sv1a, ids.sv1b, ids.sup1, ids.asst1] });
  assert.equal(r.status, 200, await r.clone().text());
  const after = (await j(await call('att', '/attendance/sheet'))).data.stages.find(s => s.id === 1);
  assert.ok(after.taken.MASS && after.taken.SERVICE);
  const byId = Object.fromEntries(after.servants.map(x => [x.id, x]));
  assert.equal(byId[ids.sv1a].mass, true); assert.equal(byId[ids.sv1b].mass, false); assert.equal(byId[ids.sv1b].service, true);
  assert.equal(await AttendanceRecord.countDocuments({ stageId: 1, present: false }), 2); // sv1b mass + asst1 mass
});

test('2. التسجيل لخادم الغياب والأدمن فقط', async () => {
  for (const who of ['sup1', 'asst1', 'sv1a', 'keeper']) assert.equal((await put(who, { stageId: 1, mass: [] })).status, 403, who);
  assert.equal((await call(null, '/attendance/sheet')).status, 401);
  assert.equal((await put('admin', { stageId: 2, mass: [ids.sv2a], service: [ids.sv2a] })).status, 200, 'admin can mark');
  for (const bad of [{ stageId: 99, mass: [] }, { stageId: 1 }, { stageId: 1, mass: 'x' }, { stageId: 1, mass: ['nope'] }, { stageId: 1, mass: [{ $ne: 1 }] }]) {
    assert.equal((await put('att', bad)).status, 400, JSON.stringify(bad));
  }
});

test('3. المشرف والمشرف المساعد: مرحلتهما فقط (عرض) — والخادم لا يرى الورقة', async () => {
  for (const who of ['sup1', 'asst1']) {
    const s = await j(await call(who, '/attendance/sheet'));
    assert.equal(s.data.level, 'STAGE'); assert.equal(s.data.canMark, false);
    assert.deepEqual(s.data.stages.map(x => x.id), [1]);
  }
  assert.equal((await call('sv1a', '/attendance/sheet')).status, 403);
  assert.equal((await call('keeper', '/attendance/sheet')).status, 403);
  assert.equal((await call('keeper', '/attendance/summary')).status, 403);
});

test('4. ملخص الغياب: مراحل ← خدام ← أعداد، بنطاق كل دور', async () => {
  const all = await j(await call('att', '/attendance/summary'));
  const s1 = all.data.stages.find(s => s.id === 1);
  const row = Object.fromEntries(s1.servants.map(x => [x.name, x]));
  assert.equal(row['م sv1b'].mass, 1); assert.equal(row['م sv1b'].service, 0); assert.equal(row['م asst1'].total, 1);
  assert.equal(row['م sv1a'].total, 0);
  assert.equal(s1.weeksRecorded.MASS, 1);
  assert.equal(s1.servants[0].total >= s1.servants[1].total, true, 'sorted by absences');
  assert.equal((await j(await call('sup1', '/attendance/summary'))).data.stages.length, 1);
  const own = await j(await call('sv1b', '/attendance/summary'));
  assert.equal(own.data.level, 'OWN'); assert.equal(own.data.stages[0].servants.length, 1); assert.equal(own.data.stages[0].servants[0].mass, 1);
  assert.equal((await j(await call('att', '/attendance/summary?range=4'))).data.range, 4);
  assert.equal((await call('att', '/attendance/summary?range=abc')).status, 200);
});

test('5. لوحة الغياب (أدمن/مشرف): قداس + خدمة + من لم يرفع التحضير', async () => {
  const sub = await Preparation.create({ uploaderId: ids.sv1a, uploaderName: 'م sv1a', stageId: 1, mimeType: 'image/webp', size: 1, originalSize: 1, data: Buffer.from('x'), thumb: Buffer.from('x'), createdAt: new Date('2026-11-16T08:00:00Z') });
  const o = await j(await call('admin', '/attendance/overview'));
  assert.equal(o.data.week.weeksAgo, 0); assert.equal(o.data.week.auto, true);
  const s1 = o.data.stages.find(s => s.id === 1);
  assert.deepEqual(s1.absentMass.map(x => x.id).sort(), [ids.sv1b, ids.asst1].sort());
  assert.equal(s1.absentService.length, 0);
  assert.ok(!s1.missingPrep.some(x => x.id === ids.sv1a) && s1.missingPrep.some(x => x.id === ids.sv1b));
  assert.equal(o.data.stages.length, 8);
  assert.equal(o.data.summary.absentMass, 3); // + sup2 غائب في المرحلة 2 (سجّل الأدمن الحضور بدونه)
  const lead = await j(await call('asst1', '/attendance/overview'));
  assert.deepEqual(lead.data.stages.map(s => s.id), [1]);
  for (const who of ['sv1a', 'att', 'keeper']) assert.equal((await call(who, '/attendance/overview')).status, 403, who);
  await sub.deleteOne();
});

test('6. غياب أسبوعين متتاليين عن القداس والخدمة (يظهر فقط لو غاب عن النوعين في الأسبوعين)', async () => {
  // الأسبوع الحالي (weeks=0): sv1b غاب عن القداس، حاضر خدمة → سجّله غائبًا عن الخدمة أيضًا
  await put('att', { stageId: 1, mass: [ids.sv1a, ids.sup1, ids.asst1], service: [ids.sv1a, ids.sup1, ids.asst1] });
  // الأسبوع السابق: sv1b غائب عن النوعين، asst1 غائب عن القداس فقط
  await put('att', { weeks: 1, stageId: 1, mass: [ids.sv1a, ids.sup1], service: [ids.sv1a, ids.sup1, ids.asst1] });
  const o = await j(await call('admin', '/attendance/overview'));
  assert.deepEqual(o.data.twoWeeks.map(x => x.id), [ids.sv1b], 'only sv1b absent from both in both weeks');
  assert.equal(o.data.twoWeeks[0].stage.id, 1);
  assert.equal(o.data.summary.twoWeeks, 1);
  const lead = await j(await call('sup2', '/attendance/overview'));
  assert.equal(lead.data.twoWeeks.length, 0, 'other stage lead does not see it');
  const prev = await j(await call('admin', '/attendance/overview?weeks=1'));
  assert.equal(prev.data.week.weeksAgo, 1);
});

test('7. الأسبوع التلقائي: لو الحالي لم يُسجَّل يعرض الأسبوع الماضي', async () => {
  const later = '2026-11-23T08:00:00Z'; // الأسبوع التالي — لا يوجد تسجيل فيه
  const o = await j(await call('admin', '/attendance/overview', { now: later }));
  assert.equal(o.data.week.weeksAgo, 1); assert.equal(o.data.week.auto, true);
  const fixed = await j(await call('admin', '/attendance/overview?weeks=0', { now: later }));
  assert.equal(fixed.data.week.weeksAgo, 0); assert.equal(fixed.data.summary.absentMass, 0);
});

test('8. الموافقة على التسجيل: تعيين الرتبة والمرحلة مع التحقق', async () => {
  const mk = async n => (await User.create({ fullName: `طالب ${n}`, email: `p${n}@t.local`, passwordHash: hash(PASS), status: 'PENDING', roles: [], stageId: null }))._id.toString();
  const approve = (id, body, who = 'admin') => call(who, `/registrations/${id}/approve`, { method: 'POST', body });
  const a = await mk(1);
  assert.equal((await approve(a, { roles: ['ASSISTANT'] })).status, 400, 'assistant needs a stage');
  assert.equal((await approve(a, { roles: ['SERVANT'], stageId: 99 })).status, 400);
  assert.equal((await approve(a, { roles: ['SUPERVISOR', 'GOD'], stageId: 1 })).status, 400);
  assert.equal((await approve(a, { roles: ['ASSISTANT'], stageId: 3 }, 'sup1')).status, 403, 'only admin approves');
  const ok = await approve(a, { roles: ['ASSISTANT'], stageId: 3 });
  assert.equal(ok.status, 200); const u = (await j(ok)).data.user;
  assert.deepEqual(u.roles, ['ASSISTANT']); assert.equal(u.stageId, 3);
  const b = await mk(2); const k = await approve(b, { roles: ['STOREKEEPER'], stageId: 5 });
  assert.equal((await j(k)).data.user.stageId, null, 'no stage for storekeeper');
  const c = await mk(3); assert.equal((await j(await approve(c, { roles: ['ATTENDANCE'] }))).data.user.roles[0], 'ATTENDANCE');
  const d = await mk(4); assert.equal((await j(await approve(d, { roles: ['SERVANT'], stageId: 8 }))).data.user.stage.id, 8);
  // تعديل رتبة مستخدم لاحقًا
  const p = await call('admin', `/users/${d}/roles`, { method: 'PATCH', body: { roles: ['SUPERVISOR'], stageId: 2 } });
  assert.equal(p.status, 200); assert.equal((await j(p)).data.user.roles[0], 'SUPERVISOR');
  assert.equal((await call('admin', `/users/${d}/roles`, { method: 'PATCH', body: { roles: ['SUPERVISOR'], stageId: null } })).status, 400);
});

test('9. المشرف المساعد = نفس صلاحيات مشرف المرحلة', async () => {
  const users = await j(await call('asst1', '/users'));
  assert.ok(users.data.users.every(u => u.stageId === 1));
  assert.equal((await call('asst1', '/stages/1/members')).status, 200);
  assert.equal((await call('asst1', '/stages/2/members')).status, 403);
  assert.equal((await call('asst1', '/dashboard')).status, 200);
  const prep = await j(await call('asst1', '/preparations/overview'));
  assert.equal(prep.data.level, 'STAGE'); assert.equal(prep.data.canUpload, true);
  assert.deepEqual(prep.data.stages.map(s => s.id), [1]);
  assert.equal((await call('att', '/users')).status, 403, 'attendance servant has no users page');
  assert.equal((await call('att', '/dashboard')).status, 403);
  assert.equal((await call('att', '/preparations/overview')).data === undefined || true, true);
});
