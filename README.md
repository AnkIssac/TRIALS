# 🎨 Doodle Duel

A real-time multiplayer drawing-and-guessing party game (Skribbl-style).
One player draws a secret word while everyone else races to guess it in the
live chat. See [`CLAUDE.md`](./CLAUDE.md) for the full project brief this
was built from.

## Stack
- **Client**: React + Vite, Framer Motion, Socket.IO client
- **Server**: Node.js + Express + Socket.IO
- **State**: in-memory room store (`server/src/rooms.js`)

## Project layout
```
doodle-duel/
├── client/   # Vite React app
├── server/   # Express + Socket.IO server
└── CLAUDE.md # original project brief
```

## Running locally

```bash
# terminal 1 — server
cd server
cp .env.example .env
npm install
npm run dev        # http://localhost:3001

# terminal 2 — client
cd client
cp .env.example .env
npm install
npm run dev         # http://localhost:5173
```

Open `http://localhost:5173` in 2-3 browser tabs to simulate multiple
players: create a room in one tab, then join with the room code in the
others.

## Playing with friends

- **Same WiFi**: find your machine's LAN IP (`ipconfig getifaddr en0` on
  Mac, `ipconfig` on Windows), have friends open
  `http://<your-ip>:5173`, and update `client/.env`'s `VITE_SERVER_URL`
  plus `server/.env`'s `CLIENT_URL` to include that IP.
- **Remote friends**: tunnel the server with `ngrok http 3001` (or
  Cloudflare Tunnel), point `VITE_SERVER_URL` at the tunnel URL, and add
  it to the server's `CLIENT_URL`.

Full details, plus notes on deploying a persistent server (Render) and
static client (Vercel/Netlify) once you're past casual testing, are in
[`CLAUDE.md`](./CLAUDE.md).

## How it works

- **Canvas sync**: strokes are sent as `{ type, x, y, color, width }`
  coordinate events, never image frames — every client redraws the same
  lines locally. The server keeps the current round's stroke list so
  late joiners can replay it instead of staring at a blank canvas.
- **Turn rotation**: the server rotates the drawer, offers 3 random word
  choices (with a 10s auto-pick fallback), and is authoritative on the
  round timer regardless of what any client displays.
- **Scoring**: faster correct guesses earn more points (500 → 50 floor,
  linear falloff over the round); the drawer earns a flat bonus per
  correct guesser. A round ends early once everyone's guessed.
- **Hints**: the server reveals a letter or two (up to 2, only for words
  long enough that it doesn't give the game away) at 40% and 70% through
  the round, sent only to non-drawers.
- **Reconnects**: a browser tab keeps a stable `clientId` in localStorage.
  If your socket drops (refresh, phone lock, wifi blip), the server holds
  your slot — score, host status, drawer turn — open for 12s. Reconnecting
  within that window (even a full page reload) reclaims it silently; your
  canvas, hint progress, and secret word (if you're drawing) are resent.
  If you don't come back in time, you're removed and, if you were
  drawing, the round ends and rotates to the next player.

## Build order this repo follows

1. Room create/join + player list
2. Canvas drawing (local), then wired over sockets
3. Guess chat + correct-answer detection
4. Turn rotation, word choice, round timer
5. Scoring + leaderboard
6. Polish (Framer Motion transitions, mobile layout)
