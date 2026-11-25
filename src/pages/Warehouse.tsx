import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import axios from 'axios';
import { AlertTriangle, Check, ClipboardList, Minus, Package, Pencil, Plus, Search, Send, ShoppingBasket, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth';

interface Section { id: string; name: string; itemCount: number }
interface WItem { id: string; name: string; sectionId: string; sectionName: string; quantity: number; unit: string; description: string; active: boolean }
type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
interface Req {
  id: string; requester: { id: string; name: string; role: 'SERVANT' | 'SUPERVISOR' }; stage: { id: number; name: string } | null;
  items: { itemId: string; name: string; sectionName: string; unit: string; quantity: number }[];
  note: string; status: Status; isAmendment?: boolean; amendmentOf?: string | null; auditTrail?: { action: string; by: string; at: string; details: string }[]; canRequestAmendment?: boolean; review: { by: string; comment: string; at: string } | null; createdAt: string; canCancel: boolean; canReview: boolean;
}
interface ReqList { items: Req[]; total: number; page: number; pageSize: number; pending: number }

const STATUS_LABEL: Record<Status, string> = { PENDING: 'قيد الانتظار', APPROVED: 'تم القبول', REJECTED: 'مرفوض', CANCELLED: 'ملغي' };
const LOW_STOCK = 3;

function apiMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    if (!e.response) return 'تعذر الاتصال بالخادم. تأكد من تشغيل الباك إند.';
    return (e.response.data as { message?: string } | undefined)?.message || 'حدث خطأ.';
  }
  return 'حدث خطأ غير متوقع.';
}
const fmtDate = (iso: string) => new Date(iso).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
const useRoles = () => {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  return { isKeeper: roles.includes('STOREKEEPER'), isAdmin: roles.includes('ADMIN'), canRequest: roles.includes('SERVANT') || roles.includes('SUPERVISOR') };
};

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <motion.div className="wh-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} role="dialog" aria-modal aria-label={title}>
      <div className="wh-modal-box" onClick={e => e.stopPropagation()}>
        <div className="wh-modal-head"><h3>{title}</h3><button className="wh-x" onClick={onClose} aria-label="إغلاق"><X size={18} /></button></div>
        {children}
      </div>
    </motion.div>
  );
}

