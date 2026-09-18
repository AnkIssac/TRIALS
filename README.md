# 🎨⚡ InkBlitz

A real-time multiplayer drawing-and-guessing party game (Skribbl-style).
One player draws a secret word while everyone else races to guess it in the
live chat — faster guesses score more. See [`CLAUDE.md`](./CLAUDE.md) for
the original project brief this was built from.

## Stack
- **Client**: React + Vite, Framer Motion, Socket.IO client
- **Server**: Node.js + Express + Socket.IO
- **State**: in-memory room store (`server/src/rooms.js`)

## Project layout
```
inkblitz/
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
others. Works on phones and tablets too — see "Playing with friends" below.

## Playing with friends

- **Same WiFi**: find your machine's LAN IP (`ipconfig getifaddr en0` on
  Mac, `ipconfig` on Windows), have friends open
  `http://<your-ip>:5173`, and update `client/.env`'s `VITE_SERVER_URL`
  plus `server/.env`'s `CLIENT_URL` to include that IP.
- **Remote friends**: tunnel the server with `ngrok http 3001` (or
  Cloudflare Tunnel), point `VITE_SERVER_URL` at the tunnel URL, and add
  it to the server's `CLIENT_URL`.

Full details, plus notes on deploying a persistent server (Render) and
static client (Vercel/Netlify) whenever you're ready to grab a permanent
link, are in [`CLAUDE.md`](./CLAUDE.md).

## Features

- **Rooms** with a shareable code, a QR code + copyable join link (opens
  straight to "type your name and hit Join," no typing a code by hand),
  host controls, custom word lists, and configurable round length /
  rounds-per-player
- **Drawing tools**: pen, paint-bucket fill, eraser, color palette, stroke
  width, undo, clear — all synced live to everyone in the room, plus a
  brush-size ring that follows your cursor so you see the stroke width
  before you commit to it
- **Scoring**: faster correct guesses earn more points; the drawer earns a
  bonus per correct guesser; optional team mode pools scores by team
- **Round modifiers**: a random round is occasionally flagged Double
  Points, Blitz (half time), Steady Hand (no undo/eraser), or Chaos
  Palette (the drawer gets a random handful of colors) — revealed at the
  "3, 2, 1, Draw!" round-start countdown
- **Hints**: a letter or two reveals itself as the timer runs down, and a
  guesser gets a private "so close!" nudge on a near-miss guess
- **Player avatars**: draw your own little avatar before you join, or skip
  it for the default colored-initial one
- **Reactions**: quick-tap emoji bursts during a round, no chat needed
- **Spectator mode**: join mid-round and watch, then hop into the next
  round whenever you're ready
- **Round-end recap**: a fast animated replay of what was just drawn, and
  an end-of-game awards section (Fastest Gun, Comeback Kid, Master
  Doodler) alongside the final leaderboard
- **Rematch**: the host can start a fresh game with the same room/players
  right from the final scoreboard — no re-creating the room
- **Reconnects**: your slot (score, host status, drawer turn) is held open
  for 25s if your connection drops — a refresh reclaims it silently
- **Sound + confetti**, mutable, plus a mobile/tablet-friendly layout that
  fills whatever screen shape you've got — phone, rotated phone, tablet,
  laptop

## How it works

- **Canvas sync**: every client sizes its own canvas to whatever
  rectangle it actually has — no fixed aspect ratio, no letterboxing.
  Strokes are relayed as `{ type, x, y, color, width }` where x/y/width
  are 0-1 fractions of *that client's own canvas*, not raw pixels or
  images — each client converts a fraction to its own pixel space when
  drawing, which is what keeps a stroke lining up correctly even though
  everyone's canvas is a different physical size. The server keeps the
  current round's stroke list so late joiners (and a resized/rotated
  canvas) can replay it instead of staring at a blank canvas.
- **Turn rotation**: the server rotates the drawer, offers 3 random word
  choices (with a 10s auto-pick fallback), and is authoritative on the
  round timer regardless of what any client displays.
- **Scoring**: faster correct guesses earn more points (500 → 50 floor,
  linear falloff over the round); the drawer earns a flat bonus per
  correct guesser. A round ends early once everyone's guessed.
- **Reconnects**: a browser tab keeps a stable `clientId` in
  sessionStorage (per-tab, so several tabs in one browser act as separate
  players). If your socket drops, the server holds your slot open for
  25s; reconnecting within that window — even a full page reload —
  reclaims it silently.

## Build order this repo follows

1. Room create/join + player list
2. Canvas drawing (local), then wired over sockets
3. Guess chat + correct-answer detection
4. Turn rotation, word choice, round timer
5. Scoring + leaderboard
6. Polish: hints, reconnects, fill/undo, custom word lists, avatars,
   reactions, spectator mode, team mode, mobile/tablet layout
