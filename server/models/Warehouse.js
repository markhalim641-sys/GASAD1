import mongoose from 'mongoose';

// أقسام المخزن (مثال: أدوات كتابة، ملابس، حلويات...)
const sectionSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80, unique: true },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

// أصناف المخزن
const itemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  sectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'WarehouseSection', required: true, index: true },
  quantity: { type: Number, required: true, min: 0, default: 0 },
  unit: { type: String, trim: true, maxlength: 20, default: 'قطعة' },
  description: { type: String, trim: true, maxlength: 300, default: '' },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });

itemSchema.index({ sectionId: 1, name: 1 }, { unique: true });

// طلبات الخدام وأمناء الخدمة من المخزن
const requestSchema = new mongoose.Schema({
  requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  requesterName: { type: String, required: true },
  requesterRole: { type: String, enum: ['SERVANT', 'SUPERVISOR', 'ASSISTANT'], required: true },
  stageId: { type: Number, default: null, index: true },

  // لقطة وقت الطلب (حتى لو تغيّر الصنف أو اتحذف بعد كده)
  items: [{
    _id: false,
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    sectionName: { type: String, default: '' },
    unit: { type: String, default: 'قطعة' },
    quantity: { type: Number, required: true, min: 1 }
  }],
  note: { type: String, trim: true, maxlength: 300, default: '' },

  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'], default: 'PENDING', index: true },
  reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewerName: { type: String, default: '' },
  reviewComment: { type: String, trim: true, maxlength: 500, default: '' },
  reviewedAt: { type: Date, default: null },
  amendmentOf: { type: mongoose.Schema.Types.ObjectId, ref: 'WarehouseRequest', default: null, index: true },
  isAmendment: { type: Boolean, default: false },
  auditTrail: [{ _id: false, action: { type: String, required: true }, byId: { type: mongoose.Schema.Types.ObjectId, default: null }, byName: { type: String, default: '' }, at: { type: Date, default: Date.now }, details: { type: String, default: '' } }],

  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

export const WarehouseSection = mongoose.model('WarehouseSection', sectionSchema);
export const WarehouseItem = mongoose.model('WarehouseItem', itemSchema);
export const WarehouseRequest = mongoose.model('WarehouseRequest', requestSchema);
