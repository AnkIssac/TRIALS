import { useEffect, useRef, useState, useCallback } from 'react';

// The canvas's pixel buffer is sized to whatever rectangle its wrapper
// actually is on THIS client -- no fixed 800x600, no letterboxing to a
// fixed aspect ratio. Every client can (and usually will) have a
// differently-shaped canvas, so all coordinates on the wire are normalized
// (0-1) fractions of "my own canvas size" rather than absolute pixels --
// each client converts a fraction to its OWN pixel space when drawing,
// which is what keeps a stroke lining up correctly everywhere despite
// everyone's canvas being a different physical size.
const COLORS = [
  '#1e1e1e', '#ffffff', '#e03131', '#f08c00', '#f5d90a',
  '#2f9e44', '#1971c2', '#7048e8', '#c2255c', '#9c6644',
];
// Stroke width as a fraction of canvas width (roughly 3px/6px/12px/20px at
// an 800px-wide canvas) so "medium" looks medium-sized on any screen.
const WIDTHS = [0.004, 0.0075, 0.015, 0.025];
const WIDTH_PREVIEW_BASE = 800; // just for sizing the toolbar's preview dots

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

function fillWhite(ctx, w, h) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
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
// dead at an anti-aliased stroke edge) with the chosen color. xFrac/yFrac
// are 0-1 fractions of THIS canvas, converted to its own pixel space here.
function floodFill(ctx, xFrac, yFrac, fillHex, canvasW, canvasH) {
  const x0 = Math.round(xFrac * canvasW);
  const y0 = Math.round(yFrac * canvasH);
  if (x0 < 0 || y0 < 0 || x0 >= canvasW || y0 >= canvasH) return;

  const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
  const data = imageData.data;
  const fillColor = hexToRgba(fillHex);
  const startIdx = (y0 * canvasW + x0) * 4;
  const targetColor = [data[startIdx], data[startIdx + 1], data[startIdx + 2], data[startIdx + 3]];

  if (pixelMatches(data, startIdx, fillColor, 16)) return; // already this color

  const TOLERANCE = 48;
  const visited = new Uint8Array(canvasW * canvasH);
  const stack = [[x0, y0]];

  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || x >= canvasW || y < 0 || y >= canvasH) continue;

    const pixelPos = y * canvasW + x;
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

// Shared replay used for a late-joiner's initial catch-up, a freshly
// (re)synced draw:history/draw:undo payload, AND a local resize (the
// canvas's pixel buffer has to be recreated at the new size, which wipes
// it, so we redraw from the same fraction-space log at whatever size the
// canvas is now). canvasW/canvasH are THIS client's current buffer size.
function replayActions(ctx, actions, canvasW, canvasH) {
  fillWhite(ctx, canvasW, canvasH);
  let lastPoint = null;
  let lastColor = '#1e1e1e';
  let lastWidthFrac = WIDTHS[1];
  for (const a of actions) {
    if (a.type === 'start') {
      lastPoint = { x: a.x * canvasW, y: a.y * canvasH };
      lastColor = a.color;
      lastWidthFrac = a.width;
    } else if (a.type === 'move' && lastPoint) {
      // 'move' carries no color/width of its own (bandwidth) -- it always
      // continues whatever the most recent 'start' set.
      const point = { x: a.x * canvasW, y: a.y * canvasH };
      drawLine(ctx, lastPoint, point, lastColor, lastWidthFrac * canvasW);
      lastPoint = point;
    } else if (a.type === 'end') {
      // See the matching comment where 'end' is handled live -- the
      // closing point has to be drawn here too, using the tracked
      // color/width, since the 'end' entry itself carries neither.
      if (lastPoint && a.x !== undefined && a.y !== undefined) {
        drawLine(ctx, lastPoint, { x: a.x * canvasW, y: a.y * canvasH }, lastColor, lastWidthFrac * canvasW);
      }
      lastPoint = null;
    } else if (a.type === 'fill') {
      floodFill(ctx, a.x, a.y, a.color, canvasW, canvasH);
      lastPoint = null;
    }
  }
}

