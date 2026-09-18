import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import * as sound from '../utils/sound.js';

// "3... 2... 1... Draw!" -- purely cosmetic, doesn't touch the (server-
// authoritative) round timer, so it never costs the round any real time.
// Self-contained: mounts fresh every round (its parent, Canvas, remounts
// each round -- see App.jsx), runs its own steps, then renders nothing.
const STEPS = ['3', '2', '1', 'Draw!'];
const STEP_MS = 550;

export default function RoundCountdown() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (index === 0) {
      sound.playTick();
    } else if (index === STEPS.length - 1) {
      sound.playRoundStart();
    } else if (index < STEPS.length) {
      sound.playTick();
    }

    if (index >= STEPS.length - 1) {
      const t = setTimeout(() => setIndex((i) => i + 1), STEP_MS + 150);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setIndex((i) => i + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [index]);

  const label = STEPS[index];
  if (label === undefined) return null;

  return (
    <div className="round-countdown">
      <AnimatePresence mode="wait">
        <motion.span
          key={label}
          className={`countdown-step ${label === 'Draw!' ? 'countdown-go' : ''}`}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 1.7, opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
