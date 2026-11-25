import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';
export default function Pending() {
  const { user, logout } = useAuth();
  if (!user) return <Navigate to="/login" replace />; if (user.status === 'ACTIVE') return <Navigate to="/app" replace />;
  return <section className="auth"><div className="sky" /><div className="card auth-card"><h2>{user.status === 'REJECTED' ? 'تم رفض الطلب' : 'طلبك قيد المراجعة'}</h2><p>{user.status === 'REJECTED' ? 'تواصل مع أمين الخدمة.' : `أهلًا ${user.fullName}. سيفعّل أمين الخدمة حسابك ويحدد مرحلتك، ثم يمكنك الدخول.`}</p><button className="btn btn--ghost" onClick={() => logout()}>تسجيل الخروج</button></div></section>;
}
