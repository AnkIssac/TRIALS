import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

// Small and square on purpose -- this is a one-time doodle sent once at
// join, not a live-synced stream, so a modest fixed resolution keeps the
// exported PNG tiny (a simple sketch is typically only a couple KB).
export const AVATAR_SIZE = 120;

const COLORS = ['#1e1e1e', '#e03131', '#f08c00', '#f5d90a', '#2f9e44', '#1971c2', '#7048e8', '#c2255c'];
const WIDTHS = [3, 7];

function drawLine(ctx, from, to, color, width) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function fillWhite(ctx) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
}

/**
 * A tiny local-only sketchpad for a player's avatar. No socket, no
 * real-time sync -- the parent reads the finished doodle (via `ref`) as a
 * PNG data URL at the moment they hit Create/Join. Drawing nothing at all
 * is fine; the caller falls back to the usual colored-initial avatar.
 */
const AvatarPicker = forwardRef(function AvatarPicker(_props, ref) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const hasDrawnRef = useRef(false);

  const [color, setColor] = useState('#1e1e1e');
  const [width, setWidth] = useState(3);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctxRef.current = ctx;
    fillWhite(ctx);
  }, []);

  useImperativeHandle(ref, () => ({
    // Returns null if the player never drew anything, so callers can fall
    // back to the default avatar instead of shipping a blank white square.
    getDataUrl() {
      if (!hasDrawnRef.current) return null;
      return canvasRef.current.toDataURL('image/png');
    },
  }));

  const getCoords = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * AVATAR_SIZE,
      y: ((e.clientY - rect.top) / rect.height) * AVATAR_SIZE,
    };
  };

  const handlePointerDown = (e) => {
    const canvas = canvasRef.current;
    canvas.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    const point = getCoords(e);
    lastPointRef.current = point;
    // Draw a dot immediately so a single tap (an eye, a freckle) still
    // shows up, not just drags.
    const ctx = ctxRef.current;
    drawLine(ctx, point, point, color, width);
    hasDrawnRef.current = true;
  };

  const handlePointerMove = (e) => {
    if (!isDrawingRef.current) return;
    const point = getCoords(e);
    const ctx = ctxRef.current;
    if (lastPointRef.current) {
      drawLine(ctx, lastPointRef.current, point, color, width);
      hasDrawnRef.current = true;
    }
    lastPointRef.current = point;
  };

  const handlePointerUp = () => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
  };

  const handleClear = () => {
    fillWhite(ctxRef.current);
    hasDrawnRef.current = false;
  };

  return (
    <div className="avatar-picker">
      <span className="field-label">Draw yourself (optional)</span>
      <div className="avatar-picker-body">
        <canvas
          ref={canvasRef}
          width={AVATAR_SIZE}
          height={AVATAR_SIZE}
          className="avatar-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        <div className="avatar-picker-controls">
          <div className="avatar-swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch avatar-swatch ${color === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`color ${c}`}
              />
            ))}
          </div>
          <div className="avatar-widths">
            {WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                className={`width-btn ${width === w ? 'active' : ''}`}
                onClick={() => setWidth(w)}
                aria-label={`width ${w}`}
              >
                <span style={{ width: w + 2, height: w + 2 }} className="width-dot" />
              </button>
            ))}
          </div>
          <button type="button" className="avatar-clear-btn" onClick={handleClear}>
            🗑️
          </button>
        </div>
      </div>
    </div>
  );
});

export default AvatarPicker;
