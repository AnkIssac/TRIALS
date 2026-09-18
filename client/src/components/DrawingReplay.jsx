import { useEffect, useRef, useState } from 'react';
import { drawLine, floodFill, fillWhite } from './Canvas.jsx';

// Roughly how long the whole time-lapse takes regardless of how many
// stroke actions the round actually produced -- a short round with a
// handful of lines plays back near real-time, while a dense round-long
// drawing is sped up so the recap never takes longer than a few seconds.
const TARGET_FRAMES = 220;

// A little time-lapse of the round's drawing on the round-end screen,
// reusing the exact same stroke log the server already keeps for late
// joiners -- nothing new to compute or store, just replayed with a fixed
// small canvas and animated instead of drawn instantly.
export default function DrawingReplay({ strokes }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [done, setDone] = useState(false);
  const [replayKey, setReplayKey] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !strokes || strokes.length === 0) return undefined;

    const rect = wrap.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    fillWhite(ctx, w, h);

    let cancelled = false;
    let frameId = null;
    let i = 0;
    let lastPoint = null;
    let lastColor = '#1e1e1e';
    let lastWidthFrac = 0.0075;
    setDone(false);

    const batch = Math.max(1, Math.ceil(strokes.length / TARGET_FRAMES));

    function step() {
      if (cancelled) return;
      for (let n = 0; n < batch && i < strokes.length; n++, i++) {
        const a = strokes[i];
        if (a.type === 'start') {
          lastPoint = { x: a.x * w, y: a.y * h };
          lastColor = a.color;
          lastWidthFrac = a.width;
        } else if (a.type === 'move' && lastPoint) {
          const point = { x: a.x * w, y: a.y * h };
          drawLine(ctx, lastPoint, point, lastColor, lastWidthFrac * w);
          lastPoint = point;
        } else if (a.type === 'end') {
          if (lastPoint && a.x !== undefined && a.y !== undefined) {
            drawLine(ctx, lastPoint, { x: a.x * w, y: a.y * h }, lastColor, lastWidthFrac * w);
          }
          lastPoint = null;
        } else if (a.type === 'fill') {
          floodFill(ctx, a.x, a.y, a.color, w, h);
          lastPoint = null;
        }
      }
      if (i < strokes.length) {
        frameId = requestAnimationFrame(step);
      } else {
        setDone(true);
      }
    }
    frameId = requestAnimationFrame(step);

    return () => {
      cancelled = true;
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [strokes, replayKey]);

  if (!strokes || strokes.length === 0) return null;

  return (
    <div className="drawing-replay">
      <div className="drawing-replay-canvas-wrap" ref={wrapRef}>
        <canvas className="drawing-replay-canvas" ref={canvasRef} />
        {!done && <span className="drawing-replay-badge">▶ Replay</span>}
      </div>
      {done && (
        <button type="button" className="drawing-replay-again" onClick={() => setReplayKey((k) => k + 1)}>
          ↻ Watch again
        </button>
      )}
    </div>
  );
}
