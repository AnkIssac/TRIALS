import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

import { WORD_LIST, pickRandomWords } from './words.js';
import { calcPoints, normalize, closenessHint, DRAWER_POINTS_PER_GUESSER } from './scoring.js';
import {
  ROUND_LENGTH_MS,
  CHOICE_TIMEOUT_MS,
  ROUNDS_PER_PLAYER,
  MIN_PLAYERS_TO_START,
  RECONNECT_GRACE_MS,
  generateRoomId,
  createRoom,
  getRoom,
  deleteRoom,
  addPlayer,
  removePlayer,
  disconnectPlayer,
  reconnectPlayer,
  findByClientId,
  getPlayer,
  getDrawer,
  publicRoomState,
  allNonDrawersGuessed,
} from './rooms.js';

const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGINS = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// Always allow localhost dev even if CLIENT_URL is overridden for prod.
if (!ALLOWED_ORIGINS.includes('http://localhost:5173')) {
  ALLOWED_ORIGINS.push('http://localhost:5173');
}

const ROUND_END_PAUSE_MS = 5000; // time between round:end and the next word choice
const ALL_GUESSED_GRACE_MS = 1200; // let the last "Correct!" message land before ending
const HINT_FRACTIONS = [0.4, 0.7]; // reveal a letter at 40% and 70% of the round elapsed

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: ALLOWED_ORIGINS },
});

function sanitizeUsername(raw) {
  const trimmed = String(raw ?? '').trim().slice(0, 20);
  return trimmed || 'Player';
}

function broadcastRoomState(roomId) {
  const room = getRoom(roomId);
  if (!room) return;
  io.to(roomId).emit('room:state', publicRoomState(room));
}

// Word with hidden letters replaced by underscores; spaces pass through so
// multi-word answers still show their word breaks.
function buildHintMask(word, revealedIndices) {
  return [...word].map((ch, i) => (ch === ' ' ? ' ' : revealedIndices.has(i) ? ch : '_')).join('');
}

function clearHintTimers(room) {
  room.hintTimers.forEach(clearTimeout);
  room.hintTimers = [];
}

// Reveal a couple of letters as the round goes on -- capped so words stay
// guessable, and skipped entirely for very short words.
function scheduleHints(roomId, word) {
  const room = getRoom(roomId);
  if (!room) return;

  const letterIndices = [...word].reduce((acc, ch, i) => {
    if (/[a-z]/i.test(ch)) acc.push(i);
    return acc;
  }, []);
  const maxHints = letterIndices.length >= 7 ? 2 : letterIndices.length >= 4 ? 1 : 0;
  if (maxHints === 0) return;

  const hintIndices = [...letterIndices].sort(() => Math.random() - 0.5).slice(0, maxHints);
  const drawer = getDrawer(room);

  hintIndices.forEach((idx, i) => {
    const delay = ROUND_LENGTH_MS * (HINT_FRACTIONS[i] ?? HINT_FRACTIONS[HINT_FRACTIONS.length - 1]);
    const timer = setTimeout(() => {
      const r = getRoom(roomId);
      // Bail if the round has already moved on (ended early, next word, etc).
      if (!r || r.phase !== 'drawing' || r.currentWord !== word) return;

      r.revealedHintIndices.add(idx);
      const mask = buildHintMask(word, r.revealedHintIndices);
      r.players.forEach((p) => {
        if (p.connected && p.socketId !== drawer.socketId) {
          io.to(p.socketId).emit('round:hint', { hint: mask });
        }
      });
    }, delay);
    room.hintTimers.push(timer);
  });
}

// Bring a socket that just (re)joined mid-game up to speed: the word
// choices if they're the drawer picking, or the round state + secret word
// (drawer only) + stroke history + hint mask if a round is already drawing.
function sendRoundCatchUp(socket, room) {
  const drawer = getDrawer(room);
  const isDrawer = drawer && drawer.socketId === socket.id;

  if (room.phase === 'choosing' && isDrawer && room.currentWordChoices) {
    socket.emit('word:choices', { choices: room.currentWordChoices });
    return;
  }

  if (room.phase === 'drawing' && room.currentWord) {
    socket.emit('round:start', {
      drawerId: drawer.socketId,
      wordLength: room.currentWord.length,
      timeLimit: ROUND_LENGTH_MS,
      roundNumber: room.roundNumber,
      maxRounds: room.maxRounds,
      hint: buildHintMask(room.currentWord, room.revealedHintIndices),
      // no roundStartedAt sent -- client just starts its local countdown
      // from timeLimit; being a few seconds generous is fine for an MVP.
    });
    if (isDrawer) {
      socket.emit('round:word', { word: room.currentWord });
    }
    if (room.strokes.length > 0) {
      socket.emit('draw:history', { strokes: room.strokes });
    }
  }
}

