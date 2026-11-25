import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth';
import Atmosphere from '../components/Atmosphere';
import church from '../assets/church.jpg';
export default function Register() {
  const { user, setUser } = useAuth(); const nav = useNavigate();
  const [f, setF] = useState({ fullName: '', email: '', password: '' }), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/app" replace />;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <section className="auth"><div className="sky" /><div className="church" aria-hidden><img src={church} alt="" /></div><Atmosphere />
      <motion.form className="card auth-card" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} onSubmit={async e => { e.preventDefault(); setErr(''); setBusy(true); try { const { data } = await api.post<{ user: import('../auth').User }>('/auth/register', f); setUser(data.user); nav('/pending'); } catch (x) { setErr(errorMessage(x)); } setBusy(false); }}>
        <h2>إنشاء حساب</h2><p>بعد التسجيل سيراجع أمين الخدمة طلبك ويحدد مرحلتك.</p>
        <label><input placeholder="الاسم الكامل" value={f.fullName} onChange={set('fullName')} /></label>
        <label><input type="email" placeholder="الإيميل" value={f.email} onChange={set('email')} /></label>
        <label><input type="password" placeholder="كلمة المرور (8 أحرف على الأقل)" value={f.password} onChange={set('password')} /></label>
        {err && <div className="err">{err}</div>}
        <button className="btn btn--lg" disabled={busy}>{busy ? 'جارٍ الإرسال…' : 'إرسال الطلب'}</button>
        <small>لديك حساب؟ <Link to="/login" style={{ color: 'var(--gold)' }}>سجّل الدخول</Link></small>
      </motion.form>
    </section>
  );
}
