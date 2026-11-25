
import Stage from './models/Stage.js';

const STAGES = [
  // المرحلة الأولى كانت "بلاي وكي جي و١ و٢" وتم تقسيمها إلى مرحلتين.
  // الـ id ثابت للمراحل القديمة (لا تتأثر بيانات الخدام)، و order هو رقم العرض.
  { id: 1, slug: 'kg', name: 'بلاي وكي جي', order: 1 },
  { id: 8, slug: 'g1-2', name: '١ و ٢', order: 2 },
  { id: 2, slug: 'g3-4', name: '٣ و٤', order: 3 },
  { id: 3, slug: 'g5-6', name: '٥ و٦', order: 4 },
  { id: 4, slug: 'prep-boys', name: 'إعدادي ولاد', order: 5 },
  { id: 5, slug: 'prep-girls', name: 'إعدادي بنات', order: 6 },
  { id: 6, slug: 'sec-boys', name: 'ثانوي ولاد', order: 7 },
  { id: 7, slug: 'sec-girls', name: 'ثانوي بنات', order: 8 },
];

export async function seedStages() {
  for (const stage of STAGES) {
    await Stage.updateOne(
      { id: stage.id },
      { $set: stage },
      { upsert: true }
    );
  }

  console.log('تم تجهيز مراحل الخدمة في MongoDB بنجاح.');
}
