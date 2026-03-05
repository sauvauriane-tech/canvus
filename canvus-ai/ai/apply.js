/**
 * apply.js — In-browser Canvus AI Op Applier
 *
 * Reads the global Canvus state (S, getEl, pushUndo, mkEl, mkFill,
 * renderAll, updateProps, updateLayers) and applies a validated array
 * of ops in sequence, wrapped in a single undo step.
 *
 * Include this script after app.js; it will be called by the AI panel.
 *
 *   applyOps(ops, { dryRun: false })
 *     → { applied: [], skipped: [], diff: DiffEntry[] }
 */

/**
 * @param {import('./ops').AnyOp[]} ops
 * @param {{ dryRun?: boolean }} [options]
 * @returns {{ applied: string[], skipped: string[], diff: object[] }}
 */
function applyOps(ops, { dryRun = false } = {}) {
  const applied = [];
  const skipped = [];
  const diff    = [];
  const newTopFrameIds = [];

  if (!dryRun) pushUndo();

  for (const op of ops) {
    try {
      const result = _applyOne(op, dryRun);
      applied.push(op.type);
      diff.push(...result);
      // Track newly created top-level frames for auto-centering
      if (!dryRun && op.type === 'create_element' && op.elType === 'frame' && !op.parentId) {
        const created = S.els[S.els.length - 1];
        if (created && created.type === 'frame') newTopFrameIds.push(created.id);
      }
    } catch (err) {
      skipped.push(`${op.type}: ${err.message}`);
    }
  }

  if (!dryRun) {
    renderAll();
    updateProps();
    updateLayers();

    // Auto-center viewport on the first newly created top-level frame
    if (newTopFrameIds.length > 0) {
      const fr = getEl(newTopFrameIds[0]);
      if (fr) {
        const wrap = document.getElementById('canvas-wrap');
        const r = wrap ? wrap.getBoundingClientRect() : { width: window.innerWidth - 280, height: window.innerHeight - 48 };
        const vw = r.width, vh = r.height;
        // Fit zoom so the frame fills ~80% of the viewport
        const fitZoom = Math.min(0.8 * vw / fr.w, 0.8 * vh / fr.h, 2);
        S.zoom = Math.max(0.1, fitZoom);
        S.panX = vw / 2 - (fr.x + fr.w / 2) * S.zoom;
        S.panY = vh / 2 - (fr.y + fr.h / 2) * S.zoom;
        applyTransform();
        renderGrid();
      }
    }
  }

  return { applied, skipped, diff };
}

// ─── Op dispatch ─────────────────────────────────────────────────────────────
function _applyOne(op, dry) {
  switch (op.type) {
    case 'create_element':            return _createEl(op, dry);
    case 'delete_elements':           return _deleteEls(op, dry);
    case 'set_property':              return _setProperty(op, dry);
    case 'move_elements':             return _moveEls(op, dry);
    case 'resize_element':            return _resizeEl(op, dry);
    case 'rename_element':            return _renameEl(op, dry);
    case 'reorder_element':           return _reorderEl(op, dry);
    case 'group_elements':            return _groupEls(op, dry);
    case 'ungroup_elements':          return _ungroupEls(op, dry);
    case 'set_fill':                  return _setFill(op, dry);
    case 'add_fill':                  return _addFill(op, dry);
    case 'remove_fill':               return _removeFill(op, dry);
    case 'set_stroke':                return _setStroke(op, dry);
    case 'add_effect':                return _addEffect(op, dry);
    case 'remove_effect':             return _removeEffect(op, dry);
    case 'set_auto_layout':           return _setAutoLayout(op, dry);
    case 'remove_auto_layout':        return _removeAutoLayout(op, dry);
    case 'align_elements':            return _alignEls(op, dry);
    case 'distribute_elements':       return _distributeEls(op, dry);
    case 'add_prototype_connection':  return _addProtoConn(op, dry);
    case 'batch':                     return op.ops.flatMap(o => _applyOne(o, dry));
    default: throw new Error(`Unknown op type: ${op.type}`);
  }
}

// ─── Implementations ─────────────────────────────────────────────────────────
function _createEl(op, dry) {
  const d = [{ op: 'create_element', elType: op.elType, name: op.name }];
  if (dry) return d;
  const el = mkEl(op.elType, op.x, op.y, op.w, op.h);
  if (op.name)     el.name     = op.name;
  if (op.text)     el.text     = op.text;
  if (op.fontSize) el.fontSize = op.fontSize;
  if (op.parentId) el.parentId = op.parentId;
  if (op.fill)     el.fills    = [mkFill(op.fill)];
  if (op.stroke)   el.stroke   = op.stroke;
  S.els.push(el);
  S.selIds = [el.id];
  return d;
}

