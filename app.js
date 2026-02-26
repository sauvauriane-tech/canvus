// ════════════════════════════════════════════════════════════
// STATE — single source of truth
// ════════════════════════════════════════════════════════════
const S = {
  els: [], comments: [],
  pages: [{id:1,name:'WELCOME TO CANVUS'},{id:2,name:'Page 2'}],
  page: 1,
  nextId: 1,
  selIds: [],
  tool: 'select',
  zoom: 1, panX: 80, panY: 70,
  gridOn: false, snapOn: true,
  protoMode: false, protoFrom: null,
  coachOn: false,
  altDown: false,
  hoveredId: null,
  protoConns: [],
  colorStyles: {
    primary:   {label:'Primary',   hex:'#7c6aee'},
    secondary: {label:'Secondary', hex:'#3db87a'},
    success:   {label:'Success',   hex:'#4caf80'},
    warning:   {label:'Warning',   hex:'#d4a03a'},
    error:     {label:'Error',     hex:'#e05555'},
    neutral:   {label:'Neutral',   hex:'#8888a0'},
  },
  commentsVisible: true,
  // Collab: anonymous session — WebSocket-ready structure
  collab: {
    sessionId: null,   // set on init from localStorage
    shareId: null,     // unique file share token
    presence: [],      // [{sessionId, color, initial, x, y}] — ready for WS sync
  },
};

// ── Collab init (localStorage mock — swap for WebSocket later) ──
(function initCollab() {
  let sid = localStorage.getItem('canvus_session');
  if (!sid) { sid = 'sess_'+Math.random().toString(36).slice(2,9); localStorage.setItem('canvus_session', sid); }
  S.collab.sessionId = sid;
  // Share ID: derived from URL hash if present, otherwise generate
  let shareId = location.hash.slice(1);
  if (!shareId) {
    shareId = localStorage.getItem('canvus_share') || ('file_'+Math.random().toString(36).slice(2,10));
    localStorage.setItem('canvus_share', shareId);
    history.replaceState(null,'','#'+shareId);
  }
  S.collab.shareId = shareId;
})();

// ── DOM refs ──
const canvasEl   = document.getElementById('canvas');
const canvasWrap = document.getElementById('canvas-wrap');
const selBoxEl   = document.getElementById('sel-box');
const snapLayer  = document.getElementById('snap-layer');
const measureLayer = document.getElementById('measure-layer');
const commentLayer = document.getElementById('comment-layer');

// ════════════════════════════════════════════════════════════
// CANVAS TRANSFORM
// ════════════════════════════════════════════════════════════
function applyTransform() {
  canvasEl.style.transform = `translate(${S.panX}px,${S.panY}px) scale(${S.zoom})`;
  canvasEl.style.transformOrigin = '0 0';
  document.getElementById('zoom-lbl').textContent = Math.round(S.zoom*100)+'%';
}

function screenToCanvas(sx, sy) {
  const r = canvasWrap.getBoundingClientRect();
  return {x:(sx-r.left-S.panX)/S.zoom, y:(sy-r.top-S.panY)/S.zoom};
}

// ════════════════════════════════════════════════════════════
// GRID RENDERER
// ════════════════════════════════════════════════════════════
const gridCanvas = document.getElementById('grid-canvas');

