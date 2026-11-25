import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertOctagon, CalendarCheck, Church, ChevronLeft, ChevronRight, ClipboardX, HandHeart, Images, Sparkles, UserPlus, Users } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth';
import { STAGE_ICON } from '../roles';
import { CountUp, initial, weekLabel, weekRange } from '../components/ui';
import { Dashboard as BasicDashboard } from './Shell';

interface P { id: string; name: string; isLead: boolean }
interface StageBlock { id: number; slug: string; name: string; order: number; total: number; taken: { MASS: boolean; SERVICE: boolean }; absentMass: P[]; absentService: P[]; missingPrep: P[] }
interface Overview {
  level: 'ALL' | 'STAGE';
  week: { start: string; end: string; weeksAgo: number; isCurrent: boolean; auto: boolean; prepOpen: boolean };
  summary: { servants: number; absentMass: number; absentService: number; missingPrep: number; twoWeeks: number };
  stages: StageBlock[];
  twoWeeks: { id: string; name: string; isLead: boolean; stage: { id: number; name: string; slug: string } | null }[];
}

type Key = 'absentMass' | 'absentService' | 'missingPrep';

function Tile({ tone, icon, value, label, i }: { tone: string; icon: React.ReactNode; value: number; label: string; i: number }) {
  return (
    <div className={`vtile ${tone}`} style={{ ['--i' as string]: i }}>
      <span className="vtile-ic">{icon}</span>
      <b><CountUp value={value} /></b>
      <small>{label}</small>
      <i className="vtile-shine" aria-hidden />
    </div>
  );
}

function ListCard({ tone, icon, title, stages, pick, takenKey, i }: { tone: string; icon: React.ReactNode; title: string; stages: StageBlock[]; pick: Key; takenKey?: 'MASS' | 'SERVICE'; i: number }) {
  const withItems = stages.filter(s => s[pick].length > 0);
  const notTaken = takenKey ? stages.filter(s => s.total > 0 && !s.taken[takenKey]) : [];
  const count = withItems.reduce((n, s) => n + s[pick].length, 0);
  return (
    <section className={`vlist ${tone}`} style={{ ['--i' as string]: i }}>
      <header><span className="vlist-ic">{icon}</span><h3>{title}</h3><em>{count}</em></header>
      {withItems.length === 0 && <p className="vlist-empty">{notTaken.length === stages.length && stages.length > 0 ? 'لم يُسجَّل الحضور بعد' : 'مفيش حد 🎉'}</p>}
      {withItems.map(s => (
        <div key={s.id} className="vlist-stage" data-stage={s.slug}>
          <h4><span aria-hidden>{STAGE_ICON[s.slug] ?? '📘'}</span> {s.name}<em>{s[pick].length}</em></h4>
          <ul>{s[pick].map(p => <li key={p.id}><span className="vav">{initial(p.name)}</span>{p.name}{p.isLead && <small>مشرف</small>}</li>)}</ul>
        </div>
      ))}
      {notTaken.length > 0 && withItems.length > 0 && <p className="vlist-note">لم يُسجَّل بعد: {notTaken.map(s => s.name).join('، ')}</p>}
    </section>
  );
}

