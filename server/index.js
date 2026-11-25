
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import mongoose from 'mongoose';

import { connectDB } from './config/database.js';
import { seedStages } from './seed.js';
import User from './models/User.js';
import Stage from './models/Stage.js';
import Session from './models/Session.js';
import { hash, verify } from './utils/password.js';
import { createPreparationsRouter } from './routes/preparations.js';
import { createWarehouseRouter } from './routes/warehouse.js';
import { getStages } from './utils/stagesCache.js';
import { createAttendanceRouter } from './routes/attendance.js';
import { isAdmin as roleIsAdmin, isLead, validateRolesAndStage } from './utils/roles.js';

const app = express();
const PORT = process.env.PORT || 4000;

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  process.env.CLIENT_URL
].filter(Boolean);

// في التطوير نسمح أيضًا بالدخول من شبكة البيت (مثلاً الموبايل على نفس الواي فاي)
const LAN_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

const isAllowedOrigin = origin =>
  allowedOrigins.includes(origin) ||
  (process.env.NODE_ENV !== 'production' && LAN_ORIGIN.test(origin));

app.use(cors({
  origin(origin, callback) {
    // السماح بالطلبات التي لا تأتي من متصفح، مثل أدوات الاختبار
    if (!origin || isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    const error = new Error('Origin not allowed by CORS');
    error.status = 403;
    return callback(error);
  },
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/v1/health', (req, res) => {
  res.json({
    success: true,
    message: 'جسد واحد API يعمل',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// تحويل بيانات المستخدم إلى شكل مناسب للـ Frontend
async function formatUser(user) {
  if (!user) return null;

  let stage = null;

  if (user.stageId !== null && user.stageId !== undefined) {
    stage = (await getStages()).find(s => s.id === user.stageId) ?? null;
  }

  return {
    id: user._id.toString(),
    fullName: user.fullName,
    email: user.email,
    username: user.username || null,
    roles: user.roles || [],
    status: user.status,
    stageId: user.stageId ?? null,
    stage: stage
      ? {
          id: stage.id,
          slug: stage.slug,
          name: stage.name
        }
      : null,
    createdAt: user.createdAt
  };
}

// قراءة Cookie الخاصة بالجلسة
function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';

  for (const part of cookieHeader.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');

    if (key === name) {
      return decodeURIComponent(valueParts.join('='));
    }
  }

  return null;
}

function setSessionCookie(res, sid) {
  const production = process.env.NODE_ENV === 'production';

  res.cookie('sid', sid, {
    httpOnly: true,
    secure: production,
    sameSite: production ? 'none' : 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

function clearSessionCookie(res) {
  const production = process.env.NODE_ENV === 'production';

  res.clearCookie('sid', {
    httpOnly: true,
    secure: production,
    sameSite: production ? 'none' : 'lax',
    path: '/'
  });
}

async function createSession(userId, res) {
  const sid = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await Session.create({
    sid,
    userId,
    expiresAt
  });

  setSessionCookie(res, sid);
}

// التأكد من وجود مستخدم مسجل دخوله
async function authenticate(req, res, next) {
  try {
    const sid = getCookie(req, 'sid');

    if (!sid) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHENTICATED',
        message: 'سجّل الدخول أولًا.'
      });
    }

    // رحلة واحدة لقاعدة البيانات بدل اثنتين (الجلسة + المستخدم)
    const [found] = await Session.aggregate([
      { $match: { sid, expiresAt: { $gt: new Date() } } },
      { $limit: 1 },
      { $lookup: { from: User.collection.name, localField: 'userId', foreignField: '_id', as: 'u' } }
    ]);

    const session = found ? { _id: found._id, userId: found.userId } : null;
    const userDoc = found?.u?.[0] ?? null;

    if (!session) {
      clearSessionCookie(res);

      return res.status(401).json({
        success: false,
        code: 'UNAUTHENTICATED',
        message: 'انتهت الجلسة. سجّل الدخول مرة أخرى.'
      });
    }

    const user = userDoc ? User.hydrate(userDoc) : null;

    if (!user) {
      await Session.deleteOne({ _id: session._id });
      clearSessionCookie(res);

      return res.status(401).json({
        success: false,
        code: 'UNAUTHENTICATED',
        message: 'الحساب غير موجود.'
      });
    }

    if (user.status === 'REJECTED') {
      await Session.deleteOne({ _id: session._id });
      clearSessionCookie(res);

      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_REJECTED',
        message: 'تم رفض طلب التسجيل.'
      });
    }

    req.user = user;
    req.session = session;

    next();
  } catch (error) {
    next(error);
  }
}

// التأكد من أن الحساب نشط
function requireActive(req, res, next) {
  if (req.user.status !== 'ACTIVE') {
    return res.status(403).json({
      success: false,
      code: 'ACCOUNT_PENDING',
      message: 'حسابك في انتظار موافقة أمين الخدمة.'
    });
  }

  next();
}

// التأكد من أن المستخدم أمين خدمة
function requireAdmin(req, res, next) {
  if (!req.user.roles?.includes('ADMIN')) {
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'ليس لديك صلاحية لتنفيذ العملية.'
    });
  }

  next();
}

function requireAdminOrSupervisor(req, res, next) {
  const roles = req.user.roles || [];

  if (!roles.includes('ADMIN') && !roles.includes('SUPERVISOR') && !roles.includes('ASSISTANT')) {
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'ليس لديك صلاحية لعرض هذه البيانات.'
    });
  }

  next();
}