function renderGrid() {
  const w = canvasWrap.offsetWidth, h = canvasWrap.offsetHeight;
  gridCanvas.width = w; gridCanvas.height = h;
  const ctx = gridCanvas.getContext('2d');
  ctx.clearRect(0,0,w,h);

  if (!S.gridOn) {
    // quiet dot grid
    ctx.fillStyle = 'rgba(55,55,68,0.7)';
    const sp = 24;
    for (let x = S.panX%sp; x < w; x += sp)
      for (let y = S.panY%sp; y < h; y += sp)
        { ctx.beginPath(); ctx.arc(x,y,1,0,Math.PI*2); ctx.fill(); }
    return;
  }

  const G = 8, gs = G*S.zoom;
  const ox = ((S.panX%gs)+gs)%gs, oy = ((S.panY%gs)+gs)%gs;
  ctx.strokeStyle = 'rgba(124,106,238,.07)'; ctx.lineWidth = 1;
  for (let x=ox; x<w; x+=gs){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
  for (let y=oy; y<h; y+=gs){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}

  const ms = 64*S.zoom;
  const mox = ((S.panX%ms)+ms)%ms, moy = ((S.panY%ms)+ms)%ms;
  ctx.strokeStyle = 'rgba(124,106,238,.16)';
  for (let x=mox; x<w; x+=ms){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
  for (let y=moy; y<h; y+=ms){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
}

function snapV(v) { return S.snapOn ? Math.round(v/8)*8 : v; }

function toggleGrid() {
  S.gridOn = !S.gridOn;
  document.getElementById('btn-grid').classList.toggle('on', S.gridOn);
  document.getElementById('st-grid').style.display = S.gridOn ? 'flex' : 'none';
  renderGrid();
}

function toggleSnap() {
  S.snapOn = !S.snapOn;
  document.getElementById('btn-snap').classList.toggle('on', S.snapOn);
  document.getElementById('st-snap').style.display = S.snapOn ? 'flex' : 'none';
}

// ════════════════════════════════════════════════════════════
// SNAP GUIDES
// ════════════════════════════════════════════════════════════
let _snapTimer = null;

function showSnapGuide(axis, val) {
  // Clear immediately (don't wait for timeout) so guides don't pile up during drag
  snapLayer.innerHTML = '';
  clearTimeout(_snapTimer);
  const g = document.createElement('div');
  g.className = `sg ${axis}`;
  if (axis==='h') g.style.top = val*S.zoom+S.panY+'px';
  else g.style.left = val*S.zoom+S.panX+'px';
  snapLayer.appendChild(g);
  _snapTimer = setTimeout(()=>{ snapLayer.innerHTML=''; }, 600);
}

function findSnap(el) {
  const threshold = 6/S.zoom;
  let snapX=null, snapY=null;
  S.els.forEach(e => {
    if (e.id===el.id||!e.visible) return;
    const vEdges = [e.x, e.x+e.w/2, e.x+e.w];
    const hEdges = [e.y, e.y+e.h/2, e.y+e.h];
    [el.x, el.x+el.w/2, el.x+el.w].forEach(edge => {
      vEdges.forEach(ve => { if (!snapX && Math.abs(edge-ve)<threshold) snapX={guide:ve,offset:ve-edge}; });
    });
    [el.y, el.y+el.h/2, el.y+el.h].forEach(edge => {
      hEdges.forEach(he => { if (!snapY && Math.abs(edge-he)<threshold) snapY={guide:he,offset:he-edge}; });
    });
  });
  return {snapX, snapY};
}

// ════════════════════════════════════════════════════════════
// DISTANCE MEASUREMENT (Alt key only)
// ════════════════════════════════════════════════════════════
function renderMeasure() {
  measureLayer.innerHTML = '';
  if (!S.altDown || S.selIds.length !== 1) return;
  const sel = getEl(S.selIds[0]); if (!sel) return;
  const hovId = S.hoveredId;
  const target = hovId && hovId !== sel.id ? getEl(hovId) : null;
  if (!target) return;

  // Measure horizontal and vertical gaps
  const sR = sel.x+sel.w, sL = sel.x, sT = sel.y, sB = sel.y+sel.h;
  const tR = target.x+target.w, tL = target.x, tT = target.y, tB = target.y+target.h;

  const measurements = [];

  // Horizontal gap
  if (sR <= tL) measurements.push({axis:'h', a:sR, b:tL, mid:(sT+sB)/2});
  else if (tR <= sL) measurements.push({axis:'h', a:tR, b:sL, mid:(sT+sB)/2});

  // Vertical gap
  if (sB <= tT) measurements.push({axis:'v', a:sB, b:tT, mid:(sL+sR)/2});
  else if (tB <= sT) measurements.push({axis:'v', a:tB, b:sT, mid:(sL+sR)/2});

  measurements.forEach(m => {
    const gap = Math.round(m.b - m.a);
    if (gap <= 0) return;
    const isOnGrid = gap % 8 === 0;

    if (m.axis==='h') {
      const sx1 = m.a*S.zoom+S.panX, sx2 = m.b*S.zoom+S.panX;
      const sy  = m.mid*S.zoom+S.panY;
      // line
      const line = document.createElement('div');
      line.className='mline';
      line.style.cssText=`left:${sx1}px;top:${sy-0.5}px;width:${sx2-sx1}px;height:1px;`;
      measureLayer.appendChild(line);
      // badge
      const badge = document.createElement('div');
      badge.className='mbadge';
      badge.textContent = gap+'px';
      if (!isOnGrid) badge.style.background='var(--red)';
      badge.style.cssText += `left:${(sx1+sx2)/2}px;top:${sy-10}px;transform:translateX(-50%);`;
      measureLayer.appendChild(badge);
    } else {
      const sy1 = m.a*S.zoom+S.panY, sy2 = m.b*S.zoom+S.panY;
      const sx  = m.mid*S.zoom+S.panX;
      const line = document.createElement('div');
      line.className='mline';
      line.style.cssText=`left:${sx-0.5}px;top:${sy1}px;width:1px;height:${sy2-sy1}px;`;
      measureLayer.appendChild(line);
      const badge = document.createElement('div');
      badge.className='mbadge';
      badge.textContent = gap+'px';
      if (!isOnGrid) badge.style.background='var(--red)';
      badge.style.cssText += `left:${sx+4}px;top:${(sy1+sy2)/2}px;transform:translateY(-50%);`;
      measureLayer.appendChild(badge);
    }
  });
}

// ════════════════════════════════════════════════════════════
// TOOL SELECTION
// ════════════════════════════════════════════════════════════
function setTool(t) {
  S.tool = t;
  document.querySelectorAll('.tb[id^="tb-"]').forEach(b=>b.classList.remove('on'));
  const b = document.getElementById('tb-'+t);
  if (b) b.classList.add('on');
  canvasWrap.className = canvasWrap.className.replace(/\bm-\S+/g,'').trim() + ' m-'+t;
  if (t!=='select') { S.selIds = []; renderAll(); updateProps(); }
  if (S.protoMode && t!=='select') S.protoFrom = null;
  // Show frame presets when frame tool is active
  document.getElementById('frame-presets').classList.toggle('open', t==='frame');
}

// ════════════════════════════════════════════════════════════
// ELEMENT FACTORY & CRUD
// ════════════════════════════════════════════════════════════
function getEl(id) { return S.els.find(e=>e.id===id); }

function mkEl(type, x, y, w, h) {
  const id = S.nextId++;
  // fills[] is the new multi-layer fill system; el.fill is the legacy fallback
  // For frame: start with empty fills (transparent). For others: one default fill.
  let defaultFills = [];
  if (type === 'frame') {
    defaultFills = [];
  } else if (type === 'text') {
    defaultFills = [];
  } else if (type === 'line') {
    defaultFills = [mkFill('#888899')];
  } else {
    defaultFills = [mkFill()];
  }

  const el = {
    id, type, x:snapV(x), y:snapV(y), w, h,
    fills: defaultFills,       // multi-layer fills (new system)
    fill: 'transparent',       // legacy compat — computed from fills[]
    stroke: 'none',
    strokeWidth: type==='frame'?1:2,
    rx:0, opacity:100,
    text:'', fontSize:16, lineHeight:24, fontWeight:'400', textColor:'#111111',
    visible:true, locked:false,
    name: type[0].toUpperCase()+type.slice(1)+' '+id,
    page: S.page,
    parentId: null,
    collapsed: false,
  };
  // Sync legacy fill from fills[]
  syncLegacyFill(el);
  S.els.push(el);
  return el;
}

function mkFill(color) {
  return {
    id: S.nextId++,
    type: 'solid',          // 'solid' | 'linear' | 'radial'
    color: color || randomPastel(),
    opacity: 100,
    blend: 'normal',
    visible: true,
    // Gradient fields (used when type !== 'solid')
    stops: [
      {pos:0,   color: color || randomPastel(), opacity:100},
      {pos:100, color: '#ffffff', opacity:0},
    ],
    angle: 135,
  };
}

function fillToCSS(f) {
  if (!f.visible) return null;
  if (f.type === 'solid') {
    const rgb = hexToRgbArr(f.color);
    return rgb ? `rgba(${rgb},${(f.opacity/100).toFixed(2)})` : f.color;
  }
  // Build gradient CSS
  const stops = [...f.stops].sort((a,b)=>a.pos-b.pos).map(s=>{
    const rgb = hexToRgbArr(s.color);
    const col = rgb ? `rgba(${rgb},${(s.opacity/100).toFixed(2)})` : s.color;
    return `${col} ${s.pos}%`;
  }).join(', ');
  if (f.type === 'linear') return `linear-gradient(${f.angle}deg, ${stops})`;
  if (f.type === 'radial') return `radial-gradient(circle, ${stops})`;
  return 'transparent';
}

function syncLegacyFill(el) {
  // Compute a CSS background from the fills[] stack for rendering
  const vis = el.fills ? el.fills.filter(f=>f.visible) : [];
  if (!vis.length) { el.fill = 'transparent'; return; }
  // Use topmost visible fill's color as legacy fill (approximate; real rendering uses CSS)
  el.fill = vis[vis.length-1].color;
}

// Compute CSS background value from fills[] (bottom to top)
function buildFillCSS(el) {
  if (!el.fills || !el.fills.length) return 'transparent';
  const vis = el.fills.filter(f=>f.visible);
  if (!vis.length) return 'transparent';
  // Stack fills using CSS layers (first = top, last = bottom in CSS gradient syntax)
  // We'll use a single background color for simple cases, mix-blend-mode for layers
  // For multi-fill: use CSS multiple backgrounds with gradient tricks
  if (vis.length === 1) {
    const f = vis[0];
    const rgb = hexToRgbArr(f.color);
    return `rgba(${rgb},${(f.opacity/100).toFixed(2)})`;
  }
  // Multiple fills: render bottom-to-top using CSS linear-gradient stacking
  const layers = [...vis].reverse().map(f => {
    const rgb = hexToRgbArr(f.color);
    return `linear-gradient(rgba(${rgb},${(f.opacity/100).toFixed(2)}),rgba(${rgb},${(f.opacity/100).toFixed(2)}))`;
  });
  return layers.join(',');
}

function hexToRgbArr(hex) {
  hex = hex.replace('#','');
  if (hex.length===3) hex=hex.split('').map(c=>c+c).join('');
  const n=parseInt(hex,16);
  return `${(n>>16)&255},${(n>>8)&255},${n&255}`;
}

function deleteSelected() {
  if (!S.selIds.length) return;
  S.els = S.els.filter(e=>!S.selIds.includes(e.id));
  S.protoConns = S.protoConns.filter(c=>!S.selIds.includes(c.fromId)&&!S.selIds.includes(c.toId));
  S.selIds = [];
  renderAll(); updateProps(); updateProtoPanel();
}

function duplicateSelected() {
  if (!S.selIds.length) return;
  const newIds = [];
  [...S.selIds].forEach(id => {
    const el = getEl(id); if (!el) return;
    const copy = {...el, id:S.nextId++, x:el.x+16, y:el.y+16, name:el.name+' copy'};
    S.els.push(copy); newIds.push(copy.id);
  });
  S.selIds = newIds;
  renderAll(); updateProps();
}

function groupSelected() {
  const ids = [...S.selIds];
  if (ids.length < 2) { notify('Select 2+ elements to group'); return; }
  const els = ids.map(id=>getEl(id)).filter(Boolean);
  // Compute bounding box of selected elements
  const minX = Math.min(...els.map(e=>e.x));
  const minY = Math.min(...els.map(e=>e.y));
  const maxX = Math.max(...els.map(e=>e.x+e.w));
  const maxY = Math.max(...els.map(e=>e.y+e.h));
  // Create group element
  const grp = mkEl('group', minX, minY, maxX-minX, maxY-minY);
  grp.name = 'Group '+grp.id;
  // Assign children: make positions relative to group origin
  els.forEach(e => {
    e.parentId = grp.id;
    e._relX = e.x - minX; // store relative position
    e._relY = e.y - minY;
  });
  // Move group to end of array (rendered last = on top)
  S.els = S.els.filter(e=>!ids.includes(e.id) && e.id!==grp.id);
  S.els.push(grp, ...els);
  S.selIds = [grp.id];
  renderAll(); updateProps();
  notify('Grouped '+ids.length+' elements');
}

function ungroupSelected() {
  const grp = S.selIds.length===1 ? getEl(S.selIds[0]) : null;
  if (!grp || grp.type!=='group') { notify('Select a group to ungroup'); return; }
  // Release children
  const children = S.els.filter(e=>e.parentId===grp.id);
  children.forEach(e => { e.parentId = null; delete e._relX; delete e._relY; });
  // Remove group shell
  S.els = S.els.filter(e=>e.id!==grp.id);
  S.selIds = children.map(e=>e.id);
  renderAll(); updateProps();
  notify('Ungrouped');
}

// When a frame or group moves, children move with it
// CRITICAL: do NOT call snapV here — the parent's delta is already snapped.
// Re-snapping children causes compounding drift on every mousemove tick.
function moveWithParent(parentEl, dx, dy) {
  S.els.filter(e=>e.parentId===parentEl.id).forEach(child => {
    child.x += dx;
    child.y += dy;
    // Recursively move nested children (groups inside frames, etc.)
    if (child.type==='frame'||child.type==='group') moveWithParent(child, dx, dy);
  });
}

// ════════════════════════════════════════════════════════════
// RENDER ENGINE
// ════════════════════════════════════════════════════════════
function renderAll() {
  canvasEl.innerHTML = '';
  // Render order: frames first (so children appear on top and receive clicks)
  const pageEls = S.els.filter(e=>e.page===S.page&&e.visible);
  const frames = pageEls.filter(e=>e.type==='frame');
  const nonFrames = pageEls.filter(e=>e.type!=='frame');
  // Render frames first, then everything else (children render on top = receive mousedown first)
  frames.forEach(renderElement);
  nonFrames.forEach(renderElement);
  renderGrid();
  renderProtoArrows();
  renderComments();
  renderMeasure();
  updateLayers();
  updateStatus();
  if (S.coachOn) runCoach();
}

// LAYER_ICONS defined in layers panel section below

const BLEND_MODES = ['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion'];

function applyFillsToDiv(dom, el, extraStyle) {
  const visFills = (el.fills||[]).filter(f=>f.visible);
  const borderCSS = (el.stroke && el.stroke!=='none') ? `border:${el.strokeWidth||1}px solid ${el.stroke};` : '';
  const radiusCSS = extraStyle || `border-radius:${el.rx||0}px;`;
  const baseCSS = `position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;opacity:${el.opacity/100};${radiusCSS}${borderCSS}`;

  if (visFills.length === 0) {
    dom.style.cssText = baseCSS + 'background:transparent;';
    return;
  }

  // Single solid fill with normal blend = direct background
  if (visFills.length === 1 && visFills[0].blend === 'normal') {
    const bg = fillToCSS(visFills[0]);
    dom.style.cssText = baseCSS + `background:${bg||'transparent'};`;
    return;
  }

  // Multiple fills or blend modes: stacked child divs
  dom.style.cssText = baseCSS + 'background:transparent;overflow:hidden;';
  visFills.forEach(f => {
    const layer = document.createElement('div');
    const bg = fillToCSS(f);
    layer.style.cssText = `position:absolute;inset:0;background:${bg||'transparent'};mix-blend-mode:${f.blend};${radiusCSS}`;
    dom.appendChild(layer);
  });
}

function renderElement(el) {
  const isSel = S.selIds.includes(el.id);
  const isMulti = isSel && S.selIds.length > 1;
  let dom;

  if (el.type==='rect' || el.type==='frame') {
    dom = document.createElement('div');
    applyFillsToDiv(dom, el, null);
    if (el.type==='frame') {
      dom.classList.add('cel-frame');
      if (el.w > 0) {
        const lbl = document.createElement('div');
        lbl.className = 'frame-label';
        lbl.textContent = el.name;
        lbl.style.cssText = 'position:absolute;top:-18px;left:0;font-size:9px;color:var(--text3);white-space:nowrap;pointer-events:auto;cursor:pointer;padding:2px 4px;border-radius:3px;transition:color .1s;';
        lbl.addEventListener('mouseenter', () => lbl.style.color = 'var(--accent)');
        lbl.addEventListener('mouseleave', () => lbl.style.color = isSel ? 'var(--accent)' : 'var(--text3)');
        lbl.addEventListener('mousedown', ev => {
          ev.stopPropagation();
          S.selIds = [el.id]; renderAll(); updateProps();
        });
        if (isSel) lbl.style.color = 'var(--accent)';
        dom.appendChild(lbl);
      }
    }
  } else if (el.type==='group') {
    dom = document.createElement('div');
    dom.style.cssText = `position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;opacity:${el.opacity/100};`;
    if (isSel) dom.insertAdjacentHTML('beforeend','<div class="cel-group-badge">Group</div>');
  } else if (el.type==='ellipse') {
    dom = document.createElement('div');
    applyFillsToDiv(dom, el, 'border-radius:50%;');
    if (el.stroke!=='none') dom.style.border=`${el.strokeWidth}px solid ${el.stroke}`;
  } else if (el.type==='line') {
    dom = document.createElementNS('http://www.w3.org/2000/svg','svg');
    dom.style.cssText = `position:absolute;left:${el.x}px;top:${el.y}px;overflow:visible;`;
    dom.setAttribute('width', Math.abs(el.w)||2);
    dom.setAttribute('height', Math.abs(el.h)||2);
    const ln = document.createElementNS('http://www.w3.org/2000/svg','line');
    ln.setAttribute('x1',0); ln.setAttribute('y1',0);
    ln.setAttribute('x2',el.w); ln.setAttribute('y2',el.h);
    const lc = el.fills&&el.fills.length ? el.fills.find(f=>f.visible)?.color||'#888899' : '#888899';
    ln.setAttribute('stroke', lc);
    ln.setAttribute('stroke-width', el.strokeWidth||2);
    ln.setAttribute('stroke-linecap','round');
    dom.appendChild(ln);
  } else if (el.type==='text') {
    dom = document.createElement('div');
    dom.style.cssText = `position:absolute;left:${el.x}px;top:${el.y}px;min-width:${Math.max(el.w,10)}px;min-height:${Math.max(el.h,10)}px;color:${el.textColor};font-size:${el.fontSize}px;line-height:${el.lineHeight}px;font-weight:${el.fontWeight};opacity:${el.opacity/100};white-space:pre-wrap;word-break:break-word;font-family:'DM Sans',sans-serif;`;
    dom.textContent = el.text || 'Text';
    dom.addEventListener('dblclick', ev => {
      ev.stopPropagation();
      dom.contentEditable = 'true';
      dom.style.outline = 'none'; dom.style.cursor = 'text'; dom.focus();
      const rng = document.createRange(); rng.selectNodeContents(dom);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(rng);
    });
    dom.addEventListener('blur', () => {
      dom.contentEditable = 'false'; dom.style.cursor = '';
      el.text = dom.textContent; if (S.coachOn) runCoach();
    });
  } else { return; }

  dom.dataset.id = el.id;
  dom.classList.add('cel');
  if (el.locked) dom.classList.add('cel-locked');
  if (isSel && !isMulti) dom.classList.add('sel');
  if (isMulti) dom.classList.add('msel');

  if (el.type !== 'line' && el.type !== 'group' && isSel && !isMulti) {
    ['nw','n','ne','e','se','s','sw','w'].forEach(dir => {
      const h = document.createElement('div');
      h.className = `rh ${dir}`;
      h.addEventListener('mousedown', ev => { ev.stopPropagation(); startResize(ev, el.id, dir); });
      dom.appendChild(h);
    });
  }

  dom.addEventListener('mouseenter', () => { S.hoveredId=el.id; if (S.altDown) renderMeasure(); });
  dom.addEventListener('mouseleave', () => { if (S.hoveredId===el.id) { S.hoveredId=null; renderMeasure(); } });
  dom.addEventListener('mousedown', ev => {
    if (ev.target.classList.contains('rh')) return;
    if (S.tool !== 'select') return;
    if (el.locked) return;
    ev.stopPropagation();
    if (S.protoMode) { handleProtoClick(el.id); return; }

    // Frame drill-down: if clicking a frame that's already selected,
    // try to select a child under the cursor instead
    if (el.type === 'frame' && S.selIds.length === 1 && S.selIds[0] === el.id && !ev.shiftKey) {
      const pos = screenToCanvas(ev.clientX, ev.clientY);
      const children = S.els.filter(e => e.parentId === el.id && e.visible && !e.locked && e.page === S.page);
      // Find topmost child under cursor (reversed = top-rendered first)
      const hit = [...children].reverse().find(c =>
        pos.x >= c.x && pos.x <= c.x+c.w && pos.y >= c.y && pos.y <= c.y+c.h
      );
      if (hit) {
        S.selIds = [hit.id];
        renderAll(); updateProps();
        startMove(ev);
        return;
      }
    }

    if (ev.shiftKey) {
      if (S.selIds.includes(el.id)) S.selIds=S.selIds.filter(i=>i!==el.id);
      else S.selIds.push(el.id);
      renderAll(); updateProps();
    } else {
      if (!S.selIds.includes(el.id)) { S.selIds=[el.id]; renderAll(); updateProps(); }
      startMove(ev);
    }
  });

  canvasEl.appendChild(dom);
}

// ════════════════════════════════════════════════════════════
// DRAG: DRAW / MOVE / RESIZE / PAN / MARQUEE
// ════════════════════════════════════════════════════════════
let D = { mode:null, startPos:null, drawEl:null, moveStarts:null, resizeHandle:null, resizeElStart:null, panStart:null, marqStart:null };

canvasWrap.addEventListener('mousedown', ev => {
  if (ev.button!==0) return;
  const pos = screenToCanvas(ev.clientX, ev.clientY);

  if (S.tool==='grab') {
    D.mode='pan'; D.panStart={x:ev.clientX-S.panX, y:ev.clientY-S.panY};
    canvasWrap.classList.add('panning'); return;
  }
  if (S.tool==='comment') { placeComment(pos.x, pos.y); return; }

  // A click on the canvas background (not on an element) = deselect / start marquee
  // ev.target will be canvasWrap or grid-canvas or the #canvas div (now 0x0) — but NOT a .cel
  const hitEl = ev.target.closest('.cel');

  if (S.tool==='select' && !hitEl) {
    if (!S.protoMode) {
      S.selIds = [];
      D.mode='marquee'; D.marqStart={x:ev.clientX, y:ev.clientY};
      const r=canvasWrap.getBoundingClientRect();
      selBoxEl.style.cssText=`display:block;left:${ev.clientX-r.left}px;top:${ev.clientY-r.top}px;width:0;height:0;`;
    }
    renderAll(); updateProps(); return;
  }

  if (['rect','ellipse','text','line','frame'].includes(S.tool)) {
    D.mode='draw'; D.startPos=pos;
    const el = mkEl(S.tool, pos.x, pos.y, 0, 0);
    // fills[] already set by mkEl — just ensure text and frame are correct
    if (S.tool==='text') { el.text='Text'; el.w=120; el.h=30; el.fills=[]; }
    // frame: mkEl already sets fills=[] (transparent)
    S.selIds=[el.id]; D.drawEl=el;
    renderAll();
  }
});

document.addEventListener('mousemove', ev => {
  const pos = screenToCanvas(ev.clientX, ev.clientY);
  document.getElementById('st-pos').textContent = `X: ${Math.round(pos.x)}  Y: ${Math.round(pos.y)}`;

  if (D.mode==='pan') {
    S.panX=ev.clientX-D.panStart.x; S.panY=ev.clientY-D.panStart.y;
    applyTransform(); renderGrid(); return;
  }
  if (D.mode==='marquee') {
    const r=canvasWrap.getBoundingClientRect();
    const x=Math.min(ev.clientX,D.marqStart.x)-r.left, y=Math.min(ev.clientY,D.marqStart.y)-r.top;
    const w=Math.abs(ev.clientX-D.marqStart.x), h=Math.abs(ev.clientY-D.marqStart.y);
    selBoxEl.style.cssText=`display:block;left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    const cStart=screenToCanvas(D.marqStart.x,D.marqStart.y);
    const cx=Math.min(pos.x,cStart.x), cy=Math.min(pos.y,cStart.y);
    const cw=Math.abs(pos.x-cStart.x), ch=Math.abs(pos.y-cStart.y);
    S.selIds=S.els.filter(e=>e.page===S.page&&e.x<cx+cw&&e.x+e.w>cx&&e.y<cy+ch&&e.y+e.h>cy).map(e=>e.id);
    // re-render elements to update selection chrome
    canvasEl.innerHTML=''; S.els.filter(e=>e.page===S.page&&e.visible).forEach(renderElement);
    return;
  }
  if (D.mode==='draw'&&D.drawEl) {
    let dx=pos.x-D.startPos.x, dy=pos.y-D.startPos.y;
    if (ev.shiftKey&&S.tool!=='line'){const s=Math.max(Math.abs(dx),Math.abs(dy));dx=dx<0?-s:s;dy=dy<0?-s:s;}
    if (S.tool==='line'){D.drawEl.x=D.startPos.x;D.drawEl.y=D.startPos.y;D.drawEl.w=snapV(dx);D.drawEl.h=snapV(dy);}
    else{D.drawEl.x=snapV(dx<0?pos.x:D.startPos.x);D.drawEl.y=snapV(dy<0?pos.y:D.startPos.y);D.drawEl.w=snapV(Math.abs(dx));D.drawEl.h=snapV(Math.abs(dy));}
    renderAll(); return;
  }
  if (D.mode==='move'&&D.moveStarts) {
    const dx=pos.x-D.startPos.x, dy=pos.y-D.startPos.y;
    S.selIds.forEach(id=>{
      const el=getEl(id); if(!el) return;
      // Skip if this element's parent is also selected (parent will move it via moveWithParent)
      if (el.parentId && S.selIds.includes(el.parentId)) return;
      const st=D.moveStarts[id]; if(!st) return;
      const newX=snapV(st.x+dx), newY=snapV(st.y+dy);
      const ddx=newX-el.x, ddy=newY-el.y;
      el.x=newX; el.y=newY;
      // Move children if frame or group
      if ((el.type==='frame'||el.type==='group') && (ddx||ddy)) moveWithParent(el,ddx,ddy);
    });
    if (S.selIds.length===1) {
      const el=getEl(S.selIds[0]);
      if (el) {
        const {snapX,snapY}=findSnap(el);
        if (snapX){const ddx=snapX.offset; el.x+=ddx; if(el.type==='frame'||el.type==='group') moveWithParent(el,ddx,0); showSnapGuide('v',snapX.guide);}
        if (snapY){const ddy=snapY.offset; el.y+=ddy; if(el.type==='frame'||el.type==='group') moveWithParent(el,0,ddy); showSnapGuide('h',snapY.guide);}
      }
    }
    renderAll(); updateProps(); return;
  }
  if (D.mode==='resize'&&D.resizeElStart) {
    const el=getEl(S.selIds[0]); if(!el) return;
    const dx=pos.x-D.startPos.x, dy=pos.y-D.startPos.y;
    let {x,y,w,h}=D.resizeElStart, dir=D.resizeHandle;
    const origRatio = D.resizeElStart.w / (D.resizeElStart.h||1);
    if (dir.includes('e')) w=Math.max(4,snapV(w+dx));
    if (dir.includes('s')) h=Math.max(4,snapV(h+dy));
    if (dir.includes('w')){x=snapV(x+dx);w=Math.max(4,snapV(w-dx));}
    if (dir.includes('n')){y=snapV(y+dy);h=Math.max(4,snapV(h-dy));}
    // Proportion lock: use primary axis to constrain
    if (el.proportionLocked) {
      if (dir.includes('e')||dir.includes('w')) { h=Math.max(4,snapV(w/origRatio)); }
      else { w=Math.max(4,snapV(h*origRatio)); }
    }
    el.x=x;el.y=y;el.w=w;el.h=h;
    renderAll(); updateProps(); return;
  }
});

document.addEventListener('mouseup', ev => {
  if (D.mode==='pan'){canvasWrap.classList.remove('panning');}
  if (D.mode==='marquee'){selBoxEl.style.display='none'; updateProps();}
  if (D.mode==='draw'){
    if (D.drawEl&&D.drawEl.w<4&&D.drawEl.h<4&&S.tool!=='text'){D.drawEl.w=120;D.drawEl.h=80;}
    if (S.tool==='text'||S.tool==='frame') setTool('select');
    // Adopt newly drawn element into a frame if it lands inside one
    if (D.drawEl && D.drawEl.type!=='frame') {
      const el=D.drawEl;
      const cx=el.x+el.w/2, cy=el.y+el.h/2;
      const frames=S.els.filter(e=>e.page===S.page&&e.type==='frame'&&e.id!==el.id&&!e.locked);
      let best=null, bestArea=Infinity;
      frames.forEach(f=>{ if(cx>=f.x&&cx<=f.x+f.w&&cy>=f.y&&cy<=f.y+f.h){const a=f.w*f.h;if(a<bestArea){bestArea=a;best=f;}}});
      if (best) el.parentId=best.id;
    }
    D.drawEl=null; renderAll(); updateProps(); updateLayers();
    if (S.coachOn) runCoach();
  }
  if (D.mode==='move'){
    // After move: check if any moved element overlaps a frame and adopt it
    S.selIds.forEach(id => {
      const el = getEl(id);
      if (!el || el.type==='frame' || el.type==='group') return;
      // Find a frame that contains the element's center
      const cx = el.x + el.w/2, cy = el.y + el.h/2;
      const frames = S.els.filter(e=>e.page===S.page && e.type==='frame' && e.id!==id && !e.locked);
      // Find smallest containing frame (most specific)
      let bestFrame = null;
      let bestArea = Infinity;
      frames.forEach(f => {
        if (cx>=f.x && cx<=f.x+f.w && cy>=f.y && cy<=f.y+f.h) {
          const area = f.w*f.h;
          if (area < bestArea) { bestArea=area; bestFrame=f; }
        }
      });
      if (bestFrame) {
        if (el.parentId !== bestFrame.id) {
          el.parentId = bestFrame.id;
        }
      } else {
        // Moved outside any frame — detach from parent frame if it was in one
        if (el.parentId) {
          const parent = getEl(el.parentId);
          if (parent && parent.type==='frame') el.parentId = null;
        }
      }
    });
    renderAll(); updateLayers();
    if(S.coachOn) runCoach();
  }
  if (D.mode==='resize'){ if(S.coachOn) runCoach(); }
  D.mode=null;
});

function startMove(ev) {
  D.mode='move'; D.startPos=screenToCanvas(ev.clientX,ev.clientY);
  D.moveStarts={};
  S.selIds.forEach(id=>{ const el=getEl(id); if(el) D.moveStarts[id]={x:el.x,y:el.y}; });
}

function startResize(ev, id, dir) {
  D.mode='resize'; D.resizeHandle=dir;
  D.startPos=screenToCanvas(ev.clientX,ev.clientY);
  const el=getEl(id); D.resizeElStart={x:el.x,y:el.y,w:el.w,h:el.h};
  if (!S.selIds.includes(id)) S.selIds=[id];
}

canvasWrap.addEventListener('wheel', ev => {
  ev.preventDefault();
  const r=canvasWrap.getBoundingClientRect();
  const mx=ev.clientX-r.left, my=ev.clientY-r.top;
  const delta=ev.deltaY>0?0.9:1.1;
  const nz=Math.max(0.1,Math.min(4,S.zoom*delta));
  S.panX=mx-(mx-S.panX)*(nz/S.zoom); S.panY=my-(my-S.panY)*(nz/S.zoom);
  S.zoom=nz; applyTransform(); renderGrid();
},{passive:false});

// ════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ════════════════════════════════════════════════════════════
document.addEventListener('keydown', ev => {
  if (['INPUT','TEXTAREA'].includes(ev.target.tagName)||ev.target.contentEditable==='true') return;
  const k=ev.key.toLowerCase(), ctrl=ev.ctrlKey||ev.metaKey;

  // Alt for measure
  if (ev.key==='Alt'){ S.altDown=true; document.getElementById('st-alt').style.display='flex'; renderMeasure(); }

  // Tool shortcuts
  if (!ctrl){
    if (k==='v') setTool('select');
    if (k==='h') setTool('grab');
    if (k==='r') setTool('rect');
    if (k==='e') setTool('ellipse');
    if (k==='l') setTool('line');
    if (k==='t') setTool('text');
    if (k==='f') setTool('frame');
    if (k==='c') setTool('comment');
    if (k==='g') toggleGrid();
    if (k==='s') toggleSnap();
    if (k==='p') toggleProto();
    if (k==='escape'){
      // If a child is selected, go up to parent; otherwise deselect all
      if (S.selIds.length===1) {
        const el=getEl(S.selIds[0]);
        if (el && el.parentId) { S.selIds=[el.parentId]; renderAll(); updateProps(); return; }
      }
      S.selIds=[]; S.protoFrom=null; renderAll(); updateProps();
    }
    if ((k==='delete'||k==='backspace')&&S.selIds.length) deleteSelected();
  }
  // Ctrl combos
  if (ctrl&&k==='d'){ ev.preventDefault(); duplicateSelected(); }
  if (ctrl&&k==='g'&&!ev.shiftKey){ ev.preventDefault(); groupSelected(); }
  if (ctrl&&k==='g'&&ev.shiftKey){ ev.preventDefault(); ungroupSelected(); }
  if (ctrl&&k==='a'){ ev.preventDefault(); S.selIds=S.els.filter(e=>e.page===S.page).map(e=>e.id); renderAll(); updateProps(); }
  if (ctrl&&k==='z'&&!ev.shiftKey){ notify('Undo (coming soon)'); }
  if (ctrl&&k==='z'&&ev.shiftKey){ notify('Redo (coming soon)'); }

  // Zoom
  if (ev.key==='='||ev.key==='+'){ S.zoom=Math.min(4,S.zoom*1.15); applyTransform(); renderGrid(); }
  if (ev.key==='-'){ S.zoom=Math.max(.1,S.zoom/1.15); applyTransform(); renderGrid(); }
  if (k==='0') resetZoom();
  if (k==='1'){ S.zoom=1; applyTransform(); renderGrid(); }
  if (k==='2'){ S.zoom=2; applyTransform(); renderGrid(); }

  // Arrow nudge
  if (S.selIds.length&&['arrowup','arrowdown','arrowleft','arrowright'].includes(k)){
    ev.preventDefault();
    const d=ev.shiftKey?8:1;
    S.selIds.forEach(id=>{ const el=getEl(id); if(!el) return;
      if(k==='arrowup') el.y-=d; if(k==='arrowdown') el.y+=d;
      if(k==='arrowleft') el.x-=d; if(k==='arrowright') el.x+=d;
    });
    renderAll(); updateProps();
  }
});

document.addEventListener('keyup', ev => {
  if (ev.key==='Alt'){ S.altDown=false; document.getElementById('st-alt').style.display='none'; measureLayer.innerHTML=''; }
});

// ════════════════════════════════════════════════════════════
// ALIGNMENT & DISTRIBUTION
// ════════════════════════════════════════════════════════════
function alignEls(dir) {
  const els = S.selIds.map(id=>getEl(id)).filter(Boolean);
  if (!els.length) return;

  // Determine alignment reference (frame or bounding box)
  let refX, refY, refW, refH;

  if (els.length === 1) {
    // Single element: align relative to its parent frame (if any)
    const el = els[0];
    const parent = el.parentId ? getEl(el.parentId) : null;
    if (parent && parent.type === 'frame') {
      refX=parent.x; refY=parent.y; refW=parent.w; refH=parent.h;
    } else {
      notify('No parent frame — select a frame first to align within it');
      return;
    }
  } else {
    // Multiple elements: check if they share a common frame parent AND shift is held
    const parents = [...new Set(els.map(e=>e.parentId).filter(Boolean))];
    const commonFrame = parents.length===1 ? getEl(parents[0]) : null;
    if (commonFrame && commonFrame.type==='frame') {
      // Always align multiple siblings relative to their parent frame
      refX=commonFrame.x; refY=commonFrame.y; refW=commonFrame.w; refH=commonFrame.h;
    } else {
      // No shared frame: align to bounding box of selection
      refX=Math.min(...els.map(e=>e.x));
      refY=Math.min(...els.map(e=>e.y));
      const maxR=Math.max(...els.map(e=>e.x+e.w));
      const maxB=Math.max(...els.map(e=>e.y+e.h));
      refW=maxR-refX; refH=maxB-refY;
    }
  }

  const cx = refX + refW/2, cy = refY + refH/2;
  els.forEach(el => {
    if (dir==='left')    el.x = refX;
    if (dir==='right')   el.x = refX + refW - el.w;
    if (dir==='centerH') el.x = cx - el.w/2;
    if (dir==='top')     el.y = refY;
    if (dir==='bottom')  el.y = refY + refH - el.h;
    if (dir==='centerV') el.y = cy - el.h/2;
  });
  renderAll(); updateProps();
}

function distributeEls(axis) {
  const els=S.selIds.map(id=>getEl(id)).filter(Boolean);
  if (els.length<3){ notify('Select 3+ elements to distribute'); return; }
  if (axis==='h'){
    els.sort((a,b)=>a.x-b.x);
    const totalW=els.reduce((s,e)=>s+e.w,0);
    const span=(els[els.length-1].x+els[els.length-1].w)-els[0].x;
    const gap=(span-totalW)/(els.length-1);
    let cx=els[0].x; els.forEach(el=>{el.x=cx;cx+=el.w+gap;});
  } else {
    els.sort((a,b)=>a.y-b.y);
    const totalH=els.reduce((s,e)=>s+e.h,0);
    const span=(els[els.length-1].y+els[els.length-1].h)-els[0].y;
    const gap=(span-totalH)/(els.length-1);
    let cy=els[0].y; els.forEach(el=>{el.y=cy;cy+=el.h+gap;});
  }
  renderAll(); updateProps();
}

// ════════════════════════════════════════════════════════════
// UI KIT DRAG-AND-DROP
// ════════════════════════════════════════════════════════════
document.querySelectorAll('.kit-row[data-kit]').forEach(item=>{
  item.addEventListener('dragstart',ev=>{ ev.dataTransfer.setData('kit',item.dataset.kit); });
});
canvasWrap.addEventListener('dragover',ev=>ev.preventDefault());
canvasWrap.addEventListener('drop',ev=>{
  ev.preventDefault();
  const kit=ev.dataTransfer.getData('kit'); if(!kit) return;
  const pos=screenToCanvas(ev.clientX,ev.clientY);
  spawnKit(kit, snapV(pos.x), snapV(pos.y));
});

const KIT = {
  mobile:      {w:390,h:844,fill:'#fff',rx:40,name:'Mobile Frame'},
  desktop:     {w:1440,h:1024,fill:'#f5f5f5',rx:8,name:'Desktop Frame'},
  'btn-primary':{w:140,h:44,fill:'#7c6aee',rx:8,name:'Primary Button'},
  'btn-secondary':{w:140,h:44,fill:'transparent',rx:8,stroke:'#7c6aee',strokeWidth:2,name:'Secondary Button'},
  input:       {w:280,h:44,fill:'#f9f9f9',rx:8,stroke:'#d8d8e0',strokeWidth:1,name:'Input Field'},
  card:        {w:320,h:200,fill:'#fff',rx:16,name:'Card'},
  navbar:      {w:390,h:56,fill:'#fff',rx:0,name:'Navbar',stroke:'#eeeeee',strokeWidth:1},
  modal:       {w:400,h:300,fill:'#fff',rx:20,name:'Modal'},
  dashboard:   {w:1200,h:700,fill:'#f5f5f5',rx:8,name:'Dashboard'},
};

function spawnKit(kit, x, y) {
  const def=KIT[kit]; if(!def) return;
  if (kit==='btn-primary'||kit==='btn-secondary') {
    const r=mkEl('rect',x,y,def.w,def.h); Object.assign(r,{fill:def.fill,rx:def.rx,stroke:def.stroke||'none',strokeWidth:def.strokeWidth||2,name:def.name});
    const t=mkEl('text',x+14,y+12,def.w-28,20); Object.assign(t,{text:kit==='btn-primary'?'Get Started':'Learn More',fontSize:14,lineHeight:20,fontWeight:'500',textColor:kit==='btn-primary'?'#fff':'#7c6aee',name:def.name+' Label'});
    S.selIds=[r.id,t.id];
  } else if (kit==='navbar') {
    const r=mkEl('rect',x,y,def.w,def.h); Object.assign(r,{fill:def.fill,rx:0,stroke:def.stroke,strokeWidth:def.strokeWidth,name:def.name});
    const t=mkEl('text',x+20,y+18,80,20); Object.assign(t,{text:'Brand',fontSize:15,fontWeight:'600',textColor:'#1a1a2e',lineHeight:20,name:'Nav Brand'});
    S.selIds=[r.id,t.id];
  } else if (kit==='modal') {
    const ov=mkEl('rect',x-60,y-40,def.w+120,def.h+80); Object.assign(ov,{fill:'rgba(0,0,0,0.45)',rx:0,name:'Overlay'});
    const r=mkEl('rect',x,y,def.w,def.h); Object.assign(r,{fill:'#fff',rx:20,name:'Modal Container'});
    const t=mkEl('text',x+28,y+28,def.w-56,32); Object.assign(t,{text:'Modal Title',fontSize:22,lineHeight:32,fontWeight:'600',textColor:'#1a1a2e',name:'Modal Title'});
    S.selIds=[ov.id,r.id,t.id];
  } else if (kit==='dashboard') {
    const bg=mkEl('rect',x,y,def.w,def.h); Object.assign(bg,{fill:'#f0f0f5',rx:8,name:'Dashboard BG'});
    const sb=mkEl('rect',x,y,240,def.h); Object.assign(sb,{fill:'#1a1a2e',rx:8,name:'Sidebar'});
    const ct=mkEl('rect',x+252,y+16,def.w-268,def.h-32); Object.assign(ct,{fill:'#fff',rx:10,name:'Content'});
    S.selIds=[bg.id,sb.id,ct.id];
  } else {
    const el=mkEl('rect',x,y,def.w,def.h); Object.assign(el,{fill:def.fill,rx:def.rx||0,name:def.name});
    if (def.stroke){el.stroke=def.stroke;el.strokeWidth=def.strokeWidth;}
    S.selIds=[el.id];
  }
  renderAll(); updateProps(); notify(def.name+' added');
}

// ════════════════════════════════════════════════════════════
// FRAME PRESETS
// ════════════════════════════════════════════════════════════
const FRAME_PRESETS = {
  'phone-sm':    {w:375,  h:667,  name:'iPhone SE'},
  'phone':       {w:390,  h:844,  name:'iPhone 15'},
  'phone-xl':    {w:430,  h:932,  name:'iPhone Pro Max'},
  'tablet':      {w:768,  h:1024, name:'iPad'},
  'tablet-pro':  {w:1024, h:1366, name:'iPad Pro'},
  'desktop':     {w:1440, h:1024, name:'Desktop'},
  'macbook':     {w:1280, h:832,  name:'MacBook'},
  'fhd':         {w:1920, h:1080, name:'Full HD'},
  'social-sq':   {w:1080, h:1080, name:'Social Square'},
  'social-story':{w:1080, h:1920, name:'Story'},
  'thumb':       {w:1280, h:720,  name:'YT Thumbnail'},
  'a4':          {w:794,  h:1123, name:'A4'},
};

function spawnFramePreset(key) {
  const def = FRAME_PRESETS[key]; if (!def) return;
  // Place in center of visible canvas
  const cw = canvasWrap.offsetWidth, ch = canvasWrap.offsetHeight;
  const cx = (cw/2 - S.panX) / S.zoom;
  const cy = (ch/2 - S.panY) / S.zoom;
  const el = mkEl('frame', cx - def.w/2, cy - def.h/2, def.w, def.h);
  el.name = def.name;
  S.selIds = [el.id];
  setTool('select'); // switch back to select after placing
  renderAll(); updateProps(); updateLayers();
  notify(`${def.name} frame created (${def.w}×${def.h})`);
}

// ════════════════════════════════════════════════════════════
// TYPOGRAPHY PRESETS — correctly updates state + re-renders
// ════════════════════════════════════════════════════════════
const TYPO = [
  {label:'H1',  fontSize:32, lineHeight:40, fontWeight:'600'},
  {label:'H2',  fontSize:24, lineHeight:32, fontWeight:'600'},
  {label:'Body',fontSize:16, lineHeight:24, fontWeight:'400'},
  {label:'Caption',fontSize:12, lineHeight:16, fontWeight:'400'},
  {label:'Button',fontSize:14, lineHeight:20, fontWeight:'500'},
];

function applyTypo(preset) {
  // Works on all selected text elements; falls back to any selected element
  const textEls = S.selIds.map(id=>getEl(id)).filter(e=>e&&e.type==='text');
  if (!textEls.length) { notify('Select a text element first'); return; }
  textEls.forEach(el => {
    // Directly mutate the STATE object — not the DOM
    el.fontSize    = preset.fontSize;
    el.lineHeight  = preset.lineHeight;
    el.fontWeight  = preset.fontWeight;
  });
  // Full re-render so DOM reflects updated state
  renderAll();
  updateProps();     // refresh inspector to show new values
  if (S.coachOn) runCoach();
  notify(`Applied ${preset.label}`);
}

// ════════════════════════════════════════════════════════════
// COLOR STYLES
// ════════════════════════════════════════════════════════════
function renderColorStyles() {
  const list = document.getElementById('color-styles-list');
  list.innerHTML='';
  Object.entries(S.colorStyles).forEach(([key,cs])=>{
    const row=document.createElement('div'); row.className='cs-row';
    row.innerHTML=`<div class="cs-dot" style="background:${cs.hex}"><input type="color" value="${cs.hex}" oninput="updateCS('${key}',this.value)"></div><span class="cs-label">${cs.label}</span><span class="cs-hex">${cs.hex}</span><button class="cs-apply-btn" onclick="applyCS('${key}')" title="Apply to selection">▶</button>`;
    list.appendChild(row);
  });
}

function updateCS(key, hex) { S.colorStyles[key].hex=hex; renderColorStyles(); }

function applyCS(key) {
  const hex=S.colorStyles[key].hex;
  const els=S.selIds.map(id=>getEl(id)).filter(Boolean);
  if (!els.length){notify('Select an element first'); return;}
  els.forEach(el=>{ el.type==='text'?el.textColor=hex:el.fill=hex; });
  renderAll(); updateProps(); notify('Applied '+S.colorStyles[key].label);
}

// ════════════════════════════════════════════════════════════
// PROTOTYPE MODE
// ════════════════════════════════════════════════════════════
function toggleProto() {
  S.protoMode=!S.protoMode;
  // Sync mode tabs (no separate btn-proto button anymore)
  document.querySelectorAll('.mode-tab').forEach(t=>t.classList.remove('on'));
  document.getElementById(S.protoMode?'mode-proto':'mode-design')?.classList.add('on');
  S.protoFrom=null;
  notify(S.protoMode?'Prototype ON — click source, then target':'Prototype OFF');
  renderAll();
}

function handleProtoClick(id) {
  if (!S.protoFrom){ S.protoFrom=id; S.selIds=[id]; notify('Now click the target element'); renderAll(); return; }
  if (S.protoFrom===id){ S.protoFrom=null; return; }
  const exists=S.protoConns.find(c=>c.fromId===S.protoFrom&&c.toId===id);
  if (!exists){ S.protoConns.push({id:S.nextId++,fromId:S.protoFrom,toId:id}); notify('Connection created'); }
  S.protoFrom=null; S.selIds=[];
  renderAll(); updateProtoPanel();
}

function renderProtoArrows() {
  const layer=document.getElementById('proto-layer'); layer.innerHTML='';
  if (!S.protoMode) return;
  S.protoConns.forEach(c=>{
    const fr=getEl(c.fromId), to=getEl(c.toId); if(!fr||!to) return;
    const fx=(fr.x+fr.w/2)*S.zoom+S.panX, fy=(fr.y+fr.h)*S.zoom+S.panY;
    const tx=(to.x+to.w/2)*S.zoom+S.panX, ty=(to.y)*S.zoom+S.panY;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.style.cssText='position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;';
    const defs=document.createElementNS('http://www.w3.org/2000/svg','defs');
    defs.innerHTML=`<marker id="arr${c.id}" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#7c6aee"/></marker>`;
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',`M${fx},${fy} C${fx},${fy+60} ${tx},${ty-60} ${tx},${ty}`);
    path.setAttribute('fill','none'); path.setAttribute('stroke','#7c6aee');
    path.setAttribute('stroke-width','1.5'); path.setAttribute('stroke-dasharray','6 4');
    path.setAttribute('marker-end',`url(#arr${c.id})`);
    svg.appendChild(defs); svg.appendChild(path); layer.appendChild(svg);
  });
}

function updateProtoPanel() {
  const list=document.getElementById('proto-connections-list');
  const empty=document.getElementById('proto-empty');
  list.innerHTML='';
  if (!S.protoConns.length){empty.style.display='block';return;}
  empty.style.display='none';
  S.protoConns.forEach(c=>{
    const fr=getEl(c.fromId),to=getEl(c.toId); if(!fr||!to) return;
    const row=document.createElement('div'); row.className='pc-row';
    row.innerHTML=`<svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="none" stroke="var(--accent)" stroke-width="1.2"/></svg>${fr.name} → ${to.name}<button class="pc-del" onclick="deleteProto(${c.id})">×</button>`;
    list.appendChild(row);
  });
}

function deleteProto(id){ S.protoConns=S.protoConns.filter(c=>c.id!==id); renderAll(); updateProtoPanel(); }

// ════════════════════════════════════════════════════════════
// COMMENTS — full system: pin, reply, resolve, delete, toggle
// ════════════════════════════════════════════════════════════
function placeComment(x, y) {
  const text = prompt('Add a comment:'); if (!text) return;
  S.comments.push({id:S.nextId++, x, y, text, replies:[], resolved:false, page:S.page});
  renderComments(); setTool('select');
}

function renderComments() {
  commentLayer.innerHTML='';
  if (!S.commentsVisible) return;
  S.comments.filter(c=>c.page===S.page).forEach((c,idx)=>{
    const pin=document.createElement('div'); pin.className='cpin'; pin.dataset.cid=c.id;
    const sx=c.x*S.zoom+S.panX, sy=c.y*S.zoom+S.panY;
    pin.style.cssText=`left:${sx}px;top:${sy}px;`;

    // Replies HTML
    const repliesHTML = c.replies.map(r=>`
      <div class="cb-reply"><span class="cb-reply-author">Reply · </span>${escHtml(r)}</div>
    `).join('');

    pin.innerHTML=`
      <div class="cpin-marker${c.resolved?' resolved':''}" onclick="toggleCommentBubble(${c.id})">
        <span class="cpin-num">${idx+1}</span>
      </div>
      <div class="cbubble">
        <div class="cb-head">
          <span class="cb-author">Comment #${idx+1}</span>
          ${c.resolved?`<span class="cb-resolved-badge">✓ Resolved</span>`:`<button class="cb-resolve" onclick="resolveComment(${c.id})">Resolve</button>`}
          <button class="cb-del" onclick="deleteComment(${c.id})">×</button>
        </div>
        <div class="cb-body">
          <div class="cb-text">${escHtml(c.text)}</div>
          ${c.replies.length?`<div class="cb-replies">${repliesHTML}</div>`:''}
        </div>
        <div class="cb-input-row">
          <input class="cb-input" placeholder="Reply…" data-cid="${c.id}"
            onkeydown="if(event.key==='Enter'&&this.value.trim()){replyComment(${c.id},this.value.trim());this.value='';}">
        </div>
      </div>
    `;
    commentLayer.appendChild(pin);
  });
}

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function startInspectorRename(span, elId) {
  const el = getEl(elId); if (!el) return;
  const original = el.name;
  const input = document.createElement('input');
  input.className = 'lyr-rename-input';
  input.style.cssText='font-size:11px;font-weight:600;width:100%;';
  input.value = original;
  span.replaceWith(input);
  input.focus(); input.select();
  const commit = () => {
    el.name = input.value.trim() || original;
    span.textContent = el.name;
    input.replaceWith(span);
    updateLayers(); // sync layer panel
  };
  input.addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.key==='Enter'){ ev.preventDefault(); commit(); }
    if (ev.key==='Escape'){ input.value=original; commit(); }
  });
  input.addEventListener('blur', commit);
}

