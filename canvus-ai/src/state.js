/**
 * state.js — Canvus State Module (draft)
 *
 * Extracted from app.js. Owns the single S object, undo stack,
 * snap helpers, and all direct state mutations.
 * Other modules import { S, getEl, pushUndo, snapV, mkEl, mkFill }.
 */

// ─── Core state ────────────────────────────────────────────────────────────
export const S = {
  els:        [],       // all CanvusElement objects
  pages:      [{ id: 1, name: 'Page 1' }],
  page:       1,
  selIds:     [],
  tool:       'select',
  zoom:       1,
  panX:       0,
  panY:       0,
  grid:       true,
  snap:       true,
  protoConns: [],
  comments:   [],
  colorStyles:{},
  nextId:     1,
  coachOn:    false,
  protoMode:  false,
  outlineMode:false,

  // Export state
  _exportScale: 1,
  _exportFmt:   'png',

  // Space-pan temp state
  _spacePanning: false,
  _prevTool:     'select',
};

// ─── Undo ──────────────────────────────────────────────────────────────────
const _undo = [];
const MAX_UNDO = 60;

export function pushUndo() {
  _undo.push(JSON.stringify({ els: S.els, protoConns: S.protoConns, pages: S.pages }));
  if (_undo.length > MAX_UNDO) _undo.shift();
}

export function undo() {
  if (!_undo.length) return false;
  const snap = JSON.parse(_undo.pop());
  Object.assign(S, snap);
  return true;
}

// ─── Snap ──────────────────────────────────────────────────────────────────
export const GRID = 8;
export function snapV(v) { return S.snap ? Math.round(v / GRID) * GRID : Math.round(v); }

// ─── Element factory ───────────────────────────────────────────────────────
export function mkEl(type, x, y, w, h) {
  return {
    id:   S.nextId++,
    type, x: snapV(x), y: snapV(y), w, h,
    fills:        [mkFill('#e0e0e0')],
    fill:         'transparent',
    stroke:       'none',
    strokeWidth:  type === 'frame' ? 1 : 2,
    strokeAlign:  'center',
    strokeDash:   false,
    rx:           0,
    cornerRadii:  null,
    rotation:     0,
    opacity:      100,
    text:         '',
    fontSize:     16,
    lineHeight:   24,
    fontWeight:   '400',
    textColor:    '#111111',
    textAlign:    'left',
    letterSpacing:0,
    textTransform:'none',
    visible:      true,
    locked:       false,
    name:         type[0].toUpperCase() + type.slice(1) + ' ' + S.nextId,
    page:         S.page,
    parentId:     null,
    collapsed:    false,
    interactions: [],
    isFlowStart:  false,
    flowName:     '',
    scrollBehavior:'none',
    isComponent:  false,
    componentId:  null,
    variantProps: {},
    overrides:    {},
    html:         '',
    effects:      [],
    layoutGrids:  [],
    pathData:     null,
    pathClosed:   false,
  };
}

export function mkFill(color = '#e0e0e0') {
  return { id: S.nextId++, type: 'solid', color, opacity: 100, blend: 'normal', visible: true, stops: [] };
}

// ─── Accessors ─────────────────────────────────────────────────────────────
export function getEl(id) { return S.els.find(e => e.id === id) || null; }

export function getPage(id) { return S.pages.find(p => p.id === id) || null; }

export function currentPageEls() { return S.els.filter(e => e.page === S.page); }

// ─── Mutations ─────────────────────────────────────────────────────────────
export function addEl(el) { S.els.push(el); }

export function removeEl(id) { S.els = S.els.filter(e => e.id !== id); }

export function bringToFront(id) {
  const idx = S.els.findIndex(e => e.id === id);
  if (idx < 0) return;
  S.els.push(...S.els.splice(idx, 1));
}

export function sendToBack(id) {
  const idx = S.els.findIndex(e => e.id === id);
  if (idx < 0) return;
  S.els.unshift(...S.els.splice(idx, 1));
}

// ─── Props sync (master → instance propagation) ───────────────────────────
export const _SYNC_PROPS = [
  'stroke','strokeWidth','strokeAlign','strokeDash',
  'rx','cornerRadii','rotation','opacity',
  'fill','fills','w','h',
  'fontSize','fontWeight','textColor','lineHeight','fontStyle',
  'textAlign','letterSpacing','textTransform',
  'text','html',
];
