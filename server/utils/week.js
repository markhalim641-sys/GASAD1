// أسبوع التحضير بتوقيت القاهرة:
//   يبدأ السبت 00:00  →  يُقفل الجمعة 08:00  →  يُفتح الأسبوع الجديد الجمعة 24:00 (= السبت 00:00)
// في فترة القفل (الجمعة من 8 صباحًا حتى منتصف الليل) لا يمكن رفع تحضير.
const TZ = 'Africa/Cairo';
const DAY = 86_400_000;
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', weekday: 'short',
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
});

function parts(date) {
  const o = {};
  for (const p of fmt.formatToParts(date)) o[p.type] = p.value;
  return {
    y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute, s: +o.second,
    dow: WEEKDAYS[o.weekday]
  };
}

// فرق التوقيت (بالمللي ثانية) بين القاهرة و UTC عند لحظة معينة (يراعي التوقيت الصيفي)
function offsetAt(date) {
  const p = parts(date);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

// تحويل وقت محلي بالقاهرة إلى لحظة UTC
function cairoToUtc(y, m, d, h = 0) {
  const guess = Date.UTC(y, m - 1, d, h);
  let t = guess - offsetAt(new Date(guess));
  t = guess - offsetAt(new Date(t));
  return new Date(t);
}

/** معلومات الأسبوع الذي يقع فيه `now` (أو أسبوع سابق بعدد weeksAgo). */
export function weekInfo(now = new Date(), weeksAgo = 0) {
  const p = parts(now);
  const sinceSat = (p.dow + 1) % 7; // السبت=0 ... الجمعة=6

  // منتصف ليل السبت (بتوقيت القاهرة) لهذا الأسبوع
  const satLocal = new Date(Date.UTC(p.y, p.m - 1, p.d) - sinceSat * DAY - weeksAgo * 7 * DAY);
  const sy = satLocal.getUTCFullYear(), sm = satLocal.getUTCMonth() + 1, sd = satLocal.getUTCDate();

  const start = cairoToUtc(sy, sm, sd, 0);
  const fri = new Date(satLocal.getTime() + 6 * DAY);
  const closesAt = cairoToUtc(fri.getUTCFullYear(), fri.getUTCMonth() + 1, fri.getUTCDate(), 8);
  const next = new Date(satLocal.getTime() + 7 * DAY);
  const end = cairoToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0);

  return {
    start,            // بداية الأسبوع
    end,              // نهاية الأسبوع (= بداية التالي)
    closesAt,         // الجمعة 8 صباحًا
    reopensAt: end,   // الجمعة 12 بالليل
    isCurrent: weeksAgo === 0,
    isOpen: weeksAgo === 0 && now.getTime() < closesAt.getTime()
  };
}

export const uploadsOpen = (now = new Date()) => weekInfo(now).isOpen;
