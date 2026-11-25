import sharp from 'sharp';

// الصيغ المقبولة فقط (يُتحقق منها من محتوى الملف الفعلي وليس من الامتداد أو الـ MIME المرسل).
// SVG مرفوض عمدًا لأنه قد يحمل سكربتات.
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif']);

export const MAX_INPUT_BYTES = 10 * 1024 * 1024; // 10MB قبل الضغط
const MAX_INPUT_PIXELS = 50_000_000;             // حماية من Decompression Bomb
const MAX_SIDE = 1920;                           // أطول ضلع بعد التصغير
const THUMB_SIDE = 360;
const MAX_OUTPUT_BYTES = 3 * 1024 * 1024;        // حد أمان للمخزَّن

export class ImageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImageError';
  }
}

/**
 * يتحقق من الصورة، يصحح الاتجاه، يصغّرها مع الحفاظ على النسبة،
 * يحذف الـ metadata (EXIF/GPS...)، ويحولها إلى WebP مضغوط + صورة مصغرة.
 */
export async function processImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ImageError('الملف فارغ.');
  }

  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new ImageError('الملف ليس صورة صالحة.');
  }

  if (!ALLOWED_FORMATS.has(meta.format)) {
    throw new ImageError('صيغة الصورة غير مدعومة. المسموح: JPG, PNG, WebP, GIF, AVIF.');
  }

  try {
    // بدون withMetadata => يتم حذف كل الـ metadata تلقائيًا.
    const base = () => sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      .rotate(); // تصحيح الاتجاه حسب EXIF قبل حذفه

    const { data, info } = await base()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    const thumb = await base()
      .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 70, effort: 3 })
      .toBuffer();

    if (data.length > MAX_OUTPUT_BYTES) {
      throw new ImageError('الصورة كبيرة جدًا حتى بعد الضغط.');
    }

    return {
      data,
      thumb,
      mimeType: 'image/webp',
      width: info.width,
      height: info.height,
      size: data.length
    };
  } catch (error) {
    if (error instanceof ImageError) throw error;
    throw new ImageError('تعذرت معالجة الصورة. تأكد أنها غير تالفة.');
  }
}
