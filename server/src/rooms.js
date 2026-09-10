// In-memory room store: Map of roomId -> GameState.
// Swap this module out for a Firebase/Firestore-backed store later without
// touching index.js's socket handlers, as long as the same shape/functions
// are preserved.

// Overridable via env for testing; production should just use the default.
export const ROUND_LENGTH_MS = Number(process.env.ROUND_LENGTH_MS) || 80_000; // 80s rounds
export const CHOICE_TIMEOUT_MS = 10_000; // 10s to pick a word
export const ROUNDS_PER_PLAYER = 2; // each player draws this many times per game
export const MIN_PLAYERS_TO_START = 2;
// Overridable via env for testing; production should just use the default.
export const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) || 25_000;
export const AVATAR_COLORS = [
  '#f94144', '#f3722c', '#f8961e', '#f9c74f', '#90be6d',
  '#43aa8b', '#4d908e', '#577590', '#277da1', '#9b5de5',
];

const rooms = new Map();

function randomRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function generateRoomId() {
  let id;
  do {
    id = randomRoomCode();
  } while (rooms.has(id));
  return id;
}

export function createRoom(roomId) {
  const room = {
    id: roomId,
    players: [], // { socketId, clientId, username, score, color, hasGuessedCorrectly, connected }
    hostId: null,
    currentDrawerIndex: -1,
    usedWords: new Set(),
    phase: 'lobby', // lobby | choosing | drawing | round-end | game-end
    currentWord: null,
    currentWordChoices: null,
    roundStartedAt: null,
    roundNumber: 0,
    maxRounds: 0, // set once players are known, at game start
    strokes: [], // strokes for the *current* round, for late joiners
    revealedHintIndices: new Set(), // letter indices revealed so far this round
    roundTimer: null,
    choiceTimeout: null,
    hintTimers: [], // pending reveal-a-letter timeouts for the current round
    pendingRemovals: new Map(), // clientId -> timeout, for players in their reconnect grace window
  };
  rooms.set(roomId, room);
  return room;
}

export function getRoom(roomId) {
  return rooms.get(roomId);
}

export function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    clearTimeout(room.roundTimer);
    clearTimeout(room.choiceTimeout);
    room.hintTimers.forEach(clearTimeout);
    room.pendingRemovals.forEach(clearTimeout);
  }
  rooms.delete(roomId);
}

export function addPlayer(room, { socketId, username, clientId, avatar }) {
  const color = AVATAR_COLORS[room.players.length % AVATAR_COLORS.length];
  const player = {
    socketId,
    clientId: clientId || socketId,
    username,
    score: 0,
    color,
    avatar: avatar || null, // player-drawn PNG data URL, or null for the default colored-initial avatar
    hasGuessedCorrectly: false,
    connected: true,
  };
  room.players.push(player);
  if (!room.hostId) room.hostId = socketId;
  return player;
}

/**
 * Removes a player and keeps currentDrawerIndex pointing at the correct
 * player (or the correct "next up" slot if the drawer themself left).
 * Returns whether the removed player was mid-round drawer.
 */
export function removePlayer(room, socketId) {
  const idx = room.players.findIndex((p) => p.socketId === socketId);
  if (idx === -1) return { removed: false, wasDrawer: false };

  const wasDrawer = idx === room.currentDrawerIndex;
  room.players.splice(idx, 1);

  if (room.hostId === socketId) {
    room.hostId = room.players[0]?.socketId ?? null;
  }

  if (wasDrawer) {
    // Shift back one so the next startNextRound() (+1) lands on whoever
    // is now sitting in the departed drawer's old slot.
    room.currentDrawerIndex = idx - 1;
  } else if (idx < room.currentDrawerIndex) {
    room.currentDrawerIndex -= 1;
  }

  return { removed: true, wasDrawer };
}

/** Marks a player disconnected in place -- does NOT remove them or touch
 * drawer rotation/host. Call removePlayer() once their grace period expires. */
export function disconnectPlayer(room, socketId) {
  const player = room.players.find((p) => p.socketId === socketId);
  if (!player) return null;
  player.connected = false;
  return player;
}

/** Reclaims a disconnected (or duplicate-tab) player's slot for a new socket. */
export function reconnectPlayer(room, player, newSocketId, newUsername) {
  const oldSocketId = player.socketId;
  player.socketId = newSocketId;
  player.connected = true;
  if (newUsername) player.username = newUsername;
  if (room.hostId === oldSocketId) room.hostId = newSocketId;
  return player;
}

export function findByClientId(room, clientId) {
  if (!clientId) return null;
  return room.players.find((p) => p.clientId === clientId) ?? null;
}

export function getPlayer(room, socketId) {
  return room.players.find((p) => p.socketId === socketId);
}

export function getDrawer(room) {
  if (room.currentDrawerIndex < 0) return null;
  return room.players[room.currentDrawerIndex] ?? null;
}

export function publicRoomState(room) {
  return {
    roomId: room.id,
    players: room.players.map((p) => ({
      socketId: p.socketId,
      clientId: p.clientId,
      username: p.username,
      score: p.score,
      color: p.color,
      avatar: p.avatar,
      connected: p.connected,
      hasGuessedCorrectly: p.hasGuessedCorrectly,
    })),
    hostId: room.hostId,
    phase: room.phase,
    roundNumber: room.roundNumber,
    maxRounds: room.maxRounds,
    drawerId: getDrawer(room)?.socketId ?? null,
  };
}

export function allNonDrawersGuessed(room) {
  const drawer = getDrawer(room);
  const guessers = room.players.filter((p) => p.socketId !== drawer?.socketId && p.connected);
  if (guessers.length === 0) return false;
  return guessers.every((p) => p.hasGuessedCorrectly);
}