function startNextRound(roomId) {
  const room = getRoom(roomId);
  if (!room) return;

  room.roundNumber += 1;
  if (room.roundNumber > room.maxRounds || room.players.length < MIN_PLAYERS_TO_START) {
    endGame(roomId);
    return;
  }

  room.currentDrawerIndex = (room.currentDrawerIndex + 1) % room.players.length;
  const drawer = getDrawer(room);
  room.phase = 'choosing';
  room.currentWord = null;
  room.strokes = [];

  const choices = pickRandomWords(WORD_LIST, room.usedWords, 3);
  room.currentWordChoices = choices;

  io.to(drawer.socketId).emit('word:choices', { choices });
  broadcastRoomState(roomId);

  clearTimeout(room.choiceTimeout);
  room.choiceTimeout = setTimeout(() => {
    if (room.phase === 'choosing') {
      selectWord(roomId, choices[0].word);
    }
  }, CHOICE_TIMEOUT_MS);
}

function selectWord(roomId, word) {
  const room = getRoom(roomId);
  if (!room) return;

  clearTimeout(room.choiceTimeout);
  const drawer = getDrawer(room);
  if (!drawer) return;

  room.currentWord = word;
  room.usedWords.add(word);
  room.phase = 'drawing';
  room.roundStartedAt = Date.now();
  room.strokes = [];
  room.revealedHintIndices = new Set();
  clearHintTimers(room);
  room.players.forEach((p) => {
    p.hasGuessedCorrectly = false;
  });

  io.to(roomId).emit('round:start', {
    drawerId: drawer.socketId,
    wordLength: word.length,
    timeLimit: ROUND_LENGTH_MS,
    roundNumber: room.roundNumber,
    maxRounds: room.maxRounds,
    hint: buildHintMask(word, room.revealedHintIndices),
  });
  io.to(drawer.socketId).emit('round:word', { word });
  broadcastRoomState(roomId);

  clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => endRound(roomId, 'timeout'), ROUND_LENGTH_MS);
  scheduleHints(roomId, word);
}

function endRound(roomId, reason) {
  const room = getRoom(roomId);
  if (!room) return;
  if (room.phase !== 'drawing' && room.phase !== 'choosing') return;

  clearTimeout(room.roundTimer);
  clearTimeout(room.choiceTimeout);
  clearHintTimers(room);

  const revealedWord = room.currentWord;
  room.phase = 'round-end';
  room.strokes = [];

  io.to(roomId).emit('round:end', {
    word: revealedWord,
    reason,
    scores: room.players.map((p) => ({ socketId: p.socketId, username: p.username, score: p.score })),
  });
  broadcastRoomState(roomId);

  room.currentWord = null;

  if (room.roundNumber >= room.maxRounds || room.players.length < MIN_PLAYERS_TO_START) {
    setTimeout(() => endGame(roomId), ROUND_END_PAUSE_MS);
  } else {
    room.choiceTimeout = setTimeout(() => startNextRound(roomId), ROUND_END_PAUSE_MS);
  }
}

function endGame(roomId) {
  const room = getRoom(roomId);
  if (!room) return;

  clearTimeout(room.roundTimer);
  clearTimeout(room.choiceTimeout);
  clearHintTimers(room);

  room.phase = 'game-end';
  room.currentWord = null;
  room.strokes = [];

  io.to(roomId).emit('game:end', {
    finalScores: [...room.players]
      .sort((a, b) => b.score - a.score)
      .map((p) => ({ socketId: p.socketId, username: p.username, score: p.score, color: p.color })),
  });
  broadcastRoomState(roomId);
}

