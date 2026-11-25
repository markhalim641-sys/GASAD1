import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Download, ImagePlus, Lock, Search, Trash2, UploadCloud, Unlock, X, ZoomIn } from 'lucide-react';
import axios from 'axios';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { STAGE_ICON } from '../roles';

type Level = 'ALL' | 'STAGE' | 'OWN';
interface Item { id: string; uploader: { id: string; name: string }; stage: { id: number; name: string } | null; category: string; note: string; originalName: string; width: number; height: number; size: number; originalSize: number; createdAt: string; canDelete: boolean }
interface WeekInfo { start: string; end: string; closesAt: string; reopensAt: string; isOpen: boolean; isCurrent: boolean; weeksAgo: number }
interface ServantRow { id: string; name: string; isSupervisor: boolean; submitted: boolean; count: number; lastAt: string | null; items: Item[] }
interface StageBlock { id: number; slug: string; name: string; order: number; total: number; submitted: number; missing: number; servants: ServantRow[] }
interface Overview { level: Level; canUpload: boolean; week: WeekInfo; summary: { total: number; submitted: number; missing: number }; stages: StageBlock[] }

const CATEGORY_LABEL: Record<string, string> = { LESSON: 'تحضير درس', MEETING: 'اجتماع', ACTIVITY: 'نشاط', EVENT: 'حدث كنسي', OTHER: 'أخرى' };
const LEVEL_TEXT: Record<Level, string> = {
  OWN: 'ارفع تحضيرك الأسبوعي وتابع حالته.',
  STAGE: 'تحضير كل خدام مرحلتك، ومين رفع ومين لسه.',
  ALL: 'كل المراحل، وكل خادم وتحضيره، ومين لسه مرفعش.',
};
const CATEGORIES = ['LESSON', 'MEETING', 'ACTIVITY', 'EVENT', 'OTHER'];
const MAX_FILES = 10;
const MAX_MB = 10;

function apiMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    if (!e.response) return 'تعذر الاتصال بالخادم. تأكد من تشغيل الباك إند.';
    const d = e.response.data as { message?: string } | undefined;
    return d?.message || 'حدث خطأ.';
  }
  return 'حدث خطأ غير متوقع.';
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });
const fmtSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** يجلب الصورة عبر الـ API (مع الكوكي) ثم يعرضها — لا توجد روابط عامة للصور. */
function AuthImage({ id, kind, alt, className }: { id: string; kind: 'thumbnail' | 'image'; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(kind === 'image');
  const box = useRef<HTMLDivElement>(null);

  // لا نطلب الصورة المصغّرة إلا عندما تظهر على الشاشة
  useEffect(() => {
    if (visible) return;
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let url: string | null = null; let dead = false;
    setSrc(null); setFailed(false);
    api.get(`/preparations/${id}/${kind}`, { responseType: 'blob' })
      .then(r => { if (dead) return; url = URL.createObjectURL(r.data as Blob); setSrc(url); })
      .catch(() => { if (!dead) setFailed(true); });
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [id, kind, visible]);

  if (failed) return <div className={`prep-ph ${className ?? ''}`}>تعذر تحميل الصورة</div>;
  if (!src) return <div ref={box} className={`prep-ph prep-skel ${className ?? ''}`} aria-busy />;
  return <img className={className} src={src} alt={alt} decoding="async" />;
}

async function downloadFile(item: Item) {
  const r = await api.get(`/preparations/${item.id}/download`, { responseType: 'blob' });
  const url = URL.createObjectURL(r.data as Blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${item.originalName || 'preparation'}.webp`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function UploadPanel({ categories, onDone }: { categories: string[]; onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState('LESSON');
  const [note, setNote] = useState('');
  const [drag, setDrag] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [progress, setProgress] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map(f => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);

  const add = useCallback((list: FileList | File[]) => {
    const picked = Array.from(list);
    const imgs = picked.filter(f => f.type.startsWith('image/'));
    const tooBig = imgs.filter(f => f.size > MAX_MB * 1048576);
    const ok = imgs.filter(f => f.size <= MAX_MB * 1048576);
    const warn: string[] = [];
    if (imgs.length < picked.length) warn.push('تم تجاهل ملفات ليست صورًا.');
    if (tooBig.length) warn.push(`تم تجاهل ${tooBig.length} صورة أكبر من ${MAX_MB} ميجابايت.`);
    setFiles(prev => {
      const merged = [...prev, ...ok].slice(0, MAX_FILES);
      if (prev.length + ok.length > MAX_FILES) warn.push(`الحد الأقصى ${MAX_FILES} صور.`);
      return merged;
    });
    setMsg(warn.length ? { ok: false, text: warn.join(' ') } : null);
  }, []);

  const m = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      files.forEach(f => fd.append('images', f));
      fd.append('category', category);
      fd.append('note', note.trim());
      return (await api.post<{ created: Item[]; rejected: { name: string; message: string }[] }>('/preparations', fd, { onUploadProgress: e => setProgress(e.total ? Math.round((e.loaded / e.total) * 100) : 0) })).data;
    },
    onSuccess: d => {
      const rej = d.rejected?.length ? ` (تعذر رفع ${d.rejected.length}: ${d.rejected.map(r => r.message).join('، ')})` : '';
      setMsg({ ok: true, text: `تم رفع ${d.created.length} صورة بنجاح.${rej}` });
      setFiles([]); setNote(''); setProgress(0); onDone();
    },
    onError: e => { setMsg({ ok: false, text: apiMessage(e) }); setProgress(0); },
  });

  return (
    <section className="prep-upload">
      <div
        className={`prep-drop${drag ? ' on' : ''}`}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
      >
        <UploadCloud size={34} />
        <b>اسحب صور التحضير هنا أو اضغط للاختيار</b>
        <small>حتى {MAX_FILES} صور، كل صورة حتى {MAX_MB} ميجابايت — تُضغط تلقائيًا قبل الحفظ</small>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
      </div>

      {files.length > 0 && (
        <>
          <div className="prep-previews">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="prep-prev">
                <img src={previews[i]} alt={f.name} />
                <button type="button" aria-label="إزالة" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}><X size={14} /></button>
              </div>
            ))}
          </div>
          <div className="prep-form">
            <label>نوع التحضير
              <select value={category} onChange={e => setCategory(e.target.value)}>
                {categories.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>)}
              </select>
            </label>
            <label className="grow">ملاحظة (اختياري)
              <input value={note} maxLength={300} onChange={e => setNote(e.target.value)} placeholder="مثال: درس الجمعة — الابن الضال" />
            </label>
            <button className="btn" disabled={m.isPending} onClick={() => m.mutate()}>
              <ImagePlus size={18} /> {m.isPending ? (progress < 100 ? `جارٍ الرفع ${progress}%` : 'جارٍ المعالجة…') : `رفع ${files.length} صورة`}
            </button>
          </div>
        </>
      )}
      {msg && <div className={msg.ok ? 'prep-ok' : 'err'} role="status">{msg.text}</div>}
    </section>
  );
}

function Lightbox({ item, onClose, onDelete, canDelete }: { item: Item; onClose: () => void; onDelete: (i: Item) => void; canDelete: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <motion.div className="prep-lb" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} role="dialog" aria-modal>
      <div className="prep-lb-box" onClick={e => e.stopPropagation()}>
        <button className="prep-lb-x" onClick={onClose} aria-label="إغلاق"><X size={20} /></button>
        <AuthImage id={item.id} kind="image" alt={item.note || 'تحضير'} className="prep-lb-img" />
        <div className="prep-lb-info">
          <div><b>{item.uploader.name}</b>{item.stage && <span> · {item.stage.name}</span>}</div>
          <small>{fmtDate(item.createdAt)} — {fmtTime(item.createdAt)} · {CATEGORY_LABEL[item.category] ?? item.category} · {item.width}×{item.height} · {fmtSize(item.size)}</small>
          {item.note && <p>{item.note}</p>}
          <div className="prep-actions">
            <button className="btn btn--sm" onClick={() => downloadFile(item)}><Download size={16} /> تنزيل</button>
            {canDelete && <button className="btn btn--ghost btn--sm" onClick={() => onDelete(item)}><Trash2 size={16} /> حذف</button>}
          </div>
        </div>
      </div>
    </motion.div>
  );
}


const TZ = 'Africa/Cairo';
const fmtDayTime = (iso: string) => new Date(iso).toLocaleString('ar-EG', { timeZone: TZ, weekday: 'long', hour: 'numeric', minute: '2-digit' });
const fmtShortDay = (iso: string) => new Date(iso).toLocaleDateString('ar-EG', { timeZone: TZ, day: 'numeric', month: 'long' });

function StatusBanner({ week }: { week: WeekInfo }) {
  if (!week.isCurrent) {
    return (
      <div className="prep-banner past">
        <Lock size={20} />
        <div><b>أسبوع سابق</b><small>عرض فقط — من {fmtShortDay(week.start)} إلى {fmtShortDay(week.closesAt)}</small></div>
      </div>
    );
  }
  return week.isOpen ? (
    <div className="prep-banner open">
      <Unlock size={20} />
      <div><b>باب التحضير مفتوح</b><small>بيقفل {fmtDayTime(week.closesAt)} (بتوقيت القاهرة)</small></div>
    </div>
  ) : (
    <div className="prep-banner closed">
      <Lock size={20} />
      <div><b>باب التحضير مقفول</b><small>بيفتح تاني {fmtDayTime(week.reopensAt)} (الجمعة 12 بالليل)</small></div>
    </div>
  );
}

function ServantLine({ sv, onOpen }: { sv: ServantRow; onOpen: (i: Item) => void }) {
  return (
    <div className={`prep-sv${sv.submitted ? '' : ' miss'}`}>
      <div className="prep-sv-head">
        <span className="prep-av" aria-hidden>{sv.name.trim().charAt(0)}</span>
        <div className="prep-sv-name">
          <b>{sv.name}</b>
          <small>{sv.isSupervisor ? 'أمين الخدمة' : 'خادم'}{sv.lastAt ? ` · آخر رفع ${fmtDayTime(sv.lastAt)}` : ''}</small>
        </div>
        {sv.submitted
          ? <span className="prep-pill ok"><CheckCircle2 size={15} /> رفع ({sv.count})</span>
          : <span className="prep-pill no"><AlertTriangle size={15} /> لم يرفع</span>}
      </div>
      {sv.items.length > 0 && (
        <div className="prep-thumbs">
          {sv.items.map(it => (
            <button key={it.id} className="prep-t" onClick={() => onOpen(it)} aria-label="فتح التحضير" title={it.note || CATEGORY_LABEL[it.category]}>
              <AuthImage id={it.id} kind="thumbnail" alt={it.note || 'تحضير'} />
              <span className="prep-zoom"><ZoomIn size={18} /></span>
              <em className="prep-cat">{CATEGORY_LABEL[it.category] ?? it.category}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Preparations() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [weeks, setWeeks] = useState(0);
  const [open, setOpen] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

  const ov = useQuery({
    queryKey: ['prep-overview', user?.id, weeks],
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    queryFn: async () => (await api.get<Overview>('/preparations/overview', { params: { weeks } })).data,
  });
  const data = ov.data;
  const level: Level = data?.level ?? 'OWN';
  const week = data?.week;

  const refresh = () => qc.invalidateQueries({ queryKey: ['prep-overview'] });

  const del = useMutation({
    mutationFn: async (i: Item) => { await api.delete(`/preparations/${i.id}`); },
    onSuccess: () => { setOpen(null); refresh(); },
    onError: e => setError(apiMessage(e)),
  });
  const confirmDelete = (i: Item) => { if (window.confirm('هل تريد حذف هذا التحضير نهائيًا؟')) del.mutate(i); };

  const missingByStage = useMemo(
    () => (data?.stages ?? []).filter(s => s.missing > 0).map(s => ({ id: s.id, name: s.name, slug: s.slug, names: s.servants.filter(x => !x.submitted) })),
    [data],
  );

  const visibleStages = useMemo(() => {
    const term = q.trim();
    return (data?.stages ?? [])
      .map(s => ({ ...s, servants: s.servants.filter(sv => (!onlyMissing || !sv.submitted) && (!term || sv.name.includes(term))) }))
      .filter(s => s.servants.length > 0 || (!onlyMissing && !term));
  }, [data, onlyMissing, q]);

  const isStageCollapsed = (id: number) => collapsed[id] ?? level === 'ALL';
  const pct = data && data.summary.total ? Math.round((data.summary.submitted / data.summary.total) * 100) : 0;
  const mine = data?.stages.flatMap(s => s.servants).find(x => x.id === String(user?.id));
  const showUpload = !!data?.canUpload && !!week?.isCurrent;
  const lastWeekDay = week ? new Date(new Date(week.end).getTime() - 3600_000).toISOString() : '';

  return (
    <>
      <div className="page-head"><h2>تحضيرك</h2><span className="page-head-orn" aria-hidden /></div>
      <p className="prep-lead">{LEVEL_TEXT[level]}</p>

      {ov.isError && <div className="err">{apiMessage(ov.error)}</div>}
      {error && <div className="err" onClick={() => setError(null)}>{error}</div>}

      {week && (
        <div className="prep-toolbar">
          <StatusBanner week={week} />
          <div className="prep-weeknav" role="group" aria-label="الأسبوع">
            <button className="btn btn--ghost btn--sm" onClick={() => setWeeks(w => Math.min(52, w + 1))} disabled={weeks >= 52}><ChevronRight size={16} /> الأسبوع السابق</button>
            <span>{week.isCurrent ? 'الأسبوع الحالي' : `قبل ${weeks} ${weeks === 1 ? 'أسبوع' : weeks === 2 ? 'أسبوعين' : 'أسابيع'}`}<small>{fmtShortDay(week.start)} — {fmtShortDay(lastWeekDay)}</small></span>
            <button className="btn btn--ghost btn--sm" onClick={() => setWeeks(w => Math.max(0, w - 1))} disabled={weeks === 0}>الأسبوع التالي <ChevronLeft size={16} /></button>
          </div>
        </div>
      )}

      {data && (
        <section className="prep-dash" aria-label="ملخص الأسبوع">
          {level === 'OWN' ? (
            <div className={`prep-stat wide ${mine?.submitted ? 'good' : 'bad'}`}>
              <span className="prep-stat-ic">{mine?.submitted ? <CheckCircle2 size={26} /> : <AlertTriangle size={26} />}</span>
              <div><b>{mine?.submitted ? 'تحضيرك اتسلّم' : 'لسه مرفعتش تحضيرك'}</b><small>{mine?.submitted ? `${mine.count} صورة في الأسبوع ده` : week?.isCurrent && week.isOpen ? 'ارفع تحضيرك قبل ما الباب يقفل.' : 'الأسبوع ده مفيهوش تحضير.'}</small></div>
            </div>
          ) : (
            <>
              <div className="prep-stat"><b>{data.summary.total}</b><small>إجمالي الخدام</small></div>
              <div className="prep-stat good"><b>{data.summary.submitted}</b><small>رفعوا التحضير</small></div>
              <div className="prep-stat bad"><b>{data.summary.missing}</b><small>لم يرفعوا</small></div>
              <div className="prep-stat prog">
                <div className="prep-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
                <small>نسبة الالتزام {pct}%</small>
              </div>
            </>
          )}
        </section>
      )}

      {data && level !== 'OWN' && (
        <section className={`prep-missing${data.summary.missing ? '' : ' none'}`} aria-label="من لم يرفع">
          {data.summary.missing === 0 ? (
            <div className="prep-allok"><CheckCircle2 size={22} /> كل الخدام رفعوا تحضيرهم الأسبوع ده{data.summary.total === 0 ? ' (لا يوجد خدام مسجلين بعد)' : ''}.</div>
          ) : (
            <>
              <h3><AlertTriangle size={20} /> لم يرفعوا تحضيرهم ({data.summary.missing})</h3>
              <div className="prep-missing-grid">
                {missingByStage.map(m => (
                  <div key={m.id} className="prep-miss-card">
                    <h4><span aria-hidden>{STAGE_ICON[m.slug] ?? '📘'}</span> {m.name}<em>{m.names.length}</em></h4>
                    <ul>{m.names.map(n => <li key={n.id}>{n.name}{n.isSupervisor && <small> · أمين الخدمة</small>}</li>)}</ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {showUpload && (week?.isOpen
        ? <UploadPanel categories={CATEGORIES} onDone={refresh} />
        : <div className="prep-locked"><Lock size={22} /> باب رفع التحضير مقفول دلوقتي. بيفتح تاني {week ? fmtDayTime(week.reopensAt) : ''}.</div>)}

      {data && level !== 'OWN' && (
        <div className="prep-filters">
          <label className="grow"><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="بحث باسم الخادم…" /></label>
          <button className={`btn btn--sm${onlyMissing ? '' : ' btn--ghost'}`} onClick={() => setOnlyMissing(v => !v)} aria-pressed={onlyMissing}>
            <AlertTriangle size={15} /> {onlyMissing ? 'عرض الكل' : 'من لم يرفع فقط'}
          </button>
        </div>
      )}

      {ov.isLoading && <p>جارٍ تحميل التحضيرات…</p>}

      <div className="prep-stages">
        {visibleStages.map(st => (
          <section key={st.id} className="prep-stage" data-stage={st.slug}>
            <button className="prep-stage-head" onClick={() => setCollapsed(c => ({ ...c, [st.id]: !isStageCollapsed(st.id) }))} aria-expanded={!isStageCollapsed(st.id)}>
              <span className="prep-stage-ic" aria-hidden>{STAGE_ICON[st.slug] ?? '📘'}</span>
              <div className="prep-stage-title"><b>{st.name}</b><small>{st.submitted} من {st.total} رفعوا</small></div>
              {st.total === 0 ? <span className="prep-pill">لا يوجد خدام</span> : st.missing > 0 ? <span className="prep-pill no">{st.missing} لم يرفعوا</span> : <span className="prep-pill ok">الكل رفع</span>}
              <ChevronLeft size={18} className={`prep-chev${isStageCollapsed(st.id) ? '' : ' open'}`} />
            </button>
            <AnimatePresence initial={false}>
              {!isStageCollapsed(st.id) && (
                <motion.div className="prep-stage-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}>
                  {st.servants.length === 0 && <p className="prep-nosv">مفيش خدام مسجلين في المرحلة دي لسه.</p>}
                  {st.servants.map(sv => <ServantLine key={sv.id} sv={sv} onOpen={setOpen} />)}
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        ))}
        {data && visibleStages.length === 0 && (
          <div className="prep-empty">{onlyMissing ? 'الكل رفع تحضيره 🎉' : level === 'ALL' ? 'مفيش خدام مسجلين في مراحل لسه.' : 'مفيش نتائج.'}</div>
        )}
      </div>

      <AnimatePresence>{open && <Lightbox item={open} onClose={() => setOpen(null)} onDelete={confirmDelete} canDelete={open.canDelete && (level === 'ALL' || !!week?.isOpen)} />}</AnimatePresence>
    </>
  );
}
