import { useEffect, useState } from 'react';

/**
 * Purely a local, best-effort display countdown. The server is the source
 * of truth and ends the round on its own timer regardless of what this
 * shows -- so there's no need to sync a tick every second over the wire.
 */
export default function Timer({ timeLimitMs, roundKey }) {
  const [timeLeft, setTimeLeft] = useState(timeLimitMs ? Math.ceil(timeLimitMs / 1000) : 0);

  useEffect(() => {
    setTimeLeft(timeLimitMs ? Math.ceil(timeLimitMs / 1000) : 0);
  }, [roundKey, timeLimitMs]);

  useEffect(() => {
    if (timeLeft <= 0) return;
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [timeLeft]);

  const isLow = timeLeft <= 10;

  return (
    <div className={`timer ${isLow ? 'timer-low' : ''}`}>
      <span className="timer-value">{Math.max(0, timeLeft)}</span>
      <span className="timer-unit">s</span>
    </div>
  );
}
