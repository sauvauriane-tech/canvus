/**
 * panels.js — Canvus Panel Update Module (draft)
 *
 * Owns the right inspector (updateProps), layers panel (updateLayers),
 * and all their sub-builders. Reads S state; never mutates it directly —
 * it emits via SP / SPM / pushUndo which are imported from state.js.
 *
 * Entry points:
 *   updateProps()   — rebuild right-panel from S.selIds
 *   updateLayers()  — rebuild layers panel tree
 */

import { S, getEl, pushUndo } from './state.js';
import { renderAll } from './renderer.js';

// ─── Property helpers ────────────────────────────────────────────────────────
/** Set a property on the single selected element */
export function SP(key, val) {
  const el = getEl(S.selIds[0]); if (!el) return;
  pushUndo();
  el[key] = val;
  renderAll(); updateProps();
}

/** Set a property on all selected elements */
export function SPM(key, val) {
  pushUndo();
  S.selIds.forEach(id => { const el = getEl(id); if (el) el[key] = val; });
  renderAll(); updateProps();
}

// ─── Inspector ───────────────────────────────────────────────────────────────
export function updateProps() {
  const panel = document.getElementById('props-panel');
  if (!panel) return;

  const selIds = S.selIds;
  const multi  = selIds.length > 1;
  const el     = selIds.length === 1 ? getEl(selIds[0]) : null;

  if (!selIds.length) { panel.innerHTML = renderEmptyState(); return; }

  const sections = [];

  // ── Frame/position section ──
  sections.push(renderGeometrySection(el, multi, selIds));

  if (el) {
    if (el.type === 'frame') {
      sections.push(renderAutoLayoutSection(el));
      sections.push(renderLayoutGridSection(el));
    }
    if (el.type === 'text') {
      sections.push(renderTypographySection(el));
    }
    sections.push(renderFillsSection(el));
    sections.push(renderStrokeSection(el));
    sections.push(renderEffectsSection(el));
    sections.push(renderExportSection(el));
  }

  sections.push(renderActionsSection());

  panel.innerHTML = sections.filter(Boolean).join('');
}

function renderEmptyState() {
  return `<div style="padding:20px;color:var(--text3);font-size:12px;text-align:center;">
    Select an element to inspect
  </div>`;
}

function renderGeometrySection(el, multi, selIds) {
  if (!el && !multi) return '';
  // ... full implementation renders X/Y/W/H/rotation/radius inputs
  return `<div class="psec"><!-- geometry rows --></div>`;
}

function renderAutoLayoutSection(el) {
  const al = el.autoLayout;
  return `<div class="psec">
    <div class="psec-title">Auto Layout</div>
    <!-- direction, gap, padding, align -->
  </div>`;
}

function renderLayoutGridSection(el) {
  const grids = el.layoutGrids || [];
  return `<div class="psec">
    <div class="psec-title">Layout Grid</div>
    <!-- grid rows + add button -->
  </div>`;
}

function renderTypographySection(el) {
  return `<div class="psec">
    <div class="psec-title">Typography</div>
    <!-- font, size, weight, line-height, align, spacing, case -->
  </div>`;
}

function renderFillsSection(el) {
  const fills = el.fills || [];
  return `<div class="psec">
    <div class="psec-title">Fill</div>
    <!-- fill rows with add/delete, color, opacity, blend, gradient editor -->
  </div>`;
}

function renderStrokeSection(el) {
  return `<div class="psec">
    <div class="psec-title">Stroke</div>
    <!-- stroke color, width, position, dash toggle -->
  </div>`;
}

function renderEffectsSection(el) {
  const effs = el.effects || [];
  return `<div class="psec">
    <div class="psec-title">Effects</div>
    <!-- effect rows with type select, color/blur/offset controls -->
  </div>`;
}

function renderExportSection(el) {
  return `<div class="psec">
    <div class="psec-title">Export</div>
    <!-- scale 1x/2x/3x, format PNG/SVG, download button -->
  </div>`;
}

function renderActionsSection() {
  return `<div class="psec">
    <button onclick="duplicateSelected()">Duplicate</button>
    <button onclick="deleteSelected()">Delete</button>
  </div>`;
}

// ─── Layers panel ─────────────────────────────────────────────────────────────
export function updateLayers() {
  const panel = document.getElementById('layers-panel');
  if (!panel) return;

  const root = S.els.filter(e => e.page === S.page && !e.parentId);
  const container = document.createElement('div');

  [...root].reverse().forEach(el => renderLayerItem(container, el, 0));

  panel.innerHTML = '';
  panel.appendChild(container);
}

function renderLayerItem(container, el, depth) {
  const isContainer = el.type === 'frame' || el.type === 'group';
  const isSel = S.selIds.includes(el.id);

  const item = document.createElement('div');
  item.className = `layer-item${isSel ? ' sel' : ''}`;
  item.style.paddingLeft = `${8 + depth * 14}px`;
  item.dataset.id = el.id;
  item.draggable = true;

  const TYPE_ICONS = { rect: '▭', ellipse: '◯', text: 'T', line: '—', frame: '⊞', group: '⊡', video: '▶' };
  const icon = el.isComponent ? '⬡' : el.componentId ? '◆' : TYPE_ICONS[el.type] || '▭';

  item.innerHTML = `
    <span class="layer-icon">${icon}</span>
    <span class="layer-name" ondblclick="startRenameLayer(${el.id})">${el.name}</span>
    <button class="layer-vis" onclick="toggleLayerVis(event,${el.id})">${el.visible ? '●' : '○'}</button>
    <button class="layer-lock" onclick="toggleLayerLock(event,${el.id})">${el.locked ? '🔒' : ''}</button>
  `;

  item.addEventListener('mousedown', ev => {
    ev.stopPropagation();
    S.selIds = ev.shiftKey ? [...S.selIds, el.id] : [el.id];
    renderAll(); updateProps(); updateLayers();
  });

  container.appendChild(item);

  if (isContainer && !el.collapsed) {
    const children = [...S.els].filter(e => e.parentId === el.id && e.page === S.page).reverse();
    children.forEach(child => renderLayerItem(container, child, depth + 1));
  }
}