function _deleteEls(op, dry) {
  const names = op.ids.map(id => getEl(id)?.name).filter(Boolean);
  const d = [{ op: 'delete_elements', names }];
  if (dry) return d;
  S.els = S.els.filter(e => !op.ids.includes(e.id));
  S.selIds = S.selIds.filter(id => !op.ids.includes(id));
  // Remove children orphaned by frame deletion
  op.ids.forEach(id => { S.els = S.els.filter(e => e.parentId !== id); });
  return d;
}

function _setProperty(op, dry) {
  const d = op.ids.map(id => ({ op: 'set_property', id, key: op.key, from: getEl(id)?.[op.key], to: op.value }));
  if (dry) return d;
  op.ids.forEach(id => { const el = getEl(id); if (el) el[op.key] = op.value; });
  return d;
}

function _moveEls(op, dry) {
  const d = op.ids.map(id => {
    const el = getEl(id);
    return { op: 'move_elements', id, from: { x: el?.x, y: el?.y }, to: { x: (el?.x||0)+op.dx, y: (el?.y||0)+op.dy } };
  });
  if (dry) return d;
  op.ids.forEach(id => { const el = getEl(id); if (el) { el.x += op.dx; el.y += op.dy; } });
  return d;
}

function _resizeEl(op, dry) {
  const el = getEl(op.id);
  const d = [{ op: 'resize_element', id: op.id, from: { x: el?.x, y: el?.y, w: el?.w, h: el?.h }, to: { x: op.x, y: op.y, w: op.w, h: op.h } }];
  if (dry || !el) return d;
  if (op.x != null) el.x = op.x;
  if (op.y != null) el.y = op.y;
  if (op.w != null) el.w = op.w;
  if (op.h != null) el.h = op.h;
  return d;
}

function _renameEl(op, dry) {
  const el = getEl(op.id);
  const d = [{ op: 'rename_element', id: op.id, from: el?.name, to: op.name }];
  if (dry || !el) return d;
  el.name = op.name;
  return d;
}

function _reorderEl(op, dry) {
  const d = [{ op: 'reorder_element', id: op.id, position: op.position }];
  if (dry) return d;
  const idx = S.els.findIndex(e => e.id === op.id);
  if (idx < 0) return d;
  const [el] = S.els.splice(idx, 1);
  if (op.position === 'front')    S.els.push(el);
  if (op.position === 'back')     S.els.unshift(el);
  if (op.position === 'forward')  S.els.splice(Math.min(idx + 1, S.els.length), 0, el);
  if (op.position === 'backward') S.els.splice(Math.max(idx - 1, 0), 0, el);
  return d;
}

function _groupEls(op, dry) {
  const d = [{ op: 'group_elements', ids: op.ids, name: op.name }];
  if (dry) return d;
  const members = op.ids.map(id => getEl(id)).filter(Boolean);
  if (!members.length) return d;
  const xs = members.map(e => e.x), ys = members.map(e => e.y);
  const x2 = members.map(e => e.x + e.w), y2 = members.map(e => e.y + e.h);
  const gx = Math.min(...xs), gy = Math.min(...ys);
  const gw = Math.max(...x2) - gx, gh = Math.max(...y2) - gy;
  const grp = mkEl('group', gx, gy, gw, gh);
  grp.name = op.name || `Group ${grp.id}`;
  S.els.push(grp);
  members.forEach(el => { el.parentId = grp.id; el.x -= gx; el.y -= gy; });
  S.selIds = [grp.id];
  return d;
}

function _ungroupEls(op, dry) {
  const d = [{ op: 'ungroup_elements', ids: op.ids }];
  if (dry) return d;
  op.ids.forEach(gid => {
    const grp = getEl(gid); if (!grp) return;
    S.els.filter(e => e.parentId === gid).forEach(el => { el.parentId = grp.parentId; el.x += grp.x; el.y += grp.y; });
    S.els = S.els.filter(e => e.id !== gid);
  });
  return d;
}

function _setFill(op, dry) {
  const d = [{ op: 'set_fill', ids: op.ids }];
  if (dry) return d;
  op.ids.forEach(id => {
    const el = getEl(id); if (!el) return;
    if (!el.fills) el.fills = [];
    const idx = op.fillIndex ?? 0;
    if (!el.fills[idx]) el.fills[idx] = mkFill(op.color || '#ffffff');
    if (op.color   != null) el.fills[idx].color   = op.color;
    if (op.opacity != null) el.fills[idx].opacity  = op.opacity;
    if (op.visible != null) el.fills[idx].visible  = op.visible;
    if (op.blend   != null) el.fills[idx].blend    = op.blend;
  });
  return d;
}

function _addFill(op, dry) {
  const d = [{ op: 'add_fill', ids: op.ids, color: op.color }];
  if (dry) return d;
  op.ids.forEach(id => {
    const el = getEl(id); if (!el) return;
    if (!el.fills) el.fills = [];
    el.fills.push({ ...mkFill(op.color), opacity: op.opacity ?? 100, blend: op.blend ?? 'normal' });
  });
  return d;
}

