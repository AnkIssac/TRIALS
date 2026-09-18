import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

// Builds a join link that pre-fills the room code -- Lobby.jsx reads the
// `join` query param on load so scanning this (or tapping a shared link)
// drops a friend straight at "type your name and hit Join" instead of
// making them type a 5-char code by hand.
export function buildJoinUrl(roomId) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('join', roomId);
  return url.toString();
}

// A friend on the same WiFi (or reached over a tunnel) scans this instead
// of typing the room code -- the single biggest friction point when
// actually getting a group of friends into the same room.
export default function InviteQR({ roomId }) {
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const joinUrl = buildJoinUrl(roomId);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, joinUrl, {
      width: 132,
      margin: 1,
      color: { dark: '#241b33', light: '#ffffff' },
    }).catch(() => {
      /* canvas may not be mounted yet on a very fast unmount -- harmless */
    });
  }, [joinUrl]);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(joinUrl);
      } else {
        // The Clipboard API needs a secure context (https, or localhost) --
        // over plain http://<lan-ip> (the normal way friends join on WiFi)
        // it's unavailable, so fall back to the old select-and-copy trick.
        const textarea = document.createElement('textarea');
        textarea.value = joinUrl;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable for some other reason -- the link text below
      // is still there to copy by hand, so just no-op rather than error.
    }
  };

  return (
    <div className="invite-qr">
      <canvas ref={canvasRef} className="invite-qr-canvas" aria-label="QR code to join this room" />
      <div className="invite-qr-actions">
        <button type="button" className="invite-copy-btn" onClick={handleCopy}>
          {copied ? '✅ Copied!' : '🔗 Copy Join Link'}
        </button>
        <p className="hint invite-link-text">{joinUrl}</p>
      </div>
    </div>
  );
}
