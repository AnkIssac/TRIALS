import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSocket } from './hooks/useSocket.js';
import Lobby from './components/Lobby.jsx';
import WordChoices from './components/WordChoices.jsx';
import Canvas from './components/Canvas.jsx';
import Chat from './components/Chat.jsx';
import PlayerList from './components/PlayerList.jsx';
import Timer from './components/Timer.jsx';
import Confetti from './components/Confetti.jsx';
import * as sound from './utils/sound.js';

let msgIdCounter = 0;
const nextMsgId = () => `m${++msgIdCounter}-${Date.now()}`;

const CLIENT_ID_KEY = 'doodle-duel-client-id';
const SESSION_KEY = 'doodle-duel-session';

// A stable per-TAB id so a dropped connection (refresh, phone lock, wifi
// blip) can reclaim the same player slot instead of joining as a new
// player. sessionStorage (not localStorage) is deliberate here: it
// survives a reload of this tab but is NOT shared with other tabs, so
// opening the game in several tabs of the same browser still gives you
// several independent players instead of every tab reconnecting as the
// first one. A private window / cleared storage just starts a fresh
// identity, which is fine.
function getOrCreateClientId() {
  try {
    let id = sessionStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID?.() ?? `c${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return `c${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function saveSession(session) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore (private browsing, etc.) */
  }
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export default function App() {
  const { socket, connected } = useSocket();

  const [mySocketId, setMySocketId] = useState(socket.id);
  const [roomState, setRoomState] = useState(null); // server's room:state payload
  const [errorMessage, setErrorMessage] = useState('');
  const [messages, setMessages] = useState([]);

  const [wordChoices, setWordChoices] = useState(null); // drawer only
  const [myWord, setMyWord] = useState(null); // drawer only
  const [wordLength, setWordLength] = useState(0);
  const [timeLimit, setTimeLimit] = useState(0);
  const [roundKey, setRoundKey] = useState(0);
  const [strokeHistory, setStrokeHistory] = useState(null);

  const [roundEndInfo, setRoundEndInfo] = useState(null);
  const [finalScores, setFinalScores] = useState(null);
  const [hintMask, setHintMask] = useState(null);
  const [confetti, setConfetti] = useState({ key: 0, big: false });
  const [muted, setMutedState] = useState(() => sound.isMuted());

  const fireConfetti = (big) => setConfetti((c) => ({ key: c.key + 1, big }));
  const toggleMuted = () => {
    const next = !muted;
    sound.setMuted(next);
    setMutedState(next);
  };

  const roomStateRef = useRef(roomState);
  roomStateRef.current = roomState;

  const clientIdRef = useRef(getOrCreateClientId());
  const pendingUsernameRef = useRef(''); // username of the create/join currently in flight

  useEffect(() => {
    const onConnect = () => {
      setMySocketId(socket.id);

      // Reconnected (or just loaded the page) with a saved session and no
      // room state yet -- try to reclaim our slot rather than sitting on
      // the home screen. The server matches us by clientId, so this is a
      // no-op if that room/player no longer exists.
      const session = loadSession();
      if (session && !roomStateRef.current) {
        pendingUsernameRef.current = session.username;
        socket.emit('room:join', { roomId: session.roomId, username: session.username, clientId: clientIdRef.current });
      }
    };

    const onRoomCreated = ({ roomId }) => {
      setErrorMessage('');
      saveSession({ roomId, username: pendingUsernameRef.current });
    };
    const onRoomJoined = ({ roomId }) => {
      setErrorMessage('');
      saveSession({ roomId, username: pendingUsernameRef.current });
    };
    const onRoomRejoined = ({ roomId }) => {
      setErrorMessage('');
      saveSession({ roomId, username: pendingUsernameRef.current });
    };
    const onRoomError = ({ message }) => {
      setErrorMessage(message);
      clearSession();
    };

    const onRoomState = (state) => {
      setRoomState(state);
      if (state.phase === 'choosing') {
        setRoundEndInfo(null);
        setFinalScores(null);
        setMyWord(null);
        setHintMask(null);
      }
    };

    const onWordChoices = ({ choices }) => setWordChoices(choices);

    const onRoundStart = ({ wordLength: wl, timeLimit: tl, hint }) => {
      setWordChoices(null);
      setMyWord(null);
      setWordLength(wl);
      setTimeLimit(tl);
      setRoundEndInfo(null);
      setStrokeHistory(null);
      setHintMask(hint ?? null);
      setRoundKey((k) => k + 1);
      sound.playRoundStart();
    };

    const onRoundWord = ({ word }) => setMyWord(word);
    const onRoundHint = ({ hint }) => setHintMask(hint);

    const onDrawHistory = ({ strokes }) => setStrokeHistory(strokes);

    const onChatMessage = (msg) => {
      setMessages((prev) => [...prev.slice(-99), { ...msg, id: nextMsgId() }]);
      if (msg.correct) {
        if (msg.self) {
          sound.playYouGotIt();
          fireConfetti(false);
        } else if (!msg.system) {
          sound.playCorrectGuess();
        }
      }
    };

    const onRoundEnd = ({ word, scores, reason }) => {
      setRoundEndInfo({ word, scores, reason });
      setMyWord(null);
      setWordChoices(null);
    };

    const onGameEnd = ({ finalScores: fs }) => {
      setFinalScores(fs);
      setRoundEndInfo(null);
      sound.playVictory();
      fireConfetti(true);
    };

    socket.on('connect', onConnect);
    socket.on('room:created', onRoomCreated);
    socket.on('room:joined', onRoomJoined);
    socket.on('room:rejoined', onRoomRejoined);
    socket.on('room:error', onRoomError);
    socket.on('room:state', onRoomState);
    socket.on('word:choices', onWordChoices);
    socket.on('round:start', onRoundStart);
    socket.on('round:word', onRoundWord);
    socket.on('round:hint', onRoundHint);
    socket.on('draw:history', onDrawHistory);
    socket.on('chat:message', onChatMessage);
    socket.on('round:end', onRoundEnd);
    socket.on('game:end', onGameEnd);

    return () => {
      socket.off('connect', onConnect);
      socket.off('room:created', onRoomCreated);
      socket.off('room:joined', onRoomJoined);
      socket.off('room:rejoined', onRoomRejoined);
      socket.off('room:error', onRoomError);
      socket.off('room:state', onRoomState);
      socket.off('word:choices', onWordChoices);
      socket.off('round:start', onRoundStart);
      socket.off('round:word', onRoundWord);
      socket.off('round:hint', onRoundHint);
      socket.off('draw:history', onDrawHistory);
      socket.off('chat:message', onChatMessage);
      socket.off('round:end', onRoundEnd);
      socket.off('game:end', onGameEnd);
    };
  }, [socket]);

  const handleCreate = (username, avatar) => {
    setErrorMessage('');
    pendingUsernameRef.current = username;
    socket.emit('room:create', { username, clientId: clientIdRef.current, avatar });
  };

  const handleJoin = (username, roomId, avatar) => {
    setErrorMessage('');
    pendingUsernameRef.current = username;
    socket.emit('room:join', { roomId, username, clientId: clientIdRef.current, avatar });
  };

  const handleStart = () => socket.emit('game:start');
  const handlePickWord = (word) => socket.emit('word:pick', { word });
  const handleSetSettings = (settings) => socket.emit('room:setSettings', settings);
  const handleSetWordList = (words) => socket.emit('room:setWordList', { words });

  if (!connected) {
    return (
      <div className="app-shell centered">
        <p className="hint">Connecting to server...</p>
      </div>
    );
  }

  const inRoom = !!roomState;
  const phase = roomState?.phase;
  const isDrawer = roomState?.drawerId === mySocketId;
  const me = roomState?.players.find((p) => p.socketId === mySocketId);

  if (!inRoom || phase === 'lobby') {
    return (
      <div className="app-shell centered">
        <Lobby
          joined={inRoom}
          roomId={roomState?.roomId}
          players={roomState?.players ?? []}
          hostId={roomState?.hostId}
          mySocketId={mySocketId}
          errorMessage={errorMessage}
          roundLengthMs={roomState?.roundLengthMs ?? 80_000}
          roundsPerPlayer={roomState?.roundsPerPlayer ?? 2}
          customWordCount={roomState?.customWordCount ?? 0}
          onCreate={handleCreate}
          onJoin={handleJoin}
          onStart={handleStart}
          onSetSettings={handleSetSettings}
          onSetWordList={handleSetWordList}
        />
      </div>
    );
  }

  if (phase === 'game-end' && finalScores) {
    const isHost = roomState.hostId === mySocketId;
    return (
      <div className="app-shell centered">
        <Confetti burstKey={confetti.key} big={confetti.big} />
        <motion.div className="lobby-card game-end-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1>🏆 Final Scores</h1>
          <ol className="final-scores">
            {finalScores.map((p, i) => (
              <motion.li
                key={p.socketId}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.15 }}
              >
                <span className="rank">#{i + 1}</span>
                <span className="player-avatar" style={{ background: p.color }}>
                  {p.username.slice(0, 1).toUpperCase()}
                </span>
                <span className="player-name">{p.username}</span>
                <span className="player-score">{p.score}</span>
              </motion.li>
            ))}
          </ol>
          {isHost ? (
            <button className="primary" onClick={handleStart}>
              Play Again
            </button>
          ) : (
            <p className="hint">Waiting for the host to start another round...</p>
          )}
        </motion.div>
      </div>
    );
  }

  // choosing / drawing / round-end: the main game screen
  return (
    <div className="app-shell game-layout">
      <Confetti burstKey={confetti.key} big={confetti.big} />
      <header className="game-header">
        <div className="room-pill">Room {roomState.roomId}</div>
        <div className="round-pill">
          Round {roomState.roundNumber}/{roomState.maxRounds}
        </div>
        {phase === 'drawing' && <Timer timeLimitMs={timeLimit} roundKey={roundKey} onTick={sound.playTick} />}
        {phase === 'drawing' && (
          <div className="word-hint">
            {isDrawer
              ? myWord
              : (hintMask ?? '_'.repeat(wordLength))
                  .split('')
                  .map((ch, i) =>
                    ch === ' ' ? (
                      <span key={i} className="letter-space" />
                    ) : (
                      <span key={i} className="letter-blank">
                        {ch !== '_' ? ch : ''}
                      </span>
                    )
                  )}
          </div>
        )}
        <button
          type="button"
          className="mute-toggle"
          style={{ marginLeft: phase === 'drawing' ? 0 : 'auto' }}
          onClick={toggleMuted}
          aria-label={muted ? 'Unmute sound' : 'Mute sound'}
          title={muted ? 'Unmute sound' : 'Mute sound'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      </header>

      <div className="game-body">
        <aside className="sidebar">
          <PlayerList
            players={roomState.players}
            hostId={roomState.hostId}
            drawerId={roomState.drawerId}
            mySocketId={mySocketId}
          />
        </aside>

        <main className="main-stage">
          <AnimatePresence mode="wait">
            {phase === 'choosing' && (
              <motion.div key="choosing" className="stage-center" exit={{ opacity: 0 }}>
                {isDrawer && wordChoices ? (
                  <WordChoices choices={wordChoices} onPick={handlePickWord} />
                ) : (
                  <div className="waiting-message">
                    <p className="hint">
                      {roomState.players.find((p) => p.socketId === roomState.drawerId)?.username ?? 'The drawer'} is
                      choosing a word...
                    </p>
                  </div>
                )}
              </motion.div>
            )}

            {phase === 'drawing' && (
              <motion.div key="drawing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Canvas socket={socket} isDrawer={isDrawer} initialStrokes={strokeHistory} drawingLabel="Watch the artist!" />
              </motion.div>
            )}

            {phase === 'round-end' && roundEndInfo && (
              <motion.div
                key="round-end"
                className="stage-center"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="round-end-banner">
                  <h2>The word was:</h2>
                  <p className="revealed-word">{roundEndInfo.word}</p>
                  {roundEndInfo.reason === 'drawer-left' && <p className="hint">The drawer disconnected.</p>}
                  <p className="hint">Next round starting soon...</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <aside className="chat-sidebar">
          <Chat
            socket={socket}
            messages={messages}
            disabled={phase !== 'drawing' || isDrawer || !!me?.hasGuessedCorrectly}
            disabledReason={isDrawer ? "You're drawing!" : me?.hasGuessedCorrectly ? 'You already guessed it!' : undefined}
          />
        </aside>
      </div>
    </div>
  );
}
