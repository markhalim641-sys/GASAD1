import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Church, HandHeart, Save } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth';
import { STAGE_ICON } from '../roles';
import { CountUp, fmtDay, initial, weekLabel, weekRange } from '../components/ui';

interface Row { id: string; name: string; isLead: boolean; mass: number; service: number; total: number; lastAbsent: string | null }
interface StageSum { id: number; slug: string; name: string; weeksRecorded: { MASS: number; SERVICE: number }; totals: { mass: number; service: number; all: number }; servants: Row[] }
interface Summary { level: 'ALL' | 'STAGE' | 'OWN'; range: number | 'all'; stages: StageSum[] }
interface SheetServant { id: string; name: string; isLead: boolean; mass: boolean | null; service: boolean | null }
interface SheetStage { id: number; slug: string; name: string; taken: { MASS: string | null; SERVICE: string | null }; servants: SheetServant[] }
interface Sheet { level: 'ALL' | 'STAGE'; canMark: boolean; week: { start: string; end: string; weeksAgo: number }; stages: SheetStage[] }

const sev = (n: number) => (n === 0 ? 'zero' : n <= 2 ? 'mid' : 'high');
const fmtTime = (iso: string) => new Date(iso).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'long', hour: 'numeric', minute: '2-digit' });

// ===================== الغياب والإحصائيات =====================
function Stats() {
  const { user } = useAuth();
  const [range, setRange] = useState<string>('all');
  const [open, setOpen] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ['att-summary', user?.id, range],
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.get<Summary>('/attendance/summary', { params: { range } })).data,
  });
  const d = q.data;
  const single = d?.level !== 'ALL';
  const opened = (id: number) => (single ? true : open === id);
  const ranges: [string, string][] = [['all', 'الكل'], ['4', 'آخر 4 أسابيع'], ['12', 'آخر 12 أسبوع']];
  const grand = useMemo(() => (d?.stages ?? []).reduce((n, s) => n + s.totals.all, 0), [d]);

  return (
    <>
      <div className="att-bar">
        <div className="wh-chips" role="tablist">{ranges.map(([v, l]) => <button key={v} role="tab" aria-selected={range === v} className={`wh-chip${range === v ? ' on' : ''}`} onClick={() => setRange(v)}>{l}</button>)}</div>
        {d && !single && <span className="att-grand">إجمالي الغياب: <b><CountUp value={grand} /></b></span>}
      </div>
      {q.isError && <div className="err">{errorMessage(q.error)}</div>}
      {q.isLoading && <p>جارٍ التحميل…</p>}
      <div className="att-stages vstagger" style={{ opacity: q.isPlaceholderData ? 0.65 : 1 }}>
        {d?.stages.map(s => (
          <section key={s.id} className="att-stage" data-stage={s.slug}>
            <button className="att-stage-head" onClick={() => !single && setOpen(o => (o === s.id ? null : s.id))} aria-expanded={opened(s.id)} disabled={single}>
              <span className="att-ic" aria-hidden>{STAGE_ICON[s.slug] ?? '📘'}</span>
              <div className="att-title"><b>{s.name}</b><small>{s.servants.length} خادم · تسجيل {s.weeksRecorded.MASS} قداس / {s.weeksRecorded.SERVICE} خدمة</small></div>
              <div className="att-badges">
                <span className="abadge mass"><Church size={14} /> {s.totals.mass}</span>
                <span className="abadge service"><HandHeart size={14} /> {s.totals.service}</span>
                <span className={`abadge total ${sev(s.totals.all)}`}>{s.totals.all}</span>
              </div>
              {!single && <ChevronDown size={18} className={`prep-chev2${opened(s.id) ? ' open' : ''}`} />}
            </button>
            {opened(s.id) && (
              <div className="att-body">
                {s.servants.length === 0 && <p className="prep-nosv">مفيش خدام في المرحلة دي لسه.</p>}
                {s.servants.map(r => (
                  <div key={r.id} className={`att-row ${sev(r.total)}`}>
                    <span className="vav">{initial(r.name)}</span>
                    <div className="att-name"><b>{r.name}</b><small>{r.isLead ? 'مشرف' : 'خادم'}{r.lastAbsent ? ` · آخر غياب ${fmtDay(r.lastAbsent)}` : ''}</small></div>
                    <span className="abadge mass" title="غياب القداس"><Church size={14} /> {r.mass}</span>
                    <span className="abadge service" title="غياب الخدمة"><HandHeart size={14} /> {r.service}</span>
                    <span className={`abadge total ${sev(r.total)}`} title="الإجمالي">{r.total}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </>
  );
}

// ===================== تسجيل الحضور (خادم الغياب / الأدمن) =====================
function StageSheet({ st, weeks, onSaved }: { st: SheetStage; weeks: number; onSaved: () => void }) {
  const init = () => ({ mass: new Set(st.servants.filter(s => s.mass).map(s => s.id)), service: new Set(st.servants.filter(s => s.service).map(s => s.id)) });
  const [sel, setSel] = useState(init);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setSel(init()); setDirty(false); /* eslint-disable-next-line */ }, [st, weeks]);

  const toggle = (k: 'mass' | 'service', id: string) => { setDirty(true); setSel(p => { const n = new Set(p[k]); n.has(id) ? n.delete(id) : n.add(id); return { ...p, [k]: n }; }); };
  const all = (k: 'mass' | 'service') => { setDirty(true); setSel(p => ({ ...p, [k]: p[k].size === st.servants.length ? new Set() : new Set(st.servants.map(s => s.id)) })); };
  const save = useMutation({
    mutationFn: async () => { await api.put('/attendance/sheet', { weeks, stageId: st.id, mass: [...sel.mass], service: [...sel.service] }); },
    onSuccess: () => { setErr(null); setDirty(false); onSaved(); },
    onError: e => setErr(errorMessage(e)),
  });
  const takenBoth = st.taken.MASS && st.taken.SERVICE;

  return (
    <div className="att-body">
      <div className="att-sheet-head">
        <span>الخادم</span>
        <button className="att-all" onClick={() => all('mass')}><Church size={14} /> قداس (الكل)</button>
        <button className="att-all" onClick={() => all('service')}><HandHeart size={14} /> خدمة (الكل)</button>
      </div>
      {st.servants.length === 0 && <p className="prep-nosv">مفيش خدام في المرحلة دي لسه.</p>}
      {st.servants.map(s => (
        <div key={s.id} className="att-row">
          <span className="vav">{initial(s.name)}</span>
          <div className="att-name"><b>{s.name}</b><small>{s.isLead ? 'مشرف' : 'خادم'}</small></div>
          <button className={`att-toggle mass${sel.mass.has(s.id) ? ' on' : ''}`} onClick={() => toggle('mass', s.id)} aria-pressed={sel.mass.has(s.id)}>{sel.mass.has(s.id) ? <Check size={16} /> : null}{sel.mass.has(s.id) ? 'حاضر' : 'غائب'}</button>
          <button className={`att-toggle service${sel.service.has(s.id) ? ' on' : ''}`} onClick={() => toggle('service', s.id)} aria-pressed={sel.service.has(s.id)}>{sel.service.has(s.id) ? <Check size={16} /> : null}{sel.service.has(s.id) ? 'حاضر' : 'غائب'}</button>
        </div>
      ))}
      {err && <div className="err">{err}</div>}
      <div className="att-save">
        <button className="btn" disabled={save.isPending || st.servants.length === 0} onClick={() => save.mutate()}><Save size={16} /> {save.isPending ? 'جارٍ الحفظ…' : takenBoth ? 'تحديث الحضور' : 'حفظ الحضور'}</button>
        {dirty ? <span className="att-state dirty">فيه تعديلات لم تُحفظ</span> : takenBoth ? <span className="att-state ok"><CheckCircle2 size={15} /> اتسجّل {st.taken.MASS ? fmtTime(st.taken.MASS) : ''}</span> : <span className="att-state">لم يُسجَّل بعد — الغائب = اللي مش متعلّم</span>}
      </div>
    </div>
  );
}

function Marking() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [weeks, setWeeks] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ['att-sheet', user?.id, weeks],
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.get<Sheet>('/attendance/sheet', { params: { weeks } })).data,
  });
  const d = q.data;
  const refresh = () => { qc.invalidateQueries({ queryKey: ['att-sheet'] }); qc.invalidateQueries({ queryKey: ['att-summary'] }); qc.invalidateQueries({ queryKey: ['att-overview'] }); };

  return (
    <>
      <div className="att-bar">
        <div className="prep-weeknav" role="group" aria-label="الأسبوع">
          <button className="btn btn--ghost btn--sm" onClick={() => setWeeks(w => Math.min(12, w + 1))} disabled={weeks >= 12}><ChevronRight size={16} /> الأسبوع السابق</button>
          <span>{weekLabel(weeks)}<small>{d ? weekRange(d.week.start, d.week.end) : ''}</small></span>
          <button className="btn btn--ghost btn--sm" onClick={() => setWeeks(w => Math.max(0, w - 1))} disabled={weeks === 0}>الأسبوع التالي <ChevronLeft size={16} /></button>
        </div>
      </div>
      {q.isError && <div className="err">{errorMessage(q.error)}</div>}
      {q.isLoading && <p>جارٍ التحميل…</p>}
      <div className="att-stages vstagger" style={{ opacity: q.isPlaceholderData ? 0.65 : 1 }}>
        {d?.stages.map(s => {
          const done = !!(s.taken.MASS && s.taken.SERVICE);
          return (
            <section key={s.id} className="att-stage" data-stage={s.slug}>
              <button className="att-stage-head" onClick={() => setOpen(o => (o === s.id ? null : s.id))} aria-expanded={open === s.id}>
                <span className="att-ic" aria-hidden>{STAGE_ICON[s.slug] ?? '📘'}</span>
                <div className="att-title"><b>{s.name}</b><small>{s.servants.length} خادم</small></div>
                <span className={`att-pill${done ? ' ok' : ''}`}>{done ? 'اتسجّل ✓' : s.taken.MASS || s.taken.SERVICE ? 'جزئي' : 'لم يُسجَّل'}</span>
                <ChevronDown size={18} className={`prep-chev2${open === s.id ? ' open' : ''}`} />
              </button>
              {open === s.id && <StageSheet st={s} weeks={weeks} onSaved={refresh} />}
            </section>
          );
        })}
      </div>
    </>
  );
}

export default function Attendance() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const canMark = roles.includes('ADMIN') || roles.includes('ATTENDANCE');
  const marker = roles.includes('ATTENDANCE');
  const [tab, setTab] = useState<'mark' | 'stats'>(marker ? 'mark' : 'stats');
  const own = !canMark && !roles.some(r => r === 'SUPERVISOR' || r === 'ASSISTANT');

  return (
    <>
      <div className="page-head"><h2>{own ? 'حضوري' : 'الحضور والغياب'}</h2><span className="page-head-orn" aria-hidden /></div>
      <p className="prep-lead">{canMark ? 'سجّل حضور القداس والخدمة لكل مرحلة، وتابع أعداد الغياب.' : own ? 'عدد مرات غيابك عن القداس والخدمة.' : 'خدام مرحلتك وعدد غيابهم عن القداس والخدمة.'}</p>
      {canMark && (
        <div className="att-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'mark'} className={`att-tab${tab === 'mark' ? ' on' : ''}`} onClick={() => setTab('mark')}><Check size={16} /> تسجيل الحضور</button>
          <button role="tab" aria-selected={tab === 'stats'} className={`att-tab${tab === 'stats' ? ' on' : ''}`} onClick={() => setTab('stats')}><Church size={16} /> الغياب والإحصائيات</button>
        </div>
      )}
      {canMark && tab === 'mark' ? <Marking /> : <Stats />}
    </>
  );
}