// التأكد من صحة MongoDB ObjectId
function validId(id) {
  return mongoose.isValidObjectId(id);
}

// الصفحة الرئيسية للـ API
app.get('/api/v1', (req, res) => {
  res.json({
    success: true,
    message: 'مرحبًا بك في API مشروع جسد واحد',
    endpoints: [
      '/api/v1/health',
      '/api/v1/auth/register',
      '/api/v1/auth/login',
      '/api/v1/auth/me',
      '/api/v1/auth/logout',
      '/api/v1/stages',
      '/api/v1/preparations'
    ]
  });
});

// ==============================
// Authentication: التسجيل
// ==============================
app.post('/api/v1/auth/register', async (req, res, next) => {
  try {
    const fullName = String(req.body.fullName || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (fullName.length < 2 || fullName.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'الاسم يجب أن يكون من حرفين إلى 100 حرف.'
      });
    }

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({
        success: false,
        message: 'البريد الإلكتروني غير صحيح.'
      });
    }

    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        success: false,
        message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل ولا تزيد عن 128 حرفًا.'
      });
    }

    const existing = await User.findOne({ email });

    if (existing) {
      return res.status(409).json({
        success: false,
        code: 'EMAIL_EXISTS',
        message: 'البريد الإلكتروني مسجل بالفعل.'
      });
    }

    const user = await User.create({
      fullName,
      email,
      passwordHash: hash(password),
      status: 'PENDING',
      roles: [],
      stageId: null
    });

    // لا نسجل دخولًا لحساب غير معتمد.
    return res.status(201).json({
      success: true,
      message: 'تم إنشاء الحساب، وهو الآن في انتظار موافقة أمين الخدمة.',
      data: {
        user: await formatUser(user)
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        code: 'ACCOUNT_EXISTS',
        message: 'البريد الإلكتروني أو اسم المستخدم مسجل بالفعل.'
      });
    }

    next(error);
  }
});

// ==============================
// Authentication: تسجيل الدخول
// ==============================
app.post('/api/v1/auth/login', async (req, res, next) => {
  try {
    const identifier = String(
      req.body.identifier ||
      req.body.email ||
      req.body.username ||
      ''
    ).trim().toLowerCase();

    const password = String(req.body.password || '');

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'اكتب البريد الإلكتروني أو اسم المستخدم وكلمة المرور.'
      });
    }

    const user = await User.findOne({
      $or: [
        { email: identifier },
        { username: identifier }
      ]
    });

    if (!user || !verify(password, user.passwordHash)) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'بيانات تسجيل الدخول غير صحيحة.'
      });
    }

    if (user.status === 'REJECTED') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_REJECTED',
        message: 'تم رفض طلب التسجيل. تواصل مع أمين الخدمة.'
      });
    }

    await createSession(user._id, res);

    return res.json({
      success: true,
      message: user.status === 'PENDING'
        ? 'تم تسجيل الدخول، وحسابك في انتظار الموافقة.'
        : 'تم تسجيل الدخول بنجاح.',
      data: {
        user: await formatUser(user)
      }
    });
  } catch (error) {
    next(error);
  }
});

// ==============================
// المستخدم الحالي
// ==============================
app.get('/api/v1/auth/me', authenticate, async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: {
        user: await formatUser(req.user)
      }
    });
  } catch (error) {
    next(error);
  }
});

// ==============================
// تسجيل الخروج
// ==============================
app.post('/api/v1/auth/logout', async (req, res, next) => {
  try {
    const sid = getCookie(req, 'sid');

    if (sid) {
      await Session.deleteOne({ sid });
    }

    clearSessionCookie(res);

    res.json({
      success: true,
      message: 'تم تسجيل الخروج بنجاح.'
    });
  } catch (error) {
    next(error);
  }
});

