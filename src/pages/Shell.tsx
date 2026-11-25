import { useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BookOpen, BookOpenCheck, CalendarCheck, CalendarCheck2, Church, Circle, ClipboardList, HeartHandshake, Images, Layers, LayoutDashboard, LogOut, Settings, Shuffle, UserCircle2, UserCog, UserPlus, Users as UsersIcon, Users2, Warehouse } from 'lucide-react';
import { Menu, X } from 'lucide-react';
import logo from '../assets/logo-official.png';
import { api, errorMessage } from '../api/client';
import { useAuth, type User } from '../auth';
import { ASSIGNABLE, NAV, NAV_ICON, ROLE_LABEL, navFor, STAGE_ICON } from '../roles';
export const Copyright = () => <footer className="foot">© جميع الحقوق محفوظة بواسطة المطورين MS</footer>;
type LucideIcon = React.ComponentType<{ size?: number | string; strokeWidth?: number | string }>;
// فقط الأيقونات المستخدمة (بدل استيراد مكتبة الأيقونات كلها)
const NAV_ICONS: Record<string, LucideIcon> = { Bell, BookOpen, BookOpenCheck, CalendarCheck, CalendarCheck2, Church, ClipboardList, HeartHandshake, Images, Layers, LayoutDashboard, Settings, Shuffle, UserCircle2, UserCog, UserPlus, Users: UsersIcon, Users2, Warehouse };
const Ic = ({ name, ...p }: { name: string; size?: number; strokeWidth?: number }) => { const C = NAV_ICONS[name] ?? Circle; return <C {...p} />; };
export function Shell() {
  const { user, loading, logout } = useAuth(); const [open, setOpen] = useState(false); const loc = useLocation();
  if (loading) return <section className="auth"><p>جارٍ التحميل…</p></section>;
  if (!user) return <Navigate to="/login" replace />; if (user.status !== 'ACTIVE') return <Navigate to="/pending" replace />;
  const slug = user.stage?.slug ?? 'church';
  return (
    <div className="shell" data-stage={slug}>
      <aside className={open ? 'side open' : 'side'}>
        <div className="side-pattern" aria-hidden />
        <div className="who">
          <div className="badge"><img src={logo} alt="" /></div>
          <b>{user.fullName}</b><small>{user.roles.map(r => ROLE_LABEL[r]).join(' · ')}</small>
          {user.stage && <em>{user.stage.name}</em>}
        </div>
        <nav>{navFor(user.roles).map(([p, l]) => <NavLink key={p} to={p ? `/app/${p}` : '/app'} end={!p} onClick={() => setOpen(false)}><Ic name={NAV_ICON[p] ?? 'Circle'} size={19} strokeWidth={2.1} /><span>{l}</span></NavLink>)}</nav>
        <button className="btn btn--ghost btn--sm logout" onClick={() => logout()}><LogOut size={17} />تسجيل الخروج</button>
      </aside>
      <div className="main"><button className="menu" onClick={() => setOpen(o => !o)}>{open ? <X /> : <Menu />}</button>
        <div key={loc.pathname} className="page-in"><Outlet /></div><Copyright /></div>
    </div>
  );
}
const STAT_ICON: Record<string, string> = { 'مستخدمون نشطون': 'UserCheck', 'طلبات تسجيل معلّقة': 'UserPlus', 'المشرفون': 'UserCog', 'الخدام': 'Users', 'أمناء المخزن': 'Warehouse', 'خدام المرحلة': 'Users' };

export function Dashboard() {
  const { user } = useAuth();

  const canSeeStats = !!user?.roles.some(r => r === 'ADMIN' || r === 'SUPERVISOR');

  const d = useQuery({
    queryKey: ['dash'],
    enabled: canSeeStats,
    queryFn: async () => {
      const res = await api.get('/dashboard');
      const body = res.data as any;
      const stats = body?.data?.stats ?? body?.stats ?? {};

      return [
        { label: 'إجمالي المستخدمين', value: stats.totalUsers ?? 0 },
        { label: 'طلبات تسجيل معلّقة', value: stats.pendingUsers ?? 0 },
        { label: 'مستخدمون نشطون', value: stats.activeUsers ?? 0 },
        { label: 'مستخدمون مرفوضون', value: stats.rejectedUsers ?? 0 },
        { label: 'الخدام', value: stats.servants ?? 0 },
      ];
    },
  });

  return (
    <>
      <div className="page-head">
        <h2>أهلًا {user?.fullName ?? 'بك'}</h2>
        <span className="page-head-orn" aria-hidden />
      </div>

      {d.isError && <div className="err">{errorMessage(d.error)}</div>}

      {!canSeeStats ? null : d.isLoading ? (
        <p>جارٍ تحميل الإحصائيات...</p>
      ) : (
        <div className="grid dash">
          {(d.data ?? []).map((s, i) => (
            <div
              key={s.label}
              className="stat"
            >
              <span className="stat-ic">
                <Ic name={STAT_ICON[s.label] ?? 'Sparkle'} size={22} />
              </span>
              <p>{s.value}</p>
              <h3>{s.label}</h3>
              <i className="stat-bar" />
            </div>
          ))}
        </div>
      )}
    </>
  );
}