function toggleCommentBubble(id) {
  const pin = commentLayer.querySelector(`.cpin[data-cid="${id}"]`);
  if (pin) pin.classList.toggle('open');
}

function replyComment(id, text) {
  const c=S.comments.find(c=>c.id===id); if(c){ c.replies.push(text); renderComments(); }
}

function resolveComment(id) {
  const c=S.comments.find(c=>c.id===id); if(c){ c.resolved=true; renderComments(); }
}

function deleteComment(id) {
  S.comments=S.comments.filter(c=>c.id!==id); renderComments();
}

function toggleCommentVis() {
  S.commentsVisible=!S.commentsVisible;
  renderComments();
  notify(S.commentsVisible?'Comments visible':'Comments hidden');
}

// ════════════════════════════════════════════════════════════
// UX COACH — checks + scoring
// ════════════════════════════════════════════════════════════
function toggleCoach() {
  S.coachOn=!S.coachOn;
  document.getElementById('btn-coach').classList.toggle('on',S.coachOn);
  if (S.coachOn){openCoach();runCoach();}
  else{closeCoach();setScore(null);}
}
function openCoach(){ document.getElementById('coach-panel').classList.add('open'); if(S.coachOn) runCoach(); }
function closeCoach(){ document.getElementById('coach-panel').classList.remove('open'); }