// ==============================
// مراحل الخدمة
// ==============================

app.get(
  '/api/v1/stages',
  authenticate,
  requireActive,
  async (req, res, next) => {
    try {
      const stages = await getStages();

      res.json({
        success: true,
        data: { stages }
      });
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  '/api/v1/stages/:stageId/members',
  authenticate,
  requireActive,
  requireAdminOrSupervisor,
  async (req, res, next) => {
    try {
      const stageId = Number(req.params.stageId);

      if (!Number.isInteger(stageId)) {
        return res.status(400).json({
          success: false,
          message: 'رقم المرحلة غير صحيح.'
        });
      }

      const stage = await Stage.findOne({ id: stageId }).lean();

      if (!stage) {
        return res.status(404).json({
          success: false,
          message: 'المرحلة غير موجودة.'
        });
      }

      const isAdmin = req.user.roles.includes('ADMIN');

      if (
        !isAdmin &&
        isLead(req.user) &&
        req.user.stageId !== stageId
      ) {
        return res.status(403).json({
          success: false,
          message: 'لا يمكنك عرض بيانات مرحلة أخرى.'
        });
      }

      const users = await User.find({
        stageId,
        status: 'ACTIVE',
        roles: { $in: ['SUPERVISOR', 'ASSISTANT', 'SERVANT'] }
      })
        .select('fullName email roles stageId status')
        .sort({ fullName: 1 })
        .lean();

      const supervisors = users.filter(user =>
        user.roles.includes('SUPERVISOR') || user.roles.includes('ASSISTANT')
      );

      const servants = users.filter(user =>
        user.roles.includes('SERVANT')
      );

      const formatMember = user => ({
        id: user._id.toString(),
        fullName: user.fullName,
        email: user.email,
        roles: user.roles
      });

      res.json({
        success: true,
        data: {
          stage,
          supervisors: supervisors.map(formatMember),
          servants: servants.map(formatMember)
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==============================
// طلبات التسجيل المعلقة
// ==============================
app.get(
  '/api/v1/registrations',
  authenticate,
  requireActive,
  requireAdmin,
  async (req, res, next) => {
    try {
      const users = await User.find({ status: 'PENDING' })
        .sort({ createdAt: 1 });

      const registrations = await Promise.all(
        users.map(user => formatUser(user))
      );

      res.json({
        success: true,
        data: { registrations }
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==============================
// الموافقة على طلب تسجيل
// ==============================
app.post(
  '/api/v1/registrations/:id/approve',
  authenticate,
  requireActive,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!validId(id)) {
        return res.status(400).json({
          success: false,
          message: 'معرّف المستخدم غير صحيح.'
        });
      }

      const user = await User.findById(id);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'المستخدم غير موجود.'
        });
      }

      if (user.status !== 'PENDING') {
        return res.status(409).json({
          success: false,
          message: 'طلب التسجيل ليس في حالة انتظار.'
        });
      }

      const checked = await validateRolesAndStage(
        Array.isArray(req.body.roles) ? req.body.roles : ['SERVANT'],
        req.body.stageId,
        stageId => Stage.exists({ id: stageId })
      );

      if (checked.error) {
        return res.status(400).json({ success: false, message: checked.error });
      }

      const { roles, stageId } = checked;

      user.roles = roles;
      user.stageId = stageId;
      user.status = 'ACTIVE';

      await user.save();

      res.json({
        success: true,
        message: 'تمت الموافقة على الحساب بنجاح.',
        data: { user: await formatUser(user) }
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==============================
// رفض طلب تسجيل
// ==============================
app.post(
  '/api/v1/registrations/:id/reject',
  authenticate,
  requireActive,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!validId(id)) {
        return res.status(400).json({
          success: false,
          message: 'معرّف المستخدم غير صحيح.'
        });
      }

      const user = await User.findById(id);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'المستخدم غير موجود.'
        });
      }

      if (user.status !== 'PENDING') {
        return res.status(409).json({
          success: false,
          message: 'طلب التسجيل ليس في حالة انتظار.'
        });
      }

      user.status = 'REJECTED';
      await user.save();

      await Session.deleteMany({ userId: user._id });

      res.json({
        success: true,
        message: 'تم رفض طلب التسجيل.'
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==============================
// تعديل صلاحيات مستخدم
// ==============================
app.patch(
  '/api/v1/users/:id/roles',
  authenticate,
  requireActive,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!validId(id)) {
        return res.status(400).json({
          success: false,
          message: 'معرّف المستخدم غير صحيح.'
        });
      }

      const user = await User.findById(id);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'المستخدم غير موجود.'
        });
      }

      {
        const checked = await validateRolesAndStage(
          req.body.roles !== undefined ? req.body.roles : user.roles,
          req.body.stageId !== undefined ? req.body.stageId : user.stageId,
          stageId => Stage.exists({ id: stageId })
        );

        if (checked.error) {
          return res.status(400).json({ success: false, message: checked.error });
        }

        user.roles = checked.roles;
        user.stageId = checked.stageId;
      }

      await user.save();

      res.json({
        success: true,
        message: 'تم تحديث بيانات المستخدم.',
        data: { user: await formatUser(user) }
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==============================
// عرض المستخدمين
// ==============================
app.get(
  '/api/v1/users',
  authenticate,
  requireActive,
  requireAdminOrSupervisor,
  async (req, res, next) => {
    try {
      const query = String(req.query.search || '').trim();
      const filter = {};

      if (query) {
        const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
          { fullName: { $regex: safeQuery, $options: 'i' } },
          { email: { $regex: safeQuery, $options: 'i' } },
          { username: { $regex: safeQuery, $options: 'i' } }
        ];
      }

      if (isLead(req.user) && !req.user.roles.includes('ADMIN')) {
        filter.stageId = req.user.stageId;
      }

      const users = await User.find(filter).sort({ fullName: 1 });

      res.json({
        success: true,
        data: {
          users: await Promise.all(users.map(user => formatUser(user)))
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==============================
// إحصائيات لوحة التحكم
// ==============================
app.get(
  '/api/v1/dashboard',
  authenticate,
  requireActive,
  requireAdminOrSupervisor,
  async (req, res, next) => {
    try {
      const isAdmin = req.user.roles.includes('ADMIN');
      const filter = {};

      if (!isAdmin) {
        filter.stageId = req.user.stageId;
      }

      const [totalUsers, pendingUsers, activeUsers, rejectedUsers, servants] =
        await Promise.all([
          User.countDocuments(filter),
          User.countDocuments({ ...filter, status: 'PENDING' }),
          User.countDocuments({ ...filter, status: 'ACTIVE' }),
          User.countDocuments({ ...filter, status: 'REJECTED' }),
          User.countDocuments({
            ...filter,
            status: 'ACTIVE',
            roles: 'SERVANT'
          })
        ]);

      res.json({
        success: true,
        data: {
          stats: {
            totalUsers,
            pendingUsers,
            activeUsers,
            rejectedUsers,
            servants
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==============================
// تحضيرك: رفع وعرض صور التحضير (الصلاحيات تُفرض داخل الراوتر)
// ==============================
app.use(
  '/api/v1/preparations',
  createPreparationsRouter({ authenticate, requireActive, validId, allowedOrigins, isAllowedOrigin })
);

// ==============================
// الحضور والغياب (القداس والخدمة) + لوحة الغياب
// ==============================
app.use(
  '/api/v1/attendance',
  createAttendanceRouter({ authenticate, requireActive, validId, isAllowedOrigin })
);

// ==============================
// المخزن: أقسام وأصناف وطلبات (الصلاحيات داخل الراوتر)
// ==============================
app.use(
  '/api/v1/warehouse',
  createWarehouseRouter({ authenticate, requireActive, validId, isAllowedOrigin })
);

// ==============================
// التعامل مع المسارات غير الموجودة
// ==============================
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    message: 'مسار API غير موجود.'
  });
});

// ==============================
// معالجة الأخطاء
// ==============================
app.use((error, req, res, next) => {
  console.error('API error:', error.message);

  if (res.headersSent) {
    return next(error);
  }

  if (error.status === 403) {
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'مصدر الطلب غير مسموح.'
    });
  }

  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'البريد الإلكتروني أو اسم المستخدم مسجل بالفعل.'
    });
  }

  res.status(500).json({
    success: false,
    code: 'SERVER_ERROR',
    message: 'حصل خطأ داخلي في السيرفر.'
  });
});

// ==============================
// تشغيل السيرفر بعد اتصال قاعدة البيانات
// ==============================
async function startServer() {
  try {
    await connectDB();
    await seedStages();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`API جاهز على http://localhost:${PORT}/api/v1`);
      console.log(`Health check: http://localhost:${PORT}/api/v1/health`);
    });
  } catch (error) {
    console.error('تعذر تشغيل السيرفر:', error.message);
    process.exitCode = 1;
  }
}

await startServer();