type Stage = {
  id: number;
  slug: string;
  name: string;
  order?: number | null;
};
type StageMember = {
  id: string;
  fullName: string;
  email: string;
  roles: string[];
};

type StageMembers = {
  stage: Stage;
  supervisors: StageMember[];
  servants: StageMember[];
};

export function Stages() {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ['stages'],
    queryFn: async () => {
      const res = await api.get('/stages');
      const body = res.data as any;
      const stages = body?.stages;

      if (!Array.isArray(stages)) {
        throw new Error('شكل بيانات المراحل غير متوقع من السيرفر.');
      }

      return stages as Stage[];
    },
  });

  const selectedStage = q.data?.find(
    (stage) => stage.id === selectedId
  );
  const members = useQuery({
  queryKey: ['stage-members', selectedId],
  enabled: selectedId !== null,

  queryFn: async (): Promise<StageMembers> => {
    if (selectedId === null) {
      throw new Error('اختار مرحلة الأول.');
    }

    const res = await api.get(
      `/stages/${selectedId}/members`
    );

    const body = res.data as StageMembers;

    if (
      !Array.isArray(body?.supervisors) ||
      !Array.isArray(body?.servants)
    ) {
      throw new Error(
        'شكل بيانات المشرفين والخدام غير متوقع.'
      );
    }

    return body;
  },
});
  return (
    <>
      <div className="page-head">
        <h2>مراحل الخدمة</h2>
        <span className="page-head-orn" aria-hidden />
      </div>

      <p>إدارة ومتابعة مراحل خدمة مدارس الأحد.</p>

      {q.isLoading && <p>جارٍ تحميل المراحل...</p>}

      {q.isError && (
        <div className="err">{errorMessage(q.error)}</div>
      )}

      {q.data && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 16,
              marginTop: 24,
            }}
          >
            {q.data.map((stage) => {
              const active = selectedId === stage.id;

              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() =>
                    setSelectedId(active ? null : stage.id)
                  }
                  aria-pressed={active}
                  style={{
                    textAlign: 'right',
                    padding: 22,
                    borderRadius: 16,
                    border: active
                      ? '2px solid #651f35'
                      : '1px solid #e5d7c7',
                    background: active ? '#f7efe3' : '#fff',
                    color: '#421321',
                    cursor: 'pointer',
                    boxShadow: active
                      ? '0 5px 18px #651f351c'
                      : '0 2px 8px #00000008',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 18,
                    }}
                  >
                    <span style={{ fontSize: 30 }}>
                      {STAGE_ICON[stage.slug] ?? '📚'}
                    </span>

                    <span
                      style={{
                        fontSize: 12,
                        padding: '5px 10px',
                        borderRadius: 20,
                        background: '#ead9c7',
                      }}
                    >
                      مرحلة {stage.order ?? stage.id}
                    </span>
                  </div>

                  <h3 style={{ margin: '0 0 10px', fontSize: 19 }}>
                    {stage.name}
                  </h3>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 13,
                      color: '#806b60',
                    }}
                  >
                    <code>{stage.slug}</code>
                    <span>
                      {active ? 'إخفاء التفاصيل ↑' : 'عرض التفاصيل ←'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedStage && (
            <section
              style={{
                marginTop: 24,
                padding: 24,
                borderRadius: 16,
                border: '1px solid #e5d7c7',
                background: '#fff',
              }}
            >
              <div className="page-head">
                <h2>
                  {STAGE_ICON[selectedStage.slug] ?? '📚'}{' '}
                  {selectedStage.name}
                </h2>
              </div>

              <p>تفاصيل المرحلة المختارة</p>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: 14,
                  marginTop: 20,
                }}
              >
                <div>
                  <small>رقم المرحلة</small>
                  <h3>{selectedStage.order ?? selectedStage.id}</h3>
                </div>

                <div>
                  <small>كود المرحلة</small>
                  <h3>
                    <code>{selectedStage.slug}</code>
                  </h3>
                </div>

                <div>
                  <small>اسم المرحلة</small>
                  <h3>{selectedStage.name}</h3>
                </div>
              </div>

            <div style={{ marginTop: 28 }}>
  {members.isLoading && (
    <p>جارٍ تحميل بيانات الخدام والمشرفين...</p>
  )}

  {members.isError && (
    <div className="err">
      {errorMessage(members.error)}
    </div>
  )}

  {members.data && (
    <>
      <h3 style={{ marginBottom: 14 }}>
        👨‍💼 المشرف المسؤول
      </h3>

      {members.data.supervisors.length === 0 ? (
        <p>لا يوجد مشرف مسجل في هذه المرحلة.</p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 14,
            marginBottom: 28,
          }}
        >
          {members.data.supervisors.map((member) => (
            <div
              key={member.id}
              style={{
                padding: 18,
                border: '1px solid #e5d7c7',
                borderRadius: 14,
                background: '#f7efe3',
              }}
            >
              <div style={{ fontSize: 24 }}>👨‍💼</div>
              <h3>{member.fullName}</h3>
              <p style={{ direction: 'ltr' }}>
                {member.email}
              </p>
              <small>مشرف المرحلة</small>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ marginBottom: 14 }}>
        🙋 خدام المرحلة ({members.data.servants.length})
      </h3>

      {members.data.servants.length === 0 ? (
        <p>لا يوجد خدام مسجلون في هذه المرحلة.</p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 14,
          }}
        >
          {members.data.servants.map((member) => (
            <div
              key={member.id}
              style={{
                padding: 18,
                border: '1px solid #e5d7c7',
                borderRadius: 14,
                background: '#fff',
              }}
            >
              <div style={{ fontSize: 24 }}>🙋</div>
              <h3>{member.fullName}</h3>
              <p style={{ direction: 'ltr' }}>
                {member.email}
              </p>
              <small>خادم</small>
            </div>
          ))}
        </div>
      )}
    </>
  )}