function hexToRgb(hex){
  hex=hex.replace('#',''); if(hex.length===3) hex=hex.split('').map(c=>c+c).join('');
  const n=parseInt(hex,16); return{r:(n>>16)&255,g:(n>>8)&255,b:n&255};
}
function lum({r,g,b}){
  const s=[r,g,b].map(c=>{c/=255;return c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4);});
  return .2126*s[0]+.7152*s[1]+.0722*s[2];
}
function contrast(h1,h2){
  try{const l1=lum(hexToRgb(h1)),l2=lum(hexToRgb(h2));const[hi,lo]=l1>l2?[l1,l2]:[l2,l1];return(hi+.055)/(lo+.055);}catch{return 21;}
}

const VAGUE=['submit','click here','continue','ok','yes','no','button'];

function runCoach() {
  const pageEls=S.els.filter(e=>e.page===S.page&&e.visible);
  const issues=[]; let score=100;

  pageEls.forEach(el=>{
    if (el.type==='text') {
      // Contrast (if fill is set, compare; otherwise compare text to white)
      if (el.fill&&el.fill!=='transparent'){
        const cr=contrast(el.textColor,el.fill);
        if(cr<4.5){issues.push({t:'error',icon:'⚠️',rule:'Low Contrast',desc:`"${el.name}": ${cr.toFixed(1)}:1 — WCAG AA requires 4.5:1`});score-=15;}
      }
      // Vague labels
      const txt=(el.text||'').toLowerCase().trim();
      if(VAGUE.includes(txt)){issues.push({t:'warn',icon:'✏️',rule:'Vague Label',desc:`"${el.text}" is generic. Try "Create Account" or "Save Changes".`});score-=10;}
      // Small text
      if(el.fontSize<14){issues.push({t:'warn',icon:'🔍',rule:'Text Too Small',desc:`"${el.name}": ${el.fontSize}px. Body text should be ≥14px.`});score-=8;}
    }
    // Tap target
    if((el.type==='rect'||el.type==='ellipse')&&el.h<44){
      issues.push({t:'warn',icon:'👆',rule:'Small Tap Target',desc:`"${el.name}": ${Math.round(el.h)}px — min recommended is 44px.`});score-=8;
    }
  });

  const offGrid=pageEls.filter(e=>e.x%8!==0||e.y%8!==0);
  if(offGrid.length){issues.push({t:'warn',icon:'📐',rule:'Off-Grid Elements',desc:`${offGrid.length} element(s) not on 8pt grid. Enable Snap (S) to fix.`});score-=Math.min(15,offGrid.length*5);}

  if(!issues.length) issues.push({t:'ok',icon:'✅',rule:'Looking great!',desc:'No UX issues found on this page.'});

  score=Math.max(0,Math.min(100,score));
  setScore(score);

  document.getElementById('coach-body').innerHTML=issues.map(i=>`
    <div class="ci ${i.t}"><div class="ci-icon">${i.icon}</div><div><div class="ci-rule">${i.rule}</div><div class="ci-desc">${i.desc}</div></div></div>
  `).join('');
}

