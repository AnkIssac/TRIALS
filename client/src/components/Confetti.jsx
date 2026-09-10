import { useMemo } from 'react';
import { motion } from 'framer-motion';

const COLORS = ['#7c3aed', '#ff5d8f', '#f7931e', '#21a366', '#1971c2', '#f5d90a'];

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A short-lived confetti burst, fixed over the whole viewport. Re-fires
 * whenever `burstKey` changes (bump a counter in the parent) -- 0/null/
 * undefined renders nothing, so a parent can gate it with its own state
 * without an extra "visible" flag. Skips rendering entirely when the
 * viewer has requested reduced motion.
 */
export default function Confetti({ burstKey, big = false }) {
  const particles = useMemo(() => {
    if (!burstKey || prefersReducedMotion()) return [];
    const count = big ? 60 : 24;
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      color: COLORS[i % COLORS.length],
      left: 50 + (Math.random() - 0.5) * (big ? 90 : 40),
      x: (Math.random() - 0.5) * (big ? 480 : 220),
      y: (big ? 320 : 200) + Math.random() * 160,
      rotate: Math.random() * 360,
      delay: Math.random() * (big ? 0.35 : 0.15),
      size: 6 + Math.random() * 7,
      round: i % 2 === 0,
    }));
  }, [burstKey, big]);

  if (particles.length === 0) return null;

  return (
    <div className="confetti-layer" aria-hidden="true">
      {particles.map((p) => (
        <motion.span
          key={`${burstKey}-${p.id}`}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            background: p.color,
            width: p.size,
            height: p.size,
            borderRadius: p.round ? '50%' : '3px',
          }}
          initial={{ opacity: 1, y: 0, x: 0, rotate: 0 }}
          animate={{ opacity: 0, y: p.y, x: p.x, rotate: p.rotate }}
          transition={{ duration: 1.1, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}
