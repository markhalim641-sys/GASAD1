import { motion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';
const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.12 } } };
const item: Variants = { hidden: { opacity: 0, y: 40, filter: 'blur(8px)' }, show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] } } };
export const Stagger = ({ children, className }: { children: ReactNode; className?: string }) => (
  <motion.div className={className} variants={container} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }}>{children}</motion.div>
);
export const Item = ({ children, className }: { children: ReactNode; className?: string }) => <motion.div className={className} variants={item}>{children}</motion.div>;