function setScore(s) {
  const v=document.getElementById('score-val'), t=document.getElementById('coach-score-txt');
  if(s===null){v.textContent='—';v.style.color='var(--text3)';t.textContent='';return;}
  const col=s>=80?'var(--green)':s>=60?'var(--yellow)':'var(--red)';
  v.textContent=s; v.style.color=col; t.textContent=`${s}/100`; t.style.color=col;
}

// ════════════════════════════════════════════════════════════
// INSPECTOR / PROPS PANEL
// ════════════════════════════════════════════════════════════
function updateProps() {
  const content = document.getElementById('design-content');
  const insp    = document.getElementById('insp-header');
  const inspTitle = document.getElementById('insp-title');
  const inspType  = document.getElementById('insp-type');

  const els = S.selIds.map(id=>getEl(id)).filter(Boolean);

  if (!els.length) {
    insp.style.display = 'none';
    content.innerHTML  = `<div id="no-sel"><svg width="30" height="30" viewBox="0 0 30 30" fill="none" style="margin:0 auto 10px;display:block;opacity:.2"><rect x="3" y="3" width="24" height="24" rx="3" stroke="#9090a8" stroke-width="1.5" stroke-dasharray="4 3"/></svg>Select an element<br>to see its properties</div>`;
    return;
  }

  const el    = els[0];
  const multi = els.length > 1;

  // Inspector header — shows element name (dbl-click to rename)
  insp.style.display = 'block';
  const displayName = multi ? `${els.length} elements selected` : escHtml(el.name);
  const displayType = multi ? '' : el.type.toUpperCase();
  inspTitle.innerHTML = multi
    ? `<span>${displayName}</span>`
    : `<span style="cursor:text;" title="Double-click to rename" ondblclick="startInspectorRename(this,${el.id})">${displayName}</span>`;
  inspType.textContent = displayType;

  // Build property sections
  const sections = [];

  // Position & Size (single select only)
  if (!multi) {
    const ratio = el.w && el.h ? (el.w/el.h).toFixed(4) : '1';
    const locked = el.proportionLocked || false;
    sections.push(`
      <div class="psec">
        <div class="psec-title">Frame</div>
        <div class="pgrid2">
          <div class="prow"><span class="plbl">X</span><input class="pinp" type="number" value="${Math.round(el.x)}" onchange="SP('x',snapV(+this.value))"></div>
          <div class="prow"><span class="plbl">Y</span><input class="pinp" type="number" value="${Math.round(el.y)}" onchange="SP('y',snapV(+this.value))"></div>
          <div class="prow">
            <span class="plbl">W</span>
            <input class="pinp" type="number" value="${Math.round(el.w)}" onchange="SPW(${el.id},+this.value)">
          </div>
          <div class="prow">
            <span class="plbl">H</span>
            <input class="pinp" type="number" value="${Math.round(el.h)}" onchange="SPH(${el.id},+this.value)">
          </div>
        </div>
        <div class="prow" style="margin-top:4px;justify-content:space-between;">
          <button
            id="lock-prop-btn"
            onclick="toggleProportionLock(${el.id})"
            style="display:flex;align-items:center;gap:5px;background:${locked?'var(--accent-soft)':'var(--surface2)'};border:1px solid ${locked?'var(--accent)':'var(--border)'};border-radius:5px;padding:3px 9px;font-size:10px;color:${locked?'var(--accent)':'var(--text3)'};">
            ${locked?'🔗':'⛓️'} Lock Proportions
          </button>
        </div>
        ${(el.type==='rect'||el.type==='frame')?`<div class="prow" style="margin-top:5px;"><span class="plbl-text" style="margin-right:6px;">Radius</span><input class="pinp" type="number" min="0" value="${el.rx}" onchange="SP('rx',+this.value)"></div>`:''}
        ${el.type==='frame'?`<div style="margin-top:8px;font-size:10px;color:var(--text3);">Frame — children move with frame</div>`:''}
        ${el.type==='group'?`<div style="margin-top:6px;display:flex;gap:5px;"><button class="btn btn-ghost" style="flex:1;font-size:10px;" onclick="ungroupSelected()">Ungroup ⇧⌘G</button></div>`:''}
      </div>
    `);
  }

  // ── Fill Layers (all element types except text which uses textColor) ──
  if (el.type !== 'text') {
    const fills = el.fills || [];
    const fillRowsHTML = fills.map((f,i) => {
      const isGrad = f.type==='linear'||f.type==='radial';

      // Swatch preview
      let swatchStyle;
      if (isGrad) {
        swatchStyle = `background:${buildGradientCSS(f,'to right')};`;
      } else {
        swatchStyle = `background:${f.color};`;
      }

      // Gradient stop editor
      let gradHTML = '';
      if (isGrad) {
        const barCSS = buildGradientCSS(f, 'to right');
        const stopsHTML = f.stops.map((s,si)=>
          `<div class="gradient-stop" data-stop="${si}"
            style="left:${s.pos}%;background:${s.color};"
            onclick="selectGradStop(event,${el.id},${i},${si})"
            title="Stop ${si+1}: ${s.pos}%"></div>`
        ).join('');

        const activeStop = f._activeStop ?? 0;
        const as = f.stops[activeStop]||f.stops[0];
        gradHTML = `
          <div class="gradient-editor">
            <div class="gradient-bar-wrap" data-fill="${i}"
              onclick="gradBarClick(event,${el.id},${i})"
              ondblclick="addGradientStop(${el.id},${i},Math.round((event.offsetX/this.offsetWidth)*100))">
              <div class="gradient-bar" style="background:${barCSS};"></div>
              ${stopsHTML}
            </div>
            <div class="gradient-stop-controls">
              <div class="fill-swatch" style="${`background:${as.color};`}width:18px;height:18px;flex-shrink:0;">
                <input type="color" value="${as.color}" oninput="setGradientStopColor(${el.id},${i},${activeStop},this.value)">
              </div>
              <input class="fill-hex" style="width:68px;" value="${as.color}" oninput="setGradientStopColor(${el.id},${i},${activeStop},this.value)" maxlength="7">
              <input class="fill-opacity" type="number" min="0" max="100" value="${as.opacity}" title="Stop opacity" oninput="setGradientStopOpacity(${el.id},${i},${activeStop},+this.value)">
              <span style="font-size:9px;color:var(--text3);">%</span>
              <input class="grad-angle-input" type="number" value="${as.pos}" min="0" max="100" title="Stop position %" oninput="setGradientStopPos(${el.id},${i},${activeStop},+this.value)">
              <span style="font-size:9px;color:var(--text3);">%</span>
              <button class="fill-del" onclick="deleteGradientStop(${el.id},${i},${activeStop})" title="Delete stop">−</button>
            </div>
            ${f.type==='linear'?`<div class="grad-angle-row">
              <span style="font-size:9px;color:var(--text3);">Angle</span>
              <input class="grad-angle-input" type="number" value="${f.angle}" min="0" max="360" oninput="setGradientAngle(${el.id},${i},+this.value)">
              <span style="font-size:9px;color:var(--text3);">°</span>
            </div>`:''}
          </div>`;
      }

      return `
      <div class="fill-layer-row" data-fill-idx="${i}">
        <span class="fill-drag-handle">⠿</span>
        <button class="fill-layer-vis ${f.visible?'':'hidden'}" onclick="toggleFillVis(${el.id},${i})">${f.visible?'●':'○'}</button>
        <div class="fill-swatch" style="${swatchStyle}" title="Color">
          ${!isGrad?`<input type="color" value="${f.color}" oninput="setFillColor(${el.id},${i},this.value)">`:''}
        </div>
        <div class="fill-type-row" style="flex:1;margin:0 4px;">
          <button class="fill-type-btn${f.type==='solid'?' on':''}" onclick="setFillType(${el.id},${i},'solid')">Solid</button>
          <button class="fill-type-btn${f.type==='linear'?' on':''}" onclick="setFillType(${el.id},${i},'linear')">Linear</button>
          <button class="fill-type-btn${f.type==='radial'?' on':''}" onclick="setFillType(${el.id},${i},'radial')">Radial</button>
        </div>
        <select class="fill-blend" onchange="setFillBlend(${el.id},${i},this.value)">
          ${BLEND_MODES.map(m=>`<option value="${m}"${f.blend===m?' selected':''}>${m.charAt(0).toUpperCase()+m.slice(1)}</option>`).join('')}
        </select>
        <button class="fill-del" onclick="deleteFill(${el.id},${i})">−</button>
      </div>
      ${!isGrad?`
      <div style="padding:0 6px 6px 6px;display:flex;align-items:center;gap:5px;">
        <input class="fill-hex" value="${f.color}" oninput="setFillColor(${el.id},${i},this.value)" maxlength="7" style="flex:1;">
        <input class="fill-opacity" type="number" min="0" max="100" value="${f.opacity}" oninput="setFillOpacity(${el.id},${i},+this.value)" style="width:38px;">
        <span style="font-size:9px;color:var(--text3);">%</span>
      </div>`:gradHTML}
      `;
    }).join('');

    sections.push(`
      <div class="psec">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;">
          <span class="psec-title" style="margin-bottom:0;">Fill</span>
          <button onclick="addFill(${el.id})" style="background:none;border:none;color:var(--accent);font-size:16px;line-height:1;padding:0 2px;cursor:pointer;">+</button>
        </div>
        <div class="fill-layer-list" id="fill-list-${el.id}">${fillRowsHTML}</div>
        ${fills.length===0?`<button class="fill-add-btn" onclick="addFill(${el.id})">+ Add Fill</button>`:''}
      </div>
    `);
  }

  // Element opacity (always shown)
  sections.push(`
    <div class="psec">
      <div class="psec-title">Layer</div>
      <div class="prow">
        <span class="plbl-text" style="margin-right:6px;">Opacity</span>
        <input class="pinp" type="number" value="${el.opacity}" min="0" max="100" oninput="SPM('opacity',+this.value)">
        <span style="font-size:10px;color:var(--text3);margin-left:3px;">%</span>
      </div>
    </div>
  `);

  // Stroke (single)
  if (!multi) {
    sections.push(`
      <div class="psec">
        <div class="psec-title">Stroke</div>
        <div class="prow">
          <div class="csw" style="background:${el.stroke==='none'?'transparent':el.stroke}">
            <input type="color" value="${el.stroke==='none'?'#000000':el.stroke}" oninput="SP('stroke',this.value)">
          </div>
          <input class="pinp" value="${el.stroke}" oninput="SP('stroke',this.value)" placeholder="none">
          <input class="pinp" type="number" value="${el.strokeWidth}" min="0" style="width:40px;flex:0 0 40px;" oninput="SP('strokeWidth',+this.value)">
        </div>
      </div>
    `);
  }

  // Typography (text only)
  if (el.type==='text') {
    const curPreset = TYPO.find(p=>p.fontSize===el.fontSize&&p.lineHeight===el.lineHeight&&p.fontWeight===el.fontWeight);
    sections.push(`
      <div class="psec">
        <div class="psec-title">Typography</div>
        <div class="pgrid2" style="margin-bottom:6px;">
          <div class="prow"><span class="plbl-text" style="margin-right:4px;">Size</span><input class="pinp" type="number" value="${el.fontSize}" onchange="SP('fontSize',+this.value);if(S.coachOn)runCoach()"></div>
          <div class="prow"><span class="plbl-text" style="margin-right:4px;">LH</span><input class="pinp" type="number" value="${el.lineHeight}" onchange="SP('lineHeight',+this.value)"></div>
        </div>
        <div class="prow" style="margin-bottom:8px;">
          <div class="csw" style="background:${el.textColor}"><input type="color" value="${el.textColor}" oninput="SP('textColor',this.value)"></div>
          <input class="pinp" value="${el.textColor}" oninput="SP('textColor',this.value)">
        </div>
        <div class="psec-title" style="margin-bottom:4px;">Text Styles</div>
        ${TYPO.map(p=>`
          <div class="tp-item${curPreset&&curPreset.label===p.label?' on':''}">
            <span class="tp-name">${p.label}</span>
            <span class="tp-info">${p.fontSize}/${p.lineHeight} ${p.fontWeight}</span>
            <button class="tp-btn" onclick="applyTypo(${JSON.stringify(p).replace(/"/g,'&quot;')})">Apply</button>
          </div>
        `).join('')}
      </div>
    `);
  }

  // Actions
  sections.push(`
    <div class="psec">
      <div style="display:flex;gap:5px;">
        <button class="btn btn-ghost" style="flex:1;font-size:11px;" onclick="duplicateSelected()">Duplicate</button>
        <button class="btn" style="flex:1;font-size:11px;background:var(--red-bg);color:var(--red);border:1px solid rgba(224,85,85,.25)" onclick="deleteSelected()">Delete</button>
      </div>
    </div>
  `);

  content.innerHTML = sections.join('');
}

