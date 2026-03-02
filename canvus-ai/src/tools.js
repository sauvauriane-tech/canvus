/**
 * tools.js — Canvus Tool Handlers (draft)
 *
 * Owns:
 *   - D (drag state)
 *   - setTool()
 *   - All mouse event listeners on canvasWrap
 *   - Per-tool mousedown/mousemove/mouseup logic
 *
 * Imports state mutations, calls renderAll/updateProps via events.
 */

import { S, getEl, pushUndo, snapV, mkEl } from './state.js';
import { renderAll } from './renderer.js';
import { updateProps, updateLayers } from './panels.js';

// ─── Drag state ─────────────────────────────────────────────────────────────
export const D = {
  mode:       null,   // 'move' | 'resize' | 'draw' | 'marquee' | 'pan' | 'rotate'
  startPos:   null,   // { x, y } in canvas coords at drag start
  drawEl:     null,   // element being drawn
  resizeId:   null,
  resizeDir:  null,
  rotElId:    null,
  rotStart:   0,
  rotStartAngle: 0,
  alEl:       null,
  alParent:   null,
};

// ─── Tool switcher ───────────────────────────────────────────────────────────
const SHAPE_TOOLS = new Set(['rect', 'ellipse', 'frame', 'text', 'line', 'section']);

export function setTool(t) {
  S.tool = t;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  document.body.style.cursor = t === 'grab' ? 'grab' : 'default';
}

// ─── Screen → canvas coordinate conversion ──────────────────────────────────
export function screenToCanvas(sx, sy) {
  const rect = document.getElementById('canvas-wrap').getBoundingClientRect();
  return {
    x: (sx - rect.left - S.panX) / S.zoom,
    y: (sy - rect.top  - S.panY) / S.zoom,
  };
}

// ─── Canvas mouse events ─────────────────────────────────────────────────────
const canvasWrap = document.getElementById('canvas-wrap');

canvasWrap.addEventListener('mousedown', onMouseDown);
document.addEventListener('mousemove', onMouseMove);
document.addEventListener('mouseup',   onMouseUp);

function onMouseDown(ev) {
  if (ev.button !== 0) return;
  const pos = screenToCanvas(ev.clientX, ev.clientY);

  if (S.tool === 'grab') {
    D.mode = 'pan';
    D.startPos = { x: ev.clientX - S.panX, y: ev.clientY - S.panY };
    return;
  }

  if (SHAPE_TOOLS.has(S.tool)) {
    pushUndo();
    const el = mkEl(S.tool === 'section' ? 'frame' : S.tool, pos.x, pos.y, 0, 0);
    if (S.tool === 'text') { el.text = 'Text'; el.w = 120; el.h = 30; el.fills = []; }
    S.els.push(el);
    S.selIds = [el.id];
    D.mode = 'draw';
    D.drawEl = el;
    D.startPos = { ...pos };
    renderAll();
    return;
  }

  if (S.tool === 'select') {
    const hit = hitTest(pos);
    if (hit) {
      if (!S.selIds.includes(hit.id)) {
        S.selIds = ev.shiftKey ? [...S.selIds, hit.id] : [hit.id];
      }
      D.mode = 'move';
      D.startPos = { ...pos };
    } else {
      // Marquee select
      S.selIds = [];
      D.mode = 'marquee';
      D.startPos = { ...pos };
    }
    renderAll(); updateProps();
  }
}

function onMouseMove(ev) {
  const pos = screenToCanvas(ev.clientX, ev.clientY);

  if (D.mode === 'pan') {
    S.panX = ev.clientX - D.startPos.x;
    S.panY = ev.clientY - D.startPos.y;
    renderAll();
    return;
  }

  if (D.mode === 'draw' && D.drawEl) {
    const dx = pos.x - D.startPos.x;
    const dy = pos.y - D.startPos.y;
    D.drawEl.w = snapV(Math.abs(dx));
    D.drawEl.h = snapV(Math.abs(dy));
    if (dx < 0) D.drawEl.x = snapV(pos.x);
    if (dy < 0) D.drawEl.y = snapV(pos.y);
    if (S.tool === 'line') { D.drawEl.w = snapV(dx); D.drawEl.h = snapV(dy); }
    renderAll();
    return;
  }

  if (D.mode === 'move') {
    const dx = pos.x - D.startPos.x;
    const dy = pos.y - D.startPos.y;
    S.selIds.forEach(id => {
      const el = getEl(id); if (!el) return;
      el.x = snapV(el.x + dx);
      el.y = snapV(el.y + dy);
    });
    D.startPos = { ...pos };
    renderAll();
    return;
  }

  if (D.mode === 'rotate' && D.rotElId) {
    const el = getEl(D.rotElId); if (!el) return;
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    const angle = Math.atan2(pos.y - cy, pos.x - cx) * 180 / Math.PI;
    let newRot = D.rotStart + (angle - D.rotStartAngle);
    if (ev.shiftKey) newRot = Math.round(newRot / 15) * 15;
    el.rotation = ((newRot % 360) + 360) % 360;
    renderAll(); updateProps();
  }
}

function onMouseUp(ev) {
  if (D.mode === 'draw') {
    if (D.drawEl && D.drawEl.w < 4 && D.drawEl.h < 4 && S.tool !== 'text') {
      D.drawEl.w = 120; D.drawEl.h = 80;
    }
    // Switch back to select after drawing any shape
    setTool('select');
    D.drawEl = null;
    renderAll(); updateProps(); updateLayers();
  }
  D.mode = null;
}

// ─── Hit testing ─────────────────────────────────────────────────────────────
function hitTest(pos) {
  const pageEls = S.els.filter(e => e.page === S.page && e.visible && !e.locked);
  // Check in reverse z-order (top elements first)
  for (let i = pageEls.length - 1; i >= 0; i--) {
    const el = pageEls[i];
    if (pos.x >= el.x && pos.x <= el.x + el.w && pos.y >= el.y && pos.y <= el.y + el.h) {
      return el;
    }
  }
  return null;
}

// ─── Keyboard shortcuts ──────────────────────────────────────────────────────
document.addEventListener('keydown', ev => {
  const ctrl = ev.ctrlKey || ev.metaKey;
  const k = ev.key.toLowerCase();

  if (ctrl && k === 'z') { /* undo */ return; }
  if (ctrl && k === 'd') { ev.preventDefault(); /* duplicate */ return; }
  if (ctrl && k === 'g') { ev.preventDefault(); ev.shiftKey ? /* ungroup */ null : /* group */ null; return; }

  if (!ev.target.closest('input, textarea, [contenteditable]')) {
    if (k === 'v' && !ev.shiftKey) setTool('select');
    if (k === 'h') setTool('grab');
    if (k === 'r') setTool('rect');
    if (k === 'e' || k === 'o') setTool('ellipse');
    if (k === 'l') setTool('line');
    if (k === 't') setTool('text');
    if (k === 'f') setTool('frame');
    if (k === 'c') setTool('comment');
    if (k === ' ' && !S._spacePanning) { S._spacePanning = true; S._prevTool = S.tool; setTool('grab'); }
  }
});

document.addEventListener('keyup', ev => {
  if (ev.key === ' ' && S._spacePanning) { S._spacePanning = false; setTool(S._prevTool); }
});
