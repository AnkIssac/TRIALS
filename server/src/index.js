import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

import { WORD_LIST, pickRandomWords } from './words.js';
import { calcPoints, normalize, DRAWER_POINTS_PER_GUESSER } from './scoring.js';
import {
  ROUND_LENGTH_MS,
  CHOICE_TIMEOUT_MS,
  ROUNDS_PER_PLAYER,
  MIN_PLAYERS_TO_START,
  generateRoomId,
  createRoom,
  getRoom,
  deleteRoom,
  addPlayer,
  removePlayer,
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
  room.players.forEach((p) => {
    p.hasGuessedCorrectly = false;
  });

  io.to(roomId).emit('round:start', {
    drawerId: drawer.socketId,
    wordLength: word.length,
    timeLimit: ROUND_LENGTH_MS,
    roundNumber: room.roundNumber,
    maxRounds: room.maxRounds,
  });
  io.to(drawer.socketId).emit('round:word', { word });
  broadcastRoomState(roomId);

  clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => endRound(roomId, 'timeout'), ROUND_LENGTH_MS);
}

function endRound(roomId, reason) {
  const room = getRoom(roomId);
  if (!room) return;
  if (room.phase !== 'drawing' && room.phase !== 'choosing') return;

  clearTimeout(room.roundTimer);
  clearTimeout(room.choiceTimeout);

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
  socket.on('room:create', ({ username } = {}) => {
    const roomId = generateRoomId();
    const room = createRoom(roomId);
    const player = addPlayer(room, { socketId: socket.id, username: sanitizeUsername(username) });

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.username = player.username;

    socket.emit('room:created', { roomId, socketId: socket.id });
    broadcastRoomState(roomId);
  });

  socket.on('room:join', ({ roomId, username } = {}) => {
    const id = String(roomId ?? '').trim().toUpperCase();
    const room = getRoom(id);

    if (!room) {
      socket.emit('room:error', { message: `Room "${id}" doesn't exist.` });
      return;
    }
    if (room.players.some((p) => p.socketId === socket.id)) return;

    const player = addPlayer(room, { socketId: socket.id, username: sanitizeUsername(username) });
    socket.join(id);
    socket.data.roomId = id;
    socket.data.username = player.username;

    socket.emit('room:joined', { roomId: id, socketId: socket.id });

    // Late joiner: catch them up on the current round so they're not stuck
    // looking at a blank canvas / missing state.
    if (room.phase === 'drawing' && room.currentWord) {
      socket.emit('round:start', {
        drawerId: getDrawer(room).socketId,
        wordLength: room.currentWord.length,
        timeLimit: ROUND_LENGTH_MS,
        roundNumber: room.roundNumber,
        maxRounds: room.maxRounds,
        // no roundStartedAt sent -- client just starts its local countdown
        // from timeLimit; being a few seconds generous is fine for an MVP.
      });
      if (room.strokes.length > 0) {
        socket.emit('draw:history', { strokes: room.strokes });
      }
    }

    io.to(id).emit('chat:message', {
      username: 'System',
      text: `${player.username} joined the room.`,
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
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = getRoom(roomId);
    if (!room) return;

    const username = socket.data.username ?? 'A player';
    const { removed, wasDrawer } = removePlayer(room, socket.id);
    if (!removed) return;

    if (room.players.length === 0) {
      deleteRoom(roomId);
      return;
    }

    io.to(roomId).emit('chat:message', { username: 'System', text: `${username} left the room.`, system: true });

    if (wasDrawer && (room.phase === 'drawing' || room.phase === 'choosing')) {
      // Drawer vanished mid-round: end it immediately rather than leaving
      // everyone stuck waiting on a timer for a word nobody will draw.
      clearTimeout(room.roundTimer);
      clearTimeout(room.choiceTimeout);
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
  });
});

httpServer.listen(PORT, () => {
  console.log(`Doodle Duel server listening on :${PORT}`);
  console.log(`Allowed client origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
