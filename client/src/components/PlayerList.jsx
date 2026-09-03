import { motion, AnimatePresence } from 'framer-motion';

export default function PlayerList({ players, hostId, drawerId, mySocketId }) {
  const sorted = [...players].sort((a, b) => b.score - a.score);

  return (
    <ul className="player-list">
      <AnimatePresence initial={false}>
        {sorted.map((p) => (
          <motion.li
            key={p.socketId}
            layout
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.25 }}
            className={`player-row ${p.socketId === drawerId ? 'is-drawer' : ''}`}
          >
            <span className="player-avatar" style={{ background: p.color }}>
              {p.username.slice(0, 1).toUpperCase()}
            </span>
            <span className="player-name">
              {p.username}
              {p.socketId === mySocketId && ' (you)'}
            </span>
            <span className="player-badges">
              {p.socketId === hostId && <span title="Host">👑</span>}
              {p.socketId === drawerId && <span title="Drawing">✏️</span>}
              {p.hasGuessedCorrectly && <span title="Guessed it">✅</span>}
            </span>
            <motion.span
              key={p.score}
              initial={{ scale: 1.4, color: '#2f9e44' }}
              animate={{ scale: 1, color: 'inherit' }}
              transition={{ duration: 0.4 }}
              className="player-score"
            >
              {p.score}
            </motion.span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
