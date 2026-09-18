// Shared metadata for the surprise per-round modifiers (see ROUND_MODIFIERS
// in server/src/rooms.js). The server only ever sends the bare modifier id
// (e.g. 'double-points') -- everything about how it's *presented* (emoji,
// copy) lives here so App.jsx/Canvas.jsx/RoundCountdown.jsx all show the
// same wording without repeating it three times.
export const MODIFIER_INFO = {
  'double-points': {
    emoji: '⚡',
    pillLabel: '2x Points!',
    countdownLabel: 'Double Points Round!',
    recap: 'That was a Double Points round!',
  },
  blitz: {
    emoji: '⏱️',
    pillLabel: 'Blitz! Half Time',
    countdownLabel: 'Blitz Round! Half Time!',
    recap: 'That was a Blitz round -- half the usual time!',
  },
  'steady-hand': {
    emoji: '🧊',
    pillLabel: 'Steady Hand',
    countdownLabel: 'Steady Hand Round! No Undo or Eraser!',
    recap: 'That was a Steady Hand round -- no undo or eraser allowed!',
  },
  'chaos-palette': {
    emoji: '🎨',
    pillLabel: 'Chaos Palette',
    countdownLabel: 'Chaos Palette Round!',
    recap: 'That was a Chaos Palette round -- the drawer only had a random handful of colors!',
  },
};

export function getModifierInfo(modifier) {
  return modifier ? (MODIFIER_INFO[modifier] ?? null) : null;
}