// Prop setter helpers — call renderAll to rebuild DOM from state
function SP(key, val) {
  const el=getEl(S.selIds[0]); if(el){el[key]=val; renderAll();}
}
function SPM(key, val) {
  S.selIds.forEach(id=>{const el=getEl(id);if(el)el[key]=val;});
  renderAll();
}

// Width/height with proportion lock
function SPW(elId, val) {
  const el=getEl(elId); if(!el) return;
  if (el.proportionLocked && el.h) {
    const ratio = el.w/el.h;
    el.w = snapV(val);
    el.h = snapV(val/ratio);
  } else { el.w = snapV(val); }
  renderAll();
}
function SPH(elId, val) {
  const el=getEl(elId); if(!el) return;
  if (el.proportionLocked && el.w) {
    const ratio = el.w/el.h;
    el.h = snapV(val);
    el.w = snapV(val*ratio);
  } else { el.h = snapV(val); }
  renderAll();
}
function toggleProportionLock(elId) {
  const el=getEl(elId); if(!el) return;
  el.proportionLocked = !el.proportionLocked;
  renderAll(); updateProps();
}

// ── Fill layer mutation helpers ──
function addFill(elId) {
  const el = getEl(elId); if (!el) return;
  if (!el.fills) el.fills = [];
  el.fills.push(mkFill());
  syncLegacyFill(el);
  renderAll(); updateProps();
}

