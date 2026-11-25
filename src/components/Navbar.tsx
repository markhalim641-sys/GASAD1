import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link, useLocation } from 'react-router-dom';
import { Menu, User as UserIcon, X } from 'lucide-react';
import logo from '../assets/logo-official.png';
import { NAV, SITE } from '../content';
import Magnetic from './Magnetic';
import { useAuth } from '../auth';
export default function Navbar() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const [active, setActive] = useState('home');
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 20); on();
    window.addEventListener('scroll', on, { passive: true }); return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => {
    if (pathname !== '/') return;
    const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && setActive(e.target.id)), { rootMargin: '-45% 0px -50% 0px' });
    NAV.forEach(n => { const el = document.getElementById(n.id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, [pathname]);
  const cur = pathname === '/' ? active : '';
  const cta = user ? { to: '/app', label: user.fullName.split(' ')[0] } : { to: '/login', label: 'دخول الخدام' };
  return (
    <motion.header className={`nav ${scrolled ? 'nav--s' : ''}`} initial={{ y: -90, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}>
      <Link to="/" className="brand" aria-label={SITE.name}>
        <motion.img src={logo} alt="" whileHover={{ rotate: [0, -6, 6, 0], scale: 1.08 }} transition={{ duration: 0.6 }} />
        <span>{SITE.name.replace(' ', '\u00A0')}</span>
      </Link>
      <nav className="links">
        {NAV.map((n, i) => (
          <motion.div key={n.id} initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 + i * 0.09 }}>
            <Link to={n.id === 'home' ? '/#home' : `/#${n.id}`} className={cur === n.id ? 'on' : ''} onClick={() => n.id === 'home' && pathname === '/' && window.scrollTo({ top: 0, behavior: 'smooth' })}>
              {n.label}
              {cur === n.id && <motion.i layoutId="ind" className="ind" transition={{ type: 'spring', stiffness: 380, damping: 30 }} />}
            </Link>
          </motion.div>
        ))}
      </nav>
      <div className="nav-end">
        <Magnetic strength={0.25}><Link to={cta.to} className="btn btn--sm"><UserIcon size={18} />{cta.label}</Link></Magnetic>
        <button className="burger" aria-label="القائمة" onClick={() => setOpen(o => !o)}>{open ? <X /> : <Menu />}</button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div className="drawer" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            {NAV.map((n, i) => <motion.div key={n.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}><Link to={`/#${n.id}`} onClick={() => setOpen(false)}>{n.label}</Link></motion.div>)}
            <Link to={cta.to} className="btn">{cta.label}</Link>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
