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
