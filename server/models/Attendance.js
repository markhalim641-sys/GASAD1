import mongoose from 'mongoose';

export const ATTENDANCE_TYPES = ['MASS', 'SERVICE']; // القداس / الخدمة

// "ورقة" حضور محفوظة لمرحلة في أسبوع (لكل نوع) — وجودها يعني أن الحضور تم تسجيله
const sessionSchema = new mongoose.Schema({
  weekStart: { type: Date, required: true },
  type: { type: String, enum: ATTENDANCE_TYPES, required: true },
  stageId: { type: Number, required: true },
  savedAt: { type: Date, default: Date.now },
  savedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  savedByName: { type: String, default: '' }
}, { versionKey: false });
sessionSchema.index({ weekStart: 1, type: 1, stageId: 1 }, { unique: true });

// حضور/غياب كل خادم في أسبوع
const recordSchema = new mongoose.Schema({
  weekStart: { type: Date, required: true },
  type: { type: String, enum: ATTENDANCE_TYPES, required: true },
  stageId: { type: Number, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName: { type: String, required: true },
  isLead: { type: Boolean, default: false },
  present: { type: Boolean, required: true },
  markedAt: { type: Date, default: Date.now }
}, { versionKey: false });
recordSchema.index({ weekStart: 1, type: 1, userId: 1 }, { unique: true });
recordSchema.index({ stageId: 1, weekStart: -1 });
recordSchema.index({ userId: 1, weekStart: -1 });

export const AttendanceSession = mongoose.model('AttendanceSession', sessionSchema);
export const AttendanceRecord = mongoose.model('AttendanceRecord', recordSchema);