function _removeFill(op, dry) {
  const d = [{ op: 'remove_fill', ids: op.ids, fillIndex: op.fillIndex }];
  if (dry) return d;
  op.ids.forEach(id => { const el = getEl(id); if (el?.fills) el.fills.splice(op.fillIndex, 1); });
  return d;
}

function _setStroke(op, dry) {
  const d = [{ op: 'set_stroke', ids: op.ids }];
  if (dry) return d;
  op.ids.forEach(id => {
    const el = getEl(id); if (!el) return;
    if (op.color != null) el.stroke      = op.color;
    if (op.width != null) el.strokeWidth = op.width;
    if (op.align != null) el.strokeAlign = op.align;
    if (op.dash  != null) el.strokeDash  = op.dash;
  });
  return d;
}

function _addEffect(op, dry) {
  const d = [{ op: 'add_effect', ids: op.ids, effectType: op.effectType }];
  if (dry) return d;
  const ef = {
    type: op.effectType, visible: true,
    color: op.color ?? '#000000', opacity: op.opacity ?? 25,
    x: op.x ?? 2, y: op.y ?? 4, blur: op.blur ?? 8, spread: op.spread ?? 0,
    radius: op.radius ?? 8, amount: op.amount ?? 20,
    preset: op.preset ?? 'noise', scale: op.scale ?? 65, blend: op.blend ?? 'overlay',
  };
  op.ids.forEach(id => { const el = getEl(id); if (el) { if (!el.effects) el.effects = []; el.effects.push({...ef}); } });
  return d;
}

function _removeEffect(op, dry) {
  const d = [{ op: 'remove_effect', ids: op.ids, effectIndex: op.effectIndex }];
  if (dry) return d;
  op.ids.forEach(id => { const el = getEl(id); if (el?.effects) el.effects.splice(op.effectIndex, 1); });
  return d;
}

function _setAutoLayout(op, dry) {
  const d = [{ op: 'set_auto_layout', id: op.id }];
  if (dry) return d;
  const el = getEl(op.id); if (!el) return d;
  el.autoLayout = { direction: op.direction, gap: op.gap, padding: op.padding, align: op.align };
  return d;
}

function _removeAutoLayout(op, dry) {
  const d = [{ op: 'remove_auto_layout', id: op.id }];
  if (dry) return d;
  const el = getEl(op.id); if (el) el.autoLayout = null;
  return d;
}

function _alignEls(op, dry) {
  const d = [{ op: 'align_elements', ids: op.ids, direction: op.direction }];
  if (dry) return d;
  const els = op.ids.map(id => getEl(id)).filter(Boolean);
  if (!els.length) return d;
  const dir = op.direction;
  const xs = els.map(e => e.x), ys = els.map(e => e.y);
  const x2 = els.map(e => e.x + e.w), y2 = els.map(e => e.y + e.h);
  if (dir === 'left')     els.forEach(e => { e.x = Math.min(...xs); });
  if (dir === 'right')    els.forEach(e => { e.x = Math.max(...x2) - e.w; });
  if (dir === 'center-h') { const cx = (Math.min(...xs) + Math.max(...x2)) / 2; els.forEach(e => { e.x = cx - e.w/2; }); }
  if (dir === 'top')      els.forEach(e => { e.y = Math.min(...ys); });
  if (dir === 'bottom')   els.forEach(e => { e.y = Math.max(...y2) - e.h; });
  if (dir === 'center-v') { const cy = (Math.min(...ys) + Math.max(...y2)) / 2; els.forEach(e => { e.y = cy - e.h/2; }); }
  return d;
}

function _distributeEls(op, dry) {
  const d = [{ op: 'distribute_elements', ids: op.ids, axis: op.axis }];
  if (dry) return d;
  const els = op.ids.map(id => getEl(id)).filter(Boolean);
  if (els.length < 3) return d;
  if (op.axis === 'h') {
    els.sort((a,b) => a.x - b.x);
    const totalW = els.reduce((s,e) => s+e.w, 0);
    const span = (els[els.length-1].x + els[els.length-1].w) - els[0].x;
    const gap = (span - totalW) / (els.length - 1);
    let cx = els[0].x + els[0].w + gap;
    for (let i = 1; i < els.length - 1; i++) { els[i].x = cx; cx += els[i].w + gap; }
  } else {
    els.sort((a,b) => a.y - b.y);
    const totalH = els.reduce((s,e) => s+e.h, 0);
    const span = (els[els.length-1].y + els[els.length-1].h) - els[0].y;
    const gap = (span - totalH) / (els.length - 1);
    let cy = els[0].y + els[0].h + gap;
    for (let i = 1; i < els.length - 1; i++) { els[i].y = cy; cy += els[i].h + gap; }
  }
  return d;
}

function _addProtoConn(op, dry) {
  const d = [{ op: 'add_prototype_connection', fromId: op.fromId, toId: op.toId }];
  if (dry) return d;
  S.protoConns.push({
    id: S.nextId++, fromId: op.fromId, toId: op.toId,
    trigger: op.trigger ?? 'click', animation: op.animation ?? 'instant',
  });
  return d;
}