function SectionChips({ sections, value, onChange }: { sections: Section[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="wh-chips" role="tablist">
      <button role="tab" aria-selected={!value} className={`wh-chip${!value ? ' on' : ''}`} onClick={() => onChange('')}>الكل</button>
      {sections.map(s => (
        <button key={s.id} role="tab" aria-selected={value === s.id} className={`wh-chip${value === s.id ? ' on' : ''}`} onClick={() => onChange(s.id)}>{s.name}<em>{s.itemCount}</em></button>
      ))}
    </div>
  );
}

const stockClass = (q: number) => (q <= 0 ? 'out' : q <= LOW_STOCK ? 'low' : 'ok');
const stockText = (i: WItem) => (i.quantity <= 0 ? 'نفد' : `متوفر ${i.quantity} ${i.unit}`);

// ======================================================================
// خادم المخزن: الأقسام والأصناف
// ======================================================================
function ItemForm({ sections, item, defaultSection, onDone, onClose }: { sections: Section[]; item: WItem | null; defaultSection: string; onDone: () => void; onClose: () => void }) {
  const [f, setF] = useState({ name: item?.name ?? '', sectionId: item?.sectionId ?? defaultSection ?? sections[0]?.id ?? '', quantity: String(item?.quantity ?? 0), unit: item?.unit ?? 'قطعة', description: item?.description ?? '', active: item?.active ?? true });
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async () => {
      const body = { ...f, quantity: Number(f.quantity) };
      if (item) await api.patch(`/warehouse/items/${item.id}`, body); else await api.post('/warehouse/items', body);
    },
    onSuccess: onDone,
    onError: e => setErr(apiMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(p => ({ ...p, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  return (
    <Modal title={item ? 'تعديل الصنف' : 'إضافة صنف'} onClose={onClose}>
      <div className="wh-form">
        <label>اسم الصنف<input value={f.name} onChange={set('name')} maxLength={80} autoFocus /></label>
        <label>القسم<select value={f.sectionId} onChange={set('sectionId')}>{sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <div className="wh-row2">
          <label>الكمية<input type="number" min={0} step={1} value={f.quantity} onChange={set('quantity')} /></label>
          <label>الوحدة<input value={f.unit} onChange={set('unit')} maxLength={20} placeholder="قطعة / علبة / كرتونة" /></label>
        </div>
        <label>وصف (اختياري)<textarea value={f.description} onChange={set('description')} maxLength={300} rows={2} /></label>
        <label className="wh-check"><input type="checkbox" checked={f.active} onChange={set('active')} /> متاح للطلب (لو مقفول الصنف يختفي من الخدام)</label>
        {err && <div className="err">{err}</div>}
        <div className="wh-actions"><button className="btn" disabled={m.isPending || !f.name.trim() || !f.sectionId} onClick={() => m.mutate()}><Check size={16} /> حفظ</button><button className="btn btn--ghost" onClick={onClose}>إلغاء</button></div>
      </div>
    </Modal>
  );
}

function KeeperView() {
  const qc = useQueryClient();
  const [sectionId, setSectionId] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedQ(q.trim()), 300); return () => window.clearTimeout(timer); }, [q]);
  const [newSection, setNewSection] = useState('');
  const [editing, setEditing] = useState<WItem | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sections = useQuery({ queryKey: ['wh-sections'], queryFn: async () => (await api.get<{ sections: Section[] }>('/warehouse/sections')).data.sections });
  const items = useQuery({ queryKey: ['wh-items', sectionId, debouncedQ], queryFn: async () => (await api.get<{ items: WItem[] }>('/warehouse/items', { params: { sectionId: sectionId || undefined, q: debouncedQ || undefined } })).data.items });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['wh-sections'] }); qc.invalidateQueries({ queryKey: ['wh-items'] }); };
  const fail = (e: unknown) => setError(apiMessage(e));

  const addSection = useMutation({ mutationFn: async () => { await api.post('/warehouse/sections', { name: newSection }); }, onSuccess: () => { setNewSection(''); setError(null); refresh(); }, onError: fail });
  const renameSection = useMutation({ mutationFn: async (v: { id: string; name: string }) => { await api.patch(`/warehouse/sections/${v.id}`, { name: v.name }); }, onSuccess: refresh, onError: fail });
  const delSection = useMutation({ mutationFn: async (id: string) => { await api.delete(`/warehouse/sections/${id}`); }, onSuccess: () => { setSectionId(''); refresh(); }, onError: fail });
  const adjust = useMutation({ mutationFn: async (v: { id: string; quantity: number }) => { await api.patch(`/warehouse/items/${v.id}`, { quantity: v.quantity }); }, onSuccess: refresh, onError: fail });
  const delItem = useMutation({ mutationFn: async (id: string) => { await api.delete(`/warehouse/items/${id}`); }, onSuccess: refresh, onError: fail });

  const secs = sections.data ?? [];
  const list = items.data ?? [];
  const current = secs.find(s => s.id === sectionId);
  const low = list.filter(i => i.active && i.quantity <= LOW_STOCK).length;
  const total = useMemo(() => secs.reduce((n, s) => n + s.itemCount, 0), [secs]);

  return (
    <>
      <div className="page-head"><h2>المخزن</h2><span className="page-head-orn" aria-hidden /></div>
      <p className="prep-lead">أضف الأصناف ووزّعها على أقسام، وراجع الطلبات الواردة من <Link to="/app/warehouse-requests">طلبات المخزن</Link>.</p>
      {error && <div className="err" onClick={() => setError(null)}>{error}</div>}

      <section className="wh-stats">
        <div className="prep-stat"><b>{secs.length}</b><small>قسم</small></div>
        <div className="prep-stat"><b>{total}</b><small>صنف</small></div>
        <div className={`prep-stat ${low ? 'bad' : 'good'}`}><b>{low}</b><small>على وشك النفاد</small></div>
      </section>

      <section className="wh-panel">
        <h3>الأقسام</h3>
        <SectionChips sections={secs} value={sectionId} onChange={setSectionId} />
        <div className="wh-inline">
          <input value={newSection} onChange={e => setNewSection(e.target.value)} maxLength={80} placeholder="اسم قسم جديد (مثال: أدوات كتابة)" onKeyDown={e => { if (e.key === 'Enter' && newSection.trim()) addSection.mutate(); }} />
          <button className="btn btn--sm" disabled={!newSection.trim() || addSection.isPending} onClick={() => addSection.mutate()}><Plus size={15} /> إضافة قسم</button>
          {current && (
            <>
              <button className="btn btn--ghost btn--sm" onClick={() => { const n = window.prompt('الاسم الجديد للقسم', current.name); if (n && n.trim() && n.trim() !== current.name) renameSection.mutate({ id: current.id, name: n.trim() }); }}><Pencil size={15} /> تعديل الاسم</button>
              <button className="btn btn--ghost btn--sm" onClick={() => { if (window.confirm(`حذف قسم «${current.name}»؟`)) delSection.mutate(current.id); }}><Trash2 size={15} /> حذف القسم</button>
            </>
          )}
        </div>
      </section>

      <div className="prep-filters">
        <label className="grow"><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="بحث عن صنف…" /></label>
        <button className="btn" disabled={!secs.length} onClick={() => setEditing('new')} title={secs.length ? '' : 'أضف قسم الأول'}><Plus size={16} /> إضافة صنف</button>
      </div>

      {items.isLoading && <p>جارٍ التحميل…</p>}
      {!items.isLoading && list.length === 0 && <div className="prep-empty">{secs.length ? 'مفيش أصناف هنا لسه. اضغط «إضافة صنف».' : 'ابدأ بإضافة قسم، وبعدين أضف الأصناف.'}</div>}

      <div className="wh-grid">
        {list.map(i => (
          <article key={i.id} className={`wh-card ${stockClass(i.quantity)}${i.active ? '' : ' off'}`}>
            <header><b>{i.name}</b>{!i.active && <span className="prep-pill no">مخفي</span>}</header>
            <small className="wh-sec">{i.sectionName}</small>
            {i.description && <p>{i.description}</p>}
            <div className="wh-qty">
              <button aria-label="نقص" onClick={() => adjust.mutate({ id: i.id, quantity: i.quantity - 1 })} disabled={i.quantity <= 0 || adjust.isPending}><Minus size={15} /></button>
              <span><b>{i.quantity}</b><small>{i.unit}</small></span>
              <button aria-label="زيادة" onClick={() => adjust.mutate({ id: i.id, quantity: i.quantity + 1 })} disabled={adjust.isPending}><Plus size={15} /></button>
            </div>
            {i.quantity <= LOW_STOCK && i.active && <small className="wh-warn"><AlertTriangle size={13} /> {i.quantity <= 0 ? 'نفد من المخزن' : 'على وشك النفاد'}</small>}
            <div className="prep-actions">
              <button className="btn btn--ghost btn--sm" onClick={() => setEditing(i)}><Pencil size={14} /> تعديل</button>
              <button className="btn btn--ghost btn--sm" aria-label="حذف الصنف" onClick={() => { if (window.confirm(`حذف «${i.name}»؟`)) delItem.mutate(i.id); }}><Trash2 size={14} /></button>
            </div>
          </article>
        ))}
      </div>

      <AnimatePresence>
        {editing && <ItemForm sections={secs} item={editing === 'new' ? null : editing} defaultSection={sectionId} onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} />}
      </AnimatePresence>
    </>
  );
}

