import Stage from '../models/Stage.js';

// المراحل تتغير نادرًا جدًا، فنخزّنها في الذاكرة دقيقة واحدة لتقليل الرحلات لقاعدة البيانات
let cache = null;
let at = 0;
const TTL = 60_000;

export async function getStages() {
  if (cache && Date.now() - at < TTL) return cache;
  cache = await Stage.find().sort({ order: 1, id: 1 }).lean();
  at = Date.now();
  return cache;
}

export const clearStagesCache = () => { cache = null; };