function deleteFill(elId, idx) {
  const el = getEl(elId); if (!el||!el.fills) return;
  el.fills.splice(idx, 1);
  syncLegacyFill(el);
  renderAll(); updateProps();
}

function toggleFillVis(elId, idx) {
  const el = getEl(elId); if (!el||!el.fills) return;
  el.fills[idx].visible = !el.fills[idx].visible;
  syncLegacyFill(el);
  renderAll(); updateProps();
}

function setFillColor(elId, idx, color) {
  const el = getEl(elId); if (!el||!el.fills) return;
  // Normalize color value
  if (color && color.length >= 4) {
    el.fills[idx].color = color;
    syncLegacyFill(el);
    renderAll();
    // Don't rebuild full props panel on color input (too slow) — just update swatch
    const swatch = document.querySelector(`[data-fill-idx="${idx}"] .fill-swatch`);
    if (swatch) swatch.style.background = color;
  }
}

function setFillOpacity(elId, idx, val) {
  const el = getEl(elId); if (!el||!el.fills) return;
  el.fills[idx].opacity = Math.max(0,Math.min(100,val));
  syncLegacyFill(el);
  renderAll();
}

function setFillBlend(elId, idx, blend) {
  const el = getEl(elId); if (!el||!el.fills) return;
  el.fills[idx].blend = blend;
  renderAll();
}

function setFillType(elId, idx, type) {
  const el = getEl(elId); if (!el||!el.fills) return;
  el.fills[idx].type = type;
  syncLegacyFill(el);
  renderAll(); updateProps();
}

function setGradientAngle(elId, idx, angle) {
  const el = getEl(elId); if (!el||!el.fills) return;
  el.fills[idx].angle = +angle;
  renderAll();
}

function setGradientStopColor(elId, fillIdx, stopIdx, color) {
  const el = getEl(elId); if (!el||!el.fills) return;
  if (!el.fills[fillIdx].stops) return;
  el.fills[fillIdx].stops[stopIdx].color = color;
  renderAll();
  // Update gradient bar preview
  updateGradientBarPreview(elId, fillIdx);
}

function setGradientStopOpacity(elId, fillIdx, stopIdx, val) {
  const el = getEl(elId); if (!el||!el.fills) return;
  el.fills[fillIdx].stops[stopIdx].opacity = Math.max(0,Math.min(100,+val));
  renderAll();
  updateGradientBarPreview(elId, fillIdx);
}

function setGradientStopPos(elId, fillIdx, stopIdx, pos) {
  const el = getEl(elId); if (!el||!el.fills) return;
  el.fills[fillIdx].stops[stopIdx].pos = Math.max(0,Math.min(100,+pos));
  renderAll();
  updateGradientBarPreview(elId, fillIdx);
}

function addGradientStop(elId, fillIdx, pos) {
  const el = getEl(elId); if (!el||!el.fills) return;
  const f = el.fills[fillIdx]; if (!f) return;
  // Interpolate color at pos
  const sorted = [...f.stops].sort((a,b)=>a.pos-b.pos);
  const newStop = {pos: Math.round(pos), color: randomPastel(), opacity: 100};
  f.stops.push(newStop);
  renderAll(); updateProps();
}

function deleteGradientStop(elId, fillIdx, stopIdx) {
  const el = getEl(elId); if (!el||!el.fills) return;
  const f = el.fills[fillIdx];
  if (!f||f.stops.length<=2) { notify('Need at least 2 stops'); return; }
  f.stops.splice(stopIdx,1);
  renderAll(); updateProps();
}

function updateGradientBarPreview(elId, fillIdx) {
  const el = getEl(elId); if (!el||!el.fills) return;
  const f = el.fills[fillIdx]; if (!f) return;
  const bar = document.querySelector(`[data-fill-idx="${fillIdx}"] .gradient-bar`);
  if (bar) bar.style.background = buildGradientCSS(f, 'to right');
}

function buildGradientCSS(f, direction) {
  const stops = [...f.stops].sort((a,b)=>a.pos-b.pos).map(s=>{
    const rgb = hexToRgbArr(s.color);
    return (rgb?`rgba(${rgb},${(s.opacity/100).toFixed(2)})`:s.color)+` ${s.pos}%`;
  }).join(', ');
  return `linear-gradient(${direction||f.angle+'deg'}, ${stops})`;
}

function selectGradStop(ev, elId, fillIdx, stopIdx) {
  ev.stopPropagation();
  const el = getEl(elId); if (!el||!el.fills) return;
  el.fills[fillIdx]._activeStop = stopIdx;
  // Highlight active stop visually
  document.querySelectorAll(`[data-fill-idx="${fillIdx}"] .gradient-stop`).forEach((s,i)=>{
    s.classList.toggle('active', i===stopIdx);
  });
  updateProps();
}

function gradBarClick(ev, elId, fillIdx) {
  // Single click just sets active stop if near one; double-click (handled separately) adds
  ev.stopPropagation();
}

// ── Mode switching (Design / Prototype / Comment) ──
function switchMode(mode) {
  document.querySelectorAll('.mode-tab').forEach(t=>t.classList.remove('on'));
  document.getElementById('mode-'+mode)?.classList.add('on');
  if (mode==='proto') {
    if (!S.protoMode) toggleProto();
  } else {
    if (S.protoMode) toggleProto();
  }
  if (mode==='comment') setTool('comment');
  else if (mode==='design') { if (S.tool==='comment') setTool('select'); }
}

// ════════════════════════════════════════════════════════════
// LAYERS PANEL — nested, renamable
// ════════════════════════════════════════════════════════════
const LAYER_ICONS = {rect:'▭', ellipse:'◯', text:'T', line:'/', frame:'⬜', group:'⬡'};

function updateLayers() {
  const list = document.getElementById('layers-list');
  list.innerHTML = '';
  // Get page elements, excluding children (they render under their parent)
  const pageEls = [...S.els].filter(e=>e.page===S.page).reverse();
  // Roots: no parentId
  const roots = pageEls.filter(e=>!e.parentId);

  roots.forEach(el => renderLayerItem(list, el, 0));
}

function renderLayerItem(container, el, depth) {
  const isSel = S.selIds.includes(el.id);
  const hasChildren = S.els.some(e=>e.parentId===el.id);
  const isContainer = el.type==='frame'||el.type==='group';

  const item = document.createElement('div');
  item.className = 'lyr'+(isSel?' on':'')+(depth>0?' lyr-indent':'');
  item.style.paddingLeft = (12 + depth*16)+'px';

  // Collapse toggle for frames/groups
  const toggleHtml = isContainer && hasChildren
    ? `<span class="lyr-group-toggle" onclick="toggleLayerCollapse(event,${el.id})">${el.collapsed?'▶':'▼'}</span>`
    : `<span style="width:10px;flex-shrink:0;"></span>`;

  item.innerHTML = `
    ${toggleHtml}
    <span class="lyr-ico">${LAYER_ICONS[el.type]||'◻'}</span>
    <span class="lyr-name" title="${escHtml(el.name)}">${escHtml(el.name)}</span>
    <button class="lyr-lock${el.locked?' locked':''}" onclick="toggleLock(event,${el.id})" title="${el.locked?'Unlock':'Lock'}">${el.locked?'🔒':'🔓'}</button>
    <button class="lyr-vis" onclick="toggleVis(event,${el.id})" title="${el.visible?'Hide':'Show'}">${el.visible?'👁':'○'}</button>
  `;

  // Click = select (with multi-select support via Cmd/Ctrl or Shift)
  item.addEventListener('click', ev => {
    if (ev.target.classList.contains('lyr-vis') ||
        ev.target.classList.contains('lyr-lock') ||
        ev.target.classList.contains('lyr-group-toggle')) return;
    if (S.protoMode) return;
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey) {
      // Toggle this element in selection
      if (S.selIds.includes(el.id)) {
        S.selIds = S.selIds.filter(i=>i!==el.id);
      } else {
        S.selIds = [...S.selIds, el.id];
      }
    } else {
      S.selIds = [el.id];
    }
    renderAll(); updateProps();
  });

  // Double-click name = inline rename
  const nameSpan = item.querySelector('.lyr-name');
  nameSpan.addEventListener('dblclick', ev => {
    ev.stopPropagation();
    startLayerRename(nameSpan, el);
  });

  container.appendChild(item);

  // Render children if not collapsed
  if (isContainer && !el.collapsed) {
    const children = S.els.filter(e=>e.parentId===el.id&&e.page===S.page);
    children.forEach(child => renderLayerItem(container, child, depth+1));
  }
}

function toggleLayerCollapse(ev, id) {
  ev.stopPropagation();
  const el = getEl(id); if (!el) return;
  el.collapsed = !el.collapsed;
  updateLayers();
}

function toggleVis(ev, id) {
  ev.stopPropagation(); const el=getEl(id); if(el){el.visible=!el.visible;renderAll();updateLayers();}
}

function toggleLock(ev, id) {
  ev.stopPropagation(); const el=getEl(id); if(!el) return;
  el.locked=!el.locked;
  if (el.locked && S.selIds.includes(id)) { S.selIds=S.selIds.filter(i=>i!==id); updateProps(); }
  renderAll(); updateLayers();
  notify(el.locked ? `🔒 "${el.name}" locked` : `🔓 "${el.name}" unlocked`);
}

