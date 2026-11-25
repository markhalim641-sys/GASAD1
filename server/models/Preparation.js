import mongoose from 'mongoose';

export const PREPARATION_CATEGORIES = ['LESSON', 'MEETING', 'ACTIVITY', 'EVENT', 'OTHER'];

// تحضيرك: كل صورة تُخزَّن مضغوطة داخل قاعدة البيانات نفسها كبيانات ثنائية (Buffer)
// وليست Base64. حقول الصورة الثقيلة (data, thumb) مخفية افتراضيًا (select: false)
// حتى لا تُحمَّل أثناء عرض القوائم.
const preparationSchema = new mongoose.Schema({
  // تُملأ من الجلسة في الباك إند فقط، ولا تُقرأ أبدًا من طلب الواجهة.
  uploaderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  uploaderName: { type: String, required: true },
  stageId: { type: Number, default: null, index: true },

  category: { type: String, enum: PREPARATION_CATEGORIES, default: 'LESSON' },
  note: { type: String, default: '', maxlength: 300 },
  originalName: { type: String, default: 'preparation', maxlength: 100 },

  mimeType: { type: String, required: true },
  width: Number,
  height: Number,
  size: { type: Number, required: true },          // حجم الصورة بعد الضغط (بايت)
  originalSize: { type: Number, required: true },  // حجم الملف المرفوع قبل الضغط

  data: { type: Buffer, required: true, select: false },
  thumb: { type: Buffer, required: true, select: false },

  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

preparationSchema.index({ stageId: 1, createdAt: -1 });
preparationSchema.index({ uploaderId: 1, createdAt: -1 });

export default mongoose.model('Preparation', preparationSchema);
