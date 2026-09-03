import { useState } from 'react';
import PlayerList from './PlayerList.jsx';

const MIN_PLAYERS_TO_START = 2;

/**
 * Covers both pre-join screens: the create/join form (`joined === false`)
 * and the in-room waiting room once you've joined but the host hasn't
 * started the game yet (`joined === true`).
 */
export default function Lobby({
  joined,
  roomId,
  players,
  hostId,
  mySocketId,
  errorMessage,
  onCreate,
  onJoin,
  onStart,
}) {
  const [username, setUsername] = useState(() => localStorage.getItem('doodle-duel-username') || '');
  const [joinCode, setJoinCode] = useState('');

  const persistName = (name) => {
    try {
      localStorage.setItem('doodle-duel-username', name);
    } catch {
      /* ignore (private browsing, etc.) */
    }
  };

  if (!joined) {
    return (
      <div className="lobby-card">
        <h1 className="brand">🎨 Doodle Duel</h1>
        <p className="tagline">Draw. Guess. Duel your friends.</p>

        <label className="field">
          <span>Your name</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={20}
            placeholder="e.g. Scribbles"
          />
        </label>

        <div className="lobby-actions">
          <button
            className="primary"
            disabled={!username.trim()}
            onClick={() => {
              persistName(username.trim());
              onCreate(username.trim());
            }}
          >
            Create a Room
          </button>

          <div className="join-row">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
              placeholder="ROOM CODE"
              className="room-code-input"
            />
            <button
              disabled={!username.trim() || !joinCode.trim()}
              onClick={() => {
                persistName(username.trim());
                onJoin(username.trim(), joinCode.trim());
              }}
            >
              Join
            </button>
          </div>
        </div>

        {errorMessage && <p className="error-text">{errorMessage}</p>}
      </div>
    );
  }

  const isHost = hostId === mySocketId;
  const canStart = players.length >= MIN_PLAYERS_TO_START;

  return (
    <div className="lobby-card waiting-room">
      <h2>Room Code</h2>
      <div className="room-code-display">{roomId}</div>
      <p className="hint">Share this code with friends so they can join.</p>

      <PlayerList players={players} hostId={hostId} drawerId={null} mySocketId={mySocketId} />

      {isHost ? (
        <button className="primary" disabled={!canStart} onClick={onStart}>
          {canStart ? 'Start Game' : `Need at least ${MIN_PLAYERS_TO_START} players`}
        </button>
      ) : (
        <p className="hint">Waiting for the host to start the game...</p>
      )}

      {errorMessage && <p className="error-text">{errorMessage}</p>}
    </div>
  );
}
