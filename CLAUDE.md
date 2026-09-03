# Project Brief: Doodle Duel (Skribbl-style Drawing & Guessing Game)

Hand this file to Claude Code as `CLAUDE.md` (or paste it as your first prompt) to kick off the build.

## Concept
A real-time multiplayer drawing-and-guessing party game. One player draws a
secret word while everyone else races to type the correct guess in a live
chat. Points scale with guess speed; the drawer earns points for every
correct guesser.

## Tech Stack
- **Frontend**: React + Vite, Framer Motion for transitions/score pop-ins
- **Realtime**: Socket.IO (client + server)
- **Backend**: Node.js + Express, Socket.IO server
- **Canvas**: HTML5 `<canvas>` with pointer events, synced via socket
  broadcast (not raw base64 frames — send stroke coordinates)
- **State**: In-memory room store to start (Map of roomId → GameState);
  swap in Firebase Realtime Database or Firestore later for persistence
  and cross-server scaling
- **Deploy**: local-first for now (see "Local & Remote Testing" below);
  Render (or Railway/Fly.io) for the socket server only once you want a
  persistent link that doesn't need your laptop running (see "Going
  Persistent Later")

## Core Features (MVP)
1. **Lobby/rooms** — create a room, get a shareable code, join by code
2. **Player list** with avatars/colors, host indicator
3. **Turn rotation** — each round, one player becomes the drawer
4. **Word choice** — drawer picks from 3 random words (with difficulty tags)
5. **Canvas sync** — drawing broadcasts to all clients in near-real-time;
   support pen color, stroke width, eraser, clear canvas
6. **Guess chat** — text input; correct guesses are hidden from others but
   confirmed to the guesser ("You got it!"); wrong guesses show normally
7. **Scoring** — faster correct guesses = more points; drawer gets points
   per correct guesser; round timer (60–90s) with visible countdown
8. **Round/game flow** — reveal word after round ends, rotate drawer,
   show final leaderboard after N rounds

## Stretch Features (post-MVP)
- Custom word lists / private rooms with your own word bank
- Hint system (reveal letters as timer runs down)
- Emoji reactions / quick chat during rounds
- Spectator mode
- Persistent player stats via Firebase (win rate, fastest guesses)
- Mobile-friendly touch drawing (you already do touch canvas work, so this
  should be straightforward)

## Socket Event Sketch
```
client -> server:
  room:create { username }
  room:join   { roomId, username }
  draw:stroke { x, y, color, width, type: 'start'|'move'|'end' }
  draw:clear  {}
  chat:guess  { text }
  word:pick   { word }

server -> client:
  room:state     { players, hostId, phase }
  round:start    { drawerId, timeLimit, wordLength }
  round:word     { word }              // sent only to drawer
  draw:stroke    { ...same shape... }  // relayed to non-drawers
  chat:message   { username, text, correct: boolean }
  round:end      { word, scores }
  game:end       { finalScores }
```

## Canvas Sync Implementation

The core idea: never send images. Send **coordinates + metadata**, and let
every client draw the same lines locally. Coordinates are tiny (a few bytes
per point) so you can send them fast enough to feel live, and every client
renders with the same canvas API calls, so everyone sees identical strokes.

**Stroke event shape:**
```js
// pointerdown
{ type: 'start', x: 120, y: 84, color: '#000000', width: 4 }
// pointermove (repeated while drawing)
{ type: 'move', x: 122, y: 88 }
// pointerup
{ type: 'end' }
```

**Client — capture and draw locally first** (draw immediately on your own
canvas so it feels instant even with network lag, then emit):
```js
let isDrawing = false;
let lastPoint = null;

canvas.addEventListener('pointerdown', (e) => {
  isDrawing = true;
  const point = getCanvasCoords(e);
  lastPoint = point;
  socket.emit('draw:stroke', { type: 'start', ...point, color, width });
});

canvas.addEventListener('pointermove', throttle((e) => {
  if (!isDrawing) return;
  const point = getCanvasCoords(e);
  drawLine(ctx, lastPoint, point, color, width); // draw locally now
  socket.emit('draw:stroke', { type: 'move', ...point });
  lastPoint = point;
}, 40)); // ~25 emits/sec — smooth without flooding the socket

canvas.addEventListener('pointerup', () => {
  isDrawing = false;
  socket.emit('draw:stroke', { type: 'end' });
});

function drawLine(ctx, from, to, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}
```

**Server — relay only, don't process:**
```js
socket.on('draw:stroke', (data) => {
  const roomId = socket.data.roomId;
  socket.to(roomId).emit('draw:stroke', data); // everyone except sender
});
```

