import { useEffect, useRef, useState, useCallback } from 'react';

export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 600;

const COLORS = [
  '#1e1e1e', '#ffffff', '#e03131', '#f08c00', '#f5d90a',
  '#2f9e44', '#1971c2', '#7048e8', '#c2255c', '#9c6644',
];
const WIDTHS = [3, 6, 12, 20];

function throttle(fn, ms) {
  let last = 0;
  let pendingArgs = null;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const remaining = ms - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else {
      pendingArgs = args;
      if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          timer = null;
          fn(...pendingArgs);
        }, remaining);
      }
    }
  };
}

function drawLine(ctx, from, to, color, width) {
  ctx.globalCompositeOperation = color === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = color === 'eraser' ? 'rgba(0,0,0,1)' : color;
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
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

export default function Canvas({ socket, isDrawer, drawingLabel, initialStrokes }) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const isPointerDownRef = useRef(false);
  const lastPointRef = useRef(null); // my own last point, while drawing
  const remoteLastPointRef = useRef(null); // last point replayed from the network
  const remoteColorRef = useRef('#1e1e1e');
  const remoteWidthRef = useRef(4);

  const [color, setColor] = useState('#1e1e1e');
  const [width, setWidth] = useState(6);
  const [tool, setTool] = useState('pen'); // 'pen' | 'eraser'

  const activeColor = tool === 'eraser' ? 'eraser' : color;

  // Set up the canvas + white background once.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctxRef.current = ctx;
    fillWhite(ctx);
  }, []);

  // Replay any strokes we missed (late join / room switch).
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx || !initialStrokes || initialStrokes.length === 0) return;

    fillWhite(ctx);
    let lp = null;
    for (const s of initialStrokes) {
      if (s.type === 'start') {
        lp = { x: s.x, y: s.y };
      } else if (s.type === 'move' && lp) {
        const p = { x: s.x, y: s.y };
        drawLine(ctx, lp, p, s.color, s.width);
        lp = p;
      } else if (s.type === 'end') {
        lp = null;
      }
    }
  }, [initialStrokes]);

  // Listen for remote strokes / clears from the server relay.
  useEffect(() => {
    if (!socket) return;

    const handleStroke = (data) => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      if (data.type === 'start') {
        remoteLastPointRef.current = { x: data.x, y: data.y };
        remoteColorRef.current = data.color;
        remoteWidthRef.current = data.width;
      } else if (data.type === 'move') {
        const point = { x: data.x, y: data.y };
        if (remoteLastPointRef.current) {
          drawLine(ctx, remoteLastPointRef.current, point, remoteColorRef.current, remoteWidthRef.current);
        }
        remoteLastPointRef.current = point;
      } else if (data.type === 'end') {
        remoteLastPointRef.current = null;
      }
    };

    const handleClear = () => {
      const ctx = ctxRef.current;
      if (ctx) fillWhite(ctx);
    };

    const handleHistory = ({ strokes }) => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      fillWhite(ctx);
      let lp = null;
      for (const s of strokes) {
        if (s.type === 'start') {
          lp = { x: s.x, y: s.y };
        } else if (s.type === 'move' && lp) {
          const p = { x: s.x, y: s.y };
          drawLine(ctx, lp, p, s.color, s.width);
          lp = p;
        } else if (s.type === 'end') {
          lp = null;
        }
      }
    };

    // A fresh round means a blank canvas, whether or not I'm the drawer.
    const handleRoundStart = () => {
      remoteLastPointRef.current = null;
      const ctx = ctxRef.current;
      if (ctx) fillWhite(ctx);
    };

    socket.on('draw:stroke', handleStroke);
    socket.on('draw:clear', handleClear);
    socket.on('draw:history', handleHistory);
    socket.on('round:start', handleRoundStart);
    return () => {
      socket.off('draw:stroke', handleStroke);
      socket.off('draw:clear', handleClear);
      socket.off('draw:history', handleHistory);
      socket.off('round:start', handleRoundStart);
    };
  }, [socket]);

  const getCanvasCoords = useCallback((e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  }, []);

  const handlePointerDown = (e) => {
    if (!isDrawer) return;
    const canvas = canvasRef.current;
    canvas.setPointerCapture(e.pointerId);
    isPointerDownRef.current = true;
    const point = getCanvasCoords(e);
    lastPointRef.current = point;
    socket.emit('draw:stroke', { type: 'start', ...point, color: activeColor, width });
  };

  const handlePointerMove = (e) => {
    if (!isDrawer || !isPointerDownRef.current) return;
    const point = getCanvasCoords(e);
    const ctx = ctxRef.current;
    if (lastPointRef.current) {
      drawLine(ctx, lastPointRef.current, point, activeColor, width); // draw locally now, instantly
    }
    lastPointRef.current = point;
    throttledEmitMove(socket, point);
  };

  const handlePointerUp = () => {
    if (!isDrawer) return;
    isPointerDownRef.current = false;
    lastPointRef.current = null;
    socket.emit('draw:stroke', { type: 'end' });
  };

  const handleClear = () => {
    if (!isDrawer) return;
    const ctx = ctxRef.current;
    fillWhite(ctx);
    socket.emit('draw:clear');
  };

  return (
    <div className="canvas-panel">
      <div className="canvas-wrap">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className={`draw-canvas ${isDrawer ? 'is-drawer' : ''}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        {!isDrawer && drawingLabel && <div className="canvas-overlay-label">{drawingLabel}</div>}
      </div>

      {isDrawer && (
        <div className="toolbar">
          <div className="toolbar-group">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${tool === 'pen' && color === c ? 'active' : ''}`}
                style={{ background: c, borderColor: c === '#ffffff' ? '#ccc' : c }}
                onClick={() => {
                  setColor(c);
                  setTool('pen');
                }}
                aria-label={`color ${c}`}
              />
            ))}
          </div>
          <div className="toolbar-group">
            {WIDTHS.map((w) => (
              <button
                key={w}
                className={`width-btn ${width === w ? 'active' : ''}`}
                onClick={() => setWidth(w)}
                aria-label={`width ${w}`}
              >
                <span style={{ width: w, height: w }} className="width-dot" />
              </button>
            ))}
          </div>
          <div className="toolbar-group">
            <button
              className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`}
              onClick={() => setTool((t) => (t === 'eraser' ? 'pen' : 'eraser'))}
            >
              🧽 Eraser
            </button>
            <button className="tool-btn danger" onClick={handleClear}>
              🗑️ Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Throttled emit helper kept outside the component body's render churn.
const throttledEmitMove = throttle((socket, point) => {
  socket.emit('draw:stroke', { type: 'move', ...point });
}, 40);
