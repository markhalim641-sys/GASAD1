import { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, User } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { errorMessage } from '../api/client';
import Atmosphere from '../components/Atmosphere';
import church from '../assets/church.jpg';
const DEMO: [string, string, string][] = [['أمين الخدمة', 'admin', 'Admin@123'], ['مشرف كي جي', 'sup_kg', 'Pass@123'], ['مشرف إعدادي بنات', 'sup_prep_girls', 'Pass@123'], ['مشرف ثانوي ولاد', 'sup_sec_boys', 'Pass@123'], ['مشرف مساعد', 'asst', 'Pass@123'], ['خادم', 'serv1', 'Pass@123'], ['أمين مخزن', 'store', 'Pass@123'], ['مسؤول حضور', 'att', 'Pass@123'], ['طلب معلّق', 'reg1', 'Pass@123']];
export default function Login() {
  const { user, login } = useAuth(); const nav = useNavigate();
  const [id, setId] = useState(''), [pw, setPw] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  if (user) return <Navigate to={user.status === 'ACTIVE' ? '/app' : '/pending'} replace />;
  const go = async (i: string, p: string) => { setErr(''); setBusy(true); try { await login(i, p); nav('/app'); } catch (e) { setErr(errorMessage(e)); } setBusy(false); };
  return (
    <section className="auth"><div className="sky" /><div className="church" aria-hidden><img src={church} alt="" /></div><Atmosphere />
      <motion.form className="card auth-card" onSubmit={e => { e.preventDefault(); go(id, pw); }} initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
        <h2>تسجيل الدخول</h2>
        <label><User size={18} /><input placeholder="الإيميل أو اسم المستخدم" autoComplete="username" value={id} onChange={e => setId(e.target.value)} /></label>
        <label><Lock size={18} /><input type="password" placeholder="كلمة المرور" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} /></label>
        {err && <div className="err">{err}</div>}
        <button className="btn btn--lg" disabled={busy || !id || !pw}>{busy ? 'جارٍ الدخول…' : 'دخول'}</button>
        <small>ليس لديك حساب؟ <Link to="/register" style={{ color: 'var(--gold)' }}>سجّل الآن</Link></small>
        {import.meta.env.VITE_DEMO_MODE === 'true' && <div className="demo"><b>دخول سريع (وضع التجربة)</b>{DEMO.map(([l, u, p]) => <button type="button" key={u} className="chip" onClick={() => go(u, p)}>{l}</button>)}</div>}
      </motion.form>
    </section>
  );
}
