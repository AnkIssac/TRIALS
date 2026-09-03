import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSocket } from './hooks/useSocket.js';
import Lobby from './components/Lobby.jsx';
import WordChoices from './components/WordChoices.jsx';
import Canvas from './components/Canvas.jsx';
import Chat from './components/Chat.jsx';
import PlayerList from './components/PlayerList.jsx';
import Timer from './components/Timer.jsx';

let msgIdCounter = 0;
const nextMsgId = () => `m${++msgIdCounter}-${Date.now()}`;

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

  const roomStateRef = useRef(roomState);
  roomStateRef.current = roomState;

  useEffect(() => {
    const onConnect = () => setMySocketId(socket.id);

    const onRoomCreated = () => setErrorMessage('');
    const onRoomJoined = () => setErrorMessage('');
    const onRoomError = ({ message }) => setErrorMessage(message);

    const onRoomState = (state) => {
      setRoomState(state);
      if (state.phase === 'choosing') {
        setRoundEndInfo(null);
        setFinalScores(null);
        setMyWord(null);
      }
    };

    const onWordChoices = ({ choices }) => setWordChoices(choices);

    const onRoundStart = ({ wordLength: wl, timeLimit: tl }) => {
      setWordChoices(null);
      setMyWord(null);
      setWordLength(wl);
      setTimeLimit(tl);
      setRoundEndInfo(null);
      setStrokeHistory(null);
      setRoundKey((k) => k + 1);
    };

    const onRoundWord = ({ word }) => setMyWord(word);

    const onDrawHistory = ({ strokes }) => setStrokeHistory(strokes);

    const onChatMessage = (msg) => {
      setMessages((prev) => [...prev.slice(-99), { ...msg, id: nextMsgId() }]);
    };

    const onRoundEnd = ({ word, scores, reason }) => {
      setRoundEndInfo({ word, scores, reason });
      setMyWord(null);
      setWordChoices(null);
    };

    const onGameEnd = ({ finalScores: fs }) => {
      setFinalScores(fs);
      setRoundEndInfo(null);
    };

    socket.on('connect', onConnect);
    socket.on('room:created', onRoomCreated);
    socket.on('room:joined', onRoomJoined);
    socket.on('room:error', onRoomError);
    socket.on('room:state', onRoomState);
    socket.on('word:choices', onWordChoices);
    socket.on('round:start', onRoundStart);
    socket.on('round:word', onRoundWord);
    socket.on('draw:history', onDrawHistory);
    socket.on('chat:message', onChatMessage);
    socket.on('round:end', onRoundEnd);
    socket.on('game:end', onGameEnd);

    return () => {
      socket.off('connect', onConnect);
      socket.off('room:created', onRoomCreated);
      socket.off('room:joined', onRoomJoined);
      socket.off('room:error', onRoomError);
      socket.off('room:state', onRoomState);
      socket.off('word:choices', onWordChoices);
      socket.off('round:start', onRoundStart);
      socket.off('round:word', onRoundWord);
      socket.off('draw:history', onDrawHistory);
      socket.off('chat:message', onChatMessage);
      socket.off('round:end', onRoundEnd);
      socket.off('game:end', onGameEnd);
    };
  }, [socket]);

  const handleCreate = (username) => {
    setErrorMessage('');
    socket.emit('room:create', { username });
  };

  const handleJoin = (username, roomId) => {
    setErrorMessage('');
    socket.emit('room:join', { roomId, username });
  };

  const handleStart = () => socket.emit('game:start');
  const handlePickWord = (word) => socket.emit('word:pick', { word });

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
          onCreate={handleCreate}
          onJoin={handleJoin}
          onStart={handleStart}
        />
      </div>
    );
  }

  if (phase === 'game-end' && finalScores) {
    const isHost = roomState.hostId === mySocketId;
    return (
      <div className="app-shell centered">
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
      <header className="game-header">
        <div className="room-pill">Room {roomState.roomId}</div>
        <div className="round-pill">
          Round {roomState.roundNumber}/{roomState.maxRounds}
        </div>
        {phase === 'drawing' && <Timer timeLimitMs={timeLimit} roundKey={roundKey} />}
        {phase === 'drawing' && (
          <div className="word-hint">
            {isDrawer ? myWord : Array.from({ length: wordLength }).map((_, i) => <span key={i} className="letter-blank" />)}
          </div>
        )}
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