export default function Canvas({ socket, isDrawer, drawingLabel, initialStrokes }) {
  const canvasRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const ctxRef = useRef(null);
  const isPointerDownRef = useRef(false);
  const lastPointRef = useRef(null); // my own last point, while drawing (pixel + fraction)
  const remoteLastPointRef = useRef(null); // last point replayed from the network (pixel)
  const remoteColorRef = useRef('#1e1e1e');
  const remoteWidthFracRef = useRef(WIDTHS[1]);
  const resizeTimeoutRef = useRef(null);
  // Every action drawn this round (mine + everyone else's), in the same
  // fraction-space shape the server relays -- lets a resize (rotating a
  // phone, a window resize) redraw the picture at the new size instead of
  // just wiping it, since resizing a canvas element clears its pixels.
  const strokeLogRef = useRef([]);

  const [color, setColor] = useState('#1e1e1e');
  const [width, setWidth] = useState(WIDTHS[1]);
  const [tool, setTool] = useState('pen'); // 'pen' | 'fill' | 'eraser'

  const activeColor = tool === 'eraser' ? 'eraser' : color;

  // Size the canvas's pixel buffer to match its wrapper's actual rendered
  // size -- on mount, and again whenever that size changes (rotation,
  // window resize, sidebar collapsing, etc.). Debounced a little so an
  // in-progress layout transition doesn't thrash it mid-animation.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = canvasWrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    ctxRef.current = ctx;

    const applySize = () => {
      const rect = wrap.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w <= 0 || h <= 0) return; // mid-transition, not laid out yet
      if (canvas.width === w && canvas.height === h) return; // no real change

      canvas.width = w;
      canvas.height = h;
      if (strokeLogRef.current.length > 0) {
        replayActions(ctx, strokeLogRef.current, w, h);
      } else {
        fillWhite(ctx, w, h);
      }
    };

    applySize();

    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimeoutRef.current);
      resizeTimeoutRef.current = setTimeout(applySize, 150);
    });
    observer.observe(wrap);

    return () => {
      observer.disconnect();
      clearTimeout(resizeTimeoutRef.current);
    };
  }, []);

  // Replay any strokes we missed (late join / room switch).
  useEffect(() => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas || !initialStrokes || initialStrokes.length === 0) return;
    strokeLogRef.current = initialStrokes;
    replayActions(ctx, initialStrokes, canvas.width, canvas.height);
  }, [initialStrokes]);

  // Listen for remote strokes / clears from the server relay.
  useEffect(() => {
    if (!socket) return;

    const handleStroke = (data) => {
      const ctx = ctxRef.current;
      const canvas = canvasRef.current;
      if (!ctx || !canvas) return;
      if (data.type === 'start') {
        remoteLastPointRef.current = { x: data.x * canvas.width, y: data.y * canvas.height };
        remoteColorRef.current = data.color;
        remoteWidthFracRef.current = data.width;
      } else if (data.type === 'move') {
        const point = { x: data.x * canvas.width, y: data.y * canvas.height };
        if (remoteLastPointRef.current) {
          drawLine(ctx, remoteLastPointRef.current, point, remoteColorRef.current, remoteWidthFracRef.current * canvas.width);
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
          drawLine(
            ctx,
            remoteLastPointRef.current,
            { x: data.x * canvas.width, y: data.y * canvas.height },
            remoteColorRef.current,
            remoteWidthFracRef.current * canvas.width
          );
        }
        remoteLastPointRef.current = null;
      } else if (data.type === 'fill') {
        floodFill(ctx, data.x, data.y, data.color, canvas.width, canvas.height);
        remoteLastPointRef.current = null;
      }
      strokeLogRef.current.push(data);
    };

    const handleClear = () => {
      const ctx = ctxRef.current;
      const canvas = canvasRef.current;
      strokeLogRef.current = [];
      if (ctx && canvas) fillWhite(ctx, canvas.width, canvas.height);
    };

    const handleHistory = ({ strokes }) => {
      const ctx = ctxRef.current;
      const canvas = canvasRef.current;
      if (!ctx || !canvas) return;
      strokeLogRef.current = strokes;
      replayActions(ctx, strokes, canvas.width, canvas.height);
    };

    // A fresh round means a blank canvas, whether or not I'm the drawer.
    const handleRoundStart = () => {
      remoteLastPointRef.current = null;
      strokeLogRef.current = [];
      const ctx = ctxRef.current;
      const canvas = canvasRef.current;
      if (ctx && canvas) fillWhite(ctx, canvas.width, canvas.height);
    };

    socket.on('draw:stroke', handleStroke);
    socket.on('draw:clear', handleClear);
    socket.on('draw:history', handleHistory);
    // An undo can't surgically erase one stroke off a raster canvas, so the
    // server just sends back the (now shorter) full history and everyone
    // wipes + replays it -- identical shape to draw:history's catch-up.
    socket.on('draw:undo', handleHistory);
    socket.on('round:start', handleRoundStart);
    return () => {
      socket.off('draw:stroke', handleStroke);
      socket.off('draw:clear', handleClear);
      socket.off('draw:history', handleHistory);
      socket.off('draw:undo', handleHistory);
      socket.off('round:start', handleRoundStart);
    };
  }, [socket]);

  // Returns both my own canvas's pixel coords (for instant local drawing)
  // and 0-1 fractions of it (for the network + local replay log).
  const getCanvasCoords = useCallback((e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    return { x: fx * canvas.width, y: fy * canvas.height, fx, fy };
  }, []);

  const handlePointerDown = (e) => {
    if (!isDrawer) return;
    const point = getCanvasCoords(e);
    const canvas = canvasRef.current;

    if (tool === 'fill') {
      // A single click, not a drag -- fill locally now, then relay the same
      // click point + color for everyone else (and late joiners) to replay.
      const ctx = ctxRef.current;
      floodFill(ctx, point.fx, point.fy, color, canvas.width, canvas.height);
      const action = { type: 'fill', x: point.fx, y: point.fy, color };
      strokeLogRef.current.push(action);
      socket.emit('draw:stroke', action);
      return;
    }

    canvas.setPointerCapture(e.pointerId);
    isPointerDownRef.current = true;
    lastPointRef.current = point;
    const action = { type: 'start', x: point.fx, y: point.fy, color: activeColor, width };
    strokeLogRef.current.push(action);
    socket.emit('draw:stroke', action);
  };

  const handlePointerMove = (e) => {
    if (!isDrawer || !isPointerDownRef.current) return;
    const point = getCanvasCoords(e);
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (lastPointRef.current) {
      drawLine(ctx, lastPointRef.current, point, activeColor, width * canvas.width); // draw locally now, instantly
    }
    lastPointRef.current = point;
    const action = { type: 'move', x: point.fx, y: point.fy };
    strokeLogRef.current.push(action);
    throttledEmitMove(socket, action);
  };

  const handlePointerUp = () => {
    if (!isDrawer) return;
    isPointerDownRef.current = false;
    const finalPoint = lastPointRef.current;
    lastPointRef.current = null;
    // Carry the closing point -- see the matching comment on the 'end'
    // handler for why this can't just be an empty { type: 'end' }.
    const action = finalPoint ? { type: 'end', x: finalPoint.fx, y: finalPoint.fy } : { type: 'end' };
    strokeLogRef.current.push(action);
    socket.emit('draw:stroke', action);
  };

  const handleClear = () => {
    if (!isDrawer) return;
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    strokeLogRef.current = [];
    fillWhite(ctx, canvas.width, canvas.height);
    socket.emit('draw:clear');
  };

  const handleUndo = () => {
    if (!isDrawer) return;
    // No local-optimistic redraw here -- the server holds the actual
    // stroke history (needed for late joiners anyway), so undo waits for
    // its reply rather than guessing what the canvas looked like a stroke
    // ago. A short round-trip, not the instant feel drawing itself has.
    socket.emit('draw:undo');
  };

  return (
    <div className="canvas-panel">
      <div className="canvas-wrap" ref={canvasWrapRef}>
        <canvas
          ref={canvasRef}
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
                  <span
                    style={{ width: w * WIDTH_PREVIEW_BASE, height: w * WIDTH_PREVIEW_BASE }}
                    className="width-dot"
                  />
                </button>
              ))}
            </div>
          )}
          <div className="toolbar-group">
            <button className="tool-btn" onClick={handleUndo}>
              ↩️ Undo
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
const throttledEmitMove = throttle((socket, action) => {
  socket.emit('draw:stroke', action);
}, 40);
