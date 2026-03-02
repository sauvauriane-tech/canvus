/**
 * renderer.js — Canvus Renderer Module (draft)
 *
 * Owns all DOM-building logic. Reads S (read-only) and writes to
 * the #canvas and #grid-canvas DOM elements. Never mutates state.
 *
 * Entry points:
 *   renderAll()     — full canvas redraw from S.els
 *   renderGrid()    — redraws the background dot grid
 *   renderElement() — renders one element to DOM
 */

import { S, getEl } from './state.js';

const canvas     = document.getElementById('canvas');
const gridCanvas = document.getElementById('grid-canvas');

// ─── Full redraw ────────────────────────────────────────────────────────────
export function renderAll() {
  canvas.innerHTML = '';

  // Apply pan + zoom transform
  canvas.style.transform = `translate(${S.panX}px, ${S.panY}px) scale(${S.zoom})`;

  // Render all elements on the current page in z-order
  const pageEls = S.els.filter(e => e.page === S.page && !e.parentId);
  pageEls.forEach(el => renderElement(el));

  // Children (inside frames/groups) are rendered by renderElement recursively

  renderMeasure();
  renderMultiSelBox();
  renderProtoArrows();
  renderSnapGuides();
  renderComments();
}

// ─── Single element ─────────────────────────────────────────────────────────
export function renderElement(el) {
  if (!el.visible && !isSelected(el.id)) return;

  let dom;
  const isSel   = S.selIds.includes(el.id);
  const isMulti = S.selIds.length > 1;

  if (el.type === 'rect' || el.type === 'frame') {
    dom = document.createElement('div');
    applyFillsToDiv(dom, el, null);
    if (el.imageSrc) {
      dom.style.backgroundImage = `url('${el.imageSrc}')`;
      dom.style.backgroundSize = 'cover';
      dom.style.backgroundPosition = 'center';
    }
    if (el.type === 'frame') {
      dom.classList.add('cel-frame');
      renderLayoutGrid(dom, el);
      renderFrameLabel(dom, el, isSel);
      renderChildren(dom, el);
    }
  } else if (el.type === 'ellipse') {
    dom = document.createElement('div');
    applyFillsToDiv(dom, el, 'border-radius:50%;');
  } else if (el.type === 'text') {
    dom = renderTextEl(el);
  } else if (el.type === 'line') {
    dom = renderLineEl(el);
  } else if (el.type === 'group') {
    dom = renderGroupEl(el, isSel);
  } else if (el.type === 'video') {
    dom = renderVideoEl(el);
  }

  if (!dom) return;

  dom.className = (dom.className || '') + ` cel ${el.type === 'frame' ? 'cel-frame' : ''}`.trim();
  dom.dataset.id = el.id;

  positionDom(dom, el);
  applyEffectsToEl(dom, el);
  applySelectionHandles(dom, el, isSel, isMulti);

  canvas.appendChild(dom);
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function positionDom(dom, el) {
  const rot   = el.rotation || 0;
  const flipH = el.flipH ? -1 : 1;
  const flipV = el.flipV ? -1 : 1;
  dom.style.left = `${el.x}px`;
  dom.style.top  = `${el.y}px`;
  dom.style.width  = `${el.w}px`;
  dom.style.height = `${el.h}px`;
  if (rot || el.flipH || el.flipV) {
    dom.style.transform = `rotate(${rot}deg) scale(${flipH},${flipV})`;
    dom.style.transformOrigin = 'center center';
  }
  dom.style.opacity = el.opacity / 100;
}

function renderChildren(frameDom, frame) {
  const children = S.els.filter(e => e.parentId === frame.id && e.page === S.page);
  children.forEach(child => {
    // Children are positioned relative to frame origin
    const childDom = buildElDom(child);
    if (childDom) frameDom.appendChild(childDom);
  });
}

function isSelected(id) { return S.selIds.includes(id); }

// ─── Grid ────────────────────────────────────────────────────────────────────
export function renderGrid() {
  const ctx  = gridCanvas.getContext('2d');
  const W    = gridCanvas.width  = window.innerWidth;
  const H    = gridCanvas.height = window.innerHeight;
  if (!S.grid) { ctx.clearRect(0, 0, W, H); return; }

  const STEP = 8 * S.zoom;
  const offX = ((S.panX % STEP) + STEP) % STEP;
  const offY = ((S.panY % STEP) + STEP) % STEP;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(120,120,140,0.3)';

  for (let x = offX; x < W; x += STEP) {
    for (let y = offY; y < H; y += STEP) {
      ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
    }
  }
}

// Note: applyFillsToDiv, applyEffectsToEl, renderLayoutGrid etc. are also
// in this module in the full implementation. Kept brief here for readability.
