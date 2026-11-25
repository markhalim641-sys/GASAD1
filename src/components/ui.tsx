import { useEffect, useState } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** عدّاد متحرك للأرقام (خفيف: requestAnimationFrame فقط) */
export function useCountUp(target: number, ms = 800) {
  const [v, setV] = useState(reduced() ? target : 0);
  useEffect(() => {
    if (reduced()) { setV(target); return; }
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export const CountUp = ({ value }: { value: number }) => <>{useCountUp(value)}</>;

export const TZ = 'Africa/Cairo';
export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('ar-EG', { timeZone: TZ, day: 'numeric', month: 'long' });
export const weekRange = (startIso: string, endIso: string) => `${fmtDay(startIso)} — ${fmtDay(new Date(new Date(endIso).getTime() - 3600_000).toISOString())}`;
export const initial = (name: string) => name.trim().charAt(0) || '؟';
export const weekLabel = (weeksAgo: number) => (weeksAgo === 0 ? 'الأسبوع الحالي' : weeksAgo === 1 ? 'الأسبوع الماضي' : `قبل ${weeksAgo} أسابيع`);
