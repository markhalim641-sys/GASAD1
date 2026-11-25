import express from 'express';
import multer from 'multer';
import path from 'node:path';
import mongoose from 'mongoose';

import Preparation, { PREPARATION_CATEGORIES } from '../models/Preparation.js';
import User from '../models/User.js';
import { weekInfo } from '../utils/week.js';
import { getStages } from '../utils/stagesCache.js';
import { isLead } from '../utils/roles.js';
import { processImage, ImageError, MAX_INPUT_BYTES } from '../utils/image.js';

const MAX_FILES_PER_REQUEST = 10;

// ------------------------------------------------------------------
// مستويات الوصول (تُحسب دائمًا من المستخدم المحمّل من قاعدة البيانات بعد التحقق من الجلسة):
//   ALL   → ADMIN: كل التحضيرات في كل المراحل (عرض وإدارة فقط، لا يرفع تحضيرًا)
//   STAGE → SUPERVISOR (أمين الخدمة): كل تحضيرات مرحلته فقط، ويرفع تحضيره كأي خادم
//   OWN   → الخادم: تحضيراته هو فقط
// ------------------------------------------------------------------
export function accessLevel(user) {
  const roles = user.roles || [];

  if (roles.includes('ADMIN')) return 'ALL';

  if (
    isLead(user) &&
    user.stageId !== null &&
    user.stageId !== undefined
  ) {
    return 'STAGE';
  }

  return 'OWN';
}

export function scopeFilter(user) {
  switch (accessLevel(user)) {
    case 'ALL':
      return {};
    case 'STAGE':
      return { stageId: user.stageId };
    default:
      return { uploaderId: user._id };
  }
}

// الأدمن لا يرفع تحضيرًا: الرفع للخادم وأمين الخدمة (المشرف) فقط
function canUpload(user) {
  const roles = user.roles || [];
  return ['SUPERVISOR', 'ASSISTANT', 'SERVANT'].some(r => roles.includes(r));
}

// في بيئة الاختبار فقط يمكن تحديد "الوقت الحالي" بهيدر لاختبار قفل الجمعة
const getNow = req =>
  process.env.NODE_ENV === 'test' && req.headers['x-test-now']
    ? new Date(String(req.headers['x-test-now']))
    : new Date();

const CLOSED_MESSAGE = 'باب رفع التحضير مقفول: بيقفل الجمعة 8 الصبح ويفتح تاني الجمعة 12 بالليل (بتوقيت القاهرة).';
const weekPublic = (w, weeksAgo = 0) => ({
  start: w.start, end: w.end, closesAt: w.closesAt, reopensAt: w.reopensAt,
  isOpen: w.isOpen, isCurrent: w.isCurrent, weeksAgo
});

const isAdmin = user => (user.roles || []).includes('ADMIN');

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// قيم الـ query يجب أن تكون نصوصًا بسيطة (حماية من NoSQL injection مثل ?x[$ne]=1)
const str = value => (typeof value === 'string' ? value.trim() : '');