function checkAllGuessed(roomId) {
  const room = getRoom(roomId);
  if (!room) return;
  if (!allNonDrawersGuessed(room)) return;

  clearTimeout(room.roundTimer);
  setTimeout(() => endRound(roomId, 'all-guessed'), ALL_GUESSED_GRACE_MS);
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ username, clientId } = {}) => {
    const roomId = generateRoomId();
    const room = createRoom(roomId);
    const player = addPlayer(room, {
      socketId: socket.id,
      username: sanitizeUsername(username),
      clientId,
    });

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.username = player.username;
    socket.data.clientId = player.clientId;

    socket.emit('room:created', { roomId, socketId: socket.id });
    broadcastRoomState(roomId);
  });

  socket.on('room:join', ({ roomId, username, clientId } = {}) => {
    const id = String(roomId ?? '').trim().toUpperCase();
    const room = getRoom(id);

    if (!room) {
      socket.emit('room:error', { message: `Room "${id}" doesn't exist.` });
      return;
    }

    const existing = findByClientId(room, clientId);
    let player;
    let isReconnect = false;

    if (existing) {
      // Same clientId means this is either a dropped player reclaiming their
      // slot within the grace window, or a page refresh / duplicate tab --
      // either way, reuse their existing score/state instead of adding a
      // second entry for them.
      const pendingRemoval = room.pendingRemovals.get(existing.clientId);
      if (pendingRemoval) {
        clearTimeout(pendingRemoval);
        room.pendingRemovals.delete(existing.clientId);
      }
      isReconnect = !existing.connected || existing.socketId !== socket.id;
      player = reconnectPlayer(room, existing, socket.id, sanitizeUsername(username));
    } else {
      if (room.players.some((p) => p.socketId === socket.id)) return;
      player = addPlayer(room, { socketId: socket.id, username: sanitizeUsername(username), clientId });
    }

    socket.join(id);
    socket.data.roomId = id;
    socket.data.username = player.username;
    socket.data.clientId = player.clientId;

    socket.emit(isReconnect ? 'room:rejoined' : 'room:joined', { roomId: id, socketId: socket.id });

    // Catches up a late joiner OR a reconnecting player: word choices if
    // they're the drawer picking, or round state + stroke history if a
    // round is already in progress.
    sendRoundCatchUp(socket, room);

    io.to(id).emit('chat:message', {
      username: 'System',
      text: isReconnect ? `${player.username} reconnected.` : `${player.username} joined the room.`,
      system: true,
    });
    broadcastRoomState(id);
  });

  socket.on('game:start', () => {
    const roomId = socket.data.roomId;
    const room = getRoom(roomId);
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (room.phase !== 'lobby' && room.phase !== 'game-end') return;
    if (room.players.length < MIN_PLAYERS_TO_START) {
      socket.emit('room:error', { message: `Need at least ${MIN_PLAYERS_TO_START} players to start.` });
      return;
    }

    room.players.forEach((p) => {
      p.score = 0;
      p.hasGuessedCorrectly = false;
    });
    room.currentDrawerIndex = -1;
    room.roundNumber = 0;
    room.maxRounds = room.players.length * ROUNDS_PER_PLAYER;
    room.usedWords.clear();

    startNextRound(roomId);
  });

  socket.on('word:pick', ({ word } = {}) => {
    const roomId = socket.data.roomId;
    const room = getRoom(roomId);
    if (!room || room.phase !== 'choosing') return;

    const drawer = getDrawer(room);
    if (!drawer || drawer.socketId !== socket.id) return;

    const validChoice = room.currentWordChoices?.some((c) => c.word === word);
    if (!validChoice) return;

    selectWord(roomId, word);
  });

  socket.on('draw:stroke', (data = {}) => {
    const roomId = socket.data.roomId;
    const room = getRoom(roomId);
    if (!room || room.phase !== 'drawing') return;

    const drawer = getDrawer(room);
    if (!drawer || drawer.socketId !== socket.id) return;

    // Keep this round's strokes for late joiners; relay only what's needed.
    const stroke = {
      type: data.type,
      x: data.x,
      y: data.y,
      color: data.color,
      width: data.width,
    };
    room.strokes.push(stroke);

    socket.to(roomId).emit('draw:stroke', stroke);
  });

  socket.on('draw:clear', () => {
    const roomId = socket.data.roomId;
    const room = getRoom(roomId);
    if (!room || room.phase !== 'drawing') return;

    const drawer = getDrawer(room);
    if (!drawer || drawer.socketId !== socket.id) return;

    room.strokes = [];
    socket.to(roomId).emit('draw:clear');
  });

  socket.on('chat:guess', ({ text } = {}) => {
    const roomId = socket.data.roomId;
    const room = getRoom(roomId);
    if (!room || typeof text !== 'string' || !text.trim()) return;

    const player = getPlayer(room, socket.id);
    const drawer = getDrawer(room);
    if (!player || !drawer) return;
    if (socket.id === drawer.socketId) return; // drawer can't guess
    if (room.phase !== 'drawing') {
      io.to(roomId).emit('chat:message', { username: player.username, text, correct: false });
      return;
    }
    if (player.hasGuessedCorrectly) return; // no double-scoring

    const isCorrect = normalize(text) === normalize(room.currentWord);

    if (isCorrect) {
      const elapsedMs = Date.now() - room.roundStartedAt;
      const points = calcPoints(elapsedMs, ROUND_LENGTH_MS);
      player.score += points;
      player.hasGuessedCorrectly = true;
      drawer.score += DRAWER_POINTS_PER_GUESSER;

      socket.emit('chat:message', {
        username: player.username,
        text: `You got it! +${points}`,
        correct: true,
        self: true,
      });
      socket.to(roomId).emit('chat:message', {
        username: player.username,
        text: 'guessed the word!',
        correct: true,
        hideText: true,
      });
      broadcastRoomState(roomId);
      checkAllGuessed(roomId);
    } else {
      io.to(roomId).emit('chat:message', { username: player.username, text, correct: false });

      // A private "so close!" nudge, sent only to this guesser -- it must
      // never leak to the room, or it'd hand everyone else a free hint
      // about a guess they didn't make.
      const hintText = closenessHint(normalize(text), normalize(room.currentWord));
      if (hintText) {
        socket.emit('chat:message', { username: 'Hint', text: hintText, hint: true });
      }
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = getRoom(roomId);
    if (!room) return;

    const player = disconnectPlayer(room, socket.id);
    if (!player) return;

    // Don't tear anything down yet -- hold their slot (score, host status,
    // drawer turn) open for a bit in case it's just a phone lock or a wifi
    // blip. checkAllGuessed already ignores disconnected players, and no
    // new draw:stroke/chat:guess can land on their stale socketId meanwhile.
    io.to(roomId).emit('chat:message', {
      username: 'System',
      text: `${player.username} disconnected. Holding their spot for ${Math.round(RECONNECT_GRACE_MS / 1000)}s...`,
      system: true,
    });
    broadcastRoomState(roomId);

    const clientId = player.clientId;
    const timer = setTimeout(() => finalizePlayerRemoval(roomId, clientId), RECONNECT_GRACE_MS);
    room.pendingRemovals.set(clientId, timer);
  });
});