**Other clients — replay the strokes** (each receiving client keeps its own
"last point" per drawer and reconstructs the line the same way):
```js
let remoteLastPoint = null;

socket.on('draw:stroke', (data) => {
  if (data.type === 'start') {
    remoteLastPoint = { x: data.x, y: data.y };
    currentColor = data.color;
    currentWidth = data.width;
  } else if (data.type === 'move') {
    const point = { x: data.x, y: data.y };
    drawLine(ctx, remoteLastPoint, point, currentColor, currentWidth);
    remoteLastPoint = point;
  } else if (data.type === 'end') {
    remoteLastPoint = null;
  }
});
```

**Late-joiner gotcha:** a player who joins mid-round has a blank canvas —
they missed earlier strokes. Keep an in-memory array of every stroke for
the current round on the server; when a new player joins, send them the
whole array once and have them replay it in a loop. Round lengths are short
(60–90s), so the array never gets big enough to need anything fancier
(e.g., periodic image snapshots) for an MVP.

## Turn Rotation & Word Selection

Server owns the room state — rotate the drawer index, hand them a few
random word choices, and fall back to auto-picking if they stall.

```js
// room = { players, currentDrawerIndex, usedWords, phase, currentWord,
//          roundStartedAt, roundTimer, choiceTimeout }

function startNextRound(roomId) {
  const room = rooms.get(roomId);
  room.currentDrawerIndex = (room.currentDrawerIndex + 1) % room.players.length;
  const drawer = room.players[room.currentDrawerIndex];
  room.phase = 'choosing';

  const choices = pickRandomWords(WORD_LIST, room.usedWords, 3);
  io.to(drawer.socketId).emit('word:choices', { choices });

  // auto-pick if the drawer doesn't choose in time
  room.choiceTimeout = setTimeout(() => {
    if (room.phase === 'choosing') selectWord(roomId, choices[0]);
  }, 10000);
}

function selectWord(roomId, word) {
  const room = rooms.get(roomId);
  clearTimeout(room.choiceTimeout);
  room.currentWord = word;
  room.usedWords.add(word);
  room.phase = 'drawing';
  room.roundStartedAt = Date.now();
  room.players.forEach(p => { p.hasGuessedCorrectly = false; });

  const drawer = room.players[room.currentDrawerIndex];
  io.to(roomId).emit('round:start', {
    drawerId: drawer.socketId,
    wordLength: word.length,
    timeLimit: ROUND_LENGTH_MS,
  });
  io.to(drawer.socketId).emit('round:word', { word }); // only the drawer sees it

  room.roundTimer = setTimeout(() => endRound(roomId), ROUND_LENGTH_MS);
}
```

## Guess Detection & Scoring

Correct guesses need three things: hide the word from everyone but the
guesser, score based on how fast they guessed, and stop a player from
scoring twice in one round.

```js
socket.on('chat:guess', ({ text }) => {
  const room = rooms.get(socket.data.roomId);
  const player = room.players.find(p => p.socketId === socket.id);
  const drawer = room.players[room.currentDrawerIndex];

  if (socket.id === drawer.socketId) return;      // drawer can't guess
  if (player.hasGuessedCorrectly) return;          // no double-scoring

  const isCorrect = normalize(text) === normalize(room.currentWord);

  if (isCorrect) {
    const elapsedMs = Date.now() - room.roundStartedAt;
    const points = calcPoints(elapsedMs, ROUND_LENGTH_MS);
    player.score += points;
    player.hasGuessedCorrectly = true;
    drawer.score += DRAWER_POINTS_PER_GUESSER;

    socket.emit('chat:message', { username: player.username, text: `Correct! +${points}`, correct: true });
    socket.to(socket.data.roomId).emit('chat:message', { username: player.username, text: 'guessed the word!', correct: true, hideText: true });

    checkAllGuessed(room); // end round early if everyone's got it
  } else {
    io.to(socket.data.roomId).emit('chat:message', { username: player.username, text, correct: false });
  }
});

function calcPoints(elapsedMs, roundLengthMs) {
  const remainingFraction = 1 - elapsedMs / roundLengthMs;
  return Math.max(50, Math.round(500 * remainingFraction)); // 50–500, faster = more
}

function normalize(str) {
  return str.trim().toLowerCase();
}
```

## Round Timer

The server is authoritative (it ends the round via `setTimeout` regardless
of what any client shows), so the client just needs a local countdown for
display — no need to broadcast a tick every second:

```js
// client
useEffect(() => {
  socket.on('round:start', ({ timeLimit }) => setTimeLeft(timeLimit / 1000));
}, []);

useEffect(() => {
  if (timeLeft <= 0) return;
  const id = setTimeout(() => setTimeLeft(t => t - 1), 1000);
  return () => clearTimeout(id);
}, [timeLeft]);
```

