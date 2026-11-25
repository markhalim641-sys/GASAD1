
import mongoose from 'mongoose';

const stageSchema = new mongoose.Schema({
  id: {
    type: Number,
    required: true,
    unique: true
  },
  slug: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  // ترتيب/رقم العرض. الـ id ثابت حتى لا تتأثر بيانات المستخدمين الحالية.
  order: {
    type: Number,
    default: null
  }
}, {
  versionKey: false
});

export default mongoose.model('Stage', stageSchema);