</div>
            </section>
          )}

          {q.data.length === 0 && (
            <p>لا توجد مراحل مسجلة حاليًا.</p>
          )}
        </>
      )}
    </>
  );
}




const PAGE_LABEL: Record<string, string> = Object.fromEntries(Object.entries(NAV).flatMap(([, items]) => items).map(([p, l]) => [p, l]));

export function Soon() {
  const { page = '' } = useParams();

  if (page === 'stages') {
    return <Stages />;
  }

  return (
    <>
      <div className="page-head">
        <h2>{PAGE_LABEL[page] ?? page}</h2>
        <span className="page-head-orn" aria-hidden />
      </div>

      <div className="soon">
        <div className="soon-ic">
          <Ic name={NAV_ICON[page] ?? 'Hourglass'} size={34} />
        </div>
        <h3>قيد الإنشاء</h3>
        <p>
          هذا القسم جزء من المراحل القادمة في خطة البناء،
          وسيُفعَّل أول ما يعتمد على بيانات حقيقية من الخادم.
        </p>
        <i className="soon-orn" aria-hidden />
      </div>
    </>
  );
}


export function Users() {
  const q = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await api.get('/users');
      const body = res.data as any;

      const users = body?.data?.users ?? body?.data?.items ?? body?.users ?? body?.items ?? [];

      if (!Array.isArray(users)) {
        throw new Error('شكل بيانات المستخدمين غير متوقع من السيرفر.');
      }

      return users as User[];
    },
  });

  return (
    <>
      <div className="page-head">
        <h2>المستخدمون</h2>
        <span className="page-head-orn" aria-hidden />
      </div>

      {q.isError && <div className="err">{errorMessage(q.error)}</div>}

      {q.isLoading && <p>جارٍ تحميل المستخدمين...</p>}

      {!q.isLoading && !q.isError && q.data?.length === 0 && (
        <p>لا يوجد مستخدمون لعرضهم.</p>
      )}

      {q.data && q.data.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الإيميل</th>
                <th>الأدوار</th>
                <th>المرحلة</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((u: any, i) => (
                <tr key={u.id ?? u._id ?? i}>
                  <td>{u.fullName ?? '—'}</td>
                  <td>{u.email ?? '—'}</td>
                  <td>
                    {(u.roles ?? [])
                      .map((r: string) => ROLE_LABEL[r] ?? r)
                      .join('، ') || '—'}
                  </td>
                  <td>{u.stage?.name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}


export function Registrations() {
  const q = useQuery({
    queryKey: ['registrations'],
    queryFn: async () => {
      const res = await api.get('/registrations');
      const body = res.data as any;

      const registrations =
        body?.data?.registrations ??
        body?.data?.items ??
        body?.registrations ??
        body?.items ??
        body?.data;

      if (Array.isArray(registrations)) {
        return registrations;
      }

      if (registrations == null) {
        return [];
      }

      throw new Error('شكل بيانات طلبات التسجيل غير متوقع من السيرفر.');
    },
  });

  return (
    <>
      <div className="page-head">
        <h2>طلبات التسجيل</h2>
        <span className="page-head-orn" aria-hidden />
      </div>

      {q.isError && (
        <div className="err">{errorMessage(q.error)}</div>
      )}

      {q.isLoading && <p>جارٍ تحميل طلبات التسجيل...</p>}

      {!q.isLoading && !q.isError && q.data?.length === 0 && (
        <p>لا توجد طلبات تسجيل حاليًا.</p>
      )}

      {!q.isLoading && !q.isError && q.data && q.data.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الإيميل</th>
                <th>الحالة</th>
                <th>المرحلة</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r: any, i: number) => (
                <tr key={r.id ?? r._id ?? i}>
                  <td>{r.fullName ?? r.user?.fullName ?? '—'}</td>
                  <td>{r.email ?? r.user?.email ?? '—'}</td>
                  <td>{r.status ?? '—'}</td>
                  <td>{r.stage?.name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