## Suggested Project Structure
```
doodle-duel/
├── client/                  # Vite React app
│   ├── src/
│   │   ├── components/
│   │   │   ├── Canvas.jsx
│   │   │   ├── Chat.jsx
│   │   │   ├── PlayerList.jsx
│   │   │   ├── Timer.jsx
│   │   │   └── Lobby.jsx
│   │   ├── hooks/
│   │   │   └── useSocket.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
├── server/
│   ├── src/
│   │   ├── rooms.js         # room state management
│   │   ├── words.js         # word list + pickRandomWords
│   │   ├── scoring.js
│   │   └── index.js         # Express + Socket.IO entrypoint
│   └── package.json
└── CLAUDE.md                 # this brief
```

## Getting Started
```bash
# client
npm create vite@latest client -- --template react
cd client && npm install socket.io-client framer-motion

# server
mkdir server && cd server && npm init -y
npm install express socket.io cors
```
Server needs CORS configured to allow the client's origin (localhost in
dev, your deployed client URL in prod) — Socket.IO's CORS setting is
separate from Express's, so both need it:
```js
const io = new Server(httpServer, {
  cors: { origin: [process.env.CLIENT_URL, 'http://localhost:5173'] }
});
```

## Local & Remote Testing (current phase: solo, then friends)

**Solo testing:** just run both processes and open multiple tabs.
```bash
# terminal 1
cd server && npm run dev
# terminal 2
cd client && npm run dev
```
Open `localhost:5173` in 2-3 tabs to simulate multiple players.

**Friends on the same WiFi** (same room/house):
- Find your machine's local network IP: `ipconfig getifaddr en0` (Mac) or
  `ipconfig` (Windows) — looks like `192.168.1.42`
- They connect to `http://192.168.1.42:5173` instead of `localhost`
- Update the client's Socket.IO connection URL and the server's CORS
  `origin` to allow that IP, not just `localhost`

**Friends remote** (not on your network): `localhost` won't reach them, so
tunnel your local server to a public URL temporarily:
```bash
ngrok http 3001   # or your server's port
```
This gives a public URL like `https://abc123.ngrok-free.app` that
forwards to your local machine. Point the client's Socket.IO connection
at that URL, add it to server CORS `origin`, and you're playable —
no hosting account needed for this. Cloudflare Tunnel is a free
alternative to ngrok if you want it.

## Going Persistent Later (optional — once you want an always-on link)

When you're past casual testing and want a link you can share anytime
without keeping your laptop on and a tunnel open:

- **Client**: Vercel or Netlify (static hosting, generous free tiers)
- **Server**: Render as a **Web Service** (not Background Worker — you
  need a public URL; not Static Site — you need a running process).
  Web services support WebSockets natively.
- **Free tier caveat**: Render's free Web Service spins down after 15
  minutes of inactivity, which drops any open Socket.IO connections
  mid-game without warning. Fine while you're just poking at it; annoying
  the moment you actually start a game session with friends and go quiet
  for a bit.
- **Paid Starter tier** (~$7/month) removes the spin-down — worth it once
  you're actually playing regularly, not before.
- Add WebSocket keepalive pings (both client and server) regardless of
  tier — connections can still be interrupted by instance restarts or
  network blips, so a ping/pong heartbeat helps detect and recover from
  stale connections.

## Suggested Build Order (good milestones for Claude Code sessions)
1. Scaffold Vite React app + Express/Socket.IO server, basic room create/join
2. Canvas drawing (local only, no sync yet) — get strokes feeling good
3. Wire canvas sync over sockets between 2 browser tabs
4. Guess chat + correct-answer detection
5. Turn rotation, word selection, round timer
6. Scoring + leaderboard UI
7. Polish pass: Framer Motion transitions, sound effects, mobile layout

## Notes for Claude Code
- Keep drawing events lightweight (coordinates, not canvas snapshots) to
  avoid bandwidth/lag issues with multiple players
- Debounce/throttle `draw:stroke` emits (~30-60ms) for smoothness without
  flooding the socket
- Guard against the drawer's own guess being processed as a valid guess
- Word list can start as a simple JSON array; make it easy to swap in
  categories later
- End the round early (via `checkAllGuessed`) once every non-drawer has
  guessed correctly, rather than waiting out the full timer — feels much
  better in playtesting
- Handle a drawer disconnecting mid-round: end the round immediately and
  advance to the next player rather than leaving everyone stuck waiting
- `normalize()` should probably also strip punctuation and collapse extra
  whitespace, not just lowercase/trim, so guesses like "It's a Dog!" match
- Reset `usedWords` when the word pool runs low (or once per game) so a
  long game doesn't run out of fresh words
