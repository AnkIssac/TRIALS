import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function Chat({ socket, messages, disabled, disabledReason }) {
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || disabled) return;
    socket.emit('chat:guess', { text });
    setDraft('');
  };

  return (
    <div className="chat-panel">
      <div className="chat-messages" ref={listRef}>
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`chat-msg ${m.system ? 'system' : ''} ${m.correct ? 'correct' : ''} ${m.self ? 'self' : ''}`}
            >
              {m.system ? (
                <span className="chat-text">{m.text}</span>
              ) : (
                <>
                  <span className="chat-author">{m.username}:</span>{' '}
                  <span className="chat-text">{m.hideText ? m.text : m.text}</span>
                </>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={disabled ? disabledReason || "You can't guess right now" : 'Type your guess...'}
          disabled={disabled}
          maxLength={80}
        />
        <button type="submit" disabled={disabled || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
