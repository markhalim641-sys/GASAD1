import express from 'express';
import mongoose from 'mongoose';

import { WarehouseSection, WarehouseItem, WarehouseRequest } from '../models/Warehouse.js';
import { getStages } from '../utils/stagesCache.js';

const MAX_QTY = 1_000_000;
const MAX_LINES = 30;

const has = (user, role) => (user.roles || []).includes(role);
const isKeeper = user => has(user, 'STOREKEEPER');   // خادم المخزن: يدير الأصناف ويراجع الطلبات
const isAdmin = user => has(user, 'ADMIN');          // الأدمن: عرض فقط
const canRequest = user => has(user, 'SERVANT') || has(user, 'SUPERVISOR') || has(user, 'ASSISTANT'); // خادم / أمين خدمة

const str = v => (typeof v === 'string' ? v.trim() : '');
const escapeRegex = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isQty = (n, min) => Number.isInteger(n) && n >= min && n <= MAX_QTY;

const fail = (res, status, message, code) =>
  res.status(status).json({ success: false, ...(code ? { code } : {}), message });

export function createWarehouseRouter({ authenticate, requireActive, validId, isAllowedOrigin = () => true }) {
  const router = express.Router();

  router.use(authenticate, requireActive);

  // حماية CSRF للعمليات التي تغيّر البيانات
  router.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) return fail(res, 403, 'مصدر الطلب غير مسموح.', 'FORBIDDEN');
    next();
  });

  // أي مستخدم له علاقة بالمخزن
  router.use((req, res, next) => {
    if (isKeeper(req.user) || isAdmin(req.user) || canRequest(req.user)) return next();
    return fail(res, 403, 'ليس لديك صلاحية الوصول للمخزن.', 'FORBIDDEN');
  });

  const onlyKeeper = (req, res, next) =>
    isKeeper(req.user) ? next() : fail(res, 403, 'هذه العملية لخادم المخزن فقط.', 'FORBIDDEN');

  const presentItem = (i, sectionMap) => ({
    id: i._id.toString(),
    name: i.name,
    sectionId: i.sectionId.toString(),
    sectionName: sectionMap.get(i.sectionId.toString()) || '',
    quantity: i.quantity,
    unit: i.unit,
    description: i.description || '',
    active: i.active,
    updatedAt: i.updatedAt
  });

  const sectionsMap = async () => {
    const list = await WarehouseSection.find().sort({ name: 1 }).lean();
    return { list, map: new Map(list.map(s => [s._id.toString(), s.name])) };
  };

  // ============================ الأقسام ============================
  router.get('/sections', async (req, res, next) => {
    try {
      const { list } = await sectionsMap();
      const itemFilter = isKeeper(req.user) ? {} : { active: true };
      const counts = await WarehouseItem.aggregate([{ $match: itemFilter }, { $group: { _id: '$sectionId', n: { $sum: 1 } } }]);
      const cmap = new Map(counts.map(c => [c._id.toString(), c.n]));
      res.json({ success: true, data: { sections: list.map(s => ({ id: s._id.toString(), name: s.name, itemCount: cmap.get(s._id.toString()) || 0 })) } });
    } catch (e) { next(e); }
  });

  router.post('/sections', onlyKeeper, async (req, res, next) => {
    try {
      const name = str(req.body.name);
      if (!name || name.length > 80) return fail(res, 400, 'اكتب اسم القسم (حتى 80 حرف).');
      const s = await WarehouseSection.create({ name });
      res.status(201).json({ success: true, message: 'تم إضافة القسم.', data: { section: { id: s._id.toString(), name: s.name, itemCount: 0 } } });
    } catch (e) {
      if (e.code === 11000) return fail(res, 409, 'القسم ده موجود بالفعل.');
      next(e);
    }
  });

  router.patch('/sections/:id', onlyKeeper, async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return fail(res, 404, 'القسم غير موجود.', 'NOT_FOUND');
      const name = str(req.body.name);
      if (!name || name.length > 80) return fail(res, 400, 'اكتب اسم القسم (حتى 80 حرف).');
      const s = await WarehouseSection.findByIdAndUpdate(req.params.id, { $set: { name } }, { new: true });
      if (!s) return fail(res, 404, 'القسم غير موجود.', 'NOT_FOUND');
      res.json({ success: true, message: 'تم تعديل القسم.', data: { section: { id: s._id.toString(), name: s.name } } });
    } catch (e) {
      if (e.code === 11000) return fail(res, 409, 'القسم ده موجود بالفعل.');
      next(e);
    }
  });

  router.delete('/sections/:id', onlyKeeper, async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return fail(res, 404, 'القسم غير موجود.', 'NOT_FOUND');
      if (await WarehouseItem.exists({ sectionId: req.params.id })) {
        return fail(res, 409, 'مينفعش تحذف قسم فيه أصناف. انقل الأصناف أو احذفها الأول.');
      }
      const r = await WarehouseSection.deleteOne({ _id: req.params.id });
      if (!r.deletedCount) return fail(res, 404, 'القسم غير موجود.', 'NOT_FOUND');
      res.json({ success: true, message: 'تم حذف القسم.' });
    } catch (e) { next(e); }
  });

  // ============================ الأصناف ============================
  router.get('/items', async (req, res, next) => {
    try {
      const filter = isKeeper(req.user) ? {} : { active: true };
      const sectionId = str(req.query.sectionId);
      if (sectionId) {
        if (!validId(sectionId)) return fail(res, 400, 'معرّف القسم غير صحيح.');
        filter.sectionId = new mongoose.Types.ObjectId(sectionId);
      }
      const q = str(req.query.q).slice(0, 60);
      if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };

      const [items, { map }] = await Promise.all([WarehouseItem.find(filter).sort({ name: 1 }).limit(500).lean(), sectionsMap()]);
      res.json({ success: true, data: { items: items.map(i => presentItem(i, map)) } });
    } catch (e) { next(e); }
  });

  const readItemBody = async (body, partial) => {
    const out = {};
    if (!partial || body.name !== undefined) {
      const name = str(body.name);
      if (!name || name.length > 80) return { error: 'اكتب اسم الصنف (حتى 80 حرف).' };
      out.name = name;
    }
    if (!partial || body.sectionId !== undefined) {
      const sid = str(body.sectionId);
      if (!mongoose.isValidObjectId(sid) || !(await WarehouseSection.exists({ _id: sid }))) return { error: 'اختار قسم صحيح.' };
      out.sectionId = sid;
    }
    if (!partial || body.quantity !== undefined) {
      const q = Number(body.quantity ?? 0);
      if (!isQty(q, 0)) return { error: 'الكمية لازم تكون رقم صحيح من 0 لحد 1,000,000.' };
      out.quantity = q;
    }
    if (body.unit !== undefined) {
      const unit = str(body.unit);
      if (!unit || unit.length > 20) return { error: 'الوحدة لازم تكون من 1 لـ 20 حرف.' };
      out.unit = unit;
    }
    if (body.description !== undefined) {
      const d = str(body.description);
      if (d.length > 300) return { error: 'الوصف أطول من 300 حرف.' };
      out.description = d;
    }
    if (body.active !== undefined) out.active = body.active === true || body.active === 'true';
    return { value: out };
  };

  router.post('/items', onlyKeeper, async (req, res, next) => {
    try {
      const r = await readItemBody(req.body, false);
      if (r.error) return fail(res, 400, r.error);
      const item = await WarehouseItem.create({ ...r.value, updatedAt: new Date() });
      const { map } = await sectionsMap();
      res.status(201).json({ success: true, message: 'تم إضافة الصنف.', data: { item: presentItem(item.toObject(), map) } });
    } catch (e) {
      if (e.code === 11000) return fail(res, 409, 'الصنف ده موجود بالفعل في نفس القسم.');
      next(e);
    }
  });

  router.patch('/items/:id', onlyKeeper, async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return fail(res, 404, 'الصنف غير موجود.', 'NOT_FOUND');
      const r = await readItemBody(req.body, true);
      if (r.error) return fail(res, 400, r.error);
      const item = await WarehouseItem.findByIdAndUpdate(req.params.id, { $set: { ...r.value, updatedAt: new Date() } }, { new: true }).lean();
      if (!item) return fail(res, 404, 'الصنف غير موجود.', 'NOT_FOUND');
      const { map } = await sectionsMap();
      res.json({ success: true, message: 'تم تعديل الصنف.', data: { item: presentItem(item, map) } });
    } catch (e) {
      if (e.code === 11000) return fail(res, 409, 'الصنف ده موجود بالفعل في نفس القسم.');
      next(e);
    }
  });

  router.delete('/items/:id', onlyKeeper, async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return fail(res, 404, 'الصنف غير موجود.', 'NOT_FOUND');
      const r = await WarehouseItem.deleteOne({ _id: req.params.id });
      if (!r.deletedCount) return fail(res, 404, 'الصنف غير موجود.', 'NOT_FOUND');
      res.json({ success: true, message: 'تم حذف الصنف.' });
    } catch (e) { next(e); }
  });

  // ============================ الطلبات ============================
  const requestScope = user => (isKeeper(user) || isAdmin(user) ? {} : { requesterId: user._id });

  const presentRequest = (r, stageMap, user) => ({
    id: r._id.toString(),
    requester: { id: r.requesterId.toString(), name: r.requesterName, role: r.requesterRole },
    stage: r.stageId === null || r.stageId === undefined ? null : { id: r.stageId, name: stageMap.get(r.stageId) || '—' },
    items: r.items.map(i => ({ itemId: i.itemId.toString(), name: i.name, sectionName: i.sectionName, unit: i.unit, quantity: i.quantity })),
    note: r.note || '',
    status: r.isAmendment ? 'PENDING' : r.status,
    isAmendment: !!r.isAmendment,
    amendmentOf: r.amendmentOf ? r.amendmentOf.toString() : null,
    auditTrail: (r.auditTrail || []).map(a => ({ action: a.action, by: a.byName, at: a.at, details: a.details })),
    review: r.status === 'PENDING' || r.status === 'CANCELLED' ? null : {
      by: r.reviewerName, comment: r.reviewComment || '', at: r.reviewedAt
    },
    createdAt: r.createdAt,
    canCancel: r.status === 'PENDING' && r.requesterId.toString() === user._id.toString(),
    canReview: r.status === 'PENDING' && isKeeper(user),
    canRequestAmendment: ['APPROVED', 'REJECTED'].includes(r.status) && r.requesterId.toString() === user._id.toString() && !r.isAmendment
  });

  const stagesMap = async () => new Map((await getStages()).map(s => [s.id, s.name]));

  router.get('/requests', async (req, res, next) => {
    try {
      const filters = {};
      const status = str(req.query.status);
      if (status) {
        if (!['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(status)) return fail(res, 400, 'الحالة غير صحيحة.');
        filters.status = status;
      }
      const stageRaw = str(req.query.stageId);
      if (stageRaw) {
        const sid = Number(stageRaw);
        if (!Number.isInteger(sid)) return fail(res, 400, 'رقم المرحلة غير صحيح.');
        filters.stageId = sid;
      }
      const scope = requestScope(req.user);
      const filter = { $and: [scope, filters] };
      const page = Math.max(1, Number.parseInt(str(req.query.page), 10) || 1);
      const pageSize = Math.min(50, Math.max(1, Number.parseInt(str(req.query.pageSize), 10) || 20));

      const [items, total, pending, smap] = await Promise.all([
        WarehouseRequest.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
        WarehouseRequest.countDocuments(filter),
        WarehouseRequest.countDocuments({ $and: [scope, { status: 'PENDING' }] }),
        stagesMap()
      ]);

      res.json({ success: true, data: { items: items.map(r => presentRequest(r, smap, req.user)), total, page, pageSize, pending } });
    } catch (e) { next(e); }
  });

  router.post('/requests', async (req, res, next) => {
    try {
      if (!canRequest(req.user)) return fail(res, 403, 'الطلب للخدام وأمناء الخدمة فقط.', 'FORBIDDEN');
      if (req.user.stageId === null || req.user.stageId === undefined) {
        return fail(res, 403, 'لم يتم تحديد مرحلتك بعد. تواصل مع أمين الخدمة.', 'NO_STAGE');
      }

      const lines = Array.isArray(req.body.items) ? req.body.items : [];
      if (!lines.length) return fail(res, 400, 'اختار صنف واحد على الأقل.');
      if (lines.length > MAX_LINES) return fail(res, 400, `الحد الأقصى ${MAX_LINES} صنف في الطلب الواحد.`);

      const note = str(req.body.note).slice(0, 300);
      const seen = new Set();
      const snapshot = [];
      const { map: secMap } = await sectionsMap();

      for (const line of lines) {
        const itemId = str(line?.itemId);
        const quantity = Number(line?.quantity);
        if (!validId(itemId)) return fail(res, 400, 'صنف غير صحيح في الطلب.');
        if (!isQty(quantity, 1)) return fail(res, 400, 'الكمية لازم تكون رقم صحيح أكبر من صفر.');
        if (seen.has(itemId)) return fail(res, 400, 'الصنف متكرر في الطلب.');
        seen.add(itemId);

        const item = await WarehouseItem.findOne({ _id: itemId, active: true }).lean();
        if (!item) return fail(res, 400, 'في صنف مش متاح في المخزن.');
        snapshot.push({ itemId: item._id, name: item.name, sectionName: secMap.get(item.sectionId.toString()) || '', unit: item.unit, quantity });
      }

      const doc = await WarehouseRequest.create({
        requesterId: req.user._id,
        requesterName: req.user.fullName,
        requesterRole: has(req.user, 'SUPERVISOR') ? 'SUPERVISOR' : has(req.user, 'ASSISTANT') ? 'ASSISTANT' : 'SERVANT',
        stageId: req.user.stageId,
        items: snapshot,
        note,
        createdAt: new Date()
      });

      res.status(201).json({ success: true, message: 'تم إرسال الطلب لخادم المخزن.', data: { request: presentRequest(doc.toObject(), await stagesMap(), req.user) } });
    } catch (e) { next(e); }
  });

  const loadScoped = async (req) => {
    if (!validId(req.params.id)) return null;
    return WarehouseRequest.findOne({ $and: [{ _id: req.params.id }, requestScope(req.user)] });
  };

  router.get('/requests/:id', async (req, res, next) => {
    try {
      const doc = await loadScoped(req);
      if (!doc) return fail(res, 404, 'الطلب غير موجود.', 'NOT_FOUND');
      res.json({ success: true, data: { request: presentRequest(doc.toObject(), await stagesMap(), req.user) } });
    } catch (e) { next(e); }
  });

  // إلغاء الطلب بواسطة صاحبه طالما لم يُراجع
  router.delete('/requests/:id', async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return fail(res, 404, 'الطلب غير موجود.', 'NOT_FOUND');
      const r = await WarehouseRequest.findOneAndUpdate(
        { _id: req.params.id, requesterId: req.user._id, status: 'PENDING' },
        { $set: { status: 'CANCELLED' } }
      );
      if (!r) return fail(res, 404, 'الطلب غير موجود أو اتراجع بالفعل.', 'NOT_FOUND');
      res.json({ success: true, message: 'تم إلغاء الطلب.' });
    } catch (e) { next(e); }
  });

  // خادم المخزن يعدّل تفاصيل الطلب قبل اتخاذ القرار النهائي
  router.patch('/requests/:id/items', onlyKeeper, async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return fail(res, 404, 'الطلب غير موجود.', 'NOT_FOUND');
      const doc = await WarehouseRequest.findOne({ _id: req.params.id, status: 'PENDING' });
      if (!doc) return fail(res, 409, 'لا يمكن تعديل طلب تمت مراجعته.', 'CONFLICT');
      const lines = Array.isArray(req.body.items) ? req.body.items : [];
      if (!lines.length || lines.length > MAX_LINES) return fail(res, 400, 'الطلب لازم يحتوي على صنف واحد على الأقل وبحد أقصى 30 صنف.');
      const seen = new Set(); const snapshot = []; const { map } = await sectionsMap();
      for (const line of lines) {
        const itemId = str(line?.itemId); const quantity = Number(line?.quantity);
        if (!validId(itemId) || !isQty(quantity, 1) || seen.has(itemId)) return fail(res, 400, 'راجع الأصناف والكميات؛ لا يسمح بالتكرار أو الكميات غير الصحيحة.');
        seen.add(itemId);
        const item = await WarehouseItem.findById(itemId).lean();
        if (!item) return fail(res, 400, 'أحد الأصناف لم يعد موجودًا بالمخزن.');
        snapshot.push({ itemId: item._id, name: item.name, sectionName: map.get(item.sectionId.toString()) || '', unit: item.unit, quantity });
      }
      const updated = await WarehouseRequest.findOneAndUpdate({ _id: doc._id, status: 'PENDING' }, { $set: { items: snapshot }, $push: { auditTrail: { action: 'KEEPER_EDIT', byId: req.user._id, byName: req.user.fullName, at: new Date(), details: 'تم تعديل الأصناف والكميات قبل المراجعة.' } } }, { new: true }).lean();
      if (!updated) return fail(res, 409, 'تمت مراجعة الطلب بالفعل ولا يمكن تعديله.', 'CONFLICT');
      res.json({ success: true, message: 'تم تعديل الطلب قبل مراجعته.', data: { request: presentRequest(updated, await stagesMap(), req.user) } });
    } catch (e) { next(e); }
  });

  // صاحب الطلب يرسل طلب تعديل منفصل بعد المراجعة؛ لا يتغير الطلب الأصلي مباشرة
  router.post('/requests/:id/amendment', async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return fail(res, 404, 'الطلب غير موجود.', 'NOT_FOUND');
      const parent = await WarehouseRequest.findOne({ _id: req.params.id, requesterId: req.user._id, status: { $in: ['APPROVED', 'REJECTED'] }, isAmendment: { $ne: true } }).lean();
      if (!parent) return fail(res, 404, 'لا يمكن طلب تعديل لهذا الطلب.', 'NOT_FOUND');
      if (await WarehouseRequest.exists({ amendmentOf: parent._id, status: 'PENDING' })) return fail(res, 409, 'يوجد طلب تعديل قيد المراجعة بالفعل.', 'CONFLICT');
      const lines = Array.isArray(req.body.items) ? req.body.items : [];
      if (!lines.length || lines.length > MAX_LINES) return fail(res, 400, 'الطلب لازم يحتوي على صنف واحد على الأقل وبحد أقصى 30 صنف.');
      const seen = new Set(); const snapshot = []; const { map } = await sectionsMap();
      for (const line of lines) {
        const itemId = str(line?.itemId); const quantity = Number(line?.quantity);
        if (!validId(itemId) || !isQty(quantity, 1) || seen.has(itemId)) return fail(res, 400, 'راجع الأصناف والكميات.') ;
        seen.add(itemId);
        const item = await WarehouseItem.findOne({ _id: itemId, active: true }).lean();
        if (!item) return fail(res, 400, 'أحد الأصناف غير متاح حاليًا.');
        snapshot.push({ itemId: item._id, name: item.name, sectionName: map.get(item.sectionId.toString()) || '', unit: item.unit, quantity });
      }
      const amendment = await WarehouseRequest.create({ requesterId: parent.requesterId, requesterName: parent.requesterName, requesterRole: parent.requesterRole, stageId: parent.stageId, items: snapshot, note: str(req.body.note).slice(0, 300), status: 'PENDING', isAmendment: true, amendmentOf: parent._id, auditTrail: [{ action: 'AMENDMENT_REQUESTED', byId: req.user._id, byName: req.user.fullName, at: new Date(), details: `طلب تعديل للطلب ${parent._id}` }] });
      res.status(201).json({ success: true, message: 'تم إرسال طلب التعديل لخادم المخزن.', data: { request: presentRequest(amendment.toObject(), await stagesMap(), req.user) } });
    } catch (e) { next(e); }
  });

  // القبول والخصم وتحديث الطلب عملية واحدة داخل Transaction لمنع الخصم الجزئي أو المكرر.
  router.post('/requests/:id/approve', onlyKeeper, async (req, res, next) => {
    const session = await mongoose.startSession();
    try {
      if (!validId(req.params.id)) return fail(res, 404, 'الطلب غير موجود.', 'NOT_FOUND');
      const comment = str(req.body.comment).slice(0, 500);
      let approvedRequest = null;
      let responseMessage = '';

      await session.withTransaction(async () => {
        const doc = await WarehouseRequest.findOne({ _id: req.params.id, status: 'PENDING' }).session(session);
        if (!doc) {
          const error = new Error('الطلب غير موجود أو اتراجع بالفعل.');
          error.httpStatus = 409; error.apiCode = 'CONFLICT'; throw error;
        }

        let parent = null;
        let stockChanges = [];
        if (doc.isAmendment) {
          parent = await WarehouseRequest.findById(doc.amendmentOf).session(session);
          if (!parent || !['APPROVED', 'REJECTED'].includes(parent.status)) {
            const error = new Error('الطلب الأصلي لم يعد صالحًا للتعديل.');
            error.httpStatus = 409; error.apiCode = 'CONFLICT'; throw error;
          }
          const previous = new Map((parent.status === 'APPROVED' ? parent.items : []).map(x => [x.itemId.toString(), x]));
          const revised = new Map(doc.items.map(x => [x.itemId.toString(), x]));
          for (const id of new Set([...previous.keys(), ...revised.keys()])) {
            const oldLine = previous.get(id); const newLine = revised.get(id);
            const delta = (newLine?.quantity || 0) - (oldLine?.quantity || 0);
            if (!delta) continue;
            const filter = delta > 0 ? { _id: id, quantity: { $gte: delta } } : { _id: id };
            const result = await WarehouseItem.updateOne(filter, {
              $inc: { quantity: -delta }, $set: { updatedAt: new Date() }
            }, { session });
            if (result.modifiedCount !== 1) {
              const error = new Error(`الكمية المتاحة من «${newLine?.name || oldLine?.name}» غير كافية أو الصنف غير موجود.`);
              error.httpStatus = 409; error.apiCode = 'INSUFFICIENT_STOCK'; throw error;
            }
            stockChanges.push({ itemId: id, delta });
          }
        } else {
          for (const line of doc.items) {
            const result = await WarehouseItem.updateOne(
              { _id: line.itemId, quantity: { $gte: line.quantity } },
              { $inc: { quantity: -line.quantity }, $set: { updatedAt: new Date() } },
              { session }
            );
            if (result.modifiedCount !== 1) {
              const error = new Error(`الكمية المتاحة من «${line.name}» مش كافية أو الصنف اتحذف.`);
              error.httpStatus = 409; error.apiCode = 'INSUFFICIENT_STOCK'; throw error;
            }
            stockChanges.push({ itemId: line.itemId, delta: line.quantity });
          }
        }

        doc.status = 'APPROVED';
        doc.reviewerId = req.user._id;
        doc.reviewerName = req.user.fullName;
        doc.reviewComment = comment;
        doc.reviewedAt = new Date();
        doc.auditTrail.push({ action: 'APPROVED', byId: req.user._id, byName: req.user.fullName, at: new Date(), details: comment });
        await doc.save({ session });

        if (parent) {
          parent.items = doc.items;
          parent.status = 'APPROVED';
          parent.auditTrail.push({ action: 'AMENDMENT_APPROVED', byId: req.user._id, byName: req.user.fullName, at: new Date(), details: 'تم اعتماد طلب التعديل وتسوية فرق الكميات.' });
          await parent.save({ session });
        }

        approvedRequest = doc.toObject();
        responseMessage = doc.isAmendment ? 'تم قبول التعديل وتسوية المخزون تلقائيًا.' : 'تم قبول الطلب وخصم الكميات من المخزن.';
      });

      res.json({ success: true, message: responseMessage, data: { request: presentRequest(approvedRequest, await stagesMap(), req.user) } });
    } catch (e) {
      if (e.httpStatus) return fail(res, e.httpStatus, e.message, e.apiCode);
      next(e);
    } finally {
      await session.endSession();
    }
  });

  router.post('/requests/:id/reject', onlyKeeper, async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return fail(res, 404, 'الطلب غير موجود.', 'NOT_FOUND');
      const comment = str(req.body.comment).slice(0, 500);

      const done = await WarehouseRequest.findOneAndUpdate(
        { _id: req.params.id, status: 'PENDING' },
        { $set: { status: 'REJECTED', reviewerId: req.user._id, reviewerName: req.user.fullName, reviewComment: comment, reviewedAt: new Date() }, $push: { auditTrail: { action: 'REJECTED', byId: req.user._id, byName: req.user.fullName, at: new Date(), details: comment } } },
        { new: true }
      ).lean();
      if (!done) return fail(res, 404, 'الطلب غير موجود أو اتراجع بالفعل.', 'NOT_FOUND');

      res.json({ success: true, message: 'تم رفض الطلب.', data: { request: presentRequest(done, await stagesMap(), req.user) } });
    } catch (e) { next(e); }
  });

  return router;
}
