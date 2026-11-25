import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useScroll, useSpring, useTransform } from 'framer-motion';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, CalendarCheck, HeartHandshake, Mail, Phone, ShieldCheck, Users } from 'lucide-react';
import church from '../assets/church.jpg';
import cross from '../assets/cross.png';
import Atmosphere from '../components/Atmosphere';
import Magnetic from '../components/Magnetic';
import { Item, Stagger } from '../components/Reveal';
import { PILLARS, SITE, STAGES, VERSE } from '../content';
const ease = [0.22, 1, 0.36, 1] as const;
const Word = ({ w, d }: { w: string; d: number }) => (
  <span className="mask"><motion.span initial={{ y: '115%', opacity: 0, filter: 'blur(10px)' }} animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }} transition={{ duration: 1.1, delay: d, ease }}>{w}</motion.span></span>
);
function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const py = useTransform(scrollYProgress, [0, 1], [0, 90]);
  const cy = useTransform(scrollYProgress, [0, 1], [0, -40]);
  const mx = useMotionValue(0), my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 60, damping: 20 }), sy = useSpring(my, { stiffness: 60, damping: 20 });
  const bx = useTransform(sx, v => v * -14), by = useTransform(sy, v => v * -10);
  const spx = useTransform(sx, v => v * (typeof window !== 'undefined' ? window.innerWidth : 0)), spy = useTransform(sy, v => v * (typeof window !== 'undefined' ? window.innerHeight : 0));
  const fine = typeof window !== 'undefined' && window.matchMedia('(pointer:fine)').matches;
  return (
    <section id="home" ref={ref} className="hero" onMouseMove={fine ? e => { mx.set(e.clientX / window.innerWidth - 0.5); my.set(e.clientY / window.innerHeight - 0.5); } : undefined}>
      <div className="sky" />
      <motion.div className="sun" animate={{ opacity: [0.7, 1, 0.7], scale: [1, 1.12, 1] }} transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div className="church" style={{ y: py, x: bx }}>
        <motion.img src={church} alt="كنيسة الشهيدين العظيمين أبّا كير ويوحنا" style={{ y: by }} initial={{ scale: 1.25, opacity: 0 }} animate={{ scale: 1.02, opacity: 1 }} transition={{ duration: 2.2, ease }} />
      </motion.div>
      <div className="fog" />
      <Atmosphere />
      {fine && <motion.div className="spot" style={{ x: spx, y: spy }} />}
      <motion.div className="hero-content" style={{ y: cy }}>
        <motion.div className="cross-row" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1, delay: 0.5, ease }}>
          <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1, delay: 0.9, ease }} style={{ transformOrigin: 'right' }} />
          <motion.img src={cross} alt="" animate={{ rotate: [0, 4, -4, 0], filter: ['drop-shadow(0 0 0 #d9a93a00)', 'drop-shadow(0 0 14px #d9a93aaa)', 'drop-shadow(0 0 0 #d9a93a00)'] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }} />
          <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1, delay: 0.9, ease }} style={{ transformOrigin: 'left' }} />
        </motion.div>
        <h1 className="title" aria-label={SITE.name}><Word w="جســد" d={0.7} /> <Word w="واحــد" d={0.85} /></h1>
        <p className="verse">{VERSE.map((l, i) => <span className="mask" key={i}><motion.span initial={{ y: '110%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.9, delay: 1.25 + i * 0.18, ease }}>{l}</motion.span></span>)}</p>
        <motion.small className="ref" initial={{ opacity: 0 }} animate={{ opacity: 0.85 }} transition={{ duration: 1, delay: 1.7 }}>أفسس ٤ : ٤</motion.small>
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 1.95, ease }}>
          <Magnetic><Link to="/login" className="btn btn--lg"><ArrowLeft size={20} className="arr" />ابدأ رحلتك معنا</Link></Magnetic>
        </motion.div>
      </motion.div>
      <motion.div className="hero-foot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.2, duration: 1 }}>
        <div className="cross-row sm"><i /><span>✝</span><i /></div>
        <p>{SITE.church}</p>
      </motion.div>
    </section>
  );
}
const ICONS = [HeartHandshake, CalendarCheck, Users, ShieldCheck];
function Pillars() {
  const [a, setA] = useState(0);
  return (
    <Stagger className="acc">
      {PILLARS.map((p, i) => { const I = ICONS[i]; return (
        <Item key={p.t} className={`pan-w ${a === i ? 'on' : ''}`}>
          <div className="pan" tabIndex={0} onMouseEnter={() => setA(i)} onFocus={() => setA(i)} onClick={() => setA(i)}>
            <span className="num">{['٠١', '٠٢', '٠٣', '٠٤'][i]}</span>
            <motion.span className="ico" animate={a === i ? { rotate: [0, -10, 10, 0], scale: 1.1 } : { rotate: 0, scale: 1 }} transition={{ duration: 0.6 }}><I size={28} /></motion.span>
            <h3>{p.t}</h3><p>{p.d}</p><i className="bar" />
          </div>
        </Item>); })}
    </Stagger>
  );
}
const Head = ({ t, s }: { t: string; s?: string }) => (
  <Stagger className="sec-head"><Item><h2>{t}</h2></Item><Item><div className="divider"><i /><span>✝</span><i /></div></Item>{s && <Item><p>{s}</p></Item>}</Stagger>
);
export default function Home() {
  const { hash } = useLocation();
  useEffect(() => { const id = hash.replace('#', ''); if (id && id !== 'home') setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 80); }, [hash]);
  const phone = import.meta.env.VITE_CONTACT_PHONE, mail = import.meta.env.VITE_CONTACT_EMAIL;
  return (
    <>
      <Hero />
      <div className="strip" />
      <section id="about" className="sec">
        <Head t="عن الخدمة" s="نظام يجمع الخدام والمشرفين حول هدف واحد: رعاية كل فرد بالمحبة والنظام." />
        <Pillars />
      </section>
      <section id="stages" className="sec alt">
        <Head t="المراحل" s="تُنظَّم الخدمة في مراحل، ولكل مرحلة خدامها وسجلاتها." />
        <Stagger className="stages">{STAGES.map((s, i) => <Item key={s}><motion.div className="stage" whileHover={{ scale: 1.05 }}><em>{i + 1}</em>{s}</motion.div></Item>)}</Stagger>
      </section>
      <section id="contact" className="sec">
        <Head t="تواصل معنا" s="للاستفسار تواصل مع خادم مرحلتك أو مع مسؤول الخدمة." />
        <Stagger className="contact">
          {phone && <Item><a className="btn" href={`tel:${phone}`}><Phone size={18} />{phone}</a></Item>}
          {mail && <Item><a className="btn" href={`mailto:${mail}`}><Mail size={18} />{mail}</a></Item>}
          <Item><Link className="btn btn--ghost" to="/login">دخول الخدام</Link></Item>
        </Stagger>
      </section>
      <footer className="foot">© جميع الحقوق محفوظة بواسطة المطورين MS</footer>
    </>
  );
}
