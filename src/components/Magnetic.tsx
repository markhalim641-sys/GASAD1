import { motion, useMotionValue, useSpring } from 'framer-motion';
import type { ReactNode } from 'react';
export default function Magnetic({ children, strength = 0.3 }: { children: ReactNode; strength?: number }) {
  const x = useMotionValue(0), y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 16, mass: 0.4 }), sy = useSpring(y, { stiffness: 220, damping: 16, mass: 0.4 });
  const fine = typeof window !== 'undefined' && window.matchMedia('(pointer:fine)').matches;
  return (
    <motion.div style={{ x: sx, y: sy, display: 'inline-block' }}
      onMouseMove={fine ? e => { const r = e.currentTarget.getBoundingClientRect(); x.set((e.clientX - r.left - r.width / 2) * strength); y.set((e.clientY - r.top - r.height / 2) * strength); } : undefined}
      onMouseLeave={() => { x.set(0); y.set(0); }}>{children}</motion.div>
  );
}
