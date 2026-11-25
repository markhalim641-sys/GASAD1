import 'dotenv/config';
import { connectDB } from './config/database.js';
import express from 'express'; import cors from 'cors'; import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { seed, verify, hash } from './seed.js';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data'); fs.mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(path.join(dir, 'jasad.db'));
if (!db.prepare("SELECT name FROM sqlite_master WHERE name='users'").get() || !db.prepare("PRAGMA table_info(users)").all().some(c => c.name === 'status')) { seed(db); console.log('تم إنشاء البيانات التجريبية'); }
const app = express(); app.use(cors({ origin: (o, cb) => cb(null, !o || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)), credentials: true })); app.use(express.json());
const ok = (res, data) => res.json({ success: true, data });
const fail = (res, s, code, message) => res.status(s).json({ success: false, error: { code, message } });
const cookie = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]));
const U = r => ({ id: r.id, fullName: r.full_name, email: r.email, username: r.username, roles: JSON.parse(r.roles), status: r.status, stageId: r.stage_id, stage: r.stage_id ? db.prepare('SELECT id,name,slug FROM stages WHERE id=?').get(r.stage_id) : null });
const auth = (active = true) => (req, res, next) => {
  const s = cookie(req).sid, u = s && db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.sid=?').get(s);
  if (!u) return fail(res, 401, 'UNAUTHENTICATED', 'سجّل الدخول أولًا.'); req.user = U(u);
  if (active && u.status !== 'ACTIVE') return fail(res, 403, 'PENDING_APPROVAL', 'حسابك في انتظار موافقة أمين الخدمة.'); next();
};
const admin = (req, res, next) => req.user.roles.includes('ADMIN') ? next() : fail(res, 403, 'FORBIDDEN', 'ليس لديك صلاحية لتنفيذ هذا الإجراء.');
const session = (res, id) => { const sid = crypto.randomBytes(24).toString('hex'); db.prepare('INSERT INTO sessions VALUES(?,?)').run(sid, id); res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`); };
const B = '/api/v1';
app.post(`${B}/auth/register`, (req, res) => {
  const { fullName, email, password } = req.body || {};
  if (!fullName?.trim() || !/^\S+@\S+\.\S+$/.test(email || '') || (password || '').length < 8) return fail(res, 422, 'VALIDATION', 'أدخل الاسم وإيميل صحيح وكلمة سر لا تقل عن 8 أحرف.');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email.toLowerCase())) return fail(res, 409, 'EMAIL_EXISTS', 'هذا الإيميل مسجّل من قبل.');
  const id = db.prepare("INSERT INTO users(full_name,email,password_hash,status,roles) VALUES(?,?,?,'PENDING','[]')").run(fullName.trim(), email.toLowerCase(), hash(password)).lastInsertRowid;
  session(res, id); ok(res, { user: U(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
});
app.post(`${B}/auth/login`, (req, res) => {
  const { identifier = '', password = '' } = req.body || {}; const i = String(identifier).toLowerCase().trim();
  const u = db.prepare('SELECT * FROM users WHERE email=? OR username=?').get(i, i);
  if (!u || !verify(String(password), u.password_hash)) return fail(res, 401, 'INVALID_CREDENTIALS', 'بيانات الدخول غير صحيحة.');
  if (u.status === 'REJECTED') return fail(res, 403, 'REJECTED', 'تم رفض طلب التسجيل. تواصل مع أمين الخدمة.');
  session(res, u.id); ok(res, { user: U(u) });
});
app.get(`${B}/auth/me`, auth(false), (req, res) => ok(res, { user: req.user }));
app.post(`${B}/auth/logout`, (req, res) => { const s = cookie(req).sid; if (s) db.prepare('DELETE FROM sessions WHERE sid=?').run(s); res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0'); ok(res, {}); });
app.get(`${B}/stages`, auth(false), (req, res) => ok(res, db.prepare('SELECT * FROM stages').all()));
const RS = ['SUPERVISOR', 'ASSISTANT', 'SERVANT', 'STOREKEEPER', 'ATTENDANCE'];
const holder = (role, stage, except) => db.prepare("SELECT id FROM users WHERE status='ACTIVE' AND stage_id=? AND roles LIKE ? AND id<>?").get(stage, `%"${role}"%`, except);
function assign(req, res, activate) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(+req.params.id); if (!u || u.roles.includes('ADMIN')) return fail(res, 404, 'NOT_FOUND', 'المستخدم غير موجود.');
  let { roles = [], stageId } = req.body || {}; if (!Array.isArray(roles) || !roles.length || !roles.every(r => RS.includes(r))) return fail(res, 422, 'VALIDATION', 'اختر دورًا واحدًا على الأقل.');
  if (!db.prepare('SELECT 1 FROM stages WHERE id=?').get(stageId)) return fail(res, 422, 'VALIDATION', 'اختر المرحلة.');
  if (roles.includes('ASSISTANT') && !roles.includes('SERVANT')) roles.push('SERVANT');
  for (const [r, m] of [['SUPERVISOR', 'المرحلة لها مشرف بالفعل.'], ['ASSISTANT', 'المرحلة لها مشرف مساعد بالفعل.']]) if (roles.includes(r) && holder(r, stageId, u.id)) return fail(res, 409, 'CONFLICT', m);
  db.prepare("UPDATE users SET roles=?,stage_id=?,status='ACTIVE' WHERE id=?").run(JSON.stringify(roles), stageId, u.id); ok(res, { user: U(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)) });
}
app.get(`${B}/registrations`, auth(), admin, (req, res) => ok(res, db.prepare("SELECT id,full_name,email,created_at FROM users WHERE status='PENDING' ORDER BY id").all().map(r => ({ id: r.id, fullName: r.full_name, email: r.email, createdAt: r.created_at }))));
app.post(`${B}/registrations/:id/approve`, auth(), admin, (req, res) => assign(req, res, true));
app.post(`${B}/registrations/:id/reject`, auth(), admin, (req, res) => { db.prepare("UPDATE users SET status='REJECTED' WHERE id=? AND status='PENDING'").run(+req.params.id); ok(res, {}); });
app.patch(`${B}/users/:id/roles`, auth(), admin, (req, res) => assign(req, res, false));
app.get(`${B}/users`, auth(), (req, res) => {
  const me = req.user, isA = me.roles.includes('ADMIN'), isS = me.roles.includes('SUPERVISOR');
  if (!isA && !isS) return fail(res, 403, 'FORBIDDEN', 'ليس لديك صلاحية لتنفيذ هذا الإجراء.');
  const q = `%${req.query.search || ''}%`, rows = db.prepare(`SELECT * FROM users WHERE status='ACTIVE' AND (full_name LIKE ? OR email LIKE ?) ${isA ? '' : 'AND stage_id=' + Number(me.stageId)} ORDER BY id`).all(q, q);
  ok(res, { items: rows.map(U), total: rows.length });
});
app.get(`${B}/dashboard`, auth(), (req, res) => {
  const me = req.user, n = (w, ...a) => db.prepare(`SELECT COUNT(*) n FROM users WHERE ${w}`).get(...a).n, s = [];
  if (me.roles.includes('ADMIN')) s.push({ label: 'مستخدمون نشطون', value: n("status='ACTIVE'") }, { label: 'طلبات تسجيل معلّقة', value: n("status='PENDING'") }, { label: 'المشرفون', value: n("roles LIKE '%\"SUPERVISOR\"%'") }, { label: 'الخدام', value: n("roles LIKE '%\"SERVANT\"%'") }, { label: 'أمناء المخزن', value: n("roles LIKE '%\"STOREKEEPER\"%'") });
  else if (me.stageId) s.push({ label: 'خدام المرحلة', value: n("status='ACTIVE' AND stage_id=? AND roles LIKE '%\"SERVANT\"%'", me.stageId) });
  ok(res, { stats: s });
});
connectDB()
  .then(() => {
    app.listen(4000, () => {
      console.log('API جاهز على http://localhost:4000/api/v1');
    });
  })
  .catch((error) => {
    console.error('تعذر تشغيل السيرفر بسبب فشل اتصال قاعدة البيانات.');
    process.exit(1);
  });