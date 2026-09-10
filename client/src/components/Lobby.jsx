import { useRef, useState } from 'react';
import PlayerList from './PlayerList.jsx';
import AvatarPicker from './AvatarPicker.jsx';

const MIN_PLAYERS_TO_START = 2;
const ROUND_LENGTH_OPTIONS = [
  { value: 30_000, label: '30s' },
  { value: 45_000, label: '45s' },
  { value: 60_000, label: '60s' },
  { value: 80_000, label: '80s' },
  { value: 90_000, label: '90s' },
  { value: 120_000, label: '120s' },
];
const ROUNDS_PER_PLAYER_OPTIONS = [1, 2, 3, 4, 5];

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
  roundLengthMs,
  roundsPerPlayer,
  customWordCount,
  onCreate,
  onJoin,
  onStart,
  onSetSettings,
  onSetWordList,
}) {
  const [username, setUsername] = useState(() => localStorage.getItem('doodle-duel-username') || '');
  const [joinCode, setJoinCode] = useState('');
  const [wordListDraft, setWordListDraft] = useState('');
  const avatarRef = useRef(null);

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

        <AvatarPicker ref={avatarRef} />

        <div className="lobby-actions">
          <button
            className="primary"
            disabled={!username.trim()}
            onClick={() => {
              persistName(username.trim());
              onCreate(username.trim(), avatarRef.current?.getDataUrl() ?? null);
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
                onJoin(username.trim(), joinCode.trim(), avatarRef.current?.getDataUrl() ?? null);
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

      <div className="game-settings">
        <span className="field-label">Game Settings</span>
        {isHost ? (
          <div className="settings-row">
            <label className="settings-field">
              <span>Round length</span>
              <select
                value={roundLengthMs}
                onChange={(e) => onSetSettings({ roundLengthMs: Number(e.target.value) })}
              >
                {ROUND_LENGTH_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Rounds/player</span>
              <select
                value={roundsPerPlayer}
                onChange={(e) => onSetSettings({ roundsPerPlayer: Number(e.target.value) })}
              >
                {ROUNDS_PER_PLAYER_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <p className="hint">
            {Math.round(roundLengthMs / 1000)}s rounds &middot; {roundsPerPlayer} round{roundsPerPlayer === 1 ? '' : 's'}{' '}
            per player
          </p>
        )}
      </div>

      <div className="word-list-settings">
        <span className="field-label">Custom Word List</span>
        <p className="hint">
          {customWordCount > 0 ? `Using ${customWordCount} custom words` : 'Using the default word list'}
        </p>
        {isHost && (
          <>
            <textarea
              className="word-list-textarea"
              value={wordListDraft}
              onChange={(e) => setWordListDraft(e.target.value)}
              placeholder="Type your own words, separated by commas or new lines (leave blank to use the default list)"
              rows={3}
            />
            <button type="button" onClick={() => onSetWordList(wordListDraft)}>
              Save Word List
            </button>
          </>
        )}
      </div>

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
