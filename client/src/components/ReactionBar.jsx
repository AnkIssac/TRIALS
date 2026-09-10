const REACTIONS = ['🔥', '😂', '👀', '😮', '❤️', '👏'];

/**
 * Quick-tap reactions, available to everyone (drawer included) during a
 * round -- separate from the guess box so they never get mistaken for (or
 * spam) an actual guess. The server rate-limits actual sends; this is just
 * the UI.
 */
export default function ReactionBar({ socket, disabled }) {
  return (
    <div className="reaction-bar">
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="reaction-btn"
          disabled={disabled}
          onClick={() => socket.emit('reaction:send', { emoji })}
          aria-label={`react ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
