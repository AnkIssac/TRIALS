import { motion, AnimatePresence } from 'framer-motion';

const TEAM_EMOJI = { red: '🔴', blue: '🔵' };

export default function PlayerList({
  players,
  hostId,
  drawerId,
  mySocketId,
  teamsEnabled,
  spectators = [],
  onJoinGame,
}) {
  const sorted = [...players].sort((a, b) => b.score - a.score);

  return (
    <>
      <ul className="player-list">
        <AnimatePresence initial={false}>
          {sorted.map((p) => (
            <motion.li
              key={p.clientId ?? p.socketId}
              layout
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.25 }}
              className={`player-row ${p.socketId === drawerId ? 'is-drawer' : ''} ${!p.connected ? 'is-disconnected' : ''} ${teamsEnabled && p.team ? `team-${p.team}` : ''}`}
            >
              {p.avatar ? (
                <img
                  src={p.avatar}
                  alt=""
                  className="player-avatar player-avatar-img"
                  style={{ borderColor: p.color, boxShadow: `0 0 0 2px white, 0 0 0 4px ${p.color}` }}
                />
              ) : (
                <span
                  className="player-avatar"
                  style={{ background: p.color, boxShadow: `0 0 0 2px white, 0 0 0 4px ${p.color}` }}
                >
                  {p.username.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="player-name">
                {teamsEnabled && p.team && <span title={`Team ${p.team}`}>{TEAM_EMOJI[p.team]} </span>}
                {p.username}
                {p.socketId === mySocketId && ' (you)'}
                {!p.connected && <span className="reconnecting-tag"> (reconnecting…)</span>}
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

      {spectators.length > 0 && (
        <div className="spectator-section">
          <span className="field-label">👀 Watching ({spectators.length})</span>
          <ul className="spectator-list">
            {spectators.map((s) => (
              <li key={s.clientId ?? s.socketId} className="spectator-row">
                {s.avatar ? (
                  <img src={s.avatar} alt="" className="player-avatar player-avatar-img spectator-avatar" />
                ) : (
                  <span className="player-avatar spectator-avatar">{s.username.slice(0, 1).toUpperCase()}</span>
                )}
                <span className="player-name">
                  {s.username}
                  {s.socketId === mySocketId && ' (you)'}
                </span>
                {s.socketId === mySocketId && (
                  <button type="button" className="join-game-btn" onClick={onJoinGame}>
                    Join Game
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
