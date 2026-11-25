import express from 'express';
import mongoose from 'mongoose';

import User from '../models/User.js';
import Preparation from '../models/Preparation.js';
import { AttendanceSession, AttendanceRecord, ATTENDANCE_TYPES } from '../models/Attendance.js';
import { weekInfo } from '../utils/week.js';
import { getStages } from '../utils/stagesCache.js';
import { isAdmin, isLead, isAttendanceKeeper, has } from '../utils/roles.js';

// من يُحسب في الحضور: الخدام والمشرفون (المرتبطون بمرحلة)
const ATTENDEE_ROLES = ['SERVANT', 'SUPERVISOR', 'ASSISTANT'];
const MAX_WEEKS_BACK = 52;

const getNow = req =>
  process.env.NODE_ENV === 'test' && req.headers['x-test-now']
    ? new Date(String(req.headers['x-test-now']))
    : new Date();

const str = v => (typeof v === 'string' ? v.trim() : '');
const fail = (res, status, message, code) => res.status(status).json({ success: false, ...(code ? { code } : {}), message });
const intIn = (v, min, max, dflt) => {
  // يقبل رقمًا (من JSON) أو نصًا (من الـ query)
  const n = typeof v === 'number' ? Math.trunc(v) : Number.parseInt(str(v), 10);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

// مستوى الوصول:
//  ALL   → خادم الغياب والأدمن (الكل، والتسجيل)
//  STAGE → مشرف المرحلة / المشرف المساعد (مرحلته فقط، عرض)
//  OWN   → الخادم (نفسه فقط)
function level(user) {
  if (isAdmin(user) || isAttendanceKeeper(user)) return 'ALL';
  if (isLead(user) && user.stageId != null) return 'STAGE';
  if (has(user, 'SERVANT') || isLead(user)) return 'OWN';
  return null;
}
const canMark = user => isAdmin(user) || isAttendanceKeeper(user);

export function createAttendanceRouter({ authenticate, requireActive, validId, isAllowedOrigin = () => true }) {
  const router = express.Router();
  router.use(authenticate, requireActive);

  router.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) return fail(res, 403, 'مصدر الطلب غير مسموح.', 'FORBIDDEN');
    next();
  });

  router.use((req, res, next) => {
    req.level = level(req.user);
    if (!req.level) return fail(res, 403, 'ليس لديك صلاحية الوصول لصفحة الحضور.', 'FORBIDDEN');
    next();
  });

  // الخدام المُحتسَبون داخل نطاق المستخدم
  async function attendees(req) {
    const filter = { status: 'ACTIVE', roles: { $in: ATTENDEE_ROLES }, stageId: { $ne: null } };
    if (req.level === 'STAGE') filter.stageId = req.user.stageId;
    if (req.level === 'OWN') filter._id = req.user._id;
    return User.find(filter).select('fullName roles stageId').lean();
  }

  const stagesInScope = async req => {
    const all = await getStages();
    if (req.level === 'ALL') return all;
    return all.filter(s => s.id === req.user.stageId);
  };

  const leadFlag = u => (u.roles || []).includes('SUPERVISOR') || (u.roles || []).includes('ASSISTANT');
  const byName = (a, b) => Number(b.isLead) - Number(a.isLead) || a.name.localeCompare(b.name, 'ar');

  // ------------------------------------------------------------------
  router.get('/meta', async (req, res, next) => {
    try {
      const w = weekInfo(getNow(req));
      res.json({ success: true, data: { level: req.level, canMark: canMark(req.user), week: { start: w.start, end: w.end }, types: ATTENDANCE_TYPES } });
    } catch (e) { next(e); }
  });

  // ------------------------------------------------------------------
  // ورقة الحضور لأسبوع (للتسجيل أو العرض)
  // ------------------------------------------------------------------
  router.get('/sheet', async (req, res, next) => {
    try {
      if (req.level === 'OWN') return fail(res, 403, 'ورقة الحضور للمشرفين وخادم الغياب فقط.', 'FORBIDDEN');
      const weeks = intIn(req.query.weeks, 0, MAX_WEEKS_BACK, 0);
      const w = weekInfo(getNow(req), weeks);

      const [stages, users] = await Promise.all([stagesInScope(req), attendees(req)]);
      const stageIds = stages.map(s => s.id);
      const [sessions, records] = await Promise.all([
        AttendanceSession.find({ weekStart: w.start, stageId: { $in: stageIds } }).lean(),
        AttendanceRecord.find({ weekStart: w.start, stageId: { $in: stageIds } }).select('userId type present').lean()
      ]);

      const taken = new Map(sessions.map(s => [`${s.stageId}:${s.type}`, s.savedAt]));
      const rec = new Map(records.map(r => [`${r.userId}:${r.type}`, r.present]));

      const out = stages.map(s => ({
        id: s.id, slug: s.slug, name: s.name, order: s.order ?? s.id,
        taken: { MASS: taken.get(`${s.id}:MASS`) ?? null, SERVICE: taken.get(`${s.id}:SERVICE`) ?? null },
        servants: users.filter(u => u.stageId === s.id).map(u => ({
          id: u._id.toString(), name: u.fullName, isLead: leadFlag(u),
          mass: rec.has(`${u._id}:MASS`) ? rec.get(`${u._id}:MASS`) : null,
          service: rec.has(`${u._id}:SERVICE`) ? rec.get(`${u._id}:SERVICE`) : null
        })).sort(byName)
      }));

      res.json({ success: true, data: { level: req.level, canMark: canMark(req.user), week: { start: w.start, end: w.end, weeksAgo: weeks }, stages: out } });
    } catch (e) { next(e); }
  });

  // حفظ حضور مرحلة (القداس و/أو الخدمة) — لخادم الغياب والأدمن فقط
  router.put('/sheet', async (req, res, next) => {
    try {
      if (!canMark(req.user)) return fail(res, 403, 'تسجيل الحضور لخادم الغياب فقط.', 'FORBIDDEN');
      const weeks = intIn(req.body.weeks, 0, MAX_WEEKS_BACK, 0);
      const stageId = Number(req.body.stageId);
      const stage = (await getStages()).find(s => s.id === stageId);
      if (!Number.isInteger(stageId) || !stage) return fail(res, 400, 'المرحلة غير صحيحة.');

      const sets = { MASS: req.body.mass, SERVICE: req.body.service };
      if (sets.MASS === undefined && sets.SERVICE === undefined) return fail(res, 400, 'لا توجد بيانات حضور للحفظ.');
      for (const v of Object.values(sets)) {
        if (v !== undefined && (!Array.isArray(v) || v.some(x => !validId(String(x))))) return fail(res, 400, 'بيانات الحضور غير صحيحة.');
      }

      const w = weekInfo(getNow(req), weeks);
      const users = await User.find({ status: 'ACTIVE', roles: { $in: ATTENDEE_ROLES }, stageId }).select('fullName roles').lean();
      const now = new Date();
      const saved = {};

      for (const [type, list] of Object.entries(sets)) {
        if (list === undefined) continue;
        const present = new Set(list.map(String));
        const ops = users.map(u => ({
          updateOne: {
            filter: { weekStart: w.start, type, userId: u._id },
            update: { $set: { stageId, userName: u.fullName, isLead: leadFlag(u), present: present.has(u._id.toString()), markedAt: now } },
            upsert: true
          }
        }));
        if (ops.length) await AttendanceRecord.bulkWrite(ops, { ordered: false });
        await AttendanceSession.updateOne(
          { weekStart: w.start, type, stageId },
          { $set: { savedAt: now, savedById: req.user._id, savedByName: req.user.fullName } },
          { upsert: true }
        );
        saved[type] = { present: users.filter(u => present.has(u._id.toString())).length, absent: users.filter(u => !present.has(u._id.toString())).length };
      }

      res.json({ success: true, message: `تم حفظ حضور ${stage.name}.`, data: { stageId, saved } });
    } catch (e) { next(e); }
  });

  // ------------------------------------------------------------------
  // ملخص الغياب: مراحل ← خدام ← عدد الغياب
  // ------------------------------------------------------------------
  router.get('/summary', async (req, res, next) => {
    try {
      const rangeRaw = str(req.query.range) || 'all';
      const range = rangeRaw === 'all' ? null : intIn(rangeRaw, 1, MAX_WEEKS_BACK, 4);
      const now = getNow(req);
      const since = range ? weekInfo(now, range - 1).start : null;
      const when = since ? { weekStart: { $gte: since } } : {};

      const [stages, users] = await Promise.all([stagesInScope(req), attendees(req)]);
      const stageIds = stages.map(s => s.id);
      const ids = users.map(u => u._id);

      const [sessions, absences] = await Promise.all([
        AttendanceSession.find({ ...when, stageId: { $in: stageIds } }).select('stageId type weekStart').lean(),
        ids.length
          ? AttendanceRecord.aggregate([
              { $match: { ...when, present: false, userId: { $in: ids } } },
              { $group: { _id: { u: '$userId', t: '$type' }, n: { $sum: 1 }, last: { $max: '$weekStart' } } }
            ])
          : []
      ]);

      const weeksRec = new Map();
      for (const s of sessions) { const k = `${s.stageId}:${s.type}`; weeksRec.set(k, (weeksRec.get(k) || 0) + 1); }
      const abs = new Map(absences.map(a => [`${a._id.u}:${a._id.t}`, a]));

      const out = stages.map(s => {
        const servants = users.filter(u => u.stageId === s.id).map(u => {
          const m = abs.get(`${u._id}:MASS`); const sv = abs.get(`${u._id}:SERVICE`);
          const last = [m?.last, sv?.last].filter(Boolean).sort().pop() ?? null;
          return { id: u._id.toString(), name: u.fullName, isLead: leadFlag(u), mass: m?.n ?? 0, service: sv?.n ?? 0, total: (m?.n ?? 0) + (sv?.n ?? 0), lastAbsent: last };
        }).sort((a, b) => b.total - a.total || byName(a, b));
        return {
          id: s.id, slug: s.slug, name: s.name, order: s.order ?? s.id,
          weeksRecorded: { MASS: weeksRec.get(`${s.id}:MASS`) || 0, SERVICE: weeksRec.get(`${s.id}:SERVICE`) || 0 },
          totals: { mass: servants.reduce((n, x) => n + x.mass, 0), service: servants.reduce((n, x) => n + x.service, 0), all: servants.reduce((n, x) => n + x.total, 0) },
          servants
        };
      });

      res.json({ success: true, data: { level: req.level, range: range ?? 'all', stages: out } });
    } catch (e) { next(e); }
  });

  // ------------------------------------------------------------------
  // لوحة الأدمن/المشرف: غياب القداس والخدمة ومن لم يرفع التحضير + غياب أسبوعين
  // ------------------------------------------------------------------
  router.get('/overview', async (req, res, next) => {
    try {
      if (req.level === 'OWN') return fail(res, 403, 'اللوحة للمشرفين والأدمن فقط.', 'FORBIDDEN');
      if (!isAdmin(req.user) && !isLead(req.user)) return fail(res, 403, 'اللوحة للمشرفين والأدمن فقط.', 'FORBIDDEN');

      const now = getNow(req);
      const [stages, users] = await Promise.all([stagesInScope(req), attendees(req)]);
      const stageIds = stages.map(s => s.id);

      // الأسبوع: تلقائي = الحالي إن كان فيه حضور مسجّل، وإلا الأسبوع الماضي
      let weeks;
      const wRaw = str(req.query.weeks);
      if (wRaw && wRaw !== 'auto') weeks = intIn(wRaw, 0, MAX_WEEKS_BACK, 0);
      else {
        const w0 = weekInfo(now, 0);
        const has0 = await AttendanceSession.exists({ weekStart: w0.start, stageId: { $in: stageIds } });
        weeks = has0 ? 0 : (await AttendanceSession.exists({ weekStart: weekInfo(now, 1).start, stageId: { $in: stageIds } })) ? 1 : 0;
      }
      const w = weekInfo(now, weeks);
      const ids = users.map(u => u._id);

      const [sessions, absentRecs, uploaders] = await Promise.all([
        AttendanceSession.find({ weekStart: w.start, stageId: { $in: stageIds } }).select('stageId type').lean(),
        AttendanceRecord.find({ weekStart: w.start, stageId: { $in: stageIds }, present: false }).select('userId userName stageId type isLead').lean(),
        ids.length ? Preparation.distinct('uploaderId', { uploaderId: { $in: ids }, createdAt: { $gte: w.start, $lt: w.end } }) : []
      ]);

      const takenSet = new Set(sessions.map(s => `${s.stageId}:${s.type}`));
      const uploaded = new Set(uploaders.map(String));
      const userMap = new Map(users.map(u => [u._id.toString(), u]));

      // غياب أسبوعين متتاليين عن القداس والخدمة: آخر أسبوعين مسجّل فيهما النوعان للمرحلة
      const back = [];
      for (let k = 0; k < 8; k++) back.push(weekInfo(now, weeks + k).start);
      const [recSessions] = await Promise.all([
        AttendanceSession.find({ weekStart: { $in: back }, stageId: { $in: stageIds } }).select('stageId type weekStart').lean()
      ]);
      const pairs = new Map(); // stageId -> [week1, week2]
      for (const st of stageIds) {
        const full = back.filter(ws => ATTENDANCE_TYPES.every(t => recSessions.some(s => s.stageId === st && s.type === t && +s.weekStart === +ws)));
        if (full.length >= 2) pairs.set(st, [full[0], full[1]]);
      }
      const twoWeeksSet = new Set();
      if (pairs.size) {
        const recs = await AttendanceRecord.find({
          weekStart: { $in: back }, stageId: { $in: [...pairs.keys()] }, present: false
        }).select('userId stageId type weekStart').lean();
        const tally = new Map();
        for (const r of recs) {
          const pair = pairs.get(r.stageId);
          if (!pair || !pair.some(ws => +ws === +r.weekStart)) continue;
          const k = String(r.userId);
          tally.set(k, (tally.get(k) || new Set()).add(`${r.type}:${+r.weekStart}`));
        }
        for (const [uid, set] of tally) if (set.size === 4 && userMap.has(uid)) twoWeeksSet.add(uid);
      }

      const out = stages.map(s => {
        const members = users.filter(u => u.stageId === s.id);
        const pick = list => list.map(u => ({ id: u._id.toString(), name: u.fullName, isLead: leadFlag(u) })).sort(byName);
        const absentOf = type => pick(members.filter(u => absentRecs.some(r => String(r.userId) === String(u._id) && r.type === type)));
        return {
          id: s.id, slug: s.slug, name: s.name, order: s.order ?? s.id, total: members.length,
          taken: { MASS: takenSet.has(`${s.id}:MASS`), SERVICE: takenSet.has(`${s.id}:SERVICE`) },
          absentMass: absentOf('MASS'),
          absentService: absentOf('SERVICE'),
          missingPrep: pick(members.filter(u => !uploaded.has(String(u._id))))
        };
      });

      const twoWeeks = [...twoWeeksSet].map(uid => {
        const u = userMap.get(uid); const st = stages.find(s => s.id === u.stageId);
        return { id: uid, name: u.fullName, isLead: leadFlag(u), stage: st ? { id: st.id, name: st.name, slug: st.slug } : null };
      }).sort(byName);

      const sum = key => out.reduce((n, s) => n + s[key].length, 0);
      res.json({
        success: true,
        data: {
          level: req.level,
          week: { start: w.start, end: w.end, weeksAgo: weeks, isCurrent: weeks === 0, auto: !wRaw || wRaw === 'auto', prepOpen: weekInfo(now, 0).isOpen && weeks === 0 },
          summary: { servants: users.length, absentMass: sum('absentMass'), absentService: sum('absentService'), missingPrep: sum('missingPrep'), twoWeeks: twoWeeks.length },
          stages: out,
          twoWeeks
        }
      });
    } catch (e) { next(e); }
  });

  return router;
}
