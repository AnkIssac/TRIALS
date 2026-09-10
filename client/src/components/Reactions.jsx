import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

let idCounter = 0;

/**
 * Floating emoji bursts, fixed over the whole viewport. Self-contained --
 * owns its own socket listener and particle lifecycle -- so it can just be
 * dropped into any screen without threading reaction state through props.
 */
export default function Reactions({ socket }) {
  const [bursts, setBursts] = useState([]);

  useEffect(() => {
    if (!socket) return;

    const onReaction = ({ emoji }) => {
      const id = ++idCounter;
      const x = 15 + Math.random() * 70; // vw%
      setBursts((prev) => [...prev.slice(-24), { id, emoji, x }]);
      setTimeout(() => {
        setBursts((prev) => prev.filter((b) => b.id !== id));
      }, 1600);
    };

    socket.on('reaction:broadcast', onReaction);
    return () => socket.off('reaction:broadcast', onReaction);
  }, [socket]);

  return (
    <div className="reactions-layer" aria-hidden="true">
      <AnimatePresence>
        {bursts.map((b) => (
          <motion.span
            key={b.id}
            className="reaction-emoji"
            style={{ left: `${b.x}%` }}
            initial={{ opacity: 0, y: 0, scale: 0.5 }}
            animate={{ opacity: [0, 1, 1, 0], y: -160, scale: 1.3 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.4, ease: 'easeOut' }}
          >
            {b.emoji}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
