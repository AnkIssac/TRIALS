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

function hexToRgba(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];
}

function pixelMatches(data, idx, [r, g, b, a], tolerance) {
  return (
    Math.abs(data[idx] - r) <= tolerance &&
    Math.abs(data[idx + 1] - g) <= tolerance &&
    Math.abs(data[idx + 2] - b) <= tolerance &&
    Math.abs(data[idx + 3] - a) <= tolerance
  );
}

// Paint-bucket style flood fill: replaces the clicked region (and every
// contiguous pixel close enough in color -- a tolerance so it doesn't stop
// dead at an anti-aliased stroke edge) with the chosen color. Runs
// identically on every client since it only needs the same click point +
// color that gets relayed, same as a stroke.
function floodFill(ctx, startX, startY, fillHex) {
  const x0 = Math.round(startX);
  const y0 = Math.round(startY);
  if (x0 < 0 || y0 < 0 || x0 >= CANVAS_WIDTH || y0 >= CANVAS_HEIGHT) return;

  const imageData = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  const data = imageData.data;
  const fillColor = hexToRgba(fillHex);
  const startIdx = (y0 * CANVAS_WIDTH + x0) * 4;
  const targetColor = [data[startIdx], data[startIdx + 1], data[startIdx + 2], data[startIdx + 3]];

  if (pixelMatches(data, startIdx, fillColor, 16)) return; // already this color

  const TOLERANCE = 48;
  const visited = new Uint8Array(CANVAS_WIDTH * CANVAS_HEIGHT);
  const stack = [[x0, y0]];

  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || x >= CANVAS_WIDTH || y < 0 || y >= CANVAS_HEIGHT) continue;

    const pixelPos = y * CANVAS_WIDTH + x;
    if (visited[pixelPos]) continue;

    const idx = pixelPos * 4;
    if (!pixelMatches(data, idx, targetColor, TOLERANCE)) continue;

    visited[pixelPos] = 1;
    data[idx] = fillColor[0];
    data[idx + 1] = fillColor[1];
    data[idx + 2] = fillColor[2];
    data[idx + 3] = fillColor[3];

    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  ctx.putImageData(imageData, 0, 0);
}

// Shared replay used for both a late-joiner's initial catch-up and a
// freshly (re)synced draw:history payload -- interprets the same stroke
// shape draw:stroke relays, fill events included.
function replayActions(ctx, actions) {
  fillWhite(ctx);
  let lastPoint = null;
  let lastColor = '#1e1e1e';
  let lastWidth = 4;
  for (const a of actions) {
    if (a.type === 'start') {
      lastPoint = { x: a.x, y: a.y };
      lastColor = a.color;
      lastWidth = a.width;
    } else if (a.type === 'move' && lastPoint) {
      const point = { x: a.x, y: a.y };
      drawLine(ctx, lastPoint, point, a.color, a.width);
      lastPoint = point;
    } else if (a.type === 'end') {
      // See the matching comment where 'end' is handled live -- the
      // closing point has to be drawn here too, using whatever color/width
      // this stroke was using, since the 'end' entry itself carries neither.
      if (lastPoint && a.x !== undefined && a.y !== undefined) {
        drawLine(ctx, lastPoint, { x: a.x, y: a.y }, lastColor, lastWidth);
      }
      lastPoint = null;
    } else if (a.type === 'fill') {
      floodFill(ctx, a.x, a.y, a.color);
      lastPoint = null;
    }
  }
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
  const [tool, setTool] = useState('pen'); // 'pen' | 'fill' | 'eraser'

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
    replayActions(ctx, initialStrokes);
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
        // The final 'move' toward this point may still be sitting in the
        // sender's throttle queue when they lift the pen -- 'end' isn't
        // throttled, so it can arrive first. Carrying the closing
        // coordinates here guarantees the last segment actually gets
        // drawn instead of leaving a gap (fatal for the fill tool: paint
        // leaks straight through a one-pixel hole in an "enclosed" shape).
        if (remoteLastPointRef.current && data.x !== undefined && data.y !== undefined) {
          drawLine(ctx, remoteLastPointRef.current, { x: data.x, y: data.y }, remoteColorRef.current, remoteWidthRef.current);
        }
        remoteLastPointRef.current = null;
      } else if (data.type === 'fill') {
        floodFill(ctx, data.x, data.y, data.color);
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
      replayActions(ctx, strokes);
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
    const point = getCanvasCoords(e);

    if (tool === 'fill') {
      // A single click, not a drag -- fill locally now, then relay the same
      // click point + color for everyone else (and late joiners) to replay.
      const ctx = ctxRef.current;
      floodFill(ctx, point.x, point.y, color);
      socket.emit('draw:stroke', { type: 'fill', x: point.x, y: point.y, color });
      return;
    }

    const canvas = canvasRef.current;
    canvas.setPointerCapture(e.pointerId);
    isPointerDownRef.current = true;
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
    const finalPoint = lastPointRef.current;
    lastPointRef.current = null;
    // Carry the closing point -- see the matching comment on the 'end'
    // handler for why this can't just be an empty { type: 'end' }.
    socket.emit('draw:stroke', finalPoint ? { type: 'end', ...finalPoint } : { type: 'end' });
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
            <span className="toolbar-label">Tool</span>
            <button
              className={`tool-btn ${tool === 'pen' ? 'active' : ''}`}
              onClick={() => setTool('pen')}
              aria-label="Pen"
            >
              ✏️ Draw
            </button>
            <button
              className={`tool-btn ${tool === 'fill' ? 'active' : ''}`}
              onClick={() => setTool('fill')}
              aria-label="Fill"
            >
              🪣 Fill
            </button>
            <button
              className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`}
              onClick={() => setTool('eraser')}
              aria-label="Eraser"
            >
              🧽 Eraser
            </button>
          </div>
          <div className="toolbar-group">
            <span className="toolbar-label">Color</span>
            <span className="current-preview" style={{ background: color }} aria-hidden="true" />
            {COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${color === c ? 'active' : ''}`}
                style={{ background: c, borderColor: c === '#ffffff' ? '#ccc' : c }}
                onClick={() => setColor(c)}
                aria-label={`color ${c}`}
              />
            ))}
          </div>
          {tool !== 'fill' && (
            <div className="toolbar-group">
              <span className="toolbar-label">Size</span>
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
          )}
          <div className="toolbar-group">
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