// Runs once a disconnected player's reconnect grace period has expired
// without them coming back -- this is the old "just remove them" behavior.
function finalizePlayerRemoval(roomId, clientId) {
  const room = getRoom(roomId);
  if (!room) return;
  room.pendingRemovals.delete(clientId);

  const player = findByClientId(room, clientId);
  if (!player || player.connected) return; // they made it back in time

  const username = player.username;
  const { removed, wasDrawer } = removePlayer(room, player.socketId);
  if (!removed) return;

  if (room.players.length === 0) {
    deleteRoom(roomId);
    return;
  }

  io.to(roomId).emit('chat:message', { username: 'System', text: `${username} left the room.`, system: true });

  if (wasDrawer && (room.phase === 'drawing' || room.phase === 'choosing')) {
    // Drawer never came back: end the round rather than leaving everyone
    // stuck waiting on a timer for a word nobody will draw.
    clearTimeout(room.roundTimer);
    clearTimeout(room.choiceTimeout);
    clearHintTimers(room);
    room.phase = 'round-end';
    const revealedWord = room.currentWord;
    room.currentWord = null;
    room.strokes = [];
    io.to(roomId).emit('round:end', {
      word: revealedWord,
      reason: 'drawer-left',
      scores: room.players.map((p) => ({ socketId: p.socketId, username: p.username, score: p.score })),
    });
    broadcastRoomState(roomId);

    if (room.players.length < MIN_PLAYERS_TO_START) {
      setTimeout(() => endGame(roomId), ROUND_END_PAUSE_MS);
    } else {
      room.choiceTimeout = setTimeout(() => startNextRound(roomId), ROUND_END_PAUSE_MS);
    }
  } else {
    broadcastRoomState(roomId);
    if (room.phase === 'drawing') checkAllGuessed(roomId);
  }
}

httpServer.listen(PORT, () => {
  console.log(`Doodle Duel server listening on :${PORT}`);
  console.log(`Allowed client origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