function safeFileBase(name) {
  const base = path
    .basename(String(name || ''))
    .replace(/\.[^./\\]*$/, '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '')
    .trim()
    .slice(0, 80);

  return base || 'preparation';
}

function contentDisposition(type, filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function parseDay(value, tzMinutes, endOfDay) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [, y, m, d] = match.map(Number);
  const ms = Date.UTC(y, m - 1, d) + tzMinutes * 60_000 + (endOfDay ? 86_400_000 : 0);
  const date = new Date(ms);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function createPreparationsRouter({ authenticate, requireActive, validId, allowedOrigins = [], isAllowedOrigin = o => allowedOrigins.includes(o) }) {
  const router = express.Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_INPUT_BYTES, files: MAX_FILES_PER_REQUEST, fields: 10, fieldSize: 2000 },
    preservePath: false,
    defParamCharset: 'utf8'
  });

  // كل المسارات تتطلب جلسة صالحة وحسابًا نشطًا.
  router.use(authenticate, requireActive);

  // حماية CSRF للعمليات التي تغيّر البيانات: إن وُجد Origin يجب أن يكون من القائمة المسموحة.
  router.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    const origin = req.headers.origin;

    if (origin && !isAllowedOrigin(origin)) {
      return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'مصدر الطلب غير مسموح.' });
    }

    next();
  });

  const present = (doc, user, stages) => ({
    id: doc._id.toString(),
    uploader: { id: doc.uploaderId.toString(), name: doc.uploaderName },
    stage: doc.stageId === null || doc.stageId === undefined
      ? null
      : { id: doc.stageId, name: stages.get(doc.stageId) || '—' },
    category: doc.category,
    note: doc.note || '',
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    width: doc.width,
    height: doc.height,
    size: doc.size,
    originalSize: doc.originalSize,
    createdAt: doc.createdAt,
    canDelete: isAdmin(user) || doc.uploaderId.toString() === user._id.toString()
  });

  const loadStages = async () => {
    const stages = await getStages();
    return { list: stages, map: new Map(stages.map(s => [s.id, s.name])) };
  };

  // ------------------------------------------------------------
  // معلومات الصلاحية + خيارات الفلاتر (محصورة بنطاق المستخدم)
  // ------------------------------------------------------------
  router.get('/meta', async (req, res, next) => {
    try {
      const level = accessLevel(req.user);
      const scope = scopeFilter(req.user);
      const { list } = await loadStages();

      const stages = level === 'ALL'
        ? list
        : level === 'STAGE'
          ? list.filter(s => s.id === req.user.stageId)
          : [];

      let uploaders = [];

      if (level !== 'OWN') {
        const rows = await Preparation.aggregate([
          { $match: scope },
          { $sort: { createdAt: -1 } },
          { $group: { _id: '$uploaderId', name: { $first: '$uploaderName' }, stageId: { $first: '$stageId' } } },
          { $sort: { name: 1 } }
        ]);

        uploaders = rows.map(r => ({ id: r._id.toString(), name: r.name, stageId: r.stageId ?? null }));
      }

      res.json({
        success: true,
        data: {
          level,
          canUpload: canUpload(req.user),
          week: weekPublic(weekInfo(getNow(req))),
          categories: PREPARATION_CATEGORIES,
          stages: stages.map(s => ({ id: s.id, slug: s.slug, name: s.name })),
          uploaders
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------------------
  // لوحة التحضير: مراحل ← خدام ← تحضير كل خادم (لأسبوع معين)
  // محصورة بنطاق المستخدم، وتُظهر من لم يرفع تحضيره
  // ------------------------------------------------------------
  router.get('/overview', async (req, res, next) => {
    try {
      const level = accessLevel(req.user);
      const scope = scopeFilter(req.user);
      const weeksAgo = Math.min(52, Math.max(0, Number.parseInt(str(req.query.weeks), 10) || 0));
      const week = weekInfo(getNow(req), weeksAgo);

      const userFilter = { status: 'ACTIVE', roles: { $in: ['SERVANT', 'SUPERVISOR', 'ASSISTANT'] } };
      if (level === 'ALL') userFilter.stageId = { $ne: null };
      else if (level === 'STAGE') userFilter.stageId = req.user.stageId;
      else userFilter._id = req.user._id;

      // المراحل (من الكاش) والخدام بالتوازي
      const [{ list: allStages, map: stageMap }, users] = await Promise.all([
        loadStages(),
        User.find(userFilter).select('fullName roles stageId').lean()
      ]);
      const ids = users.map(u => u._id);

      const preps = ids.length
        ? await Preparation.find({
            $and: [scope, { uploaderId: { $in: ids }, createdAt: { $gte: week.start, $lt: week.end } }]
          }).sort({ createdAt: -1, _id: -1 }).lean()
        : [];

      const byUser = new Map();
      for (const pr of preps) {
        const k = pr.uploaderId.toString();
        if (!byUser.has(k)) byUser.set(k, []);
        byUser.get(k).push(pr);
      }

      const stageList = level === 'ALL'
        ? allStages
        : allStages.filter(s => s.id === req.user.stageId);

      const groups = new Map(stageList.map(s => [s.id, { id: s.id, slug: s.slug, name: s.name, order: s.order ?? s.id, servants: [] }]));
      if (level === 'OWN' && !groups.size) groups.set(0, { id: 0, slug: '', name: 'بدون مرحلة', order: 0, servants: [] });

      for (const u of users) {
        const g = groups.get(u.stageId ?? 0);
        if (!g) continue;
        const items = (byUser.get(u._id.toString()) || []).map(d => present(d, req.user, stageMap));
        g.servants.push({
          id: u._id.toString(),
          name: u.fullName,
          isSupervisor: (u.roles || []).includes('SUPERVISOR') || (u.roles || []).includes('ASSISTANT'),
          submitted: items.length > 0,
          count: items.length,
          lastAt: items[0]?.createdAt ?? null,
          items
        });
      }

      const stages = [...groups.values()].sort((a, b) => a.order - b.order).map(g => {
        g.servants.sort((a, b) => Number(b.isSupervisor) - Number(a.isSupervisor) || a.name.localeCompare(b.name, 'ar'));
        const submitted = g.servants.filter(x => x.submitted).length;
        return { ...g, total: g.servants.length, submitted, missing: g.servants.length - submitted };
      });

      const total = stages.reduce((n, g) => n + g.total, 0);
      const submitted = stages.reduce((n, g) => n + g.submitted, 0);

      res.json({
        success: true,
        data: {
          level,
          canUpload: canUpload(req.user),
          week: weekPublic(week, weeksAgo),
          now: getNow(req),
          summary: { total, submitted, missing: total - submitted },
          stages
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------------------
  // قائمة التحضيرات (مع الفلاتر والبحث)
  // ------------------------------------------------------------
  router.get('/', async (req, res, next) => {
    try {
      const scope = scopeFilter(req.user);
      const filters = {};

      const stageRaw = str(req.query.stageId);
      if (stageRaw) {
        const stageId = Number(stageRaw);
        if (!Number.isInteger(stageId)) {
          return res.status(400).json({ success: false, message: 'رقم المرحلة غير صحيح.' });
        }
        filters.stageId = stageId;
      }

      const servantRaw = str(req.query.servantId);
      if (servantRaw) {
        if (!validId(servantRaw)) {
          return res.status(400).json({ success: false, message: 'معرّف الخادم غير صحيح.' });
        }
        filters.uploaderId = new mongoose.Types.ObjectId(servantRaw);
      }

      const category = str(req.query.category);
      if (category) {
        if (!PREPARATION_CATEGORIES.includes(category)) {
          return res.status(400).json({ success: false, message: 'نوع التحضير غير صحيح.' });
        }
        filters.category = category;
      }

      const tz = Math.max(-840, Math.min(840, Number.parseInt(str(req.query.tz), 10) || 0));
      const from = str(req.query.from);
      const to = str(req.query.to);
      const range = {};

      if (from) {
        const d = parseDay(from, tz, false);
        if (!d) return res.status(400).json({ success: false, message: 'تاريخ البداية غير صحيح.' });
        range.$gte = d;
      }

      if (to) {
        const d = parseDay(to, tz, true);
        if (!d) return res.status(400).json({ success: false, message: 'تاريخ النهاية غير صحيح.' });
        range.$lt = d;
      }

      if (Object.keys(range).length) filters.createdAt = range;

      const q = str(req.query.q).slice(0, 60);
      if (q) {
        const rx = { $regex: escapeRegex(q), $options: 'i' };
        filters.$or = [{ uploaderName: rx }, { note: rx }, { originalName: rx }];
      }

      // النطاق (الصلاحية) يُدمج دائمًا بـ AND مع أي فلتر، فلا يمكن تجاوزه بالـ query.
      const filter = { $and: [scope, filters] };

      const page = Math.max(1, Number.parseInt(str(req.query.page), 10) || 1);
      const pageSize = Math.min(60, Math.max(1, Number.parseInt(str(req.query.pageSize), 10) || 24));

      const [items, total, stages] = await Promise.all([
        Preparation.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
        Preparation.countDocuments(filter),
        loadStages()
      ]);

      res.json({
        success: true,
        data: {
          items: items.map(doc => present(doc, req.user, stages.map)),
          total,
          page,
          pageSize
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------------------
  // رفع صور (الهوية والمرحلة والوقت من الباك إند فقط)
  // ------------------------------------------------------------
  router.post(
    '/',
    (req, res, next) => {
      if (!canUpload(req.user)) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'ليس لديك صلاحية رفع التحضيرات.' });
      }

      if (req.user.stageId === null || req.user.stageId === undefined) {
        return res.status(403).json({
          success: false,
          code: 'NO_STAGE',
          message: 'لم يتم تحديد مرحلتك بعد. تواصل مع أمين الخدمة.'
        });
      }

      if (!weekInfo(getNow(req)).isOpen) {
        return res.status(403).json({ success: false, code: 'UPLOAD_CLOSED', message: CLOSED_MESSAGE });
      }

      next();
    },
    upload.array('images', MAX_FILES_PER_REQUEST),
    async (req, res, next) => {
      try {
        const files = req.files || [];

        if (files.length === 0) {
          return res.status(400).json({ success: false, message: 'اختر صورة واحدة على الأقل.' });
        }

        const category = str(req.body.category) || 'LESSON';

        if (!PREPARATION_CATEGORIES.includes(category)) {
          return res.status(400).json({ success: false, message: 'نوع التحضير غير صحيح.' });
        }

        const note = str(req.body.note).slice(0, 300);
        const created = [];
        const rejected = [];
        const { map: stageMap } = await loadStages();

        for (const file of files) {
          try {
            const img = await processImage(file.buffer);

            const doc = await Preparation.create({
              // ⚠️ كل الحقول التالية من الجلسة/الخادم وليست من الواجهة
              uploaderId: req.user._id,
              uploaderName: req.user.fullName,
              stageId: req.user.stageId ?? null,
              createdAt: getNow(req),

              category,
              note,
              originalName: safeFileBase(file.originalname),
              mimeType: img.mimeType,
              width: img.width,
              height: img.height,
              size: img.size,
              originalSize: file.size,
              data: img.data,
              thumb: img.thumb
            });

            created.push(present(doc, req.user, stageMap));
          } catch (error) {
            if (error instanceof ImageError) {
              rejected.push({ name: safeFileBase(file.originalname), message: error.message });
            } else {
              throw error;
            }
          }
        }

        if (created.length === 0) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_IMAGE',
            message: rejected[0]?.message || 'تعذر رفع الصور.',
            data: { rejected }
          });
        }

        res.status(201).json({ success: true, message: 'تم رفع التحضير بنجاح.', data: { created, rejected } });
      } catch (error) {
        next(error);
      }
    }
  );

  // ------------------------------------------------------------
  // جلب صورة (عرض / مصغّرة / تنزيل) — يتحقق من الصلاحية في كل طلب
  // غير المصرّح به يحصل على 404 (لا نكشف حتى وجود الصورة → منع IDOR)
  // ------------------------------------------------------------
  const sendImage = (field, disposition) => async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!validId(id)) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'الصورة غير موجودة.' });
      }

      const doc = await Preparation.findOne({
        $and: [{ _id: id }, scopeFilter(req.user)]
      }).select(`+${field}`);

      if (!doc) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'الصورة غير موجودة.' });
      }

      res.set({
        'Content-Type': doc.mimeType,
        'X-Content-Type-Options': 'nosniff',
        // الصورة لا تتغير بعد رفعها، فيمكن للمتصفح الاحتفاظ بها (خاص بالمستخدم فقط)
        'Cache-Control': 'private, max-age=86400',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': contentDisposition(
          disposition,
          `${doc.originalName || 'preparation'}.webp`
        )
      });

      res.send(Buffer.from(doc[field]));
    } catch (error) {
      next(error);
    }
  };

  router.get('/:id/image', sendImage('data', 'inline'));
  router.get('/:id/thumbnail', sendImage('thumb', 'inline'));
  router.get('/:id/download', sendImage('data', 'attachment'));

  // ------------------------------------------------------------
  // بيانات عنصر واحد
  // ------------------------------------------------------------
  router.get('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!validId(id)) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'التحضير غير موجود.' });
      }

      const doc = await Preparation.findOne({ $and: [{ _id: id }, scopeFilter(req.user)] }).lean();

      if (!doc) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'التحضير غير موجود.' });
      }

      const { map } = await loadStages();
      res.json({ success: true, data: { item: present(doc, req.user, map) } });
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------------------
  // حذف: صاحب الصورة (داخل نطاقه) أو ADMIN فقط
  // ------------------------------------------------------------
  router.delete('/:id', async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!validId(id)) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'التحضير غير موجود.' });
      }

      const doc = await Preparation.findOne({ $and: [{ _id: id }, scopeFilter(req.user)] }).select('uploaderId');

      if (!doc) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'التحضير غير موجود.' });
      }

      if (!isAdmin(req.user) && doc.uploaderId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'لا يمكنك حذف تحضير خادم آخر.' });
      }

      if (!isAdmin(req.user) && !weekInfo(getNow(req)).isOpen) {
        return res.status(403).json({ success: false, code: 'UPLOAD_CLOSED', message: 'مينفعش تحذف التحضير بعد قفل الأسبوع.' });
      }

      await Preparation.deleteOne({ _id: doc._id });

      res.json({ success: true, message: 'تم حذف التحضير.' });
    } catch (error) {
      next(error);
    }
  });

  // أخطاء الرفع (حجم/عدد الملفات...)
  router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      const messages = {
        LIMIT_FILE_SIZE: 'حجم الصورة أكبر من 10 ميجابايت.',
        LIMIT_FILE_COUNT: `الحد الأقصى ${MAX_FILES_PER_REQUEST} صور في المرة الواحدة.`,
        LIMIT_UNEXPECTED_FILE: 'حقل الملف غير متوقع.'
      };

      return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        success: false,
        code: error.code,
        message: messages[error.code] || 'تعذر رفع الملف.'
      });
    }

    next(error);
  });

  return router;
}