// ======================================================================
// الخادم / أمين الخدمة: تصفح المخزن وإرسال طلب   |   الأدمن: عرض فقط
// ======================================================================
function CatalogView({ canOrder }: { canOrder: boolean }) {
  const qc = useQueryClient();
  const [sectionId, setSectionId] = useState('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedQ(q.trim()), 300); return () => window.clearTimeout(timer); }, [q]);
  const [cart, setCart] = useState<Record<string, { item: WItem; qty: number }>>({});
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const sections = useQuery({ queryKey: ['wh-sections'], queryFn: async () => (await api.get<{ sections: Section[] }>('/warehouse/sections')).data.sections });
  const items = useQuery({ queryKey: ['wh-items', sectionId, debouncedQ], queryFn: async () => (await api.get<{ items: WItem[] }>('/warehouse/items', { params: { sectionId: sectionId || undefined, q: debouncedQ || undefined } })).data.items });

  const send = useMutation({
    mutationFn: async () => { await api.post('/warehouse/requests', { items: Object.values(cart).map(c => ({ itemId: c.item.id, quantity: c.qty })), note }); },
    onSuccess: () => { setCart({}); setNote(''); setMsg({ ok: true, text: 'تم إرسال طلبك لخادم المخزن. تابع حالته من «طلباتي».' }); qc.invalidateQueries({ queryKey: ['wh-requests'] }); },
    onError: e => setMsg({ ok: false, text: apiMessage(e) }),
  });

  const lines = Object.values(cart);
  const setQty = (item: WItem, qty: number) => setCart(c => { const n = { ...c }; if (qty <= 0) delete n[item.id]; else n[item.id] = { item, qty: Math.min(qty, 1_000_000) }; return n; });

  return (
    <>
      <div className="page-head"><h2>المخزن</h2><span className="page-head-orn" aria-hidden /></div>
      <p className="prep-lead">{canOrder ? 'اختار الأصناف اللي محتاجها وابعت الطلب لخادم المخزن، وهيرد عليك بالقبول أو الرفض مع تعليق.' : 'عرض الأصناف والكميات المتاحة في المخزن.'}</p>
      {msg && <div className={msg.ok ? 'prep-ok' : 'err'} onClick={() => setMsg(null)}>{msg.text} {msg.ok && <Link to="/app/warehouse-requests">طلباتي ←</Link>}</div>}

      <div className={canOrder ? 'wh-layout' : ''}>
        <div>
          <SectionChips sections={sections.data ?? []} value={sectionId} onChange={setSectionId} />
          <div className="prep-filters"><label className="grow"><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="بحث عن صنف…" /></label></div>
          {items.isLoading && <p>جارٍ التحميل…</p>}
          {!items.isLoading && (items.data ?? []).length === 0 && <div className="prep-empty">المخزن فاضي أو مفيش نتائج.</div>}
          <div className="wh-grid">
            {(items.data ?? []).map(i => {
              const inCart = cart[i.id]?.qty ?? 0;
              return (
                <article key={i.id} className={`wh-card ${stockClass(i.quantity)}`}>
                  <header><b>{i.name}</b></header>
                  <small className="wh-sec">{i.sectionName}</small>
                  {i.description && <p>{i.description}</p>}
                  <span className={`wh-stock ${stockClass(i.quantity)}`}><Package size={14} /> {stockText(i)}</span>
                  {canOrder && (
                    inCart === 0 ? (
                      <button className="btn btn--sm" onClick={() => setQty(i, 1)}><Plus size={15} /> أضف للطلب</button>
                    ) : (
                      <div className="wh-qty">
                        <button aria-label="نقص" onClick={() => setQty(i, inCart - 1)}><Minus size={15} /></button>
                        <span><b>{inCart}</b><small>{i.unit}</small></span>
                        <button aria-label="زيادة" onClick={() => setQty(i, inCart + 1)}><Plus size={15} /></button>
                      </div>
                    )
                  )}
                  {canOrder && inCart > i.quantity && <small className="wh-warn"><AlertTriangle size={13} /> أكتر من المتاح</small>}
                </article>
              );
            })}
          </div>
        </div>

        {canOrder && (
          <aside className="wh-cart" aria-label="طلبي">
            <h3><ShoppingBasket size={19} /> طلبي {lines.length > 0 && <em>{lines.length}</em>}</h3>
            {lines.length === 0 ? <p className="wh-muted">لسه مضفتش أصناف.</p> : (
              <ul>{lines.map(l => (
                <li key={l.item.id}><span>{l.item.name}<small> × {l.qty} {l.item.unit}</small></span><button aria-label="إزالة" onClick={() => setQty(l.item, 0)}><X size={14} /></button></li>
              ))}</ul>
            )}
            <label>ملاحظة (اختياري)<textarea rows={2} maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder="مثال: محتاجينهم لاجتماع الجمعة" /></label>
            <button className="btn" disabled={!lines.length || send.isPending} onClick={() => send.mutate()}><Send size={16} /> {send.isPending ? 'جارٍ الإرسال…' : 'إرسال الطلب'}</button>
          </aside>
        )}
      </div>
    </>
  );
}

export function Warehouse() {
  const { isKeeper, canRequest } = useRoles();
  return isKeeper ? <KeeperView /> : <CatalogView canOrder={canRequest} />;
}

// ======================================================================
// الطلبات: خادم المخزن (مراجعة) / الأدمن (عرض) / الخدام (طلباتي)
// ======================================================================
function RequestCard({ r, reviewer, showWho, onChanged }: { r: Req; reviewer: boolean; showWho: boolean; onChanged: () => void }) {
  const [comment, setComment] = useState('');
  const [editingLines, setEditingLines] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries(r.items.map(i => [i.itemId, i.quantity])));
  const [err, setErr] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: async (kind: 'approve' | 'reject') => { await api.post(`/warehouse/requests/${r.id}/${kind}`, { comment }); },
    onSuccess: onChanged, onError: e => setErr(apiMessage(e)),
  });
  const cancel = useMutation({ mutationFn: async () => { await api.delete(`/warehouse/requests/${r.id}`); }, onSuccess: onChanged, onError: e => setErr(apiMessage(e)) });
  const saveItems = useMutation({ mutationFn: async (amendment: boolean) => { const items = r.items.filter(i => (quantities[i.itemId] || 0) > 0).map(i => ({ itemId: i.itemId, quantity: quantities[i.itemId] })); if (amendment) await api.post(`/warehouse/requests/${r.id}/amendment`, { items }); else await api.patch(`/warehouse/requests/${r.id}/items`, { items }); }, onSuccess: () => { setEditingLines(false); onChanged(); }, onError: e => setErr(apiMessage(e)) });

  return (
    <article className={`wh-req ${r.status.toLowerCase()}`}>
      <header>
        <div>
          {showWho && <b>{r.requester.name}<small> · {r.requester.role === 'SUPERVISOR' ? 'أمين الخدمة' : 'خادم'}{r.stage ? ` · ${r.stage.name}` : ''}</small></b>}
          <small className="wh-muted">{fmtDate(r.createdAt)}</small>
        </div>
        <span className={`wh-status ${r.status.toLowerCase()}`}>{r.isAmendment ? 'طلب تعديل' : STATUS_LABEL[r.status]}</span>
      </header>
      <ul className="wh-lines">{r.items.map(i => <li key={i.itemId}><span>{i.name}{i.sectionName && <small> · {i.sectionName}</small>}</span><b>× {i.quantity} {i.unit}</b></li>)}</ul>
      {r.note && <p className="wh-note">«{r.note}»</p>}
      {editingLines ? (
        <div className="wh-review-box">
          <b>{r.canReview ? 'تعديل الطلب قبل المراجعة' : 'تفاصيل طلب التعديل'}</b>
          {r.items.map(i => <label key={i.itemId} className="wh-inline"><span>{i.name} ({i.unit})</span><input aria-label={`كمية ${i.name}`} type="number" min={0} step={1} value={quantities[i.itemId] ?? i.quantity} onChange={e => setQuantities(v => ({ ...v, [i.itemId]: Number(e.target.value) }))} /></label>)}
          <small>اكتب 0 لإزالة الصنف من الطلب.</small>
          <div className="wh-actions"><button className="btn btn--sm" disabled={saveItems.isPending || !r.items.some(i => (quantities[i.itemId] || 0) > 0)} onClick={() => saveItems.mutate(!r.canReview)}>{r.canReview ? 'حفظ التعديل' : 'إرسال طلب التعديل'}</button><button className="btn btn--ghost btn--sm" onClick={() => setEditingLines(false)}>إلغاء</button></div>
        </div>
      ) : (
        <div className="wh-actions">
          {reviewer && r.canReview && <button className="btn btn--ghost btn--sm" onClick={() => setEditingLines(true)}><Pencil size={14} /> تعديل الأصناف والكميات</button>}
          {r.canRequestAmendment && <button className="btn btn--ghost btn--sm" onClick={() => setEditingLines(true)}><Pencil size={14} /> طلب تعديل</button>}
        </div>
      )}
      {!!r.auditTrail?.length && <details className="wh-note"><summary>سجل التعديلات</summary>{r.auditTrail.map((a, i) => <p key={i}><small>{a.by} · {fmtDate(a.at)}</small><br />{a.details || a.action}</p>)}</details>}
      {r.review && (
        <div className={`wh-review ${r.status.toLowerCase()}`}>
          <small>رد {r.review.by || 'خادم المخزن'} · {fmtDate(r.review.at)}</small>
          <p>{r.review.comment || (r.status === 'APPROVED' ? 'تم قبول الطلب.' : '—')}</p>
        </div>
      )}
      {err && <div className="err" onClick={() => setErr(null)}>{err}</div>}
      {r.canReview && (
        <div className="wh-review-box">
          <textarea rows={2} maxLength={500} value={comment} onChange={e => setComment(e.target.value)} placeholder="تعليق اختياري للخادم" />
          <div className="wh-actions">
            <button className="btn btn--sm" disabled={act.isPending} onClick={() => act.mutate('approve')}><Check size={15} /> قبول</button>
            <button className="btn btn--ghost btn--sm" disabled={act.isPending} onClick={() => act.mutate('reject')}><X size={15} /> رفض</button>
          </div>
        </div>
      )}
      {reviewer && r.status === 'PENDING' && !r.canReview && (
        <div className="err">الحساب ده مش معاه صلاحية خادم المخزن على السيرفر، فمينفعش يراجع الطلب. سجّل خروج وادخل بحساب خادم المخزن.</div>
      )}
      {r.canCancel && <div className="wh-actions"><button className="btn btn--ghost btn--sm" disabled={cancel.isPending} onClick={() => { if (window.confirm('إلغاء الطلب؟')) cancel.mutate(); }}><Trash2 size={14} /> إلغاء الطلب</button></div>}
    </article>
  );
}

