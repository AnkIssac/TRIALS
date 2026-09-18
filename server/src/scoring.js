export const DRAWER_POINTS_PER_GUESSER = 50;

/**
 * Faster correct guesses earn more points. Linear falloff from 500 (instant)
 * down to a 50 point floor (guessed right at the very last moment).
 */
export function calcPoints(elapsedMs, roundLengthMs) {
  const remainingFraction = 1 - elapsedMs / roundLengthMs;
  return Math.max(50, Math.round(500 * remainingFraction));
}

/**
 * Normalize a guess/word for comparison: lowercase, trim, strip punctuation,
 * collapse extra whitespace. Lets "It's a Dog!" match "dog".
 */
export function normalize(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()'"?]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Standard edit distance (insertions/deletions/substitutions) between two
 * strings, used to tell a guesser "so close!" without ever showing anyone
 * else how near they got. O(n*m) time, O(m) space.
 */
export function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = Array.from({ length: n + 1 }, (_, j) => j);
  let currRow = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1, // deletion
        currRow[j - 1] + 1, // insertion
        prevRow[j - 1] + cost // substitution
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[n];
}

/**
 * A guess is "close" if it's within 1-2 edits of the word -- generous
 * enough for longer words (one typo shouldn't feel unrewarded) but tight
 * enough on short words that it doesn't fire on an unrelated guess.
 */
export function closenessHint(guessNormalized, wordNormalized) {
  if (!guessNormalized || !wordNormalized) return null;
  const distance = levenshteinDistance(guessNormalized, wordNormalized);
  const threshold = wordNormalized.length >= 6 ? 2 : 1;
  if (distance === 0 || distance > threshold) return null;
  return distance === 1 ? 'So close! Just one letter off.' : 'Getting warm!';
}

/**
 * End-of-game "superlative" awards, purely cosmetic (no effect on final
 * rank) -- computed from stats already tracked during play: the single
 * fastest correct guess of the game, a per-round score snapshot (for
 * "who climbed the most since round 1"), and how many correct guessers
 * each player earned while they were the drawer. Matches players by
 * clientId (not socketId) so a mid-game reconnect doesn't disqualify
 * someone from Comeback Kid.
 */
export function computeSuperlatives(room) {
  const superlatives = [];

  if (room.fastestGuess) {
    superlatives.push({
      title: 'Fastest Gun',
      emoji: '⚡',
      username: room.fastestGuess.username,
      detail: `Guessed in ${(room.fastestGuess.elapsedMs / 1000).toFixed(1)}s`,
    });
  }

  if (room.scoreHistory.length >= 2) {
    const first = room.scoreHistory[0];
    const final = room.scoreHistory[room.scoreHistory.length - 1];
    const rankOf = (snapshot, clientId) => {
      const sorted = [...snapshot].sort((a, b) => b.score - a.score);
      return sorted.findIndex((s) => s.clientId === clientId);
    };
    let best = null;
    for (const p of room.players) {
      const startRank = rankOf(first, p.clientId);
      const endRank = rankOf(final, p.clientId);
      if (startRank === -1 || endRank === -1) continue;
      const improvement = startRank - endRank; // positive = moved up the standings
      if (improvement > 0 && (!best || improvement > best.improvement)) {
        best = { username: p.username, improvement };
      }
    }
    if (best) {
      superlatives.push({
        title: 'Comeback Kid',
        emoji: '📈',
        username: best.username,
        detail: `Climbed ${best.improvement} spot${best.improvement === 1 ? '' : 's'} since round 1`,
      });
    }
  }

  const topDoodler = room.players.reduce(
    (best, p) => ((p.drawerHits || 0) > (best?.drawerHits || 0) ? p : best),
    null
  );
  if (topDoodler && topDoodler.drawerHits > 0) {
    superlatives.push({
      title: 'Master Doodler',
      emoji: '🎨',
      username: topDoodler.username,
      detail: `${topDoodler.drawerHits} correct guess${topDoodler.drawerHits === 1 ? '' : 'es'} on their drawings`,
    });
  }

  return superlatives;
}
