import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

import { WORD_LIST, pickRandomWords, parseCustomWordList, MIN_CUSTOM_WORDS } from './words.js';
import { calcPoints, normalize, closenessHint, DRAWER_POINTS_PER_GUESSER } from './scoring.js';
import {
  CHOICE_TIMEOUT_MS,
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
  addSpectator,
  findSpectatorByClientId,
  reconnectSpectator,
  removeSpectatorBySocketId,
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

const MIN_ROUND_LENGTH_MS = 30_000;
const MAX_ROUND_LENGTH_MS = 120_000;
const MIN_ROUNDS_PER_PLAYER = 1;
const MAX_ROUNDS_PER_PLAYER = 5;

const ALLOWED_REACTIONS = ['🔥', '😂', '👀', '😮', '❤️', '👏'];
const REACTION_COOLDOWN_MS = 500;

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

// A player-drawn avatar is a one-time PNG data URL, not a live stream, so
// unlike the drawing canvas there's no reason to avoid sending it whole --
// it's just capped to a sane size and shape so a bad client can't shove an
// arbitrary blob into room state.
const MAX_AVATAR_LENGTH = 60_000;
function sanitizeAvatar(raw) {
  if (typeof raw !== 'string') return null;
  if (!raw.startsWith('data:image/png;base64,')) return null;
  if (raw.length > MAX_AVATAR_LENGTH) return null;
  return raw;
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
    const delay = room.roundLengthMs * (HINT_FRACTIONS[i] ?? HINT_FRACTIONS[HINT_FRACTIONS.length - 1]);
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
      timeLimit: room.roundLengthMs,
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
  room.strokeActionStarts = [];

  const wordSource = room.customWords.length > 0 ? room.customWords : WORD_LIST;
  const choices = pickRandomWords(wordSource, room.usedWords, Math.min(3, wordSource.length));
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
  room.strokeActionStarts = [];
  room.revealedHintIndices = new Set();
  clearHintTimers(room);
  room.players.forEach((p) => {
    p.hasGuessedCorrectly = false;
  });

  io.to(roomId).emit('round:start', {
    drawerId: drawer.socketId,
    wordLength: word.length,
    timeLimit: room.roundLengthMs,
    roundNumber: room.roundNumber,
    maxRounds: room.maxRounds,
    hint: buildHintMask(word, room.revealedHintIndices),
  });
  io.to(drawer.socketId).emit('round:word', { word });
  broadcastRoomState(roomId);

  clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => endRound(roomId, 'timeout'), room.roundLengthMs);
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
  room.strokeActionStarts = [];

  io.to(roomId).emit('round:end', {
    word: revealedWord,
    reason,
    scores: room.players.map((p) => ({ socketId: p.socketId, username: p.username, score: p.score, team: p.team })),
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
  room.strokeActionStarts = [];

  io.to(roomId).emit('game:end', {
    finalScores: [...room.players]
      .sort((a, b) => b.score - a.score)
      .map((p) => ({ socketId: p.socketId, username: p.username, score: p.score, color: p.color, team: p.team })),
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
  socket.on('room:create', ({ username, clientId, avatar } = {}) => {
    const roomId = generateRoomId();
    const room = createRoom(roomId);
    const player = addPlayer(room, {
      socketId: socket.id,
      username: sanitizeUsername(username),
      clientId,
      avatar: sanitizeAvatar(avatar),
    });

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.username = player.username;
    socket.data.clientId = player.clientId;

    socket.emit('room:created', { roomId, socketId: socket.id });
    broadcastRoomState(roomId);
  });

  socket.on('room:join', ({ roomId, username, clientId, avatar } = {}) => {
    const id = String(roomId ?? '').trim().toUpperCase();
    const room = getRoom(id);

    if (!room) {
      socket.emit('room:error', { message: `Room "${id}" doesn't exist.` });
      return;
    }

    const existingPlayer = findByClientId(room, clientId);
    const existingSpectator = !existingPlayer ? findSpectatorByClientId(room, clientId) : null;

    let player = null;
    let spectator = null;
    let isReconnect = false;

    if (existingPlayer) {
      // Same clientId means this is either a dropped player reclaiming their
      // slot within the grace window, or a page refresh / duplicate tab --
      // either way, reuse their existing score/state instead of adding a
      // second entry for them.
      const pendingRemoval = room.pendingRemovals.get(existingPlayer.clientId);
      if (pendingRemoval) {
        clearTimeout(pendingRemoval);
        room.pendingRemovals.delete(existingPlayer.clientId);
      }
      isReconnect = !existingPlayer.connected || existingPlayer.socketId !== socket.id;
      player = reconnectPlayer(room, existingPlayer, socket.id, sanitizeUsername(username));
    } else if (existingSpectator) {
      isReconnect = true;
      spectator = reconnectSpectator(room, existingSpectator, socket.id, sanitizeUsername(username));
    } else {
      if (room.players.some((p) => p.socketId === socket.id)) return;

      // A round is already underway: join as a spectator instead of
      // dropping straight into turn rotation mid-game. Between games
      // (lobby/game-end) a join is a normal full player, same as always.
      const isMidGame = room.phase !== 'lobby' && room.phase !== 'game-end';
      if (isMidGame) {
        spectator = addSpectator(room, {
          socketId: socket.id,
          username: sanitizeUsername(username),
          clientId,
          avatar: sanitizeAvatar(avatar),
        });
      } else {
        player = addPlayer(room, {
          socketId: socket.id,
          username: sanitizeUsername(username),
          clientId,
          avatar: sanitizeAvatar(avatar),
        });
      }
    }

    const identity = player ?? spectator;

    socket.join(id);
    socket.data.roomId = id;
    socket.data.username = identity.username;
    socket.data.clientId = identity.clientId;
    socket.data.isSpectator = !!spectator;

    socket.emit(isReconnect ? 'room:rejoined' : 'room:joined', { roomId: id, socketId: socket.id, spectator: !!spectator });

    // Catches up a late joiner OR a reconnecting player/spectator: word
    // choices if they're the drawer picking (never true for a spectator's
    // socket), or round state + stroke history if a round is in progress.
    sendRoundCatchUp(socket, room);

    io.to(id).emit('chat:message', {
      username: 'System',
      text: isReconnect
        ? `${identity.username} reconnected.`
        : spectator
          ? `${identity.username} is watching.`
          : `${identity.username} joined the room.`,
      system: true,
    });
    broadcastRoomState(id);
  });

  // A spectator opts in to actually playing -- takes effect immediately and
  // they're folded into turn rotation the next time it comes around.
  socket.on('spectator:join', () => {
    const roomId = socket.data.roomId;
    const room = getRoom(roomId);
    if (!room || !socket.data.isSpectator) return;

    const spectator = room.spectators.find((s) => s.socketId === socket.id);
    if (!spectator || !removeSpectatorBySocketId(room, socket.id)) return;

    const player = addPlayer(room, {
      socketId: socket.id,
      username: spectator.username,
      clientId: spectator.clientId,
      avatar: spectator.avatar,
    });
    socket.data.isSpectator = false;

    io.to(roomId).emit('chat:message', {
      username: 'System',
      text: `${player.username} joined as a player.`,
      system: true,
    });
    broadcastRoomState(roomId);
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

    room.players.forEach((p, i) => {
      p.score = 0;
      p.hasGuessedCorrectly = false;
      p.team = room.teamsEnabled ? (i % 2 === 0 ? 'red' : 'blue') : null;
    });
    room.currentDrawerIndex = -1;
    room.roundNumber = 0;
    room.maxRounds = room.players.length * room.roundsPerPlayer;
    room.usedWords.clear();

    startNextRound(roomId);
  });

  // Host-only, only between games. Deliberately scoped: teams only pool
  // score, turn rotation and everything else about a round stays exactly
  // the same as solo play -- no team-vs-team drawer assignment, no shared
  // guesses. A bigger team mode is a much larger redesign than this.
  socket.on('room:setTeams', ({ enabled } = {}) => {
    const roomId = socket.data.roomId;
    const room = getRoom(roomId);
    if (!room || room.hostId !== socket.id) return;
    if (room.phase !== 'lobby' && room.phase !== 'game-end') return;

    room.teamsEnabled = !!enabled;
    broadcastRoomState(roomId);
  });

  // Host-only, and only between games -- changing the word pool or timing
  // mid-round would be confusing (and race the round timer/hint schedule
  // that's already running).
  socket.on('room:setWordList', ({ words } = {}) => {
    const roomId = socket.data.roomId;
    const room = getRoom(roomId);
    if (!room || room.hostId !== socket.id) return;
    if (room.phase !== 'lobby' && room.phase !== 'game-end') return;

    const trimmed = String(words ?? '').trim();
    if (!trimmed) {
      // Empty submission clears back to the default word list.
      room.customWords = [];
      room.usedWords.clear();
      broadcastRoomState(roomId);
      return;
    }

    const parsed = parseCustomWordList(trimmed);
    if (parsed.length < MIN_CUSTOM_WORDS) {
      socket.emit('room:error', { message: `Need at least ${MIN_CUSTOM_WORDS} valid custom words.` });
      return;
    }

    room.customWords = parsed;
    room.usedWords.clear();
    broadcastRoomState(roomId);
  });

  socket.on('room:setSettings', ({ roundLengthMs, roundsPerPlayer } = {}) => {
    const roomId = socket.data.roomId;
    const room = getRoom(roomId);
    if (!room || room.hostId !== socket.id) return;
    if (room.phase !== 'lobby' && room.phase !== 'game-end') return;

    if (Number.isFinite(roundLengthMs)) {
      room.roundLengthMs = Math.min(MAX_ROUND_LENGTH_MS, Math.max(MIN_ROUND_LENGTH_MS, Math.round(roundLengthMs)));
    }
    if (Number.isFinite(roundsPerPlayer)) {
      room.roundsPerPlayer = Math.min(
        MAX_ROUNDS_PER_PLAYER,
        Math.max(MIN_ROUNDS_PER_PLAYER, Math.round(roundsPerPlayer))
      );
    }
    broadcastRoomState(roomId);
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
    // A 'start' or 'fill' begins a new undo-able action -- remember where
    // in the array it began so draw:undo can cut back to just before it.
    if (stroke.type === 'start' || stroke.type === 'fill') {
      room.strokeActionStarts.push(room.strokes.length);
    }
    room.strokes.push(stroke);

    socket.to(roomId).emit('draw:stroke', stroke);
  });

  socket.on('draw:undo', () => {
    const roomId = socket.data.roomId;
    const room = getRoom(roomId);
    if (!room || room.phase !== 'drawing') return;

    const drawer = getDrawer(room);
    if (!drawer || drawer.socketId !== socket.id) return;
    if (room.strokeActionStarts.length === 0) return; // nothing left to undo

    const cutIndex = room.strokeActionStarts.pop();
    room.strokes = room.strokes.slice(0, cutIndex);

    // No incremental "erase" on a raster canvas -- every client just wipes
    // and replays the (now shorter) history, same as a late joiner would.
    io.to(roomId).emit('draw:undo', { strokes: room.strokes });
  });

  socket.on('draw:clear', () => {
    const roomId = socket.data.roomId;
    const room = getRoom(roomId);
    if (!room || room.phase !== 'drawing') return;

    const drawer = getDrawer(room);
    if (!drawer || drawer.socketId !== socket.id) return;

    room.strokes = [];
    room.strokeActionStarts = [];
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
      const points = calcPoints(elapsedMs, room.roundLengthMs);
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

  // Fire-and-forget: no room-state history, no late-joiner replay -- these
  // are meant to feel like a live audience reaction, not a persisted event.
  socket.on('reaction:send', ({ emoji } = {}) => {
    const roomId = socket.data.roomId;
    const room = getRoom(roomId);
    if (!room || room.phase !== 'drawing') return;
    if (!ALLOWED_REACTIONS.includes(emoji)) return;

    const now = Date.now();
    if (socket.data.lastReactionAt && now - socket.data.lastReactionAt < REACTION_COOLDOWN_MS) return;
    socket.data.lastReactionAt = now;

    io.to(roomId).emit('reaction:broadcast', { emoji });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = getRoom(roomId);
    if (!room) return;

    if (socket.data.isSpectator) {
      // No score, no rotation slot, nothing worth holding open -- just
      // remove them (guarded so a reconnect that already updated their
      // socketId isn't clobbered by this older socket's disconnect).
      if (removeSpectatorBySocketId(room, socket.id)) {
        broadcastRoomState(roomId);
      }
      return;
    }

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
    room.strokeActionStarts = [];
    io.to(roomId).emit('round:end', {
      word: revealedWord,
      reason: 'drawer-left',
      scores: room.players.map((p) => ({ socketId: p.socketId, username: p.username, score: p.score, team: p.team })),
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
  console.log(`InkBlitz server listening on :${PORT}`);
  console.log(`Allowed client origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