export function WarehouseRequests() {
  const { isKeeper, isAdmin } = useRoles();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'' | Status>(isKeeper ? 'PENDING' : '');
  const [stageId, setStageId] = useState('');
  const [page, setPage] = useState(1);
  const wide = isKeeper || isAdmin;

  const stages = useQuery({ enabled: wide, queryKey: ['stages-list'], queryFn: async () => (await api.get<{ stages: { id: number; name: string; order?: number }[] }>('/stages')).data.stages });
  const list = useQuery({
    queryKey: ['wh-requests', status, stageId, page],
    refetchInterval: query => query.state.data?.pending ? 60_000 : false,
    queryFn: async () => (await api.get<ReqList>('/warehouse/requests', { params: { status: status || undefined, stageId: stageId || undefined, page } })).data,
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['wh-requests'] }); qc.invalidateQueries({ queryKey: ['wh-items'] }); qc.invalidateQueries({ queryKey: ['wh-sections'] }); };
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const tabs: { v: '' | Status; l: string }[] = [{ v: 'PENDING', l: 'قيد الانتظار' }, { v: 'APPROVED', l: 'المقبولة' }, { v: 'REJECTED', l: 'المرفوضة' }, ...(wide ? [] : [{ v: 'CANCELLED' as Status, l: 'الملغية' }]), { v: '', l: 'الكل' }];

  return (
    <>
      <div className="page-head"><h2>{wide ? 'طلبات المخزن' : 'طلباتي'}</h2><span className="page-head-orn" aria-hidden /></div>
      <p className="prep-lead">{isKeeper ? 'الطلبات الواردة من كل المراحل. يمكنك تعديل الأصناف والكميات قبل القبول أو الرفض؛ والتعليق اختياري.' : isAdmin ? 'كل طلبات المخزن (عرض فقط).' : 'حالة طلباتك وردود خادم المخزن عليها.'}</p>

      <div className="wh-tabs" role="tablist">
        {tabs.map(t => (
          <button key={t.l} role="tab" aria-selected={status === t.v} className={`wh-chip${status === t.v ? ' on' : ''}`} onClick={() => { setStatus(t.v); setPage(1); }}>
            {t.l}{t.v === 'PENDING' && list.data && list.data.pending > 0 && <em>{list.data.pending}</em>}
          </button>
        ))}
        {wide && (
          <select value={stageId} onChange={e => { setStageId(e.target.value); setPage(1); }} aria-label="المرحلة" className="wh-stage-select">
            <option value="">كل المراحل</option>
            {(stages.data ?? []).sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {list.isError && <div className="err">{apiMessage(list.error)}</div>}
      {list.isLoading && <p>جارٍ التحميل…</p>}
      {list.data && list.data.items.length === 0 && <div className="prep-empty"><ClipboardList size={28} /><p>{wide ? 'مفيش طلبات هنا.' : 'لسه مبعتش أي طلب.'}</p>{!wide && <Link to="/app/warehouse">روح للمخزن ←</Link>}</div>}

      <div className="wh-reqs">
        {list.data?.items.map(r => <RequestCard key={r.id} r={r} reviewer={isKeeper} showWho={wide} onChanged={refresh} />)}
      </div>
      {totalPages > 1 && (
        <div className="prep-pager">
          <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>السابق</button>
          <span>{page} / {totalPages}</span>
          <button className="btn btn--ghost btn--sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>التالي</button>
        </div>
      )}
    </>
  );
}