function startLayerRename(span, el) {
  const original = el.name;
  const input = document.createElement('input');
  input.className = 'lyr-rename-input';
  input.value = original;
  span.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const val = input.value.trim() || original;
    el.name = val;
    // Replace input back with span
    const newSpan = document.createElement('span');
    newSpan.className = 'lyr-name';
    newSpan.title = val;
    newSpan.textContent = val;
    input.replaceWith(newSpan);
    // Re-add dblclick for future renames
    newSpan.addEventListener('dblclick', ev => { ev.stopPropagation(); startLayerRename(newSpan, el); });
    // Sync inspector title
    const inspTitle = document.getElementById('insp-title');
    if (inspTitle && S.selIds.includes(el.id)) inspTitle.textContent = val;
  };
  const cancel = () => {
    const newSpan = document.createElement('span');
    newSpan.className = 'lyr-name';
    newSpan.title = original; newSpan.textContent = original;
    input.replaceWith(newSpan);
    newSpan.addEventListener('dblclick', ev => { ev.stopPropagation(); startLayerRename(newSpan, el); });
  };

  input.addEventListener('keydown', ev => {
    ev.stopPropagation(); // don't trigger tool shortcuts
    if (ev.key==='Enter') { ev.preventDefault(); commit(); }
    if (ev.key==='Escape') { cancel(); }
  });
  input.addEventListener('blur', commit);
}

// ════════════════════════════════════════════════════════════
// PAGES PANEL
// ════════════════════════════════════════════════════════════
function updatePages() {
  const list=document.getElementById('pages-list'); list.innerHTML='';
  S.pages.forEach(p=>{
    const item=document.createElement('div'); item.className='pg-item'+(p.id===S.page?' on':'');
    const dot=document.createElement('div'); dot.className='pg-dot';
    const nameSpan=document.createElement('span'); nameSpan.className='pg-name'; nameSpan.textContent=p.name;
    item.appendChild(dot); item.appendChild(nameSpan);
    // Click = switch page
    item.addEventListener('click', ev=>{
      if (ev.target.tagName === 'INPUT') return;
      if (ev.detail > 1) return;          // don't rerender on double-click
      if (p.id === S.page) return;         // clicking active page does nothing
      S.page = p.id; S.selIds = [];
      updatePages(); renderAll(); updateProps();
    });
    // Double-click name = rename inline
    nameSpan.addEventListener('dblclick', ev=>{
      ev.stopPropagation();
      const inp=document.createElement('input');
      inp.value=p.name; inp.className='lyr-rename-input';
      inp.style.cssText='flex:1;min-width:0;font-size:11px;';
      nameSpan.replaceWith(inp); inp.focus(); inp.select();
      const commit=()=>{
        p.name=inp.value.trim()||p.name;
        inp.replaceWith(nameSpan); nameSpan.textContent=p.name;
        nameSpan.addEventListener('dblclick', redo);
      };
      const redo=ev=>{ ev.stopPropagation(); nameSpan.replaceWith(inp); inp.focus(); inp.select(); };
      inp.addEventListener('keydown', ev=>{
        ev.stopPropagation();
        if(ev.key==='Enter'){ev.preventDefault();commit();}
        if(ev.key==='Escape'){inp.replaceWith(nameSpan); nameSpan.addEventListener('dblclick',redo);}
      });
      inp.addEventListener('blur',commit);
    });
    list.appendChild(item);
  });
}

function addPage() {
  const id=S.nextId++; S.pages.push({id,name:'Page '+(S.pages.length+1)});
  S.page=id; S.selIds=[]; updatePages(); renderAll(); updateProps();
}

// ════════════════════════════════════════════════════════════
// TAB SWITCHING
// ════════════════════════════════════════════════════════════
function switchLeftTab(tab) {
  document.querySelectorAll('#left-panel .ptab').forEach(t=>t.classList.toggle('on',t.dataset.tab===tab));
  document.getElementById('tab-layers').style.display=tab==='layers'?'flex':'none';
  document.getElementById('tab-kit').style.display=tab==='kit'?'block':'none';
  document.getElementById('tab-colors').style.display=tab==='colors'?'block':'none';
  if (tab==='colors') renderColorStyles();
}

function switchRightTab(tab) {
  document.querySelectorAll('#right-tabs .ptab').forEach(t=>t.classList.toggle('on',t.dataset.rtab===tab));
  document.getElementById('design-content').style.display=tab==='design'?'block':'none';
  document.getElementById('proto-content').style.display=tab==='proto'?'block':'none';
  if (tab==='proto') updateProtoPanel();
}

// ════════════════════════════════════════════════════════════
// STATUS BAR
// ════════════════════════════════════════════════════════════
function updateStatus() {
  const pageEls=S.els.filter(e=>e.page===S.page);
  const n=S.selIds.length, el=n===1?getEl(S.selIds[0]):null;
  const st=document.getElementById('st-sel');
  if (el) st.textContent=`${el.type} · ${Math.round(el.w)} × ${Math.round(el.h)}`;
  else if (n>1) st.textContent=`${n} selected`;
  else st.textContent=`${pageEls.length} element${pageEls.length!==1?'s':''}`;
}

// ════════════════════════════════════════════════════════════
// COLLABORATION — MVP anonymous share (WebSocket-ready)
// ════════════════════════════════════════════════════════════

// Simulated presence avatars (would be replaced by WS events)
const PRESENCE_COLORS = ['#7c6aee','#3db87a','#d4a03a','#e05555','#00c2a8','#ee6a9a'];
const PRESENCE_NAMES  = ['Alex','Sam','Morgan','Jordan','Riley','Casey'];
let _presenceTimer = null;

function openShare() {
  const modal = document.getElementById('share-modal');
  const urlInput = document.getElementById('share-url-input');
  // Build the shareable URL (current page + hash)
  const url = location.href.split('#')[0] + '#' + S.collab.shareId;
  urlInput.value = url;
  modal.classList.add('open');
  // Simulate other users appearing
  simulatePresence();
}

function closeShare() {
  document.getElementById('share-modal').classList.remove('open');
  clearTimeout(_presenceTimer);
}

function copyShareLink() {
  const url = document.getElementById('share-url-input').value;
  navigator.clipboard.writeText(url).then(()=>notify('Link copied to clipboard!')).catch(()=>{
    // Fallback
    document.getElementById('share-url-input').select();
    document.execCommand('copy');
    notify('Link copied!');
  });
}

function simulatePresence() {
  const row = document.getElementById('presence-row');
  // Clear existing simulated avatars (keep the 'You' avatar)
  row.innerHTML = `<div class="presence-avatar" style="background:${PRESENCE_COLORS[0]}">Y</div><span class="presence-you">You (anonymous)</span>`;
  // Add 1-2 simulated "other" users after a short delay (would be WS events IRL)
  _presenceTimer = setTimeout(() => {
    const count = Math.floor(Math.random()*2)+1;
    for (let i=0; i<count; i++) {
      const ci = (i+1)%PRESENCE_COLORS.length;
      const name = PRESENCE_NAMES[ci];
      const avatar = document.createElement('div');
      avatar.className = 'presence-avatar';
      avatar.style.background = PRESENCE_COLORS[ci];
      avatar.title = name+' (anonymous)';
      avatar.textContent = name[0];
      // Insert before the "you" label
      row.insertBefore(avatar, row.children[1]);
    }
    // Add count label
    const lbl = document.createElement('span');
    lbl.style.cssText='font-size:10px;color:var(--text3);';
    lbl.textContent = `+${count} other${count>1?'s':''} viewing`;
    row.appendChild(lbl);
  }, 800);
}

// ── WebSocket-ready hooks (implement later) ──
// function connectWS(shareId) { ... }
// function broadcastCursorPos(x, y) { ... }
// function applyRemoteOp(op) { ... }


function randomPastel(){
  // Return hex so <input type=color> works correctly
  const h=Math.random()*360, s=0.52, l=0.72;
  const a=s*(l<0.5?l:1-l);
  const f=n=>{ const k=(n+h/30)%12; const c=l-a*Math.max(Math.min(k-3,9-k,1),-1); return Math.round(c*255).toString(16).padStart(2,'0'); };
  return '#'+f(0)+f(8)+f(4);
}

function resetZoom(){ S.zoom=1; S.panX=80; S.panY=70; applyTransform(); renderGrid(); }

function notify(msg) {
  const n=document.getElementById('notif'); n.textContent=msg; n.classList.add('show');
  clearTimeout(n._t); n._t=setTimeout(()=>n.classList.remove('show'),2200);
}

window.addEventListener('resize',()=>renderGrid());

// ════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════
(function boot() {
  setTool('select');
  applyTransform();
  updatePages();

 // --- Seed: Welcome demo (replace the whole old “Seed a starter design” block with this) ---

// Big white card
const card = mkEl('rect', 96, 96, 920, 640);
card.name = 'Welcome Card';
card.rx = 24;
card.fills = [mkFill('#ffffff')];
card.stroke = '#E5E7EB';
card.strokeWidth = 1;

// Title (split so Canvus can be accent colored)
const title1 = mkEl('text', 128, 132, 360, 52);
Object.assign(title1, {
  name: 'Title Intro',
  text: '🚀 Welcome to',
  fontSize: 40,
  lineHeight: 48,
  fontWeight: '800',
  textColor: '#111827'
});

const title2 = mkEl('text', 430, 132, 360, 52);
Object.assign(title2, {
  name: 'Title Brand',
  text: 'Canvus',
  fontSize: 40,
  lineHeight: 48,
  fontWeight: '900',
  textColor: '#7c6aee' // accent
});

// Subtitle
const subtitle = mkEl('text', 128, 192, 840, 40);
Object.assign(subtitle, {
  name: 'Subtitle',
  text: 'A beginner-first UX canvas made in Europe — built to teach good design habits while you create.',
  fontSize: 18,
  lineHeight: 28,
  fontWeight: '600',
  textColor: '#374151'
});

// Mission title + body (separate elements for hierarchy)
const mTitle = mkEl('text', 128, 260, 360, 32);
Object.assign(mTitle, {
  name: 'Mission Title',
  text: '🎯  MISSION',
  fontSize: 22,
  lineHeight: 28,
  fontWeight: '900',
  textColor: '#111827'
});

const mBody = mkEl('text', 128, 296, 400, 120);
Object.assign(mBody, {
  name: 'Mission Body',
  text: 'Turn UX principles into muscle memory — spacing, hierarchy, clarity, and accessibility by default.',
  fontSize: 18,
  lineHeight: 28,
  fontWeight: '650',
  textColor: '#111827'
});

// Vision title + body
const vTitle = mkEl('text', 560, 260, 360, 32);
Object.assign(vTitle, {
  name: 'Vision Title',
  text: '🌍  VISION',
  fontSize: 22,
  lineHeight: 28,
  fontWeight: '900',
  textColor: '#111827'
});

const vBody = mkEl('text', 560, 296, 400, 120);
Object.assign(vBody, {
  name: 'Vision Body',
  text: 'Build a European design tool ecosystem: privacy-minded, craft-led, and community-powered.',
  fontSize: 18,
  lineHeight: 28,
  fontWeight: '650',
  textColor: '#111827'
});

// Quick start block (purple)
const qsBg = mkEl('rect', 128, 420, 840, 240);
qsBg.name = 'Quick Start Block';
qsBg.rx = 20;
qsBg.fills = [mkFill('#7c6aee')];

const qsTitle = mkEl('text', 160, 420, 780, 32);
Object.assign(qsTitle, {
  name: 'Quick Start Title',
  text: '✨  QUICK START',
  fontSize: 22,
  lineHeight: 28,
  fontWeight: '900',
  textColor: '#ffffff'
});

const qsBody = mkEl('text', 160, 460, 780, 120);
Object.assign(qsBody, {
  name: 'Quick Start Body',
  text:
`V  Select
R  Rectangle
T  Text
Space  Pan
Scroll  Zoom

Grid + Snap = clean spacing • Share to get feedback`,
  fontSize: 16,
  lineHeight: 24,
  fontWeight: '650',
  textColor: '#ffffff'
});

  renderAll();
  updateProps();
  setTimeout(()=>notify('Welcome to Canvus ✦  Hold Alt over elements to measure spacing'), 400);
})();