export function AdminDashboard() {
  const { user } = useAuth();
  const [weeks, setWeeks] = useState<number | null>(null); // null = تلقائي
  const isAdmin = !!user?.roles.includes('ADMIN');

  const q = useQuery({
    queryKey: ['att-overview', user?.id, weeks],
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    queryFn: async () => (await api.get<Overview>('/attendance/overview', { params: { weeks: weeks ?? 'auto' } })).data,
  });
  const pending = useQuery({
    enabled: isAdmin,
    queryKey: ['dash-pending', user?.id],
    queryFn: async () => ((await api.get<{ stats: { pendingUsers: number } }>('/dashboard')).data.stats?.pendingUsers ?? 0),
  });

  const d = q.data;
  const cur = d?.week.weeksAgo ?? 0;
  const go = (n: number) => setWeeks(Math.max(0, Math.min(52, n)));

  return (
    <>
      <section className="vhero">
        <div className="vhero-orb a" aria-hidden /><div className="vhero-orb b" aria-hidden />
        <div className="vhero-text">
          <small>{isAdmin ? 'لوحة الأدمن' : 'لوحة المرحلة'}</small>
          <h2>أهلاً {user?.fullName}</h2>
          <p>{d ? `${weekLabel(cur)} · ${weekRange(d.week.start, d.week.end)}` : 'جارٍ تحميل اللوحة…'}{d?.week.auto && cur === 1 ? ' · (آخر أسبوع اتسجّل فيه حضور)' : ''}</p>
        </div>
        <div className="vhero-nav" role="group" aria-label="الأسبوع">
          <button onClick={() => go(cur + 1)} disabled={cur >= 52}><ChevronRight size={18} /> الأسبوع السابق</button>
          <button onClick={() => go(cur - 1)} disabled={cur === 0}>الأسبوع التالي <ChevronLeft size={18} /></button>
        </div>
      </section>

      {q.isError && <div className="err">{errorMessage(q.error)}</div>}
      {q.isLoading && <p>جارٍ التحميل…</p>}

      {d && (
        <div className="vstack" style={{ opacity: q.isPlaceholderData ? 0.65 : 1 }}>
          <div className="vtiles">
            <Tile i={0} tone="t-sky" icon={<Users size={24} />} value={d.summary.servants} label="إجمالي الخدام" />
            <Tile i={1} tone="t-amber" icon={<Church size={24} />} value={d.summary.absentMass} label="غابوا عن القداس" />
            <Tile i={2} tone="t-violet" icon={<HandHeart size={24} />} value={d.summary.absentService} label="غابوا عن الخدمة" />
            <Tile i={3} tone="t-rose" icon={<ClipboardX size={24} />} value={d.summary.missingPrep} label="لم يرفعوا التحضير" />
          </div>

          <section className={`vcritical${d.twoWeeks.length ? '' : ' ok'}`} style={{ ['--i' as string]: 4 }}>
            <div className="vcritical-glow" aria-hidden />
            <header>
              <span className="vcritical-ic">{d.twoWeeks.length ? <AlertOctagon size={26} /> : <Sparkles size={26} />}</span>
              <div>
                <h3>{d.twoWeeks.length ? 'غابوا عن القداس والخدمة لمدة أسبوعين' : 'مفيش حد غاب أسبوعين متتاليين'}</h3>
                <small>{d.twoWeeks.length ? 'محتاجين افتقاد وتواصل عاجل' : 'ربنا يبارك — الالتزام ممتاز'}</small>
              </div>
              <em><CountUp value={d.twoWeeks.length} /></em>
            </header>
            {d.twoWeeks.length > 0 && (
              <ul className="vcritical-list">
                {d.twoWeeks.map(p => (
                  <li key={p.id}><span className="vav">{initial(p.name)}</span><b>{p.name}</b>{p.stage && <span className="vchip" data-stage={p.stage.slug}>{STAGE_ICON[p.stage.slug] ?? ''} {p.stage.name}</span>}</li>
                ))}
              </ul>
            )}
          </section>

          <div className="vlists">
            <ListCard i={5} tone="t-amber" icon={<Church size={20} />} title="غابوا عن القداس" stages={d.stages} pick="absentMass" takenKey="MASS" />
            <ListCard i={6} tone="t-violet" icon={<HandHeart size={20} />} title="غابوا عن الخدمة" stages={d.stages} pick="absentService" takenKey="SERVICE" />
            <ListCard i={7} tone="t-rose" icon={<Images size={20} />} title="لم يرفعوا التحضير" stages={d.stages} pick="missingPrep" />
          </div>

          <div className="vquick">
            <Link to="/app/attendance" className="vq t-emerald"><CalendarCheck size={22} /><b>الحضور والغياب</b><small>المراحل وأعداد الغياب</small></Link>
            <Link to="/app/preparations" className="vq t-sky"><Images size={22} /><b>تحضيرك</b><small>تحضير كل خادم</small></Link>
            {isAdmin && <Link to="/app/registrations" className="vq t-rose"><UserPlus size={22} /><b>طلبات التسجيل</b><small>{pending.data ? `${pending.data} طلب جديد` : 'مفيش طلبات جديدة'}</small>{!!pending.data && <em>{pending.data}</em>}</Link>}
          </div>
        </div>
      )}
    </>
  );
}

/** الرئيسية: لوحة الغياب للأدمن والمشرفين، وتوجيه الأدوار المتخصصة لصفحتها */
export default function DashboardRoute() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const boss = roles.includes('ADMIN') || roles.includes('SUPERVISOR') || roles.includes('ASSISTANT');
  if (boss) return <AdminDashboard />;
  if (roles.includes('ATTENDANCE') && !roles.includes('SERVANT')) return <Navigate to="/app/attendance" replace />;
  if (roles.includes('STOREKEEPER') && !roles.includes('SERVANT')) return <Navigate to="/app/warehouse" replace />;
  return <BasicDashboard />;
}
