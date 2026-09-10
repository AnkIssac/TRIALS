// Small sound-effect layer built on the Web Audio API -- no audio files to
// ship, just synthesized tones. Browsers block audio until a user gesture
// happens on the page, so the AudioContext is created lazily on first use
// (by which point the player has already clicked Create/Join).

const MUTE_KEY = 'doodle-duel-muted';

let audioCtx = null;

function getContext() {
  if (isMuted()) return null;
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    audioCtx = new AudioCtx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function isMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* ignore */
  }
}

// Plays one tone with a quick attack/decay envelope (avoids the click a
// bare on/off gain change makes) at `delaySec` from now.
function tone(ctx, { freq, durationSec = 0.15, type = 'sine', gain = 0.15, delaySec = 0 }) {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;

  const startAt = ctx.currentTime + delaySec;
  gainNode.gain.setValueAtTime(0, startAt);
  gainNode.gain.linearRampToValueAtTime(gain, startAt + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);

  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec + 0.02);
}

export function playRoundStart() {
  const ctx = getContext();
  if (!ctx) return;
  tone(ctx, { freq: 440, durationSec: 0.12, type: 'triangle' });
  tone(ctx, { freq: 660, durationSec: 0.18, type: 'triangle', delaySec: 0.1 });
}

export function playCorrectGuess() {
  const ctx = getContext();
  if (!ctx) return;
  tone(ctx, { freq: 523.25, durationSec: 0.12, type: 'sine', gain: 0.12 }); // C5
  tone(ctx, { freq: 659.25, durationSec: 0.16, type: 'sine', gain: 0.12, delaySec: 0.08 }); // E5
}

export function playYouGotIt() {
  const ctx = getContext();
  if (!ctx) return;
  tone(ctx, { freq: 523.25, durationSec: 0.1, type: 'sine', gain: 0.15 }); // C5
  tone(ctx, { freq: 659.25, durationSec: 0.1, type: 'sine', gain: 0.15, delaySec: 0.09 }); // E5
  tone(ctx, { freq: 783.99, durationSec: 0.22, type: 'sine', gain: 0.15, delaySec: 0.18 }); // G5
}

export function playTick() {
  const ctx = getContext();
  if (!ctx) return;
  tone(ctx, { freq: 880, durationSec: 0.05, type: 'square', gain: 0.05 });
}

export function playVictory() {
  const ctx = getContext();
  if (!ctx) return;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    tone(ctx, { freq, durationSec: 0.28, type: 'triangle', gain: 0.14, delaySec: i * 0.13 });
  });
}
