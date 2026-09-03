import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const CHOICE_TIMEOUT_S = 10;

export default function WordChoices({ choices, onPick }) {
  const [secondsLeft, setSecondsLeft] = useState(CHOICE_TIMEOUT_S);

  useEffect(() => {
    setSecondsLeft(CHOICE_TIMEOUT_S);
  }, [choices]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);

  return (
    <motion.div
      className="word-choices"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <h2>Pick a word to draw</h2>
      <p className="hint">Auto-picking the first option in {secondsLeft}s...</p>
      <div className="choice-buttons">
        {choices.map((c) => (
          <button key={c.word} className={`choice-btn difficulty-${c.difficulty}`} onClick={() => onPick(c.word)}>
            <span className="choice-word">{c.word}</span>
            <span className="choice-difficulty">{c.difficulty}</span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}
