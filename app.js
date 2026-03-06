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
  _spacePanning: false, _prevTool: 'select',
  _exportScale: 1, _exportFmt: 'png',
  altDown: false,
  hoveredId: null,
  protoConns: [],
  _protoDrag: false, _protoDragFrom: null, // drag-to-connect state
  _selConn: null,                           // {fromId, idx} of selected arrow
  colorStyles: {
    primary:   {label:'Primary',   hex:'#7c6aee'},
    secondary: {label:'Secondary', hex:'#3db87a'},
    success:   {label:'Success',   hex:'#4caf80'},
    warning:   {label:'Warning',   hex:'#d4a03a'},
    error:     {label:'Error',     hex:'#e05555'},
    neutral:   {label:'Neutral',   hex:'#8888a0'},
  },
  fileId: null,          // set in boot from collab.shareId
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
  
  // Parse new URL format: #/file_<fileId>/page_<pageId>
  let shareId = location.hash.slice(1);
  let pageId = null;
  
  // Check if URL is in new format
  const urlParts = shareId.split('/');
  if (urlParts.length >= 3 && urlParts[0] === '' && urlParts[1]?.startsWith('file_') && urlParts[2]?.startsWith('page_')) {
    shareId = urlParts[1];
    pageId = urlParts[2].replace('page_', '');
  } else {
    // Legacy format: #file_<fileId>
    if (!shareId) {
      shareId = localStorage.getItem('canvus_share') || ('file_'+Math.random().toString(36).slice(2,10));
      localStorage.setItem('canvus_share', shareId);
    }
  }
  
  S.collab.shareId = shareId;
  
  // Store fileId for reference
  S.fileId = shareId.replace('file_', '');
  
  // If pageId was specified in URL, try to set it
  if (pageId) {
    setTimeout(() => {
      const pageExists = S.pages.some(p => p.id == pageId);
      if (pageExists) {
        S.page = parseInt(pageId) || S.page;
        updatePages();
        renderAll();
        updateProps();
      }
    }, 100);
  }
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
    // quiet dot grid — lighter in light mode
    const light = document.documentElement.dataset.theme === 'light';
    ctx.fillStyle = light ? 'rgba(100,100,130,0.35)' : 'rgba(55,55,68,0.7)';
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
  // Show frame presets when frame tool is active (not for section)
  document.getElementById('frame-presets').classList.toggle('open', t==='frame');
  closeFrameDropdown();
}

function toggleFrameDropdown(ev) {
  ev.stopPropagation();
  const dd = document.getElementById('frame-tool-dd');
  if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}
function closeFrameDropdown() {
  const dd = document.getElementById('frame-tool-dd');
  if (dd) dd.style.display = 'none';
}
document.addEventListener('click', closeFrameDropdown);

// ════════════════════════════════════════════════════════════
// ELEMENT FACTORY & CRUD
// ════════════════════════════════════════════════════════════
function getEl(id) { return S.els.find(e=>e.id===id); }

// An element is "prototypable" if it is a frame OR is a child of a frame
function isPrototypable(el) {
  return el.type === 'frame' || !!el.parentId;
}

// ── Undo / Redo ──
const _undoStack = [];
const _redoStack = [];
function _snapState() {
  return JSON.stringify({ els: S.els, pages: S.pages, page: S.page, nextId: S.nextId, colorStyles: S.colorStyles });
}
function pushUndo() {
  _undoStack.push(_snapState());
  if (_undoStack.length > 60) _undoStack.shift();
  _redoStack.length = 0; // clear redo on new action
}
function undo() {
  if (!_undoStack.length) { notify('Nothing to undo'); return; }
  _redoStack.push(_snapState());
  const st = JSON.parse(_undoStack.pop());
  Object.assign(S, { els: st.els, pages: st.pages, page: st.page, nextId: st.nextId, colorStyles: st.colorStyles, selIds: [], _selConn: null });
  renderAll(); updateProps(); updateLayers(); updatePages();
}
function redo() {
  if (!_redoStack.length) { notify('Nothing to redo'); return; }
  _undoStack.push(_snapState());
  const st = JSON.parse(_redoStack.pop());
  Object.assign(S, { els: st.els, pages: st.pages, page: st.page, nextId: st.nextId, colorStyles: st.colorStyles, selIds: [], _selConn: null });
  renderAll(); updateProps(); updateLayers(); updatePages();
}

function mkEl(type, x, y, w, h) {
  const id = S.nextId++;
  // fills[] is the new multi-layer fill system; el.fill is the legacy fallback
  // For frame: start with empty fills (transparent). For others: one default fill.
  let defaultFills = [];
  if (type === 'frame') {
    defaultFills = [];
  } else if (type === 'section') {
    defaultFills = [];
  } else if (type === 'text') {
    defaultFills = [];
  } else if (type === 'line') {
    defaultFills = [mkFill('#888899')];
  } else if (type === 'vector') {
    defaultFills = [];
  } else {
    defaultFills = [mkFill()];
  }

  const el = {
    id, type, x:snapV(x), y:snapV(y), w, h,
    fills: defaultFills,       // multi-layer fills (new system)
    fill: 'transparent',       // legacy compat — computed from fills[]
    stroke: 'none',
    strokeWidth: type==='frame'?1:2,
    strokeAlign: 'center', strokeDash: false,
    rx:0, cornerRadii:null, rotation:0, opacity:100,
    text:'', fontSize:16, lineHeight:24, fontWeight:'400', textColor:'#111111',
    textAlign:'left', letterSpacing:0, textTransform:'none',
    visible:true, locked:false,
    name: type[0].toUpperCase()+type.slice(1)+' '+id,
    page: S.page,
    parentId: null,
    collapsed: false,
    interactions: [],
    isFlowStart: false,
    flowName: '',
    scrollBehavior: 'none',
    // Component system
    isComponent: false,
    componentId: null,
    variantProps: {},
    overrides: {},   // tracks which props have been manually changed on an instance
    html: '',        // rich text innerHTML (used by text elements)
    // Effects
    effects: [],
    // Layout grids (frames only)
    layoutGrids: [],
    // Vector path (pen tool)
    pathData: null,
    pathClosed: false,
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

function _textureDataUri(preset, scale) {
  const s = Math.max(1, scale ?? 65) / 100;
  if (preset === 'dots') {
    const r = Math.max(1, Math.round(4 * s));
    const sp = Math.max(r * 2, Math.round(12 * s));
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${sp}' height='${sp}'><circle cx='${sp/2}' cy='${sp/2}' r='${r}' fill='white'/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }
  if (preset === 'lines') {
    const sp = Math.max(2, Math.round(8 * s));
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${sp}' height='${sp}'><line x1='0' y1='${sp/2}' x2='${sp}' y2='${sp/2}' stroke='white' stroke-width='1'/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }
  if (preset === 'grid') {
    const sp = Math.max(2, Math.round(12 * s));
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${sp}' height='${sp}'><rect width='${sp}' height='${sp}' fill='none' stroke='white' stroke-width='0.5'/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }
  // SVG turbulence-based presets
  const cfg = {
    noise:    {type:'fractalNoise', freq:`${(0.65*s).toFixed(3)}`,          oct:4},
    grain:    {type:'turbulence',   freq:`${(1.20*s).toFixed(3)}`,          oct:1},
    paper:    {type:'fractalNoise', freq:`${(0.04*s).toFixed(3)}`,          oct:5},
    linen:    {type:'fractalNoise', freq:`${(0.04*s).toFixed(3)} ${(0.4*s).toFixed(3)}`, oct:2},
    concrete: {type:'fractalNoise', freq:`${(0.035*s).toFixed(3)}`,         oct:6},
  }[preset] || {type:'fractalNoise', freq:`${(0.65*s).toFixed(3)}`, oct:4};
  const svg = `<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'><filter id='t'><feTurbulence type='${cfg.type}' baseFrequency='${cfg.freq}' numOctaves='${cfg.oct}' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(#t)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function hexToRgbArr(hex) {
  hex = hex.replace('#','');
  if (hex.length===3) hex=hex.split('').map(c=>c+c).join('');
  const n=parseInt(hex,16);
  return `${(n>>16)&255},${(n>>8)&255},${n&255}`;
}

function deleteSelected() {
  if (!S.selIds.length) return;
  pushUndo();
  // Remove interactions that originate from or point to deleted elements
  S.els.forEach(e => {
    if (e.interactions) e.interactions = e.interactions.filter(ix => !S.selIds.includes(ix.target));
  });
  S.els = S.els.filter(e=>!S.selIds.includes(e.id));
  S.protoConns = S.protoConns.filter(c=>!S.selIds.includes(c.fromId)&&!S.selIds.includes(c.toId));
  if (S._selConn && S.selIds.includes(S._selConn.fromId)) S._selConn = null;
  S.selIds = [];
  syncMastersToInstances();
  renderAll(); updateProps(); updateProtoPanel();
}

function duplicateSelected(inPlace) {
  if (!S.selIds.length) return;
  pushUndo();
  const newIds = [];
  [...S.selIds].forEach(id => {
    const el = getEl(id); if (!el) return;
    const copy = {...el, id:S.nextId++, x:el.x+(inPlace?0:16), y:el.y+(inPlace?0:16), name:el.name+(inPlace?'':' copy'), interactions: JSON.parse(JSON.stringify(el.interactions||[])) };
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

// ════════════════════════════════════════════════════════════
// COMPONENT SYSTEM — Atomic Design (Atoms → Molecules → Organisms)
// ════════════════════════════════════════════════════════════

function createComponent() {
  const ids = [...S.selIds];
  if (!ids.length) { notify('Select elements to create a component'); return; }
  pushUndo();
  const els = ids.map(id=>getEl(id)).filter(Boolean);

  // If already a single frame, just promote it directly
  if (ids.length === 1 && els[0].type === 'frame' && !els[0].isComponent) {
    const el = els[0];
    el.isComponent = true; el.componentId = null; el.overrides = {};
    el.variantProps = el.variantProps || {};
    if (!el.name.startsWith('⬡ ')) el.name = '⬡ ' + el.name;
    renderAll(); updateProps(); updateLayers();
    if (document.querySelector('#left-panel .ptab[data-tab="components"].on')) renderComponentsPanel();
    notify('Component created');
    return;
  }

  // For any other selection (shapes, text, groups, or multiple elements):
  // wrap everything in a new frame component
  const minX = Math.min(...els.map(e=>e.x));
  const minY = Math.min(...els.map(e=>e.y));
  const maxX = Math.max(...els.map(e=>e.x+e.w));
  const maxY = Math.max(...els.map(e=>e.y+e.h));
  const pad = 16;

  const frame = mkEl('frame', minX-pad, minY-pad, maxX-minX+pad*2, maxY-minY+pad*2);
  frame.isComponent = true;
  frame.componentId = null;
  frame.overrides = {};
  frame.fills = [];
  frame.stroke = '#7c6aee';
  frame.strokeWidth = 1;
  // Auto-name: use single element's name, or generic
  frame.name = '⬡ ' + (ids.length===1 ? els[0].name : 'Component');
  frame.variantProps = {};

  // Re-parent all selected elements into this frame
  els.forEach(e => { e.parentId = frame.id; });

  // Re-order: frame must sit before its children in S.els (mkEl appended it at end)
  const firstChildIdx = Math.min(...els.map(e => S.els.indexOf(e)));
  S.els = S.els.filter(e => e.id !== frame.id);
  S.els.splice(firstChildIdx, 0, frame);

  S.selIds = [frame.id];
  renderAll(); updateProps(); updateLayers();
  if (document.querySelector('#left-panel .ptab[data-tab="components"].on')) renderComponentsPanel();
  notify('Component created');
}

// ── Master → Instance propagation ─────────────────────────────
function syncMastersToInstances() {
  S.els.filter(e=>e.isComponent).forEach(master => {
    S.els.filter(e=>e.componentId===master.id).forEach(inst => _syncInstFromMaster(inst, master));
  });
}

const _SYNC_PROPS = ['stroke','strokeWidth','strokeAlign','strokeDash','rx','cornerRadii','rotation','opacity','fill','fills','w','h','fontSize','fontWeight','textColor','lineHeight','fontStyle','text','html'];

function _syncInstFromMaster(inst, master) {
  const ov = inst.overrides||{};
  _SYNC_PROPS.forEach(p => {
    if (!ov[p]) inst[p] = Array.isArray(master[p]) ? JSON.parse(JSON.stringify(master[p])) : master[p];
  });
  _syncInstanceChildren(inst, master);
}

function _syncInstanceChildren(inst, master) {
  const mCh = S.els.filter(e=>e.parentId===master.id);
  const iCh = S.els.filter(e=>e.parentId===inst.id);

  // Sync existing children matched by masterChildId; add missing ones
  mCh.forEach(mch => {
    const ich = iCh.find(c => c.masterChildId === mch.id);
    if (!ich) {
      // Child exists in master but not instance → add it
      const newCh = JSON.parse(JSON.stringify(mch));
      newCh.id = S.nextId++;
      newCh.parentId = inst.id;
      newCh.masterChildId = mch.id;
      newCh.x = inst.x + (mch.x - master.x);
      newCh.y = inst.y + (mch.y - master.y);
      newCh.isComponent = false;
      newCh.overrides = {};
      S.els.push(newCh);
      return;
    }
    // Sync properties respecting overrides
    const ov = ich.overrides || {};
    _SYNC_PROPS.forEach(p => {
      if (!ov[p]) ich[p] = Array.isArray(mch[p]) ? JSON.parse(JSON.stringify(mch[p])) : mch[p];
    });
    // Recurse for nested children
    _syncInstanceChildren(ich, mch);
  });

  // Remove instance children whose master child was deleted
  iCh.forEach(ich => {
    if (ich.masterChildId && !mCh.find(c => c.id === ich.masterChildId)) {
      if (!(ich.overrides && ich.overrides._kept)) {
        S.els = S.els.filter(e => e.id !== ich.id);
      }
    }
  });
}

// Push instance overrides → master → all other instances
function pushToMaster(instId) {
  const inst = getEl(instId); if (!inst||!inst.componentId) return;
  const master = getEl(inst.componentId); if (!master) return;
  pushUndo();
  const ov = inst.overrides||{};
  Object.keys(ov).forEach(p => {
    if (['id','componentId','isComponent','x','y','w','h','parentId','name','overrides','interactions','isFlowStart','flowName','page'].includes(p)) return;
    master[p] = Array.isArray(inst[p]) ? JSON.parse(JSON.stringify(inst[p])) : inst[p];
  });
  inst.overrides = {};
  syncMastersToInstances();
  renderAll(); updateProps();
  notify('Changes pushed to master & all instances');
}

// Mark a property as overridden on an instance
function _markOverride(el, prop) {
  if (el && el.componentId) {
    el.overrides = el.overrides||{};
    el.overrides[prop] = true;
  }
}

// Walk up parentId chain to find the nearest enclosing component/instance
function getComponentContainer(el) {
  let cur = el;
  while (cur.parentId) {
    const parent = getEl(cur.parentId);
    if (!parent) break;
    if (parent.isComponent || parent.componentId) return parent;
    cur = parent;
  }
  return null;
}

// Deep-copy all children of masterId under newParentId, recording masterChildId for sync
function _deepCopyChildren(masterId, newParentId, dx, dy) {
  S.els.filter(e => e.parentId === masterId).forEach(ch => {
    const newCh = JSON.parse(JSON.stringify(ch));
    const oldId = ch.id;
    newCh.id = S.nextId++;
    newCh.parentId = newParentId;
    newCh.masterChildId = oldId;
    newCh.x = ch.x + dx;
    newCh.y = ch.y + dy;
    newCh.isComponent = false;
    newCh.overrides = {};
    S.els.push(newCh);
    _deepCopyChildren(oldId, newCh.id, dx, dy);
  });
}

function createInstance(componentId) {
  const master = getEl(componentId);
  if (!master) return;
  pushUndo();
  // Deep-copy the master element
  const inst = JSON.parse(JSON.stringify(master));
  inst.id = S.nextId++;
  inst.x = master.x + 32;
  inst.y = master.y + 32;
  inst.isComponent = false;
  inst.componentId = master.id;
  inst.name = master.name.replace(/^⬡ /,'') + ' (instance)';
  inst.overrides = {};
  const dx = inst.x - master.x, dy = inst.y - master.y;
  _deepCopyChildren(master.id, inst.id, dx, dy);
  S.els.push(inst);
  S.selIds = [inst.id];
  renderAll(); updateProps(); updateLayers();
  notify('Instance created');
}

function detachInstance(id) {
  const el = getEl(id); if (!el) return;
  pushUndo();
  el.componentId = null;
  el.isComponent = false;
  el.name = el.name.replace(' (instance)', ' (detached)');
  renderAll(); updateProps(); updateLayers();
  notify('Detached from component');
}

function goToMaster(id) {
  const el = getEl(id); if (!el||!el.componentId) return;
  const master = getEl(el.componentId); if (!master) return;
  S.selIds = [master.id];
  // Pan to master
  const r = canvasWrap.getBoundingClientRect();
  S.panX = r.width/2 - (master.x + master.w/2)*S.zoom;
  S.panY = r.height/2 - (master.y + master.h/2)*S.zoom;
  applyTransform();
  renderAll(); updateProps();
}

function addVariantProp() {
  const el = getEl(S.selIds[0]); if (!el || !el.isComponent) return;
  const key = prompt('Property name (e.g. State, Size):'); if (!key) return;
  const val = prompt(`Default value for "${key}" (e.g. Default, Large):`); if (val === null) return;
  el.variantProps = el.variantProps || {};
  el.variantProps[key] = val;
  updateProps();
}

function setVariantProp(elId, key, val) {
  const el = getEl(elId); if (!el) return;
  el.variantProps = el.variantProps || {};
  el.variantProps[key] = val;
}

function removeVariantProp(elId, key) {
  const el = getEl(elId); if (!el) return;
  delete (el.variantProps||{})[key];
  updateProps();
}

function addVariant() {
  const master = getEl(S.selIds[0]);
  if (!master || !master.isComponent) return;
  pushUndo();
  // Duplicate master as new variant sibling
  const variant = JSON.parse(JSON.stringify(master));
  variant.id = S.nextId++;
  variant.x = master.x + master.w + 32;
  variant.y = master.y;
  variant.name = master.name.replace(/^⬡ /,'');
  variant.isComponent = true;
  variant.componentId = null;
  // Copy variant props with a new default value
  const newProps = {...(master.variantProps||{})};
  const firstKey = Object.keys(newProps)[0];
  if (firstKey) newProps[firstKey] = 'Variant 2';
  variant.variantProps = newProps;
  // Copy children
  S.els.filter(e=>e.parentId===master.id).forEach(ch => {
    const newCh = JSON.parse(JSON.stringify(ch));
    newCh.id = S.nextId++;
    newCh.parentId = variant.id;
    newCh.x = variant.x + (ch.x - master.x);
    newCh.y = variant.y + (ch.y - master.y);
    S.els.push(newCh);
  });
  S.els.push(variant);
  S.selIds = [variant.id];
  renderAll(); updateProps(); updateLayers();
  notify('Variant added');
}

function renderComponentsPanel() {
  const list = document.getElementById('components-list'); if (!list) return;
  list.innerHTML = '';
  const comps = S.els.filter(e=>e.isComponent&&e.page===S.page);
  const otherPages = S.pages.filter(p=>p.id!==S.page)
    .map(p=>({page:p, comps:S.els.filter(e=>e.isComponent&&e.page===p.id)}))
    .filter(g=>g.comps.length);

  if (!comps.length && !otherPages.length) {
    list.innerHTML = `<div class="comp-empty">No components yet.<br><br>Select a frame and click<br><b>Create Component</b> in the inspector,<br>or right-click an element.</div>`;
    return;
  }

  if (comps.length) {
    const gp = document.createElement('div');
    gp.className = 'comp-gp';
    const pg = S.pages.find(p=>p.id===S.page);
    gp.textContent = pg ? pg.name : 'Current page';
    list.appendChild(gp);
    comps.forEach(c => list.appendChild(_compItem(c)));
  }

  otherPages.forEach(({page, comps:pc}) => {
    const gp = document.createElement('div');
    gp.className = 'comp-gp';
    gp.textContent = page.name;
    list.appendChild(gp);
    pc.forEach(c => list.appendChild(_compItem(c)));
  });
}

function _compItem(comp) {
  const instCount = S.els.filter(e=>e.componentId===comp.id).length;
  const item = document.createElement('div');
  item.className = 'comp-item';
  item.title = `${comp.name}\n${instCount} instance${instCount!==1?'s':''}`;
  item.innerHTML = `
    <div class="comp-item-thumb">⬡</div>
    <div style="flex:1;min-width:0;">
      <div class="comp-item-name">${escHtml(comp.name.replace(/^⬡ /,''))}</div>
      <div class="comp-item-inst">${instCount} instance${instCount!==1?'s':''}</div>
    </div>
    <button style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:11px;padding:2px 4px;" title="Place instance" onclick="event.stopPropagation();placeComponentInstance(${comp.id});">+ Use</button>
  `;
  item.addEventListener('click', () => {
    if (comp.page === S.page) { S.selIds=[comp.id]; renderAll(); updateProps(); }
    else { notify('Switch to page "'+S.pages.find(p=>p.id===comp.page)?.name+'" to select this component'); }
  });
  return item;
}

function placeComponentInstance(componentId) {
  // Place instance at canvas center
  const r = canvasWrap.getBoundingClientRect();
  const center = screenToCanvas(r.left + r.width/2, r.top + r.height/2);
  const master = getEl(componentId); if (!master) return;
  pushUndo();
  const inst = JSON.parse(JSON.stringify(master));
  inst.id = S.nextId++;
  inst.x = snapV(center.x - master.w/2);
  inst.y = snapV(center.y - master.h/2);
  inst.isComponent = false;
  inst.componentId = master.id;
  inst.name = master.name.replace(/^⬡ /,'') + ' (instance)';
  inst.overrides = {};
  const dx = inst.x - master.x, dy = inst.y - master.y;
  _deepCopyChildren(master.id, inst.id, dx, dy);
  S.els.push(inst);
  S.selIds = [inst.id];
  renderAll(); updateProps(); updateLayers();
  notify('Instance placed');
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
  // Apply auto layout before DOM rebuild
  S.els.filter(e=>e.type==='frame'&&e.autoLayout&&e.page===S.page).forEach(applyAutoLayout);
  // Propagate any master changes to instances (skipped during active drag for performance)
  if (!D.mode) syncMastersToInstances();
  canvasEl.innerHTML = '';
  // Render order: frames first (so children appear on top and receive clicks)
  const pageEls = S.els.filter(e=>e.page===S.page&&e.visible);
  const frames = pageEls.filter(e=>e.type==='frame'||e.type==='section');
  const nonFrames = pageEls.filter(e=>e.type!=='frame'&&e.type!=='section');
  // Render frames/sections first, then everything else (children render on top = receive mousedown first)
  frames.forEach(renderElement);
  nonFrames.forEach(renderElement);
  renderGrid();
  renderProtoArrows();
  renderComments();
  renderMeasure();
  renderMultiSelBox();
  updateLayers();
  updateStatus();
  if (S.coachOn) runCoach();
}

// ── Multi-select bounding box ──────────────────────────────
function renderMultiSelBox() {
  const existing = document.getElementById('multisel-box');
  if (existing) existing.remove();
  if (S.selIds.length < 2) return;
  const els = S.selIds.map(id=>getEl(id)).filter(e=>e&&e.page===S.page);
  if (!els.length) return;
  const minX = Math.min(...els.map(e=>e.x));
  const minY = Math.min(...els.map(e=>e.y));
  const maxX = Math.max(...els.map(e=>e.x+e.w));
  const maxY = Math.max(...els.map(e=>e.y+e.h));
  const bw = maxX-minX, bh = maxY-minY;

  const box = document.createElement('div');
  box.id = 'multisel-box';
  box.style.cssText = `left:${minX}px;top:${minY}px;width:${bw}px;height:${bh}px;`;

  // 4 corner handles only
  ['nw','ne','se','sw'].forEach(dir => {
    const h = document.createElement('div');
    h.className = `rh ${dir}`;
    h.addEventListener('mousedown', ev => {
      ev.stopPropagation();
      startGroupResize(ev, dir, {x:minX,y:minY,w:bw,h:bh});
    });
    box.appendChild(h);
  });

  // Size badge
  const badge = document.createElement('div');
  badge.className = 'sel-size-badge';
  const sz = Math.max(8, 10/S.zoom);
  const gap = Math.max(4, 6/S.zoom);
  badge.style.cssText = `left:${bw/2}px;top:${bh+gap}px;font-size:${sz}px;`;
  badge.textContent = `${Math.round(bw)} × ${Math.round(bh)}`;
  box.appendChild(badge);

  canvasEl.appendChild(box);
}

function startGroupResize(ev, dir, bbox) {
  pushUndo();
  D.mode = 'group-resize';
  D.resizeHandle = dir;
  D.startPos = screenToCanvas(ev.clientX, ev.clientY);
  D.groupBBox = {...bbox};
  // Store each element's position/size relative to bbox
  D.groupEls = S.selIds.map(id=>{ const e=getEl(id); return e?{id,x:e.x-bbox.x,y:e.y-bbox.y,w:e.w,h:e.h}:null; }).filter(Boolean);
}

// LAYER_ICONS defined in layers panel section below

const BLEND_MODES = ['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion'];

function applyFillsToDiv(dom, el, extraStyle) {
  const visFills = (el.fills||[]).filter(f=>f.visible);
  const borderCSS = (() => {
    if (!el.stroke || el.stroke==='none') return '';
    const w = el.strokeWidth||1, c = el.stroke;
    const dash = el.strokeDash ? 'dashed' : 'solid';
    const align = el.strokeAlign || 'center';
    if (align==='inside')  return `box-shadow:inset 0 0 0 ${w}px ${c};`;
    if (align==='outside') return `box-shadow:0 0 0 ${w}px ${c};`;
    return `border:${w}px ${dash} ${c};`;
  })();
  const radiusCSS = extraStyle || (el.cornerRadii
    ? `border-radius:${el.cornerRadii.tl||0}px ${el.cornerRadii.tr||0}px ${el.cornerRadii.br||0}px ${el.cornerRadii.bl||0}px;`
    : `border-radius:${el.rx||0}px;`);
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
    // Image fill — set after applyFillsToDiv so it overrides background
    if (el.imageSrc) {
      dom.style.backgroundImage = `url('${el.imageSrc}')`;
      dom.style.backgroundSize = 'cover';
      dom.style.backgroundPosition = 'center';
      dom.style.backgroundRepeat = 'no-repeat';
    }
    if (el.type==='frame') {
      dom.classList.add('cel-frame');
      renderLayoutGrid(dom, el);
      if (el.w > 0) {
        const lbl = document.createElement('div');
        lbl.className = 'frame-label';
        lbl.textContent = el.name;
        // Keep label readable at all zoom levels: compensate for canvas scale
        const _lblSz = Math.max(8, 11 / S.zoom);
        const _lblOff = Math.max(16, 20 / S.zoom);
        lbl.style.cssText = `position:absolute;top:${-_lblOff}px;left:0;font-size:${_lblSz}px;color:var(--text3);white-space:nowrap;pointer-events:auto;cursor:pointer;padding:2px 4px;border-radius:3px;transition:color .1s;`;
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
    // stroke is handled inside applyFillsToDiv via borderCSS
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
    dom.style.cssText = `position:absolute;left:${el.x}px;top:${el.y}px;min-width:${Math.max(el.w,10)}px;min-height:${Math.max(el.h,10)}px;color:${el.textColor};font-size:${el.fontSize}px;line-height:${el.lineHeight}px;font-weight:${el.fontWeight};font-style:${el.fontStyle||'normal'};text-align:${el.textAlign||'left'};letter-spacing:${el.letterSpacing||0}em;text-transform:${el.textTransform||'none'};opacity:${el.opacity/100};white-space:pre-wrap;word-break:break-word;font-family:'DM Sans',sans-serif;cursor:default;`;
    // Render rich HTML if available, else plain text
    if (el.html) {
      dom.innerHTML = el.html;
    } else {
      dom.textContent = el.text || 'Text';
    }
    dom.addEventListener('dblclick', ev => {
      ev.stopPropagation();
      S.selIds = [el.id]; // ensure selected
      dom.contentEditable = 'true';
      dom.style.outline = 'none';
      dom.style.cursor = 'text';
      dom.style.userSelect = 'text';
      dom.focus();
      // Place cursor at click position rather than selecting all
      // (selection is already at click point from the dblclick event)
      showTextFmtBar(dom, el);
    });
    dom.addEventListener('blur', ev => {
      // Don't blur if clicking inside the format bar
      const bar = document.getElementById('text-fmt-bar');
      if (bar && bar.contains(ev.relatedTarget)) return;
      dom.contentEditable = 'false';
      dom.style.cursor = 'default';
      dom.style.userSelect = '';
      el.html = dom.innerHTML;
      el.text = dom.textContent;
      _markOverride(el, 'html'); _markOverride(el, 'text');
      if (el.isComponent) syncMastersToInstances();
      hideTextFmtBar();
      if (S.coachOn) runCoach();
    });
    dom.addEventListener('keydown', ev => {
      if (dom.contentEditable !== 'true') return;
      const ctrl = ev.ctrlKey || ev.metaKey;
      if (ctrl && ev.key.toLowerCase() === 'b') { ev.preventDefault(); ev.stopPropagation(); document.execCommand('bold'); updateFmtBarState(); }
      if (ctrl && ev.key.toLowerCase() === 'i') { ev.preventDefault(); ev.stopPropagation(); document.execCommand('italic'); updateFmtBarState(); }
      if (ctrl && ev.key.toLowerCase() === 'u') { ev.preventDefault(); ev.stopPropagation(); document.execCommand('underline'); updateFmtBarState(); }
      if (ev.key === 'Escape') { dom.blur(); }
    });
    // Update toolbar state on selection change
    dom.addEventListener('mouseup', updateFmtBarState);
    dom.addEventListener('keyup', updateFmtBarState);
  } else if (el.type==='video') {
    dom = document.createElement('div');
    const _vidRad = el.cornerRadii ? `${el.cornerRadii.tl||0}px ${el.cornerRadii.tr||0}px ${el.cornerRadii.br||0}px ${el.cornerRadii.bl||0}px` : `${el.rx||0}px`;
    dom.style.cssText = `position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;opacity:${el.opacity/100};background:#111;border-radius:${_vidRad};overflow:hidden;`;
    const _vid = document.createElement('video');
    _vid.src = el.videoSrc || '';
    _vid.style.cssText = 'width:100%;height:100%;object-fit:cover;pointer-events:none;';
    _vid.autoplay = true; _vid.loop = true; _vid.muted = true;
    dom.appendChild(_vid);
  } else if (el.type==='section') {
    dom = document.createElement('div');
    dom.classList.add('cel-section');
    dom.style.cssText = `position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;opacity:${el.opacity/100};`;
    const _lblSz = Math.max(9, 12 / S.zoom);
    const _lblOff = Math.max(20, 24 / S.zoom);
    const lbl = document.createElement('div');
    lbl.className = 'section-label';
    lbl.style.cssText = `position:absolute;top:${-_lblOff}px;left:0;font-size:${_lblSz}px;`;
    lbl.textContent = el.name;
    if (isSel) lbl.style.color = 'var(--accent)';
    lbl.addEventListener('mousedown', ev => { ev.stopPropagation(); S.selIds=[el.id]; renderAll(); updateProps(); });
    dom.appendChild(lbl);
  } else if (el.type==='vector') {
    dom = document.createElementNS('http://www.w3.org/2000/svg','svg');
    dom.style.cssText = `position:absolute;left:${el.x}px;top:${el.y}px;overflow:visible;`;
    dom.setAttribute('width', Math.max(1, el.w));
    dom.setAttribute('height', Math.max(1, el.h));
    // Transparent hit area covering the bounding box
    const _hitR = document.createElementNS('http://www.w3.org/2000/svg','rect');
    _hitR.setAttribute('x',0); _hitR.setAttribute('y',0);
    _hitR.setAttribute('width',Math.max(1,el.w)); _hitR.setAttribute('height',Math.max(1,el.h));
    _hitR.setAttribute('fill','transparent');
    dom.appendChild(_hitR);
    const _path = document.createElementNS('http://www.w3.org/2000/svg','path');
    _path.setAttribute('d', buildVectorPath(el));
    const _visFills = (el.fills||[]).filter(f=>f.visible);
    _path.setAttribute('fill', _visFills.length ? (fillToCSS(_visFills[0])||'none') : 'none');
    if (el.stroke && el.stroke!=='none') {
      _path.setAttribute('stroke', el.stroke);
      _path.setAttribute('stroke-width', el.strokeWidth||2);
      _path.setAttribute('stroke-linecap','round');
      _path.setAttribute('stroke-linejoin','round');
    } else { _path.setAttribute('stroke','none'); }
    dom.appendChild(_path);
    // Preview line + anchor handles while pen is drawing this path
    if (_pen.active && _pen.el && _pen.el.id===el.id) {
      if (_pen.previewPt && el.pathData && el.pathData.length) {
        const lastPt = el.pathData[el.pathData.length-1];
        const _prev = document.createElementNS('http://www.w3.org/2000/svg','line');
        _prev.setAttribute('x1',lastPt.x-el.x); _prev.setAttribute('y1',lastPt.y-el.y);
        _prev.setAttribute('x2',_pen.previewPt.x-el.x); _prev.setAttribute('y2',_pen.previewPt.y-el.y);
        _prev.setAttribute('stroke','var(--accent)'); _prev.setAttribute('stroke-width','1');
        _prev.setAttribute('stroke-dasharray','4 3'); _prev.setAttribute('pointer-events','none');
        dom.appendChild(_prev);
      }
      _renderPenHandles(dom, el);
    }
  } else { return; }

  applyEffectsToEl(dom, el);
  dom.dataset.id = el.id;
  dom.classList.add('cel');
  if (el.locked) dom.classList.add('cel-locked');
  if (isSel && !isMulti) dom.classList.add('sel');
  if (isMulti) dom.classList.add('msel');
  if (el.isComponent) dom.classList.add('is-component');
  if (!el.isComponent && el.componentId) dom.classList.add('is-instance');

  if (el.type !== 'line' && el.type !== 'group' && el.type !== 'vector' && isSel && !isMulti) {
    ['nw','n','ne','e','se','s','sw','w'].forEach(dir => {
      const h = document.createElement('div');
      h.className = `rh ${dir}`;
      h.addEventListener('mousedown', ev => { ev.stopPropagation(); startResize(ev, el.id, dir); });
      dom.appendChild(h);
    });
    // Size badge — canvas-space, below element, zoom-compensated
    if (el.w > 0 && el.h > 0) {
      const badge = document.createElement('div');
      badge.className = 'sel-size-badge';
      const sz = Math.max(8, 10 / S.zoom);
      const gap = Math.max(4, 6 / S.zoom);
      badge.style.cssText = `left:${el.x + el.w/2}px;top:${el.y + el.h + gap}px;font-size:${sz}px;`;
      badge.textContent = `${Math.round(el.w)} × ${Math.round(el.h)}`;
      canvasEl.appendChild(badge);
    }
  }

  dom.addEventListener('mouseenter', () => { S.hoveredId=el.id; if (S.altDown) renderMeasure(); });
  dom.addEventListener('mouseleave', () => { if (S.hoveredId===el.id) { S.hoveredId=null; renderMeasure(); } });
  dom.addEventListener('mousedown', ev => {
    if (ev.target.classList.contains('rh')) return;
    if (S.tool !== 'select') return;
    if (el.locked) return;
    ev.stopPropagation();

    // Component protection: first click selects the whole component/instance
    if (!ev.shiftKey && !S.protoMode) {
      const container = getComponentContainer(el);
      if (container && !S.selIds.includes(container.id)) {
        S.selIds = [container.id];
        renderAll(); updateProps();
        startMove(ev);
        return;
      }
    }

    if (S.protoMode) {
      // Select element to show its interactions in the proto panel (no drag in proto mode)
      if (ev.shiftKey) {
        if (S.selIds.includes(el.id)) S.selIds=S.selIds.filter(i=>i!==el.id);
        else S.selIds.push(el.id);
      } else {
        S.selIds=[el.id];
      }
      renderAll(); updateProps(); return;
    }

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
      if (ev.altKey) {
        // Alt+drag: duplicate in-place (pushUndo inside), then move the copies
        // Pass flag so startMove skips its own pushUndo (avoids double-snapshot)
        duplicateSelected(true);
        startMove(ev, true); // true = skipUndo
      } else {
        startMove(ev);
      }
    }
  });

  const _rot = el.rotation || 0;
  const _flip = (el.flipH || el.flipV) ? ` scale(${el.flipH?-1:1},${el.flipV?-1:1})` : '';
  if (_rot || el.flipH || el.flipV) {
    dom.style.transform = `rotate(${_rot}deg)${_flip}`;
    dom.style.transformOrigin = 'center center';
  }

  // Rotation handle — shown only on single-select
  if (isSel && !isMulti && el.type !== 'line' && el.type !== 'group') {
    const hOff = Math.max(20, 28 / S.zoom);
    const hSz  = Math.max(7,  10 / S.zoom);
    const rotH = document.createElement('div');
    rotH.className = 'rh rot';
    rotH.style.cssText = `width:${hSz}px;height:${hSz}px;left:calc(50% - ${hSz/2}px);top:-${hOff+hSz}px;`;
    rotH.title = 'Rotate (Shift = 15° snap)';
    rotH.addEventListener('mousedown', ev => { ev.stopPropagation(); startRotate(ev, el.id); });
    dom.appendChild(rotH);
    // Connector line
    const rotLine = document.createElement('div');
    rotLine.style.cssText = `position:absolute;width:1px;background:var(--sel);opacity:.5;left:calc(50% - 0.5px);top:-${hOff}px;height:${hOff}px;pointer-events:none;`;
    dom.appendChild(rotLine);
  }

  // Flow-start badge
  if (el.isFlowStart) dom.classList.add('cel-flow-start');

  canvasEl.appendChild(dom);

  // Proto handle: appended to canvasEl (NOT dom) to avoid overflow:hidden clipping on frames
  // Only frames and elements inside frames are prototypable
  if (S.protoMode && isPrototypable(el)) {
    const handle = document.createElement('div');
    handle.className = 'proto-handle';
    handle.title = 'Drag to connect';
    handle.style.left = (el.x + el.w) + 'px';
    handle.style.top = (el.y + el.h / 2) + 'px';
    // Helper: show/hide handle with pointer-events sync
    function _showHandle(v) {
      handle.style.opacity = v ? '1' : '0';
      handle.style.pointerEvents = v ? 'all' : 'none';
    }
    // Show when selected; invisible + non-interactive otherwise
    _showHandle(isSel);
    handle.addEventListener('mousedown', ev => {
      ev.stopPropagation();
      startProtoDrag(ev, el.id);
    });
    // Show on element hover; hide when leaving (unless selected)
    // relatedTarget checks prevent flickering when mouse moves between dom↔handle
    dom.addEventListener('mouseenter', () => _showHandle(true));
    dom.addEventListener('mouseleave', (e) => {
      if (e.relatedTarget === handle) return;
      if (!S.selIds.includes(el.id)) _showHandle(false);
    });
    handle.addEventListener('mouseenter', () => _showHandle(true));
    handle.addEventListener('mouseleave', (e) => {
      if (e.relatedTarget === dom) return;
      if (!S.selIds.includes(el.id)) _showHandle(false);
    });
    canvasEl.appendChild(handle);
  }
}

// ════════════════════════════════════════════════════════════
// DRAG: DRAW / MOVE / RESIZE / PAN / MARQUEE
// ════════════════════════════════════════════════════════════
let D = { mode:null, startPos:null, drawEl:null, moveStarts:null, resizeHandle:null, resizeElStart:null, panStart:null, marqStart:null, alEl:null, alParent:null };

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
    S.selIds = []; _lastLayerClickId = null;
    if (!S.protoMode) {
      D.mode='marquee'; D.marqStart={x:ev.clientX, y:ev.clientY};
      const r=canvasWrap.getBoundingClientRect();
      selBoxEl.style.cssText=`display:block;left:${ev.clientX-r.left}px;top:${ev.clientY-r.top}px;width:0;height:0;`;
    }
    renderAll(); updateProps(); return;
  }

  if (['rect','ellipse','text','line','frame','section'].includes(S.tool)) {
    pushUndo();
    D.mode='draw'; D.startPos=pos;
    const el = mkEl(S.tool, pos.x, pos.y, 0, 0);
    // fills[] already set by mkEl — just ensure text and frame are correct
    if (S.tool==='text') { el.text='Text'; el.w=120; el.h=30; el.fills=[]; }
    // frame/section: mkEl already sets fills=[] (transparent)
    S.selIds=[el.id]; D.drawEl=el;
    renderAll();
    return;
  }

  // Pen tool — handled in canvasWrap mousedown (cel mousedown returns early for non-select tools)
  if (S.tool==='pen') {
    const detail = ev.detail || 1;
    if (detail === 2) {
      // Double-click finishes the path; remove the redundant point added by the first click
      if (_pen.active && _pen.el && _pen.el.pathData.length > 1) _pen.el.pathData.pop();
      _finishPen(); return;
    }
    if (!_pen.active) {
      pushUndo();
      const el = mkEl('vector', pos.x, pos.y, 1, 1);
      el.pathData = []; el.pathClosed = false; el.fills = [];
      el.stroke = '#7c6aee'; el.strokeWidth = 2;
      const anchor = {x:pos.x, y:pos.y, cp1x:pos.x, cp1y:pos.y, cp2x:pos.x, cp2y:pos.y, hasHandles:false};
      el.pathData.push(anchor);
      _pen.active = true; _pen.el = el; _pen.dragAnchor = anchor;
      S.selIds = [el.id]; updateVectorBBox(el); renderAll();
    } else {
      // Check if near start anchor to close path
      const firstPt = _pen.el.pathData[0];
      if (_pen.el.pathData.length >= 3 && Math.hypot(pos.x-firstPt.x, pos.y-firstPt.y) < 10/S.zoom) {
        _pen.el.pathClosed = true; _finishPen(); return;
      }
      const anchor = {x:pos.x, y:pos.y, cp1x:pos.x, cp1y:pos.y, cp2x:pos.x, cp2y:pos.y, hasHandles:false};
      _pen.el.pathData.push(anchor);
      _pen.dragAnchor = anchor; updateVectorBBox(_pen.el); renderAll();
    }
    return;
  }
});

// ── Proto drag-to-connect ──
function startProtoDrag(ev, fromId) {
  S._protoDrag=true; S._protoDragFrom=fromId;
  S.selIds=[fromId]; renderAll(); updateProps();
  // Create temp drag line in proto-layer
  let svg=document.getElementById('proto-layer').querySelector('svg.proto-svg');
  if (!svg){ svg=document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.classList.add('proto-svg'); svg.style.cssText='position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;pointer-events:none;'; document.getElementById('proto-layer').appendChild(svg); }
  const el=getEl(fromId);
  const fx=(el.x+el.w)*S.zoom+S.panX, fy=(el.y+el.h/2)*S.zoom+S.panY;
  const dragLine=document.createElementNS('http://www.w3.org/2000/svg','line');
  dragLine.id='proto-drag-line'; dragLine.classList.add('proto-arrow-path');
  dragLine.setAttribute('x1',fx); dragLine.setAttribute('y1',fy);
  dragLine.setAttribute('x2',ev.clientX); dragLine.setAttribute('y2',ev.clientY);
  dragLine.setAttribute('stroke','#7c6aee'); dragLine.setAttribute('stroke-width','1.5');
  dragLine.setAttribute('stroke-dasharray','6 4');
  svg.appendChild(dragLine);
}

document.addEventListener('mousemove', ev => {
  // Pen tool: preview line + bezier handle drag
  if (S.tool === 'pen' && _pen.active && _pen.el) {
    const pos = screenToCanvas(ev.clientX, ev.clientY);
    _pen.previewPt = pos;
    if (ev.buttons === 1 && _pen.dragAnchor) {
      const dx = pos.x - _pen.dragAnchor.x, dy = pos.y - _pen.dragAnchor.y;
      _pen.dragAnchor.cp2x = _pen.dragAnchor.x + dx; _pen.dragAnchor.cp2y = _pen.dragAnchor.y + dy;
      _pen.dragAnchor.cp1x = _pen.dragAnchor.x - dx; _pen.dragAnchor.cp1y = _pen.dragAnchor.y - dy;
      _pen.dragAnchor.hasHandles = true;
      updateVectorBBox(_pen.el);
    }
    renderAll(); return;
  }
  // Proto drag: update temp line
  if (S._protoDrag) {
    const line=document.getElementById('proto-drag-line');
    if (line){ line.setAttribute('x2',ev.clientX); line.setAttribute('y2',ev.clientY); }
    return;
  }
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
  if (D.mode==='rotate'&&D.rotElId) {
    const el=getEl(D.rotElId); if(!el) return;
    const cx=el.x+el.w/2, cy=el.y+el.h/2;
    const curAngle=Math.atan2(pos.y-cy, pos.x-cx)*180/Math.PI;
    let newRot=D.rotStart+(curAngle-D.rotStartAngle);
    if (ev.shiftKey) newRot=Math.round(newRot/15)*15;
    el.rotation=((newRot%360)+360)%360;
    renderAll(); updateProps(); return;
  }
  if (D.mode==='group-resize'&&D.groupBBox&&D.groupEls) {
    const dx=pos.x-D.startPos.x, dy=pos.y-D.startPos.y;
    let {x:bx,y:by,w:bw,h:bh}=D.groupBBox, dir=D.resizeHandle;
    let nw=bw, nh=bh, nx=bx, ny=by;
    if (dir.includes('e')) nw=Math.max(8,bw+dx);
    if (dir.includes('s')) nh=Math.max(8,bh+dy);
    if (dir.includes('w')){nx=bx+dx;nw=Math.max(8,bw-dx);}
    if (dir.includes('n')){ny=by+dy;nh=Math.max(8,bh-dy);}
    const sx=nw/bw, sy=nh/bh;
    D.groupEls.forEach(({id,x:rx,y:ry,w:rw,h:rh})=>{
      const el=getEl(id); if(!el) return;
      el.x=Math.round(nx+rx*sx); el.y=Math.round(ny+ry*sy);
      el.w=Math.max(4,Math.round(rw*sx)); el.h=Math.max(4,Math.round(rh*sy));
    });
    renderAll(); updateProps(); return;
  }
  // Auto-layout reorder: drag a child to re-order siblings
  if (D.mode==='al-reorder'&&D.alEl&&D.alParent) {
    const _al=D.alParent.autoLayout;
    const _siblings=S.els.filter(e=>e.parentId===D.alParent.id&&e.page===S.page&&e.id!==D.alEl.id);
    let _insertIdx=_siblings.length;
    if (_al.direction==='horizontal') {
      for(let i=0;i<_siblings.length;i++){if(pos.x<_siblings[i].x+_siblings[i].w/2){_insertIdx=i;break;}}
    } else {
      for(let i=0;i<_siblings.length;i++){if(pos.y<_siblings[i].y+_siblings[i].h/2){_insertIdx=i;break;}}
    }
    // Remove alEl from its current position and re-insert at new slot
    const _alIdx=S.els.indexOf(D.alEl);
    if(_alIdx!==-1) S.els.splice(_alIdx,1);
    const _updSiblings=S.els.filter(e=>e.parentId===D.alParent.id&&e.page===S.page);
    if(!_updSiblings.length){ S.els.push(D.alEl); }
    else if(_insertIdx>=_updSiblings.length){
      const _li=S.els.indexOf(_updSiblings[_updSiblings.length-1]);
      if(_li!==-1) S.els.splice(_li+1,0,D.alEl); else S.els.push(D.alEl);
    } else {
      const _ti=S.els.indexOf(_updSiblings[_insertIdx]);
      if(_ti!==-1) S.els.splice(_ti,0,D.alEl); else S.els.push(D.alEl);
    }
    renderAll(); return;
  }
});

document.addEventListener('mouseup', ev => {
  // Pen tool: stop dragging bezier handle
  if (S.tool === 'pen' && _pen.active) { _pen.dragAnchor = null; }
  // Proto drag-to-connect: find target frame under cursor
  if (S._protoDrag) {
    S._protoDrag=false;
    const fromId=S._protoDragFrom; S._protoDragFrom=null;
    // Remove temp line
    document.getElementById('proto-drag-line')?.remove();
    // Hit-test: find a frame under the cursor (excluding source)
    const pos=screenToCanvas(ev.clientX, ev.clientY);
    const frames=S.els.filter(e=>e.page===S.page&&e.type==='frame'&&e.id!==fromId&&!e.locked);
    const target=frames.find(f=>pos.x>=f.x&&pos.x<=f.x+f.w&&pos.y>=f.y&&pos.y<=f.y+f.h);
    if (target) {
      const fromEl=getEl(fromId);
      if (!fromEl.interactions) fromEl.interactions=[];
      fromEl.interactions.push({trigger:'click',action:'navigate',target:target.id,animation:'dissolve',duration:300,delayMs:1000});
      S._selConn={fromId,idx:fromEl.interactions.length-1};
      notify(`Connected to "${target.name}"`);
    }
    renderAll(); updateProtoPanel(); return;
  }
  if (D.mode==='al-reorder'){ D.alEl=null; D.alParent=null; updateLayers(); }
  if (D.mode==='pan'){canvasWrap.classList.remove('panning');}
  if (D.mode==='marquee'){selBoxEl.style.display='none'; updateProps();}
  if (D.mode==='draw'){
    if (D.drawEl&&D.drawEl.w<4&&D.drawEl.h<4&&S.tool!=='text'){D.drawEl.w=120;D.drawEl.h=80;}
    if (S.tool==='text'||S.tool==='frame'||S.tool==='section'||S.tool==='rect'||S.tool==='ellipse'||S.tool==='line') setTool('select');
    // Adopt newly drawn element into a frame if it lands inside one (not sections/frames)
    if (D.drawEl && D.drawEl.type!=='frame' && D.drawEl.type!=='section') {
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
  if (D.mode==='rotate'){ D.rotElId=null; if(S.coachOn) runCoach(); }
  D.mode=null;
});

function startMove(ev, skipUndo) {
  if (!skipUndo) pushUndo();
  // Auto-layout child: enter reorder mode instead of free move
  if (S.selIds.length===1) {
    const _mEl=getEl(S.selIds[0]);
    if (_mEl && _mEl.parentId) {
      const _mPar=getEl(_mEl.parentId);
      if (_mPar && _mPar.autoLayout) {
        D.mode='al-reorder'; D.startPos=screenToCanvas(ev.clientX,ev.clientY);
        D.alEl=_mEl; D.alParent=_mPar; return;
      }
    }
  }
  D.mode='move'; D.startPos=screenToCanvas(ev.clientX,ev.clientY);
  D.moveStarts={};
  S.selIds.forEach(id=>{ const el=getEl(id); if(el) D.moveStarts[id]={x:el.x,y:el.y}; });
}

function startRotate(ev, id) {
  pushUndo();
  D.mode = 'rotate';
  const el = getEl(id); if (!el) return;
  if (!S.selIds.includes(id)) S.selIds = [id];
  const pos = screenToCanvas(ev.clientX, ev.clientY);
  D.rotElId = id;
  D.rotStart = el.rotation || 0;
  D.rotStartAngle = Math.atan2(pos.y - (el.y + el.h/2), pos.x - (el.x + el.w/2)) * 180 / Math.PI;
}

function startResize(ev, id, dir) {
  pushUndo();
  D.mode='resize'; D.resizeHandle=dir;
  D.startPos=screenToCanvas(ev.clientX,ev.clientY);
  const el=getEl(id); D.resizeElStart={x:el.x,y:el.y,w:el.w,h:el.h};
  if (!S.selIds.includes(id)) S.selIds=[id];
}

// ── Canvas right-click context menu ──────────────────────────
canvasWrap.addEventListener('contextmenu', ev => {
  ev.preventDefault();
  const existing = document.getElementById('canvas-ctx');
  if (existing) existing.remove();
  if (!S.selIds.length) return;
  const el = getEl(S.selIds[0]);
  if (!el) return;

  const menu = document.createElement('div');
  menu.id = 'canvas-ctx';
  menu.style.cssText = `position:fixed;left:${ev.clientX}px;top:${ev.clientY}px;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:9999;padding:4px;min-width:170px;font-size:12px;`;

  const items = [];
  if ((el.type==='frame'||el.type==='group') && !el.isComponent && !el.componentId)
    items.push({label:'⬡ Create Component', fn:'createComponent()'});
  if (el.isComponent)
    items.push({label:'+ Place Instance', fn:`createInstance(${el.id})`});
  // Any shape (not already a component/instance) can become a component
  if (!el.isComponent && !el.componentId)
    items.push({label:'⬡ Create Component', fn:'createComponent()'});
  if (el.isComponent)
    items.push({label:'◆ Place Instance', fn:`createInstance(${el.id})`});
  if (!el.isComponent && el.componentId) {
    items.push({label:'↗ Go to Master', fn:`goToMaster(${el.id})`});
    if (Object.keys(el.overrides||{}).length)
      items.push({label:'↑ Push to Master', fn:`pushToMaster(${el.id})`});
    items.push({label:'⊘ Detach Instance', fn:`detachInstance(${el.id})`});
  }
  items.push({sep:true});
  // items.push({label:'Duplicate  ⌘D', fn:'duplicateSelected()'});
  // items.push({label:'Delete  Del', fn:'deleteSelected()'});
  if (S.selIds.length >= 2) items.push({label:'Group  ⌘G', fn:'groupSelected()'});

  items.forEach(it => {
    if (it.sep) {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:var(--border);margin:3px 0;';
      menu.appendChild(sep); return;
    }
    const row = document.createElement('div');
    row.style.cssText = 'padding:7px 12px;cursor:pointer;border-radius:5px;color:var(--text1);display:flex;gap:8px;';
    row.textContent = it.label;
    row.addEventListener('mouseenter', () => row.style.background='var(--bg3)');
    row.addEventListener('mouseleave', () => row.style.background='');
    row.addEventListener('mousedown', ev2 => { ev2.preventDefault(); menu.remove(); new Function(it.fn)(); });
    menu.appendChild(row);
  });

  document.body.appendChild(menu);
  const dismiss = () => { menu.remove(); document.removeEventListener('mousedown', dismiss); };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
});

canvasWrap.addEventListener('wheel', ev => {
  ev.preventDefault();
  if (ev.ctrlKey || ev.metaKey) {
    // Pinch-to-zoom (trackpad) or Ctrl/Cmd + scroll (mouse wheel)
    const r=canvasWrap.getBoundingClientRect();
    const mx=ev.clientX-r.left, my=ev.clientY-r.top;
    const delta=ev.deltaY>0?0.9:1.1;
    const nz=Math.max(0.1,Math.min(4,S.zoom*delta));
    S.panX=mx-(mx-S.panX)*(nz/S.zoom); S.panY=my-(my-S.panY)*(nz/S.zoom);
    S.zoom=nz; applyTransform(); renderGrid();
  } else {
    // Two-finger scroll (trackpad) or plain scroll wheel — pan the canvas
    S.panX -= ev.deltaX;
    S.panY -= ev.deltaY;
    applyTransform(); renderGrid();
  }
},{passive:false});

// ════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ════════════════════════════════════════════════════════════
document.addEventListener('keydown', ev => {
  if (['INPUT','TEXTAREA'].includes(ev.target.tagName)||ev.target.contentEditable==='true') return;
  const k=ev.key.toLowerCase(), ctrl=ev.ctrlKey||ev.metaKey;

  // Space = temporary pan (hold to pan, release to restore)
  if (ev.key===' '&&!ctrl) {
    ev.preventDefault();
    if (!S._spacePanning) { S._spacePanning=true; S._prevTool=S.tool; setTool('grab'); }
    return;
  }

  // Alt for measure
  if (ev.key==='Alt'){ S.altDown=true; document.getElementById('st-alt').style.display='flex'; renderMeasure(); }

  // Tool shortcuts (no modifier)
  if (!ctrl && !ev.altKey){
    if (k==='v' && !ev.shiftKey) setTool('select');
    if (k==='h' && !ev.shiftKey) setTool('grab');
    if (k==='r' && !ev.shiftKey) setTool('rect');
    if (k==='e') setTool('ellipse');
    if (k==='o') setTool('ellipse');
    if (k==='l' && !ev.shiftKey) setTool('line');
    if (k==='t') setTool('text');
    if (k==='f') setTool('frame');
    if (k==='s' && ev.shiftKey) { ev.preventDefault(); setTool('section'); }
    if (k==='c') setTool('comment');
    if (k==='p' && !ev.shiftKey) setTool('pen');
    if (k==='p' && ev.shiftKey) toggleProto();
    if (k==='g' && !ev.shiftKey) toggleGrid();
    if (k==='s' && !ev.shiftKey) toggleSnap();
    if (k==='escape'){
      if (_pen.active) { _finishPen(); return; }
      if (S.selIds.length===1) {
        const el=getEl(S.selIds[0]);
        if (el && el.parentId) { S.selIds=[el.parentId]; renderAll(); updateProps(); return; }
      }
      S.selIds=[]; S.protoFrom=null; renderAll(); updateProps();
    }
    if ((k==='delete'||k==='backspace')&&S.selIds.length) deleteSelected();
    // Enter → drill into frame/group children
    if (k==='enter'){ ev.preventDefault(); enterChildren(); return; }
    // Tab → next/prev sibling
    if (k==='tab'){ ev.preventDefault(); siblingNav(ev.shiftKey?-1:1); return; }
    // Z-order
    if (k===']' && !ev.shiftKey) bringToFront();
    if (k==='[' && !ev.shiftKey) sendToBack();
    // Flip
    if (k==='h' && ev.shiftKey){ ev.preventDefault(); flipSelected('h'); }
    if (k==='v' && ev.shiftKey){ ev.preventDefault(); flipSelected('v'); }
    // Auto layout
    if (k==='a' && ev.shiftKey){ ev.preventDefault(); if(S.selIds.length===1) toggleAutoLayout(S.selIds[0]); }
    // Zoom to fit / selection
    if (k==='1' && ev.shiftKey){ ev.preventDefault(); zoomToFit(); return; }
    if (k==='2' && ev.shiftKey){ ev.preventDefault(); zoomToSel(); return; }
    // Page navigation
    if (ev.key==='PageUp'){ ev.preventDefault(); prevPage(); return; }
    if (ev.key==='PageDown'){ ev.preventDefault(); nextPage(); return; }
  }

  // Alt combos (no Ctrl)
  if (!ctrl && ev.altKey){
    if (k==='a' && !ev.shiftKey){ ev.preventDefault(); alignEls('left'); return; }
    if (k==='d' && !ev.shiftKey){ ev.preventDefault(); alignEls('right'); return; }
    if (k==='w' && !ev.shiftKey){ ev.preventDefault(); alignEls('top'); return; }
    if (k==='s' && !ev.shiftKey){ ev.preventDefault(); alignEls('bottom'); return; }
    if (k==='h' && !ev.shiftKey){ ev.preventDefault(); alignEls('centerH'); return; }
    if (k==='v' && !ev.shiftKey){ ev.preventDefault(); alignEls('centerV'); return; }
    if (k==='h' && ev.shiftKey){ ev.preventDefault(); distributeEls('h'); return; }
    if (k==='v' && ev.shiftKey){ ev.preventDefault(); distributeEls('v'); return; }
    if (k==='a' && ev.shiftKey){ ev.preventDefault(); if(S.selIds.length===1){ const el=getEl(S.selIds[0]); if(el&&el.autoLayout){ el.autoLayout=null; renderAll(); notify('Auto layout removed'); } } return; }
    // Panel shortcuts
    if (ev.key==='1'){ ev.preventDefault(); document.getElementById('left-panel').style.display=getComputedStyle(document.getElementById('left-panel')).display==='none'?'':'none'; return; }
    if (ev.key==='8'){ ev.preventDefault(); switchRightTab('design'); return; }
    if (ev.key==='9'){ ev.preventDefault(); switchRightTab('proto'); return; }
  }

  // Ctrl combos
  if (ctrl&&k==='d'){ ev.preventDefault(); duplicateSelected(); }
  if (ctrl&&k==='g'&&!ev.shiftKey){ ev.preventDefault(); groupSelected(); }
  if (ctrl&&k==='g'&&ev.shiftKey){ ev.preventDefault(); ungroupSelected(); }
  if (ctrl&&k==='a'&&!ev.shiftKey){ ev.preventDefault(); S.selIds=S.els.filter(e=>e.page===S.page).map(e=>e.id); renderAll(); updateProps(); }
  if (ctrl&&k==='a'&&ev.shiftKey){ ev.preventDefault(); const all=S.els.filter(e=>e.page===S.page).map(e=>e.id); S.selIds=all.filter(id=>!S.selIds.includes(id)); renderAll(); updateProps(); }
  if (ctrl&&k==='z'&&!ev.shiftKey){ ev.preventDefault(); undo(); }
  if (ctrl&&k==='z'&&ev.shiftKey){ ev.preventDefault(); redo(); }
  // Copy / Cut / Paste
  if (ctrl&&k==='c'&&!ev.shiftKey){ ev.preventDefault(); copySelected(); }
  if (ctrl&&k==='x'){ ev.preventDefault(); cutSelected(); }
  if (ctrl&&k==='v'&&ev.shiftKey){ ev.preventDefault(); pasteSelected(true); }
  if (ctrl&&k==='v'&&!ev.shiftKey&&!ev.altKey){ ev.preventDefault(); pasteSelected(); }
  // Z-order
  if (ctrl&&ev.key===']'){ ev.preventDefault(); bringForward(); }
  if (ctrl&&ev.key==='['){ ev.preventDefault(); sendBackward(); }
  // Rename
  if (ctrl&&k==='r'&&!ev.shiftKey){ ev.preventDefault(); renameSelected(); }
  // Find (stub)
  if (ctrl&&k==='f'){ ev.preventDefault(); notify('Find / search (coming soon)'); }
  // Quick actions / shortcuts (stub)
  if (ctrl&&ev.key==='/'){ ev.preventDefault(); notify('Quick actions (coming soon)'); }
  // Toggle UI
  if (ctrl&&ev.key==='\\'){ ev.preventDefault(); toggleUI(); }
  // Hide / Lock selected
  if (ctrl&&ev.shiftKey&&k==='h'){ ev.preventDefault(); toggleHideSelected(); }
  if (ctrl&&ev.shiftKey&&k==='l'){ ev.preventDefault(); toggleLockSelected(); }
  // Text formatting
  if (ctrl&&k==='b'){ ev.preventDefault(); toggleBold(); }
  if (ctrl&&k==='i'&&!ev.shiftKey){ ev.preventDefault(); toggleItalic(); }
  // Zoom — Ctrl+0 to 100%
  if (ctrl&&k==='0'){ ev.preventDefault(); resetZoom(); }

  // Zoom (no ctrl)
  if (!ctrl){
    if (ev.key==='='||ev.key==='+'){ S.zoom=Math.min(4,S.zoom*1.15); applyTransform(); renderGrid(); }
    if (ev.key==='-'){ S.zoom=Math.max(.1,S.zoom/1.15); applyTransform(); renderGrid(); }
    // Number keys: opacity when selection, zoom when empty
    if (/^[0-9]$/.test(ev.key)&&!ev.shiftKey&&!ev.altKey){
      if (S.selIds.length){
        ev.preventDefault();
        const pct=ev.key==='0'?100:parseInt(ev.key)*10;
        S.selIds.forEach(id=>{ const el=getEl(id); if(el) el.opacity=pct; });
        renderAll(); updateProps();
      } else {
        if (k==='0') resetZoom();
        if (k==='1'){ S.zoom=1; applyTransform(); renderGrid(); }
        if (k==='2'){ S.zoom=2; applyTransform(); renderGrid(); }
      }
    }
  }

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
  if (ev.key===' ') { if (S._spacePanning) { S._spacePanning=false; setTool(S._prevTool); } }
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
// SHORTCUT HELPERS
// ════════════════════════════════════════════════════════════

// ── Clipboard ──
let _clipboard = [];
// ── Layer panel state ──
let _lyrDrag = { active: false, el: null, dropTarget: null, dropBefore: true };
let _lastLayerClickId = null;
function copySelected() {
  if (!S.selIds.length) return;
  _clipboard = S.selIds.map(id=>JSON.parse(JSON.stringify(getEl(id)))).filter(Boolean);
  notify(`Copied ${_clipboard.length} element${_clipboard.length>1?'s':''}`);
}
function cutSelected() { copySelected(); deleteSelected(); }
function pasteSelected(inPlace = false) {
  if (!_clipboard.length) return;
  const newIds = [];
  _clipboard.forEach(orig=>{
    const offset = inPlace ? 0 : 16;
    const el = {...JSON.parse(JSON.stringify(orig)), id:S.nextId++, x:orig.x+offset, y:orig.y+offset};
    S.els.push(el); newIds.push(el.id);
  });
  S.selIds = newIds;
  renderAll(); updateProps();
  notify(`Pasted ${newIds.length} element${newIds.length>1?'s':''}`);
}

// ── Z-order ──
function bringForward() {
  if (!S.selIds.length) return;
  [...S.selIds].reverse().forEach(id=>{
    const i=S.els.findIndex(e=>e.id===id);
    if (i<S.els.length-1) [S.els[i],S.els[i+1]]=[S.els[i+1],S.els[i]];
  });
  renderAll();
}
function sendBackward() {
  if (!S.selIds.length) return;
  S.selIds.forEach(id=>{
    const i=S.els.findIndex(e=>e.id===id);
    if (i>0) [S.els[i],S.els[i-1]]=[S.els[i-1],S.els[i]];
  });
  renderAll();
}
function bringToFront() {
  if (!S.selIds.length) return;
  const toMove=S.selIds.map(id=>getEl(id)).filter(Boolean);
  S.els=S.els.filter(e=>!S.selIds.includes(e.id)).concat(toMove);
  renderAll();
}
function sendToBack() {
  if (!S.selIds.length) return;
  const toMove=S.selIds.map(id=>getEl(id)).filter(Boolean);
  S.els=toMove.concat(S.els.filter(e=>!S.selIds.includes(e.id)));
  renderAll();
}

// ════════════════════════════════════════════════════════════
// PEN TOOL
// ════════════════════════════════════════════════════════════
let _pen = { active: false, el: null, previewPt: null, dragAnchor: null };

function buildVectorPath(el) {
  const pts = el.pathData;
  if (!pts || pts.length < 2) return '';
  const ox = el.x, oy = el.y;
  let d = `M ${pts[0].x-ox} ${pts[0].y-oy}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i-1], cur = pts[i];
    const c1x=(prev.cp2x??prev.x)-ox, c1y=(prev.cp2y??prev.y)-oy;
    const c2x=(cur.cp1x??cur.x)-ox,  c2y=(cur.cp1y??cur.y)-oy;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${cur.x-ox} ${cur.y-oy}`;
  }
  if (el.pathClosed && pts.length >= 2) {
    const last=pts[pts.length-1], first=pts[0];
    const c1x=(last.cp2x??last.x)-ox, c1y=(last.cp2y??last.y)-oy;
    const c2x=(first.cp1x??first.x)-ox, c2y=(first.cp1y??first.y)-oy;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${first.x-ox} ${first.y-oy} Z`;
  }
  return d;
}

function updateVectorBBox(el) {
  if (!el.pathData || !el.pathData.length) return;
  const xs = [], ys = [];
  el.pathData.forEach(p => {
    xs.push(p.x, p.cp1x??p.x, p.cp2x??p.x);
    ys.push(p.y, p.cp1y??p.y, p.cp2y??p.y);
  });
  const minX=Math.min(...xs), minY=Math.min(...ys);
  const maxX=Math.max(...xs), maxY=Math.max(...ys);
  el.x=minX; el.y=minY;
  el.w=Math.max(1,maxX-minX); el.h=Math.max(1,maxY-minY);
}

function _finishPen() {
  if (!_pen.el) return;
  if (_pen.el.pathData && _pen.el.pathData.length >= 2) updateVectorBBox(_pen.el);
  else if (_pen.el.pathData && _pen.el.pathData.length < 2) {
    // Single point — remove the element
    S.els = S.els.filter(e => e.id !== _pen.el.id);
  }
  _pen.active = false; _pen.previewPt = null; _pen.dragAnchor = null;
  const id = _pen.el ? _pen.el.id : null;
  _pen.el = null;
  if (id) S.selIds = [id];
  setTool('select');
  renderAll(); updateProps(); updateLayers();
}

function _renderPenHandles(svgDom, el) {
  if (!el.pathData) return;
  const ox = el.x, oy = el.y;
  el.pathData.forEach(pt => {
    if (pt.hasHandles) {
      [[pt.cp1x,pt.cp1y],[pt.cp2x,pt.cp2y]].forEach(([hx,hy]) => {
        const ln = document.createElementNS('http://www.w3.org/2000/svg','line');
        ln.setAttribute('x1',pt.x-ox); ln.setAttribute('y1',pt.y-oy);
        ln.setAttribute('x2',hx-ox); ln.setAttribute('y2',hy-oy);
        ln.setAttribute('stroke','rgba(124,106,238,.5)'); ln.setAttribute('stroke-width','1');
        ln.setAttribute('pointer-events','none'); svgDom.appendChild(ln);
        const hd = document.createElementNS('http://www.w3.org/2000/svg','circle');
        hd.setAttribute('cx',hx-ox); hd.setAttribute('cy',hy-oy); hd.setAttribute('r',3);
        hd.setAttribute('fill','var(--accent)'); hd.setAttribute('stroke','#fff'); hd.setAttribute('stroke-width','1');
        svgDom.appendChild(hd);
      });
    }
    const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
    dot.setAttribute('cx',pt.x-ox); dot.setAttribute('cy',pt.y-oy); dot.setAttribute('r',4);
    dot.setAttribute('fill','#fff'); dot.setAttribute('stroke','var(--accent)'); dot.setAttribute('stroke-width','1.5');
    svgDom.appendChild(dot);
  });
}

// ════════════════════════════════════════════════════════════
// EFFECTS SYSTEM
// ════════════════════════════════════════════════════════════
const _NOISE_SVG = "data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E";

function applyEffectsToEl(dom, el) {
  if (!el.effects || !el.effects.length) return;
  const vis = el.effects.filter(f => f.visible);
  if (!vis.length) return;
  const shadows = [], filters = [], bFilters = [];
  vis.forEach(ef => {
    if (ef.type === 'drop-shadow') {
      const rgba = `rgba(${hexToRgbArr(ef.color||'#000')},${((ef.opacity??25)/100).toFixed(2)})`;
      shadows.push(`${ef.x??2}px ${ef.y??4}px ${ef.blur??8}px ${ef.spread??0}px ${rgba}`);
    } else if (ef.type === 'inner-shadow') {
      const rgba = `rgba(${hexToRgbArr(ef.color||'#000')},${((ef.opacity??25)/100).toFixed(2)})`;
      shadows.push(`inset ${ef.x??2}px ${ef.y??4}px ${ef.blur??8}px ${ef.spread??0}px ${rgba}`);
    } else if (ef.type === 'layer-blur') {
      filters.push(`blur(${ef.radius??8}px)`);
    } else if (ef.type === 'bg-blur') {
      bFilters.push(`blur(${ef.radius??12}px)`);
    } else if (ef.type === 'noise') {
      dom.style.setProperty('--noise-op', ((ef.amount??20)/100).toFixed(2));
      dom.classList.add('has-noise');
    } else if (ef.type === 'glass') {
      bFilters.push(`blur(${ef.radius??12}px) saturate(180%)`);
      dom.classList.add('has-glass');
    } else if (ef.type === 'texture') {
      const overlay = document.createElement('div');
      overlay.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:30;border-radius:inherit;`
        + `background-image:${_textureDataUri(ef.preset||'noise', ef.scale??65)};`
        + `background-size:${ef.preset==='dots'||ef.preset==='lines'||ef.preset==='grid'?'auto':'cover'};`
        + `opacity:${((ef.opacity??20)/100).toFixed(2)};mix-blend-mode:${ef.blend||'overlay'};`;
      dom.style.overflow = 'hidden';
      dom.appendChild(overlay);
    }
  });
  if (shadows.length) dom.style.boxShadow = shadows.join(', ');
  if (filters.length) dom.style.filter = filters.join(' ');
  if (bFilters.length) dom.style.backdropFilter = bFilters.join(' ');
}

function addEff(elId) {
  const el = getEl(elId); if (!el) return;
  if (!el.effects) el.effects = [];
  el.effects.push({type:'drop-shadow',visible:true,color:'#000000',opacity:25,x:2,y:4,blur:8,spread:0,radius:8,amount:20});
  renderAll(); updateProps();
}
function deleteEff(elId, idx) {
  const el = getEl(elId); if (!el||!el.effects) return;
  el.effects.splice(idx, 1); renderAll(); updateProps();
}
function toggleEffVis(elId, idx) {
  const el = getEl(elId); if (!el||!el.effects) return;
  el.effects[idx].visible = !el.effects[idx].visible; renderAll(); updateProps();
}
function setEff(elId, idx, key, val) {
  const el = getEl(elId); if (!el||!el.effects) return;
  el.effects[idx][key] = val; renderAll();
}
function changeEffType(elId, idx, newType) {
  const el = getEl(elId); if (!el||!el.effects) return;
  el.effects[idx].type = newType; renderAll(); updateProps();
}

// ── Flip ──
function flipSelected(axis) {
  if (!S.selIds.length) return;
  S.selIds.forEach(id=>{ const el=getEl(id); if(!el) return;
    if (axis==='h') el.flipH=!el.flipH; else el.flipV=!el.flipV;
  });
  renderAll();
}

// ── Zoom to fit / selection ──
function zoomToFit() {
  const els=S.els.filter(e=>e.page===S.page&&!e.parentId);
  if (!els.length){ resetZoom(); return; }
  const minX=Math.min(...els.map(e=>e.x)), minY=Math.min(...els.map(e=>e.y));
  const maxX=Math.max(...els.map(e=>e.x+e.w)), maxY=Math.max(...els.map(e=>e.y+e.h));
  const vw=canvasWrap.clientWidth-80, vh=canvasWrap.clientHeight-80;
  S.zoom=Math.min(4,Math.max(0.1,Math.min(vw/(maxX-minX||1),vh/(maxY-minY||1))));
  S.panX=(vw/2+40)-(minX+(maxX-minX)/2)*S.zoom;
  S.panY=(vh/2+40)-(minY+(maxY-minY)/2)*S.zoom;
  applyTransform(); renderGrid();
}
function zoomToSel() {
  if (!S.selIds.length){ zoomToFit(); return; }
  const els=S.selIds.map(id=>getEl(id)).filter(Boolean);
  const minX=Math.min(...els.map(e=>e.x)), minY=Math.min(...els.map(e=>e.y));
  const maxX=Math.max(...els.map(e=>e.x+e.w)), maxY=Math.max(...els.map(e=>e.y+e.h));
  const vw=canvasWrap.clientWidth-80, vh=canvasWrap.clientHeight-80;
  S.zoom=Math.min(4,Math.max(0.1,Math.min(vw/(maxX-minX||1),vh/(maxY-minY||1))));
  S.panX=(vw/2+40)-(minX+(maxX-minX)/2)*S.zoom;
  S.panY=(vh/2+40)-(minY+(maxY-minY)/2)*S.zoom;
  applyTransform(); renderGrid();
}

// ── Layer navigation ──
function enterChildren() {
  if (S.selIds.length!==1) return;
  const el=getEl(S.selIds[0]); if(!el) return;
  const children=S.els.filter(e=>e.parentId===el.id&&e.page===S.page&&e.visible&&!e.locked);
  if (children.length){ S.selIds=[children[children.length-1].id]; renderAll(); updateProps(); }
}
function siblingNav(dir) {
  if (S.selIds.length!==1) return;
  const el=getEl(S.selIds[0]); if(!el) return;
  const siblings=S.els.filter(e=>e.parentId===el.parentId&&e.page===S.page&&e.visible&&!e.locked);
  if (!siblings.length) return;
  const idx=siblings.findIndex(e=>e.id===el.id);
  const next=dir===1?(idx+1)%siblings.length:(idx-1+siblings.length)%siblings.length;
  S.selIds=[siblings[next].id]; renderAll(); updateProps();
}

// ── Page navigation ──
function prevPage() {
  const idx=S.pages.findIndex(p=>p.id===S.page);
  if (idx>0){ S.page=S.pages[idx-1].id; S.selIds=[]; renderAll(); updatePages(); updateProps(); }
}
function nextPage() {
  const idx=S.pages.findIndex(p=>p.id===S.page);
  if (idx<S.pages.length-1){ S.page=S.pages[idx+1].id; S.selIds=[]; renderAll(); updatePages(); updateProps(); }
}

// ── Visibility / Lock ──
function toggleHideSelected() {
  if (!S.selIds.length) return;
  S.selIds.forEach(id=>{ const e=getEl(id); if(e) e.visible=!e.visible; });
  renderAll(); updateLayers();
}
function toggleLockSelected() {
  if (!S.selIds.length) return;
  S.selIds.forEach(id=>{ const e=getEl(id); if(!e) return; e.locked=!e.locked; if(e.locked) S.selIds=S.selIds.filter(i=>i!==id); });
  renderAll(); updateLayers(); updateProps();
}

// ── Rename ──
function renameSelected() {
  if (S.selIds.length!==1) return;
  const el=getEl(S.selIds[0]); if(!el) return;
  const span=document.querySelector('.lyr.on .lyr-name');
  if (span) startLayerRename(span, el);
}

// ── Text formatting ──
function toggleBold() {
  S.selIds.forEach(id=>{ const el=getEl(id); if(!el||el.type!=='text') return;
    el.fontWeight=parseInt(el.fontWeight||400)>=600?'400':'700';
  });
  renderAll(); updateProps();
}
function toggleItalic() {
  S.selIds.forEach(id=>{ const el=getEl(id); if(!el||el.type!=='text') return;
    el.fontStyle=el.fontStyle==='italic'?'normal':'italic';
  });
  renderAll(); updateProps();
}

// ── Toggle UI panels ──
function toggleUI() {
  const lp=document.getElementById('left-panel');
  const hide=getComputedStyle(lp).display!=='none';
  ['left-panel','right-panel','topbar'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display=hide?'none':''; });
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
  const kit=ev.dataTransfer.getData('kit');
  if (kit) { const pos=screenToCanvas(ev.clientX,ev.clientY); spawnKit(kit,snapV(pos.x),snapV(pos.y)); return; }
  // File drops (images / videos)
  const files=Array.from(ev.dataTransfer.files||[]);
  if (files.length) { const pos=screenToCanvas(ev.clientX,ev.clientY); files.forEach(f=>handleMediaDrop(f,pos.x,pos.y)); }
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
  document.querySelectorAll('.mode-tab').forEach(t=>t.classList.remove('on'));
  document.getElementById(S.protoMode?'mode-proto':'mode-design')?.classList.add('on');
  S.protoFrom=null; S._selConn=null; S._protoDrag=false; S._protoDragFrom=null;
  document.getElementById('proto-layer').classList.toggle('active', S.protoMode);
  if (S.protoMode) switchRightTab('proto');
  else switchRightTab('design');
  notify(S.protoMode?'Prototype mode — drag the blue handle to wire connections':'Design mode');
  renderAll(); updateProtoPanel();
  if (!S.protoMode) updateProps();
}

// ── Interaction arrow rendering ──
function renderProtoArrows() {
  const layer=document.getElementById('proto-layer');
  // Keep a persistent <svg> overlay
  let svg=layer.querySelector('svg.proto-svg');
  if (!svg){
    svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.classList.add('proto-svg');
    svg.style.cssText='position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;pointer-events:none;';
    layer.appendChild(svg);
  }
  svg.innerHTML='';
  if (!S.protoMode) return;

  // Build defs once (shared markers)
  const defs=document.createElementNS('http://www.w3.org/2000/svg','defs');
  defs.innerHTML=`
    <marker id="arr-tip" markerWidth="8" markerHeight="8" refX="6" refY="3.5" orient="auto">
      <path d="M0,0 L7,3.5 L0,7 Z" fill="#7c6aee"/>
    </marker>
    <marker id="arr-tip-sel" markerWidth="8" markerHeight="8" refX="6" refY="3.5" orient="auto">
      <path d="M0,0 L7,3.5 L0,7 Z" fill="#fff"/>
    </marker>`;
  svg.appendChild(defs);

  // Draw one arrow per interaction
  S.els.forEach(el=>{
    if (!el.interactions?.length || el.page!==S.page) return;
    el.interactions.forEach((ix, idx)=>{
      const to=getEl(ix.target); if(!to) return;
      const isSel = S._selConn && S._selConn.fromId===el.id && S._selConn.idx===idx;

      // Source point: right center of element
      const fx=(el.x+el.w)*S.zoom+S.panX, fy=(el.y+el.h/2)*S.zoom+S.panY;
      // Target point: left center of target
      const tx=(to.x)*S.zoom+S.panX,     ty=(to.y+to.h/2)*S.zoom+S.panY;
      const dx=Math.abs(tx-fx), cp=Math.max(60, dx*0.5);

      const g=document.createElementNS('http://www.w3.org/2000/svg','g');
      g.style.pointerEvents='all';
      g.style.cursor='pointer';

      // Hit-test transparent thick path
      const hit=document.createElementNS('http://www.w3.org/2000/svg','path');
      hit.setAttribute('d',`M${fx},${fy} C${fx+cp},${fy} ${tx-cp},${ty} ${tx},${ty}`);
      hit.setAttribute('fill','none'); hit.setAttribute('stroke','transparent');
      hit.setAttribute('stroke-width','12');

      // Visible path
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');
      path.classList.add('proto-arrow-path');
      if (isSel) path.classList.add('sel');
      path.setAttribute('d',`M${fx},${fy} C${fx+cp},${fy} ${tx-cp},${ty} ${tx},${ty}`);
      path.setAttribute('fill','none');
      path.setAttribute('stroke', isSel?'#fff':'#7c6aee');
      path.setAttribute('stroke-width', isSel?'2':'1.5');
      path.setAttribute('stroke-dasharray', '7 4');
      path.setAttribute('marker-end', isSel?'url(#arr-tip-sel)':'url(#arr-tip)');

      // Trigger label bubble
      const mid=document.createElementNS('http://www.w3.org/2000/svg','text');
      const mx=(fx+tx)/2, my=Math.min(fy,ty)-14;
      mid.setAttribute('x', mx); mid.setAttribute('y', my);
      mid.setAttribute('text-anchor','middle');
      mid.style.cssText='font-size:9px;fill:'+(isSel?'#fff':'#a895ff')+';font-family:DM Sans,sans-serif;pointer-events:none;';
      mid.textContent=ix.trigger||'click';

      g.addEventListener('click', ev=>{
        ev.stopPropagation();
        S._selConn = (S._selConn&&S._selConn.fromId===el.id&&S._selConn.idx===idx) ? null : {fromId:el.id,idx};
        S.selIds=[el.id]; renderAll(); updateProtoPanel();
      });

      g.appendChild(hit); g.appendChild(path); g.appendChild(mid);
      svg.appendChild(g);
    });
  });
}

// ── Proto panel ──
function updateProtoPanel() {
  const noSel=document.getElementById('proto-no-sel');
  const selContent=document.getElementById('proto-sel-content');
  if (!noSel||!selContent) return;

  const el=S.selIds.length===1 ? getEl(S.selIds[0]) : null;
  // Only show content for prototypable elements (frames or children of frames)
  const prototypable = el && isPrototypable(el);
  const isFrame = el && el.type==='frame';

  if (!prototypable || !S.protoMode){
    noSel.style.display='block'; selContent.style.display='none'; return;
  }
  noSel.style.display='none'; selContent.style.display='block';

  // Flow starting point row (frames only)
  const flowSec=document.getElementById('proto-flow-sec');
  const flowBtn=document.getElementById('proto-flow-btn');
  const flowBadge=document.getElementById('proto-flow-badge');
  if (flowSec) flowSec.style.display=isFrame?'block':'none';
  if (isFrame&&flowBtn){
    // Show "+" when not set, "−" when set
    flowBtn.textContent=el.isFlowStart?'−':'+';
    flowBtn.classList.toggle('active',!!el.isFlowStart);
    flowBtn.title=el.isFlowStart?'Remove flow starting point':'Set as flow starting point';
  }
  if (flowBadge){
    flowBadge.style.display=(isFrame&&el.isFlowStart)?'flex':'none';
    if (isFrame&&el.isFlowStart){
      const fname = el.flowName || el.name || 'Flow 1';
      flowBadge.innerHTML=`
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style="flex-shrink:0;"><polygon points="2,1 9,5.5 2,10" fill="#f59e0b"/></svg>
        <input class="proto-flow-name-inp" value="${escHtml(fname)}" title="Double-click to rename flow"
          onchange="renameFlow(${el.id},this.value)"
          ondblclick="this.select()"
          onfocus="this.select()">
      `;
    }
  }

  // Interactions list
  const ixList=document.getElementById('proto-ix-list');
  if (ixList){ ixList.innerHTML=''; _renderIxList(el, ixList); }

  // Scroll behavior (frames only)
  const frameSec=document.getElementById('proto-frame-sec');
  const scrollSel=document.getElementById('proto-scroll-sel');
  if (frameSec) frameSec.style.display=isFrame?'block':'none';
  if (isFrame&&scrollSel) scrollSel.value=el.scrollBehavior||'none';
}

function _renderIxList(el, container) {
  const ixs=el.interactions||[];
  const frames=S.els.filter(e=>e.type==='frame'&&e.page===S.page&&e.id!==el.id);

  ixs.forEach((ix,idx)=>{
    const isSel=S._selConn&&S._selConn.fromId===el.id&&S._selConn.idx===idx;
    const card=document.createElement('div');
    card.className='proto-ix'+(isSel?' selected open':'');

    const trigLabels={click:'On click',hover:'While hovering',press:'While pressing',delay:'After delay'};
    const actLabels={navigate:'Navigate to',overlay:'Open overlay',closeOverlay:'Close overlay',changeState:'Change state'};
    const animLabels={instant:'Instant',dissolve:'Dissolve',slide:'Slide',smart:'Smart animate'};

    const targetEl=getEl(ix.target);
    const summary=`${trigLabels[ix.trigger]||ix.trigger} → ${targetEl?targetEl.name:'—'}`;

    card.innerHTML=`
      <div class="proto-ix-hdr">
        <svg width="8" height="8"><circle cx="4" cy="4" r="3" fill="none" stroke="var(--accent)" stroke-width="1.5"/></svg>
        <span>${escHtml(summary)}</span>
        <button class="proto-ix-del" onclick="deleteInteraction(${el.id},${idx});event.stopPropagation();">×</button>
        <span class="proto-ix-chevron">▶</span>
      </div>
      <div class="proto-ix-body">
        <div class="proto-field">
          <span class="proto-field-label">Trigger</span>
          <select onchange="updateInteraction(${el.id},${idx},'trigger',this.value)">
            ${Object.entries(trigLabels).map(([v,l])=>`<option value="${v}"${ix.trigger===v?' selected':''}>${l}</option>`).join('')}
          </select>
        </div>
        ${ix.trigger==='delay'?`<div class="proto-field"><span class="proto-field-label">Delay (ms)</span><input type="number" min="0" max="60000" value="${ix.delayMs||1000}" onchange="updateInteraction(${el.id},${idx},'delayMs',+this.value)"></div>`:''}
        <div class="proto-field">
          <span class="proto-field-label">Action</span>
          <select onchange="updateInteraction(${el.id},${idx},'action',this.value)">
            ${Object.entries(actLabels).map(([v,l])=>`<option value="${v}"${ix.action===v?' selected':''}>${l}</option>`).join('')}
          </select>
        </div>
        ${(ix.action==='navigate'||ix.action==='overlay')?`
        <div class="proto-field">
          <span class="proto-field-label">Destination</span>
          <select onchange="updateInteraction(${el.id},${idx},'target',+this.value)">
            <option value="">— pick frame —</option>
            ${frames.map(f=>`<option value="${f.id}"${ix.target===f.id?' selected':''}>${escHtml(f.name)}</option>`).join('')}
          </select>
        </div>`:''}
        <div class="proto-field">
          <span class="proto-field-label">Animation</span>
          <select onchange="updateInteraction(${el.id},${idx},'animation',this.value)">
            ${Object.entries(animLabels).map(([v,l])=>`<option value="${v}"${ix.animation===v?' selected':''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="proto-field">
          <span class="proto-field-label">Duration</span>
          <input type="number" min="0" max="5000" value="${ix.duration||300}" onchange="updateInteraction(${el.id},${idx},'duration',+this.value)"> ms
        </div>
      </div>`;

    // Toggle open/close on header click
    card.querySelector('.proto-ix-hdr').addEventListener('click', ev=>{
      if (ev.target.classList.contains('proto-ix-del')) return;
      card.classList.toggle('open');
      S._selConn = card.classList.contains('open') ? {fromId:el.id,idx} : null;
      renderProtoArrows();
    });

    container.appendChild(card);
  });
}

// ── Interaction CRUD ──
function addInteraction() {
  if (!S.selIds.length) return;
  const el=getEl(S.selIds[0]); if(!el||!isPrototypable(el)) return;
  if (!el.interactions) el.interactions=[];
  const frames=S.els.filter(e=>e.type==='frame'&&e.page===S.page&&e.id!==el.id);
  el.interactions.push({
    trigger:'click', action:'navigate',
    target: frames[0]?.id||null,
    animation:'dissolve', duration:300, delayMs:1000,
  });
  S._selConn={fromId:el.id, idx:el.interactions.length-1};
  renderAll(); updateProtoPanel();
}

function updateInteraction(elId, idx, field, val) {
  const el=getEl(elId); if(!el||!el.interactions||!el.interactions[idx]) return;
  el.interactions[idx][field]=val;
  renderProtoArrows(); updateProtoPanel();
}

function deleteInteraction(elId, idx) {
  const el=getEl(elId); if(!el||!el.interactions) return;
  el.interactions.splice(idx,1);
  if (S._selConn&&S._selConn.fromId===elId&&S._selConn.idx===idx) S._selConn=null;
  renderAll(); updateProtoPanel();
}

// ════════════════════════════════════════════════════════════
// RICH TEXT FORMAT BAR
// ════════════════════════════════════════════════════════════
let _fmtDom = null; // contentEditable div currently being edited

function showTextFmtBar(dom, el) {
  _fmtDom = dom;
  const bar = document.getElementById('text-fmt-bar');
  if (!bar) return;
  bar.style.display = 'flex';
  // Init controls from element's base style
  const sizeInp = document.getElementById('tfb-size');
  if (sizeInp) sizeInp.value = el.fontSize || 16;
  const swatch = document.getElementById('tfb-color-swatch');
  const colorInp = document.getElementById('tfb-color');
  if (swatch && colorInp) {
    const c = el.textColor || '#111111';
    swatch.style.background = c;
    colorInp.value = c.length === 7 ? c : '#111111';
  }
  _positionFmtBar(dom);
  updateFmtBarState();
}

function _positionFmtBar(dom) {
  const bar = document.getElementById('text-fmt-bar');
  if (!bar || !dom) return;
  const rect = dom.getBoundingClientRect();
  const barH = bar.offsetHeight || 38;
  const barW = bar.offsetWidth || 320;
  let top = rect.top - barH - 10;
  if (top < 8) top = rect.bottom + 10; // flip below if no room above
  const left = Math.min(window.innerWidth - barW - 8, Math.max(8, rect.left));
  bar.style.top  = top  + 'px';
  bar.style.left = left + 'px';
}

function hideTextFmtBar() {
  const bar = document.getElementById('text-fmt-bar');
  if (bar) bar.style.display = 'none';
  _fmtDom = null;
}

function updateFmtBarState() {
  document.querySelectorAll('#text-fmt-bar .tfb-btn[data-cmd]').forEach(btn => {
    try { btn.classList.toggle('active', document.queryCommandState(btn.dataset.cmd)); } catch(e){}
  });
}

function applyFmtCmd(cmd) {
  if (_fmtDom) _fmtDom.focus();
  document.execCommand(cmd, false, null);
  updateFmtBarState();
}

function applyFmtFontSize(px) {
  if (!_fmtDom || !px || px < 1) return;
  _fmtDom.focus();
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  if (sel.isCollapsed) {
    // No selection — update element-level font-size
    const el = S.selIds.length ? getEl(S.selIds[0]) : null;
    if (el) { el.fontSize = px; el.lineHeight = Math.round(px * 1.4); renderAll(); }
    return;
  }
  // Wrap selected text in a span with the new size
  const range = sel.getRangeAt(0);
  const span = document.createElement('span');
  span.style.fontSize = px + 'px';
  try {
    range.surroundContents(span);
  } catch (e) {
    // Cross-node selection — use execCommand fontSize hack
    document.execCommand('fontSize', false, '7');
    _fmtDom.querySelectorAll('[size="7"]').forEach(node => {
      node.removeAttribute('size');
      node.style.fontSize = px + 'px';
    });
  }
}

function applyFmtColor(color) {
  if (!_fmtDom) return;
  _fmtDom.focus();
  document.execCommand('foreColor', false, color);
}

function applyFmtFont(family) {
  if (!_fmtDom) return;
  _fmtDom.focus();
  document.execCommand('fontName', false, family);
}

function toggleFlowStart() {
  if (!S.selIds.length) return;
  const el=getEl(S.selIds[0]); if(!el||el.type!=='frame') return;
  el.isFlowStart=!el.isFlowStart;
  if (el.isFlowStart && !el.flowName) {
    const n = S.els.filter(e=>e.isFlowStart&&e.id!==el.id).length + 1;
    el.flowName = 'Flow ' + n;
  }
  renderAll(); updateProtoPanel();
}

function renameFlow(id, name) {
  const el = getEl(id); if (!el) return;
  el.flowName = name.trim() || el.flowName;
}

function setScrollBehavior(val) {
  if (!S.selIds.length) return;
  const el=getEl(S.selIds[0]); if(!el) return;
  el.scrollBehavior=val;
}

// Legacy compat
function deleteProto(id){ S.protoConns=S.protoConns.filter(c=>c.id!==id); renderAll(); updateProtoPanel(); }
function handleProtoClick(_id) { /* superseded by drag-handle flow */ }

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
    if (S.protoMode) updateProtoPanel();
    return;
  }
  if (S.protoMode) {
    insp.style.display = 'block';
    inspTitle.textContent = els.length > 1 ? `${els.length} elements` : escHtml(els[0].name);
    inspType.textContent  = els.length > 1 ? '' : els[0].type.toUpperCase();
    updateProtoPanel(); return;
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
        <div class="prow" style="margin-top:4px;">
          <span class="plbl">°</span>
          <input class="pinp" type="number" value="${Math.round(el.rotation||0)}" onchange="SP('rotation',((+this.value%360)+360)%360)" style="flex:1;">
          ${(el.rotation||0)!==0?`<button onclick="SP('rotation',0)" title="Reset rotation" style="background:none;border:none;color:var(--text3);cursor:pointer;padding:0 4px;font-size:13px;">↺</button>`:''}
        </div>
        <div class="prow" style="margin-top:4px;justify-content:space-between;">
          <button
            id="lock-prop-btn"
            onclick="toggleProportionLock(${el.id})"
            style="display:flex;align-items:center;gap:5px;background:${locked?'var(--accent-soft)':'var(--surface2)'};border:1px solid ${locked?'var(--accent)':'var(--border)'};border-radius:5px;padding:3px 9px;font-size:10px;color:${locked?'var(--accent)':'var(--text3)'};">
            ${locked?'🔗':'⛓️'} Lock Proportions
          </button>
        </div>
        ${(el.type==='rect'||el.type==='frame')?`<div style="margin-top:5px;">
          <div class="prow">
            <span class="plbl-text" style="margin-right:6px;">Radius</span>
            <input class="pinp" type="number" min="0" value="${el.cornerRadii?Math.max(el.cornerRadii.tl||0,el.cornerRadii.tr||0,el.cornerRadii.br||0,el.cornerRadii.bl||0):el.rx}"
              onchange="SP('rx',+this.value);const _e=getEl(${el.id});if(_e&&_e.cornerRadii){const v=+this.value;_e.cornerRadii={tl:v,tr:v,br:v,bl:v};renderAll();updateProps();}"
              style="flex:1;">
            <button class="fmt-btn${el.cornerRadii?' on':''}" onclick="toggleCornerRadii(${el.id})" title="${el.cornerRadii?'Collapse to uniform':'Per-corner radius'}" style="font-size:10px;padding:2px 6px;flex-shrink:0;">⊞</button>
          </div>
          ${el.cornerRadii?`<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-top:4px;">
            <div style="display:flex;align-items:center;gap:3px;">
              <span style="font-size:9px;color:var(--text3);width:14px;">TL</span>
              <input class="pinp" type="number" min="0" value="${el.cornerRadii.tl||0}" onchange="setCornerRadius(${el.id},'tl',+this.value)" style="flex:1;">
            </div>
            <div style="display:flex;align-items:center;gap:3px;">
              <span style="font-size:9px;color:var(--text3);width:14px;">TR</span>
              <input class="pinp" type="number" min="0" value="${el.cornerRadii.tr||0}" onchange="setCornerRadius(${el.id},'tr',+this.value)" style="flex:1;">
            </div>
            <div style="display:flex;align-items:center;gap:3px;">
              <span style="font-size:9px;color:var(--text3);width:14px;">BL</span>
              <input class="pinp" type="number" min="0" value="${el.cornerRadii.bl||0}" onchange="setCornerRadius(${el.id},'bl',+this.value)" style="flex:1;">
            </div>
            <div style="display:flex;align-items:center;gap:3px;">
              <span style="font-size:9px;color:var(--text3);width:14px;">BR</span>
              <input class="pinp" type="number" min="0" value="${el.cornerRadii.br||0}" onchange="setCornerRadius(${el.id},'br',+this.value)" style="flex:1;">
            </div>
          </div>`:''}
        </div>`:''}
        ${el.type==='frame'&&!el.isComponent&&!el.componentId?`<div style="margin-top:6px;display:flex;gap:5px;"><button class="btn btn-ghost" style="flex:1;font-size:10px;" onclick="createComponent()" title="Convert to reusable component">⬡ Create Component</button></div>`:''}
        ${el.type==='group'?`<div style="margin-top:6px;display:flex;gap:5px;"><button class="btn btn-ghost" style="flex:1;font-size:10px;" onclick="ungroupSelected()">Ungroup ⇧⌘G</button><button class="btn btn-ghost" style="flex:1;font-size:10px;" onclick="createComponent()" title="Convert to reusable component">⬡ Component</button></div>`:''}
      </div>
    `);
  }

  // ── Component / Instance section (single select) ──
  if (!multi && el.isComponent) {
    const varEntries = Object.entries(el.variantProps||{});
    const varHTML = varEntries.map(([k,v])=>`
      <div class="variant-row">
        <input class="variant-key" value="${escHtml(k)}" placeholder="Property" onchange="
          const el=getEl(${el.id}); if(!el) return;
          const old=this.defaultValue; const val=el.variantProps[old];
          delete el.variantProps[old]; el.variantProps[this.value]=val; this.defaultValue=this.value; updateProps();">
        <input class="variant-val" value="${escHtml(v)}" placeholder="Value" onchange="setVariantProp(${el.id},'${k}',this.value)">
        <button class="variant-del" onclick="removeVariantProp(${el.id},'${k}')">×</button>
      </div>`).join('');
    sections.push(`
      <div class="psec" style="border-top:2px solid var(--accent);padding-top:10px;">
        <div class="prow" style="margin-bottom:8px;">
          <span style="font-size:11px;font-weight:600;color:var(--accent);">⬡ Component</span>
          <button class="psec-add" style="margin-left:auto;" onclick="createInstance(${el.id})" title="Place an instance of this component">+ Instance</button>
        </div>
        ${varEntries.length ? `<div class="psec-title" style="margin-bottom:4px;">Variant Properties</div><div class="variant-props">${varHTML}</div>` : ''}
        <div style="display:flex;gap:5px;margin-top:6px;">
          <button class="btn btn-ghost" style="flex:1;font-size:10px;" onclick="addVariantProp()">+ Add property</button>
          <button class="btn btn-ghost" style="flex:1;font-size:10px;" onclick="addVariant()">+ Add variant</button>
        </div>
      </div>
    `);
  }
  if (!multi && !el.isComponent && el.componentId) {
    const master = getEl(el.componentId);
    const masterName = master ? escHtml(master.name.replace(/^⬡ /,'')) : '(missing)';
    sections.push(`
      <div class="psec" style="border-top:2px solid var(--accent);padding-top:10px;">
        <div class="prow" style="margin-bottom:6px;">
          <span style="font-size:11px;font-weight:600;color:var(--accent);">◆ Instance</span>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:8px;">Component: <span style="color:var(--text2);">${masterName}</span></div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;">
          <button class="btn btn-ghost" style="flex:1;font-size:10px;" onclick="goToMaster(${el.id})">Go to master ↗</button>
          ${Object.keys(el.overrides||{}).length ? `<button class="btn btn-ghost" style="flex:1;font-size:10px;color:var(--accent);" onclick="pushToMaster(${el.id})" title="Apply overrides to master and sync all instances">↑ Push to master</button>` : ''}
          <button class="btn btn-ghost" style="flex:1;font-size:10px;" onclick="detachInstance(${el.id})">Detach</button>
        </div>
      </div>
    `);
  }

  // ── Multi-select section ──
  if (multi) {
    const allW = els.map(e=>Math.round(e.w));
    const allH = els.map(e=>Math.round(e.h));
    const wSame = allW.every(w=>w===allW[0]);
    const hSame = allH.every(h=>h===allH[0]);
    const rotVals = els.map(e=>e.rotation||0);
    const rotSame = rotVals.every(r=>r===rotVals[0]);
    const rxVals  = els.map(e=>e.rx||0);
    const rxSame  = rxVals.every(r=>r===rxVals[0]);
    const opVals  = els.map(e=>e.opacity||100);
    const opSame  = opVals.every(o=>o===opVals[0]);

    // Fill: first visible solid fill of each element
    const firstColors = els.map(e=>{
      const f=(e.fills||[]).find(f=>f.visible!==false&&f.type==='solid');
      return f?f.color:null;
    });
    const anyHaveColor = firstColors.some(c=>c!==null);
    const colorSame = anyHaveColor && firstColors.every(c=>c===firstColors[0]);

    // Stroke
    const strokes = els.map(e=>e.stroke&&e.stroke!=='none'?e.stroke:null);
    const anyHaveStroke = strokes.some(s=>s!==null);
    const strokeSame = anyHaveStroke && strokes.every(s=>s===strokes[0]);
    const strokeWidths = els.map(e=>e.strokeWidth||1);
    const strokeWidthSame = strokeWidths.every(w=>w===strokeWidths[0]);

    // Inline helpers so onclick strings stay short
    const _setFillAll  = `S.selIds.forEach(id=>{const e=getEl(id);if(e&&e.fills&&e.fills.length)e.fills[0].color=this.value;});renderAll();updateProps();`;
    const _setStrkAll  = `S.selIds.forEach(id=>{const e=getEl(id);if(e)e.stroke=this.value;});renderAll();updateProps();`;
    const _setSWAll    = `S.selIds.forEach(id=>{const e=getEl(id);if(e)e.strokeWidth=+this.value;});renderAll();updateProps();`;
    const _eyeFill     = window&&window.EyeDropper ? `<button class="fill-eye" title="Pick from screen" onclick="(async()=>{try{const r=await new EyeDropper().open();S.selIds.forEach(id=>{const e=getEl(id);if(e&&e.fills&&e.fills.length)e.fills[0].color=r.sRGBHex;});renderAll();updateProps();}catch(x){}})()">⊕</button>` : '';
    const _eyeStrk     = window&&window.EyeDropper ? `<button class="fill-eye" title="Pick from screen" onclick="(async()=>{try{const r=await new EyeDropper().open();S.selIds.forEach(id=>{const e=getEl(id);if(e)e.stroke=r.sRGBHex;});renderAll();updateProps();}catch(x){}})()">⊕</button>` : '';

    sections.push(`
      <div class="psec">
        <div class="psec-title">Size</div>
        <div class="pgrid2">
          <div class="prow">
            <span class="plbl">W</span>
            ${wSame
              ? `<input class="pinp" type="number" value="${allW[0]}" onchange="S.selIds.forEach(id=>{const e=getEl(id);if(e)e.w=Math.max(1,+this.value);});renderAll();updateProps();">`
              : `<input class="pinp" value="Mixed" style="color:var(--text3);" onfocus="this.select()" onchange="const v=+this.value;if(v>0){S.selIds.forEach(id=>{const e=getEl(id);if(e)e.w=v;});renderAll();updateProps();}">`
            }
          </div>
          <div class="prow">
            <span class="plbl">H</span>
            ${hSame
              ? `<input class="pinp" type="number" value="${allH[0]}" onchange="S.selIds.forEach(id=>{const e=getEl(id);if(e)e.h=Math.max(1,+this.value);});renderAll();updateProps();">`
              : `<input class="pinp" value="Mixed" style="color:var(--text3);" onfocus="this.select()" onchange="const v=+this.value;if(v>0){S.selIds.forEach(id=>{const e=getEl(id);if(e)e.h=v;});renderAll();updateProps();}">`
            }
          </div>
        </div>
        <div class="pgrid2" style="margin-top:4px;">
          <div class="prow">
            <span class="plbl">°</span>
            ${rotSame
              ? `<input class="pinp" type="number" value="${Math.round(rotVals[0])}" onchange="SPM('rotation',((+this.value%360)+360)%360)">`
              : `<input class="pinp" value="Mixed" style="color:var(--text3);" onfocus="this.select()" onchange="SPM('rotation',((+this.value%360)+360)%360)">`
            }
          </div>
          <div class="prow">
            <span class="plbl">R</span>
            ${rxSame
              ? `<input class="pinp" type="number" min="0" value="${rxVals[0]}" onchange="SPM('rx',Math.max(0,+this.value))">`
              : `<input class="pinp" value="Mixed" style="color:var(--text3);" onfocus="this.select()" onchange="SPM('rx',Math.max(0,+this.value))">`
            }
          </div>
        </div>
      </div>

      <div class="psec">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span class="psec-title" style="margin-bottom:0;">Fill</span>
          <button class="psec-add" onclick="S.selIds.forEach(id=>{const e=getEl(id);if(e&&e.type!=='text'){if(!e.fills)e.fills=[];if(!e.fills.length)e.fills.push(mkFill('#7c6aee'));}});renderAll();updateProps();">+</button>
        </div>
        ${anyHaveColor
          ? `<div class="prow">
               <div class="csw" style="background:${colorSame?firstColors[0]:'linear-gradient(135deg,#ccc 50%,#888 50%)'}">
                 <input type="color" value="${colorSame?firstColors[0]:'#888888'}" oninput="${_setFillAll}">
               </div>
               <input class="pinp" value="${colorSame?firstColors[0]:'Mixed'}" maxlength="7" style="flex:1;${colorSame?'':'color:var(--text3);'}" onfocus="this.select()" oninput="const c=this.value;if(c.match(/^#[0-9a-fA-F]{6}$/)){S.selIds.forEach(id=>{const e=getEl(id);if(e&&e.fills&&e.fills.length)e.fills[0].color=c;});renderAll();updateProps();}">
               ${_eyeFill}
             </div>`
          : `<div style="font-size:11px;color:var(--text3);padding:2px 0;">None — click + to add fill</div>`
        }
      </div>

      <div class="psec">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span class="psec-title" style="margin-bottom:0;">Stroke</span>
          <button class="psec-add" onclick="S.selIds.forEach(id=>{const e=getEl(id);if(e&&(!e.stroke||e.stroke==='none'))e.stroke='#666666';});renderAll();updateProps();">+</button>
        </div>
        ${anyHaveStroke
          ? `<div class="prow">
               <div class="csw" style="background:${strokeSame?strokes.find(s=>s):('#888')}">
                 <input type="color" value="${strokeSame?strokes.find(s=>s):'#888888'}" oninput="${_setStrkAll}">
               </div>
               <input class="pinp" value="${strokeSame?strokes.find(s=>s):'Mixed'}" maxlength="7" style="flex:1;${strokeSame?'':'color:var(--text3);'}" onfocus="this.select()" oninput="const c=this.value;if(c.match(/^#[0-9a-fA-F]{6}$/)){S.selIds.forEach(id=>{const e=getEl(id);if(e)e.stroke=c;});renderAll();updateProps();}">
               ${_eyeStrk}
               <input class="pinp" type="number" min="0" value="${strokeWidthSame?strokeWidths[0]:''}" placeholder="—" style="width:34px;flex:0 0 34px;" onchange="${_setSWAll}">
               <span style="font-size:9px;color:var(--text3);">px</span>
             </div>`
          : `<div style="font-size:11px;color:var(--text3);padding:2px 0;">None — click + to add</div>`
        }
      </div>

      <div class="psec">
        <div class="psec-title">Layer</div>
        <div class="prow">
          <span class="plbl-text" style="margin-right:6px;">Opacity</span>
          ${opSame
            ? `<input class="pinp" type="number" value="${opVals[0]}" min="0" max="100" oninput="SPM('opacity',+this.value)">`
            : `<input class="pinp" value="Mixed" style="color:var(--text3);" onfocus="this.select()" onchange="SPM('opacity',Math.min(100,Math.max(0,+this.value)))">`
          }
          <span style="font-size:10px;color:var(--text3);margin-left:3px;">%</span>
        </div>
      </div>

      <div class="psec">
        <div class="psec-title">Align</div>
        <div style="display:flex;gap:3px;margin-bottom:4px;">
          ${[['left','⬛←','Left'],['centerH','⬛|','Center H'],['right','→⬛','Right'],['top','⬛↑','Top'],['centerV','—⬛','Middle'],['bottom','↓⬛','Bottom']].map(([d,l,t])=>`<button class="fmt-btn" onclick="alignEls('${d}')" title="${t}" style="flex:1;padding:3px 2px;font-size:10px;">${l}</button>`).join('')}
        </div>
        <div style="display:flex;gap:3px;">
          <button class="fmt-btn" onclick="distributeEls('h')" style="flex:1;font-size:10px;" title="Distribute horizontally">↔ Dist H</button>
          <button class="fmt-btn" onclick="distributeEls('v')" style="flex:1;font-size:10px;" title="Distribute vertically">↕ Dist V</button>
        </div>
      </div>
    `);
  }

  // Auto Layout — frames only, single select
  if (!multi && el.type==='frame') {
    const _al = el.autoLayout || null;
    sections.push(`
      <div class="psec">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span class="psec-title" style="margin-bottom:0;">Auto Layout</span>
          <button onclick="toggleAutoLayout(${el.id})" style="background:${_al?'var(--accent-soft)':'none'};border:1px solid ${_al?'var(--accent)':'var(--border)'};border-radius:4px;padding:2px 9px;font-size:9px;color:${_al?'var(--accent)':'var(--text3)'};">${_al?'Enabled ✓':'+ Enable'}</button>
        </div>
        ${_al ? `
          <div class="prow">
            <span class="plbl-text" style="min-width:30px;">Dir</span>
            <select class="pinp" onchange="setAL(${el.id},'direction',this.value)">
              <option value="horizontal"${_al.direction==='horizontal'?' selected':''}>Horizontal →</option>
              <option value="vertical"${_al.direction==='vertical'?' selected':''}>Vertical ↓</option>
            </select>
          </div>
          <div class="pgrid2" style="margin-top:4px;">
            <div class="prow"><span class="plbl-text">Gap</span><input class="pinp" type="number" min="0" value="${_al.gap}" oninput="setAL(${el.id},'gap',+this.value)"></div>
            <div class="prow"><span class="plbl-text">Pad</span><input class="pinp" type="number" min="0" value="${_al.padding}" oninput="setAL(${el.id},'padding',+this.value)"></div>
          </div>
          <div class="prow" style="margin-top:4px;">
            <span class="plbl-text" style="min-width:30px;">Align</span>
            <select class="pinp" onchange="setAL(${el.id},'align',this.value)">
              <option value="start"${_al.align==='start'?' selected':''}>Start</option>
              <option value="center"${_al.align==='center'?' selected':''}>Center</option>
              <option value="end"${_al.align==='end'?' selected':''}>End</option>
            </select>
          </div>
        ` : `<p style="font-size:10px;color:var(--text3);margin:0;">Enable to auto-position children.</p>`}
      </div>
    `);
  }

  // Layout Grid — frames only, single select
  if (!multi && el.type==='frame') {
    const grids = el.layoutGrids || [];
    const gridRowsHTML = grids.map((g, i) => {
      const hexColor = g.color||'#ff0000';
      return `
        <div style="display:flex;flex-direction:column;gap:4px;padding:5px 0;border-bottom:1px solid var(--border);">
          <div style="display:flex;gap:4px;align-items:center;">
            <div class="fill-swatch" style="background:${hexColor};opacity:${g.opacity/100};width:16px;height:16px;flex-shrink:0;">
              <input type="color" value="${hexColor}" oninput="setLayoutGrid(${el.id},${i},'color',this.value)">
            </div>
            <select class="pinp" style="flex:1;" onchange="setLayoutGrid(${el.id},${i},'type',this.value)">
              <option value="columns"${g.type==='columns'?' selected':''}>Columns</option>
              <option value="rows"${g.type==='rows'?' selected':''}>Rows</option>
              <option value="grid"${g.type==='grid'?' selected':''}>Grid</option>
            </select>
            <button class="fill-eye" onclick="toggleLayoutGridVisible(${el.id},${i})" title="${g.visible?'Hide':'Show'} grid">${g.visible?'◉':'○'}</button>
            <button class="fill-del" onclick="deleteLayoutGrid(${el.id},${i})" title="Remove">−</button>
          </div>
          <div class="pgrid2">
            ${g.type!=='grid'?`
              <div class="prow"><span class="plbl-text">${g.type==='columns'?'Cols':'Rows'}</span><input class="pinp" type="number" min="1" max="64" value="${g.count||12}" oninput="setLayoutGrid(${el.id},${i},'count',+this.value)"></div>
              <div class="prow"><span class="plbl-text">Margin</span><input class="pinp" type="number" min="0" value="${g.margin||0}" oninput="setLayoutGrid(${el.id},${i},'margin',+this.value)"></div>
              <div class="prow"><span class="plbl-text">Gutter</span><input class="pinp" type="number" min="0" value="${g.gutter||0}" oninput="setLayoutGrid(${el.id},${i},'gutter',+this.value)"></div>
            `:`
              <div class="prow"><span class="plbl-text">Size</span><input class="pinp" type="number" min="1" value="${g.gutter||8}" oninput="setLayoutGrid(${el.id},${i},'gutter',+this.value)"></div>
            `}
            <div class="prow"><span class="plbl-text">Opacity</span><input class="pinp" type="number" min="0" max="100" value="${g.opacity||10}" oninput="setLayoutGrid(${el.id},${i},'opacity',+this.value)"></div>
          </div>
        </div>`;
    }).join('');
    sections.push(`
      <div class="psec">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span class="psec-title" style="margin-bottom:0;">Layout Grid</span>
          <button onclick="addLayoutGrid(${el.id})" style="background:none;border:1px solid var(--border);border-radius:4px;padding:2px 9px;font-size:9px;color:var(--text3);cursor:pointer;">+ Add</button>
        </div>
        ${grids.length ? gridRowsHTML : '<span style="font-size:10px;color:var(--text3);">No grids — click + to add</span>'}
      </div>
    `);
  }

  // ── Fill Layers (all element types except text and video) ──
  if (el.type !== 'text' && el.type !== 'video') {
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
        ${window&&window.EyeDropper?`<button class="fill-eye" onclick="eyedropperPick(${el.id},${i})" title="Pick color from screen">⊕</button>`:''}
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

  // Element opacity (single select only — multi shows it in its own block above)
  if (!multi) {
    sections.push(`
      <div class="psec">
        <div class="psec-title">Layer</div>
        <div class="prow">
          <span class="plbl-text" style="margin-right:6px;">Opacity</span>
          <input class="pinp" type="number" value="${el.opacity}" min="0" max="100" oninput="SP('opacity',+this.value)">
          <span style="font-size:10px;color:var(--text3);margin-left:3px;">%</span>
        </div>
      </div>
    `);
  }

  // Stroke (single)
  if (!multi) {
    const sa = el.strokeAlign || 'center';
    const sd = el.strokeDash || false;
    sections.push(`
      <div class="psec">
        <div class="psec-title">Stroke</div>
        <div class="prow">
          <div class="csw" style="background:${el.stroke==='none'?'transparent':el.stroke}">
            <input type="color" value="${el.stroke==='none'?'#000000':el.stroke}" oninput="SP('stroke',this.value)">
          </div>
          <input class="pinp" value="${el.stroke}" oninput="SP('stroke',this.value)" placeholder="none">
          ${window&&window.EyeDropper?`<button class="fill-eye" onclick="eyedropperPickStroke(${el.id})" title="Pick stroke color from screen">⊕</button>`:''}
          <input class="pinp" type="number" value="${el.strokeWidth}" min="0" style="width:40px;flex:0 0 40px;" oninput="SP('strokeWidth',+this.value)">
        </div>
        ${el.stroke!=='none'?`
        <div class="prow" style="margin-top:5px;gap:3px;">
          <span class="plbl" style="flex-shrink:0;">Pos</span>
          <div style="display:flex;gap:2px;flex:1;">
            ${['inside','center','outside'].map(a=>`<button class="fmt-btn${sa===a?' on':''}" onclick="SP('strokeAlign','${a}')" title="${a} stroke" style="flex:1;font-size:10px;">${a.charAt(0).toUpperCase()+a.slice(1)}</button>`).join('')}
          </div>
          <button class="fmt-btn${sd?' on':''}" onclick="SP('strokeDash',${!sd})" title="Dashed stroke" style="margin-left:2px;letter-spacing:1px;font-size:11px;">- -</button>
        </div>`:''}
      </div>
    `);
  }

  // Typography (text only)
  if (el.type==='text') {
    const curPreset = TYPO.find(p=>p.fontSize===el.fontSize&&p.lineHeight===el.lineHeight&&p.fontWeight===el.fontWeight);
    const ta = el.textAlign||'left';
    const tt = el.textTransform||'none';
    const ALIGN_ICONS = {
      left: `<svg viewBox="0 0 14 12" width="14" height="12"><line x1="1" y1="2" x2="13" y2="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="1" y1="5.5" x2="9" y2="5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="1" y1="9" x2="13" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      center: `<svg viewBox="0 0 14 12" width="14" height="12"><line x1="1" y1="2" x2="13" y2="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="3" y1="5.5" x2="11" y2="5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="1" y1="9" x2="13" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      right: `<svg viewBox="0 0 14 12" width="14" height="12"><line x1="1" y1="2" x2="13" y2="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="5" y1="5.5" x2="13" y2="5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="1" y1="9" x2="13" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      justify: `<svg viewBox="0 0 14 12" width="14" height="12"><line x1="1" y1="2" x2="13" y2="2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="1" y1="5.5" x2="13" y2="5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="1" y1="9" x2="13" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    };
    sections.push(`
      <div class="psec">
        <div class="psec-title">Typography</div>
        <div class="pgrid2" style="margin-bottom:6px;">
          <div class="prow"><span class="plbl-text" style="margin-right:4px;">Size</span><input class="pinp" type="number" value="${el.fontSize}" onchange="SP('fontSize',+this.value);if(S.coachOn)runCoach()"></div>
          <div class="prow"><span class="plbl-text" style="margin-right:4px;">LH</span><input class="pinp" type="number" value="${el.lineHeight}" onchange="SP('lineHeight',+this.value)"></div>
        </div>
        <div class="prow" style="margin-bottom:6px;">
          <div class="csw" style="background:${el.textColor}"><input type="color" value="${el.textColor}" oninput="SP('textColor',this.value)"></div>
          <input class="pinp" value="${el.textColor}" oninput="SP('textColor',this.value)">
          ${window&&window.EyeDropper?`<button class="fill-eye" onclick="eyedropperPickText(${el.id})" title="Pick color from screen">⊕</button>`:''}
        </div>
        <div class="prow" style="margin-bottom:6px;gap:2px;">
          <span class="plbl">Align</span>
          <div style="display:flex;gap:2px;flex:1;">
            ${['left','center','right','justify'].map(a=>`<button class="fmt-btn${ta===a?' on':''}" onclick="SP('textAlign','${a}')" title="${a}">${ALIGN_ICONS[a]}</button>`).join('')}
          </div>
        </div>
        <div class="pgrid2" style="margin-bottom:6px;">
          <div class="prow">
            <span class="plbl-text" style="margin-right:4px;">Spacing</span>
            <input class="pinp" type="number" step="0.01" value="${(el.letterSpacing||0).toFixed(2)}" onchange="SP('letterSpacing',+this.value)">
            <span style="font-size:9px;color:var(--text3);margin-left:2px;">em</span>
          </div>
          <div class="prow" style="gap:2px;">
            <span class="plbl-text" style="margin-right:4px;">Case</span>
            ${[['none','Ag'],['uppercase','AG'],['lowercase','ag'],['capitalize','Ag']].map(([v,lbl])=>`<button class="fmt-btn${tt===v?' on':''}" onclick="SP('textTransform','${v}')" title="${v}">${lbl}</button>`).join('')}
          </div>
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

  // Effects
  if (!multi) {
    const effs = el.effects || [];
    const ETYPES = {'drop-shadow':'Drop Shadow','inner-shadow':'Inner Shadow','layer-blur':'Layer Blur','bg-blur':'Background Blur','noise':'Noise','glass':'Glass','texture':'Texture'};
    const BLENDS = ['normal','overlay','multiply','screen','soft-light','hard-light','color-dodge','color-burn','luminosity'];
    const effRowsHTML = effs.map((ef, i) => {
      const needsColor = ef.type==='drop-shadow'||ef.type==='inner-shadow';
      const needsXY    = ef.type==='drop-shadow'||ef.type==='inner-shadow';
      const needsBlur  = ef.type==='drop-shadow'||ef.type==='inner-shadow';
      const needsR     = ef.type==='layer-blur'||ef.type==='bg-blur'||ef.type==='glass';
      const needsAmt   = ef.type==='noise';
      const isTexture  = ef.type==='texture';
      return `<div class="eff-row" style="flex-wrap:wrap;row-gap:4px;">
        <div style="display:flex;gap:4px;align-items:center;width:100%;">
          <button class="eff-vis-btn" onclick="toggleEffVis(${el.id},${i})" title="${ef.visible?'Hide':'Show'}">${ef.visible?'●':'○'}</button>
          <select class="eff-type-sel" onchange="changeEffType(${el.id},${i},this.value)">
            ${Object.entries(ETYPES).map(([k,v])=>`<option value="${k}"${k===ef.type?' selected':''}>${v}</option>`).join('')}
          </select>
          ${needsColor?`<input type="color" class="eff-color" value="${ef.color||'#000000'}" oninput="setEff(${el.id},${i},'color',this.value)">`:``}
          ${needsXY?`<input class="pinp" type="number" value="${ef.x??2}" style="width:30px;" title="X" oninput="setEff(${el.id},${i},'x',+this.value)"><input class="pinp" type="number" value="${ef.y??4}" style="width:30px;" title="Y" oninput="setEff(${el.id},${i},'y',+this.value)">`:``}
          ${needsBlur?`<input class="pinp" type="number" value="${ef.blur??8}" style="width:34px;" title="Blur" oninput="setEff(${el.id},${i},'blur',+this.value)">`:``}
          ${needsR?`<input class="pinp" type="number" value="${ef.radius??8}" style="width:34px;" title="Radius" oninput="setEff(${el.id},${i},'radius',+this.value)">`:``}
          ${needsAmt?`<input class="pinp" type="number" value="${ef.amount??20}" style="width:34px;" title="Amount%" oninput="setEff(${el.id},${i},'amount',+this.value)">`:``}
          <button class="fill-del" onclick="deleteEff(${el.id},${i})">−</button>
        </div>
        ${isTexture?`<div style="display:flex;gap:4px;align-items:center;width:100%;padding-left:20px;">
          <select class="pinp" style="flex:1;" onchange="setEff(${el.id},${i},'preset',this.value)">
            ${['noise','grain','paper','linen','concrete','dots','lines','grid'].map(p=>`<option value="${p}"${(ef.preset||'noise')===p?' selected':''}>${p[0].toUpperCase()+p.slice(1)}</option>`).join('')}
          </select>
          <input class="pinp" type="number" min="10" max="300" value="${ef.scale??65}" style="width:38px;" title="Scale %" oninput="setEff(${el.id},${i},'scale',+this.value)">
          <span style="font-size:9px;color:var(--text3);flex-shrink:0;">%</span>
        </div>
        <div style="display:flex;gap:4px;align-items:center;width:100%;padding-left:20px;">
          <select class="pinp" style="flex:1;" onchange="setEff(${el.id},${i},'blend',this.value)">
            ${BLENDS.map(b=>`<option value="${b}"${(ef.blend||'overlay')===b?' selected':''}>${b}</option>`).join('')}
          </select>
          <input class="pinp" type="number" min="0" max="100" value="${ef.opacity??20}" style="width:38px;" title="Opacity %" oninput="setEff(${el.id},${i},'opacity',+this.value)">
          <span style="font-size:9px;color:var(--text3);flex-shrink:0;">%</span>
        </div>`:``}
      </div>`;
    }).join('');
    sections.push(`
      <div class="psec">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;">
          <span class="psec-title" style="margin-bottom:0;">Effects</span>
          <button onclick="addEff(${el.id})" style="background:none;border:none;color:var(--accent);font-size:18px;line-height:1;padding:0 2px;cursor:pointer;">+</button>
        </div>
        ${effs.length ? effRowsHTML : '<span style="font-size:10px;color:var(--text3);">No effects — click + to add</span>'}
      </div>
    `);
  }

  // Export
  if (!multi) {
    sections.push(`
      <div class="psec">
        <div class="psec-title">Export</div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          <div style="display:flex;gap:4px;align-items:center;">
            <span class="plbl" style="width:38px;flex-shrink:0;">Scale</span>
            <div style="display:flex;gap:2px;flex:1;">
              ${[1,2,3].map(s=>`<button class="fmt-btn${S._exportScale===s?' on':''}" onclick="S._exportScale=${s};updateProps();">${s}×</button>`).join('')}
            </div>
          </div>
          <div style="display:flex;gap:4px;align-items:center;">
            <span class="plbl" style="width:38px;flex-shrink:0;">Format</span>
            <div style="display:flex;gap:2px;flex:1;">
              ${['png','svg'].map(f=>`<button class="fmt-btn${S._exportFmt===f?' on':''}" onclick="S._exportFmt='${f}';updateProps();">${f.toUpperCase()}</button>`).join('')}
            </div>
          </div>
          <button class="btn" style="font-size:11px;padding:5px;" onclick="exportElement(${el.id},S._exportScale,S._exportFmt)">↓ Export</button>
        </div>
      </div>
      <div class="psec" style="margin-top: 10px;">
        <div class="psec-title">HTML/CSS Export</div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          <button class="btn" style="font-size:11px;padding:5px;" onclick="exportToHTMLCSS(${el.id}, 'full')">↓ Full HTML/CSS</button>
          <button class="btn" style="font-size:11px;padding:5px;" onclick="exportToHTMLCSS(${el.id}, 'patch')">↓ Patch Mode</button>
        </div>
      </div>
    `);
  }

  // Actions
  sections.push(`
    <div class="psec">
      <div style="display:flex;gap:5px;">
        <!-- <button class="btn btn-ghost" style="flex:1;font-size:11px;" onclick="duplicateSelected()">Duplicate</button> -->
        <!-- <button class="btn" style="flex:1;font-size:11px;background:var(--red-bg);color:var(--red);border:1px solid rgba(224,85,85,.25)" onclick="deleteSelected()">Delete</button> -->
      </div>
    </div>
  `);

  content.innerHTML = sections.join('');
}

// Prop setter helpers — call renderAll to rebuild DOM from state
function SP(key, val) {
  const el=getEl(S.selIds[0]); if(!el) return;
  el[key]=val;
  _markOverride(el, key);
  if (el.isComponent) syncMastersToInstances();
  renderAll();
}
function SPM(key, val) {
  S.selIds.forEach(id=>{const el=getEl(id);if(el){el[key]=val;_markOverride(el,key);}});
  // Sync if any selected element is a master
  if (S.selIds.some(id=>{ const e=getEl(id); return e&&e.isComponent; })) syncMastersToInstances();
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

// ════════════════════════════════════════════════════════════
// EXPORT  (PNG via Canvas 2D + SVG)
// ════════════════════════════════════════════════════════════
function _rrPath(ctx, x, y, w, h, el) {
  const cr = el.cornerRadii;
  const R  = el.rx || 0;
  const tl = Math.min(cr ? (cr.tl||0) : R, w/2, h/2);
  const tr = Math.min(cr ? (cr.tr||0) : R, w/2, h/2);
  const br = Math.min(cr ? (cr.br||0) : R, w/2, h/2);
  const bl = Math.min(cr ? (cr.bl||0) : R, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+tl, y);
  ctx.lineTo(x+w-tr, y); ctx.arcTo(x+w, y,   x+w,   y+tr, tr);
  ctx.lineTo(x+w, y+h-br); ctx.arcTo(x+w, y+h, x+w-br, y+h, br);
  ctx.lineTo(x+bl, y+h); ctx.arcTo(x,   y+h, x,     y+h-bl, bl);
  ctx.lineTo(x, y+tl); ctx.arcTo(x,   y,   x+tl,  y, tl);
  ctx.closePath();
}

function _drawElToCtx(ctx, el, ox, oy) {
  const ex = el.x - ox, ey = el.y - oy;
  const w = el.w, h = el.h;
  ctx.save();
  ctx.globalAlpha = (el.opacity||100) / 100;

  if (el.type === 'line') {
    const lc = (el.fills||[]).find(f=>f.visible)?.color || '#888899';
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex+w, ey+h);
    ctx.strokeStyle = lc; ctx.lineWidth = el.strokeWidth||2;
    ctx.lineCap = 'round'; ctx.stroke();
    ctx.restore(); return;
  }

  if (el.type === 'text') {
    const fStyle = el.fontStyle==='italic' ? 'italic ' : '';
    ctx.font = `${fStyle}${el.fontWeight||400} ${el.fontSize||16}px sans-serif`;
    ctx.fillStyle = el.textColor || '#111111';
    ctx.textBaseline = 'top';
    const lh = el.lineHeight || Math.round((el.fontSize||16) * 1.4);
    (el.text||'').split('\n').forEach((line, i) => ctx.fillText(line, ex, ey + i*lh));
    ctx.restore(); return;
  }

  // Shapes: rect, frame, ellipse, group, section
  const fills = (el.fills||[]).filter(f=>f.visible);
  fills.forEach(f => {
    ctx.save();
    ctx.globalAlpha = ((el.opacity||100)/100) * ((f.opacity||100)/100);
    if (f.type === 'linear') {
      const ang = (f.angle||0) * Math.PI / 180;
      const gx1 = ex+w/2 - Math.cos(ang)*w/2, gy1 = ey+h/2 - Math.sin(ang)*h/2;
      const gx2 = ex+w/2 + Math.cos(ang)*w/2, gy2 = ey+h/2 + Math.sin(ang)*h/2;
      const g = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
      (f.stops||[]).forEach(s => g.addColorStop(s.offset, s.color));
      ctx.fillStyle = g;
    } else if (f.type === 'radial') {
      const g = ctx.createRadialGradient(ex+w/2, ey+h/2, 0, ex+w/2, ey+h/2, Math.max(w,h)/2);
      (f.stops||[]).forEach(s => g.addColorStop(s.offset, s.color));
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = f.color || 'transparent';
    }
    if (el.type === 'ellipse') {
      ctx.beginPath(); ctx.ellipse(ex+w/2, ey+h/2, w/2, h/2, 0, 0, Math.PI*2); ctx.fill();
    } else {
      _rrPath(ctx, ex, ey, w, h, el); ctx.fill();
    }
    ctx.restore();
  });

  if (el.stroke && el.stroke !== 'none') {
    ctx.globalAlpha = (el.opacity||100)/100;
    ctx.strokeStyle = el.stroke; ctx.lineWidth = el.strokeWidth||1;
    if (el.type === 'ellipse') {
      ctx.beginPath(); ctx.ellipse(ex+w/2, ey+h/2, w/2, h/2, 0, 0, Math.PI*2); ctx.stroke();
    } else {
      _rrPath(ctx, ex, ey, w, h, el); ctx.stroke();
    }
  }
  ctx.restore();
}

async function exportElement(elId, scale, format) {
  const frame = getEl(elId); if (!frame) return;
  scale = Math.max(1, scale||1);
  const ox = frame.x, oy = frame.y;
  const W = Math.ceil(frame.w * scale), H = Math.ceil(frame.h * scale);
  const safeName = (frame.name||'export').replace(/[^\w\s-]/g,'').trim() || 'export';

  // Collect children in render order
  function getDescendants(pid) {
    const ch = S.els.filter(e => e.parentId===pid && e.visible && e.page===S.page);
    let all = [];
    ch.forEach(c => { all.push(c); all = all.concat(getDescendants(c.id)); });
    return all;
  }
  const children = getDescendants(frame.id);

  if (format === 'svg') {
    function elToSVGStr(el) {
      const x = el.x-ox, y = el.y-oy, w = el.w, h = el.h, op = (el.opacity||100)/100;
      const fills = (el.fills||[]).filter(f=>f.visible);
      const fc = fills[0]?.type==='solid' ? fills[0].color : (fills.length ? '#888' : 'none');
      const str = (el.stroke && el.stroke!=='none') ? `stroke="${el.stroke}" stroke-width="${el.strokeWidth||1}"` : 'stroke="none"';
      if (el.type==='ellipse') return `<ellipse cx="${x+w/2}" cy="${y+h/2}" rx="${w/2}" ry="${h/2}" fill="${fc}" opacity="${op}" ${str}/>`;
      if (el.type==='line')    return `<line x1="${x}" y1="${y}" x2="${x+w}" y2="${y+h}" stroke="${fc}" stroke-width="${el.strokeWidth||2}" opacity="${op}"/>`;
      if (el.type==='text')    return `<text x="${x}" y="${y+(el.fontSize||16)}" font-size="${el.fontSize||16}" font-weight="${el.fontWeight||400}" fill="${el.textColor||'#111'}" opacity="${op}">${escHtml(el.text||'')}</text>`;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${el.rx||0}" fill="${fc}" opacity="${op}" ${str}/>`;
    }
    const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${frame.w} ${frame.h}">\n${elToSVGStr(frame)}\n${children.map(elToSVGStr).join('\n')}\n</svg>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([svg], {type:'image/svg+xml'}));
    a.download = safeName + '.svg';
    a.click(); URL.revokeObjectURL(a.href);
    return;
  }

  // PNG via Canvas 2D
  const cvs = document.createElement('canvas');
  cvs.width = W; cvs.height = H;
  const ctx = cvs.getContext('2d');
  ctx.scale(scale, scale);

  _drawElToCtx(ctx, frame, ox, oy);

  // Handle images async
  const imgQueue = [];
  function scheduleImg(el) {
    if (!el.imageSrc) return;
    const ex = el.x-ox, ey = el.y-oy;
    imgQueue.push(new Promise(res => {
      const img = new Image();
      img.onload = () => { ctx.save(); ctx.drawImage(img, ex, ey, el.w, el.h); ctx.restore(); res(); };
      img.onerror = res;
      img.src = el.imageSrc;
    }));
  }
  scheduleImg(frame);
  children.forEach(child => { _drawElToCtx(ctx, child, ox, oy); scheduleImg(child); });

  await Promise.all(imgQueue);

  cvs.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${safeName}@${scale}x.png`;
    a.click(); URL.revokeObjectURL(a.href);
  }, 'image/png');
}

// EXPORT TO HTML/CSS
// ════════════════════════════════════════════════════════════
async function exportToHTMLCSS(elId, mode = 'full') {
  const rootEl = getEl(elId);
  if (!rootEl) return;
  
  // Collect all descendants
  function getDescendants(pid) {
    const ch = S.els.filter(e => e.parentId === pid && e.visible && e.page === S.page);
    let all = [];
    ch.forEach(c => { all.push(c); all = all.concat(getDescendants(c.id)); });
    return all;
  }
  const children = getDescendants(rootEl.id);
  const allElements = [rootEl, ...children];
  
  let result;
  if (mode === 'full') {
    result = generateFullHTMLCSS(allElements, rootEl);
    
    // Create download for full HTML
    const htmlBlob = new Blob([result.html], {type: 'text/html'});
    const htmlUrl = URL.createObjectURL(htmlBlob);
    
    const a = document.createElement('a');
    a.href = htmlUrl;
    a.download = `${rootEl.name || 'export'}.html`;
    a.click();
    URL.revokeObjectURL(htmlUrl);
    
    // Also provide CSS download
    const cssBlob = new Blob([result.css], {type: 'text/css'});
    const cssUrl = URL.createObjectURL(cssBlob);
    
    const cssA = document.createElement('a');
    cssA.href = cssUrl;
    cssA.download = `${rootEl.name || 'export'}.css`;
    setTimeout(() => { cssA.click(); URL.revokeObjectURL(cssUrl); }, 100);
    
  } else if (mode === 'patch') {
    result = generatePatchHTMLCSS(allElements, rootEl);
    
    // Create download for patch JSON
    const patchBlob = new Blob([JSON.stringify(result, null, 2)], {type: 'application/json'});
    const patchUrl = URL.createObjectURL(patchBlob);
    
    const a = document.createElement('a');
    a.href = patchUrl;
    a.download = `${rootEl.name || 'export'}-patch.json`;
    a.click();
    URL.revokeObjectURL(patchUrl);
  }
  
  return result;
}

function generateFullHTMLCSS(elements, rootEl) {
  const htmlParts = [];
  const cssParts = [];
  
  // Generate CSS variables
  cssParts.push(`:root {
    --bg: #f5f7fa;
    --text: #333;
    --text-light: #777;
    --primary: #4a6bff;
    --secondary: #6c5ce7;
    --success: #00cec9;
    --warning: #fdcb6e;
    --danger: #e17055;
    --radius: 8px;
    --shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    --space-1: 8px;
    --space-2: 16px;
    --space-3: 24px;
    --space-4: 32px;
    --space-5: 48px;
  }`);
  
  // Generate CSS for each element
  elements.forEach(el => {
    const cssSelector = `[data-canvus-id="${el.id}"]`;
    const styles = [];
    
    // Position and size
    if (el.x !== undefined && el.y !== undefined) {
      styles.push(`position: absolute;`);
      styles.push(`left: ${el.x}px;`);
      styles.push(`top: ${el.y}px;`);
    }
    if (el.w !== undefined) styles.push(`width: ${el.w}px;`);
    if (el.h !== undefined) styles.push(`height: ${el.h}px;`);
    
    // Background
    if (el.fills && el.fills[0]) {
      const fill = el.fills[0];
      if (fill.visible !== false && fill.color) {
        const opacity = fill.opacity !== undefined ? fill.opacity / 100 : 1;
        styles.push(`background-color: ${hexToRGBA(fill.color, opacity)};`);
      }
    }
    
    // Border radius
    if (el.rx) styles.push(`border-radius: ${el.rx}px;`);
    if (el.cornerRadii) {
      styles.push(`border-radius: ${el.cornerRadii.tl}px ${el.cornerRadii.tr}px ${el.cornerRadii.br}px ${el.cornerRadii.bl}px;`);
    }
    
    // Border
    if (el.stroke) {
      styles.push(`border: 1px solid ${el.stroke};`);
      if (el.strokeWidth) styles.push(`border-width: ${el.strokeWidth}px;`);
    }
    
    // Text styles
    if (el.type === 'text') {
      if (el.fontSize) styles.push(`font-size: ${el.fontSize}px;`);
      if (el.fontWeight) styles.push(`font-weight: ${el.fontWeight};`);
      if (el.textColor) styles.push(`color: ${el.textColor};`);
      if (el.textAlign) styles.push(`text-align: ${el.textAlign};`);
    }
    
    // Flexbox
    if (el.autoLayout) {
      const layout = el.autoLayout;
      if (layout.direction === 'horizontal') {
        styles.push(`display: flex;`);
        styles.push(`flex-direction: row;`);
      } else if (layout.direction === 'vertical') {
        styles.push(`display: flex;`);
        styles.push(`flex-direction: column;`);
      }
      if (layout.gap !== undefined) styles.push(`gap: ${layout.gap}px;`);
      if (layout.padding !== undefined) styles.push(`padding: ${layout.padding}px;`);
      if (layout.align) {
        const alignMap = {
          'min': 'flex-start',
          'center': 'center',
          'max': 'flex-end',
          'stretch': 'stretch'
        };
        styles.push(`align-items: ${alignMap[layout.align] || 'stretch'};`);
      }
    }
    
    if (styles.length > 0) {
      cssParts.push(`${cssSelector} { ${styles.join(' ')} }`);
    }
  });
  
  // Generate HTML structure
  const elementMap = {};
  elements.forEach(el => {
    elementMap[el.id] = el;
  });
  
  function buildHTMLElement(el) {
    const children = elements.filter(e => e.parentId === el.id);
    const childHTML = children.map(buildHTMLElement).join('');
    
    const attributes = [`data-canvus-id="${el.id}"`];
    if (el.name) attributes.push(`data-canvus-name="${escHtml(el.name)}"`);
    if (el.type === 'frame') attributes.push(`data-canvus-role="component"`);
    
    let content = '';
    if (el.type === 'text') {
      content = escHtml(el.text || '');
    }
    
    return `<${el.type === 'frame' ? 'div' : el.type} ${attributes.join(' ')}>${content}${childHTML}</${el.type === 'frame' ? 'div' : el.type}>`;
  }
  
  htmlParts.push(buildHTMLElement(rootEl));
  
  return {
    html: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${rootEl.name || 'Exported Design'}</title>
    <style>
${cssParts.join('\n')}
    </style>
</head>
<body>
${htmlParts.join('')}
</body>
</html>`,
    css: cssParts.join('\n')
  };
}

function generatePatchHTMLCSS(elements, rootEl) {
  const patches = [];
  
  elements.forEach(el => {
    const cssSelector = `[data-canvus-id="${el.id}"]`;
    const styleChanges = [];
    const attributeChanges = [];
    
    // Check what has changed (in a real implementation, this would compare to original state)
    // For now, we'll generate patches for all style properties
    
    if (el.fills && el.fills[0] && el.fills[0].color) {
      const fill = el.fills[0];
      const opacity = fill.opacity !== undefined ? fill.opacity / 100 : 1;
      styleChanges.push(`background-color: ${hexToRGBA(fill.color, opacity)};`);
    }
    
    if (el.textColor) {
      styleChanges.push(`color: ${el.textColor};`);
    }
    
    if (el.text && el.type === 'text') {
      attributeChanges.push(`data-text-content="${escHtml(el.text)}"`);
    }
    
    if (styleChanges.length > 0) {
      patches.push({
        type: 'style',
        selector: cssSelector,
        changes: styleChanges.join(' ')
      });
    }
    
    if (attributeChanges.length > 0) {
      patches.push({
        type: 'attribute',
        selector: cssSelector,
        changes: attributeChanges.join(' ')
      });
    }
  });
  
  return {
    patches: patches,
    applyPatch: `function applyCanvusPatch(patches) {
  patches.forEach(patch => {
    if (patch.type === 'style') {
      const elements = document.querySelectorAll(patch.selector);
      elements.forEach(el => {
        el.style.cssText += ' ' + patch.changes;
      });
    } else if (patch.type === 'attribute') {
      const elements = document.querySelectorAll(patch.selector);
      // In a real implementation, you would parse and apply attribute changes
      // This is a simplified version
    }
  });
}`
  };
}

// Helper function to convert hex to RGBA
function hexToRGBA(hex, alpha = 1) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function toggleCornerRadii(elId) {
  const el = getEl(elId); if (!el) return;
  pushUndo();
  if (el.cornerRadii) {
    el.rx = el.cornerRadii.tl || 0;
    el.cornerRadii = null;
  } else {
    el.cornerRadii = {tl: el.rx||0, tr: el.rx||0, br: el.rx||0, bl: el.rx||0};
  }
  renderAll(); updateProps();
}

function setCornerRadius(elId, corner, val) {
  const el = getEl(elId); if (!el || !el.cornerRadii) return;
  pushUndo();
  el.cornerRadii[corner] = Math.max(0, val);
  renderAll(); updateProps();
}

async function eyedropperPick(elId, fillIdx) {
  if (!window.EyeDropper) return;
  try {
    const result = await new EyeDropper().open();
    setFillColor(elId, fillIdx, result.sRGBHex);
  } catch (e) { /* user cancelled */ }
}

async function eyedropperPickStroke(elId) {
  if (!window.EyeDropper) return;
  try {
    const result = await new EyeDropper().open();
    const el = getEl(elId); if (!el) return;
    pushUndo(); el.stroke = result.sRGBHex;
    renderAll(); updateProps();
  } catch (e) {}
}

async function eyedropperPickText(elId) {
  if (!window.EyeDropper) return;
  try {
    const result = await new EyeDropper().open();
    const el = getEl(elId); if (!el) return;
    pushUndo(); el.textColor = result.sRGBHex;
    renderAll(); updateProps();
  } catch (e) {}
}

function toggleFillVis(elId, idx) {
  const el = getEl(elId); if (!el||!el.fills) return;
  el.fills[idx].visible = !el.fills[idx].visible;
  syncLegacyFill(el);
  renderAll(); updateProps();
}

function setFillColor(elId, idx, color) {
  const el = getEl(elId); if (!el||!el.fills) return;
  if (color && color.length >= 4) {
    el.fills[idx].color = color;
    syncLegacyFill(el);
    _markOverride(el, 'fills');
    if (el.isComponent) syncMastersToInstances();
    renderAll();
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
    else switchRightTab('proto'); // already on, just ensure right tab
  } else {
    if (S.protoMode) toggleProto();
    switchRightTab('design');
  }
  if (mode==='comment') setTool('comment');
  else if (mode==='design') { if (S.tool==='comment') setTool('select'); }
}

// ════════════════════════════════════════════════════════════
// LAYERS PANEL — nested, renamable
// ════════════════════════════════════════════════════════════
const LAYER_ICONS = {rect:'▭', ellipse:'◯', text:'T', line:'/', frame:'⬜', section:'▦', group:'⬡', video:'▶', vector:'✦', component:'⬡', instance:'◆'};

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
  const isContainer = el.type==='frame'||el.type==='group'||el.type==='section';

  const item = document.createElement('div');
  item.className = 'lyr'+(isSel?' on':'')+(depth>0?' lyr-indent':'');
  item.style.paddingLeft = (12 + depth*16)+'px';

  // Collapse toggle for frames/groups
  const toggleHtml = isContainer && hasChildren
    ? `<span class="lyr-group-toggle" onclick="toggleLayerCollapse(event,${el.id})">${el.collapsed?'▶':'▼'}</span>`
    : `<span style="width:10px;flex-shrink:0;"></span>`;

  item.innerHTML = `
    ${toggleHtml}
    <span class="lyr-ico" style="${el.isComponent?'color:var(--accent);':el.componentId?'color:var(--accent);opacity:.7;':''}">${el.imageSrc?'🖼':el.isComponent?'⬡':el.componentId?'◆':LAYER_ICONS[el.type]||'◻'}</span>
    <span class="lyr-name" title="${escHtml(el.name)}">${escHtml(el.name)}</span>
    <button class="lyr-lock${el.locked?' locked':''}" onclick="toggleLock(event,${el.id})" title="${el.locked?'Unlock':'Lock'}">${el.locked?'🔒':'🔓'}</button>
    <button class="lyr-vis" onclick="toggleVis(event,${el.id})" title="${el.visible?'Hide':'Show'}">${el.visible?'👁':'○'}</button>
  `;

  // Drag-to-reorder
  item.setAttribute('draggable', 'true');
  item.addEventListener('dragstart', ev => {
    _lyrDrag.active = true; _lyrDrag.el = el;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', String(el.id));
    item.classList.add('lyr-dragging');
  });
  item.addEventListener('dragend', () => {
    _lyrDrag.active = false; _lyrDrag.el = null;
    document.querySelectorAll('.lyr-drop-above,.lyr-drop-below').forEach(e=>{
      e.classList.remove('lyr-drop-above','lyr-drop-below');
    });
    item.classList.remove('lyr-dragging');
  });
  item.addEventListener('dragover', ev => {
    if (!_lyrDrag.active || !_lyrDrag.el || _lyrDrag.el.id===el.id) return;
    if (_lyrDrag.el.parentId !== el.parentId) return; // keep same parent
    ev.preventDefault(); ev.dataTransfer.dropEffect='move';
    const mid = item.getBoundingClientRect().top + item.getBoundingClientRect().height/2;
    const before = ev.clientY < mid;
    _lyrDrag.dropTarget = el; _lyrDrag.dropBefore = before;
    document.querySelectorAll('.lyr').forEach(l=>l.classList.remove('lyr-drop-above','lyr-drop-below'));
    item.classList.add(before ? 'lyr-drop-above' : 'lyr-drop-below');
  });
  item.addEventListener('drop', ev => {
    ev.preventDefault();
    if (!_lyrDrag.active || !_lyrDrag.el || !_lyrDrag.dropTarget) return;
    const dragged = _lyrDrag.el, target = _lyrDrag.dropTarget;
    if (dragged.id === target.id) return;
    pushUndo();
    const fromIdx = S.els.indexOf(dragged);
    if (fromIdx !== -1) S.els.splice(fromIdx, 1);
    let toIdx = S.els.indexOf(target);
    if (toIdx === -1) return;
    // Layer panel shows S.els in reverse; "above" in panel = higher index in array
    const insertIdx = _lyrDrag.dropBefore ? toIdx + 1 : toIdx;
    S.els.splice(Math.max(0, insertIdx), 0, dragged);
    _lyrDrag.active=false; _lyrDrag.el=null; _lyrDrag.dropTarget=null;
    renderAll(); updateLayers(); notify('Layer reordered');
  });

  // Click = select (with Cmd/Ctrl add, Shift range-select)
  item.addEventListener('click', ev => {
    if (ev.target.classList.contains('lyr-vis') ||
        ev.target.classList.contains('lyr-lock') ||
        ev.target.classList.contains('lyr-group-toggle')) return;
    if (S.protoMode) return;
    if (ev.shiftKey && _lastLayerClickId !== null) {
      // Build flat display order to range-select
      const pageEls = [...S.els].filter(e=>e.page===S.page).reverse();
      function _flatOrder(pId) {
        return pageEls.filter(e=>e.parentId===pId).reduce((acc,e)=>{
          acc.push(e);
          if ((e.type==='frame'||e.type==='group'||e.type==='section')&&!e.collapsed)
            acc.push(..._flatOrder(e.id));
          return acc;
        },[]);
      }
      const flat = _flatOrder(null);
      const ai = flat.findIndex(e=>e.id===_lastLayerClickId);
      const ci = flat.findIndex(e=>e.id===el.id);
      if (ai!==-1 && ci!==-1) {
        const lo=Math.min(ai,ci), hi=Math.max(ai,ci);
        S.selIds = flat.slice(lo,hi+1).map(e=>e.id);
      }
    } else if (ev.metaKey || ev.ctrlKey) {
      if (S.selIds.includes(el.id)) S.selIds=S.selIds.filter(i=>i!==el.id);
      else S.selIds=[...S.selIds, el.id];
    } else {
      S.selIds = [el.id];
      _lastLayerClickId = el.id;
    }
    if (!ev.shiftKey) _lastLayerClickId = el.id;
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
    const children = [...S.els].filter(e=>e.parentId===el.id&&e.page===S.page).reverse();
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
function updatePageInfoDisplay(page) {
  const pageIdDisplay = document.getElementById('page-id-display');
  if (pageIdDisplay) {
    pageIdDisplay.textContent = `Page: ${page.id} (${page.name})`;
  }
}

function copyPageUrl() {
  const currentPage = S.pages.find(p => p.id === S.page);
  if (!currentPage) return;
  
  const pageUrl = `${window.location.origin}${window.location.pathname}#/file_${S.fileId}/page_${currentPage.id}`;
  
  navigator.clipboard.writeText(pageUrl).then(() => {
    const copyIcon = document.getElementById('copy-icon');
    if (copyIcon) {
      copyIcon.textContent = '✓';
      setTimeout(() => {
        copyIcon.textContent = '📋';
      }, 2000);
    }
    notify(`Copied page URL: ${pageUrl}`);
  }).catch(err => {
    console.error('Failed to copy page URL: ', err);
    notify('Failed to copy page URL');
  });
}

function updatePages() {
  const list=document.getElementById('pages-list'); list.innerHTML='';
  S.pages.forEach(p=>{
    const item=document.createElement('div'); item.className='pg-item'+(p.id===S.page?' on':'');
    const dot=document.createElement('div'); dot.className='pg-dot';
    const nameSpan=document.createElement('span'); nameSpan.className='pg-name'; nameSpan.textContent=p.name;
    
    // Update page info display in topbar
    if (p.id === S.page) {
      updatePageInfoDisplay(p);
    }
    item.appendChild(dot); item.appendChild(nameSpan);
    // Click = switch page
    item.addEventListener('click', ev=>{
      if (ev.target.tagName === 'INPUT') return;
      if (ev.detail > 1) return;          // don't rerender on double-click
      if (p.id === S.page) return;         // clicking active page does nothing
      S.page = p.id; S.selIds = [];
      
      // Update URL with new page format
      const newUrl = `#/file_${S.collab.shareId.replace('file_', '')}/page_${p.id}`;
      history.pushState(null, '', newUrl);
      
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
  document.getElementById('tab-components').style.display=tab==='components'?'block':'none';
  document.getElementById('tab-colors').style.display=tab==='colors'?'block':'none';
  if (tab==='colors') renderColorStyles();
  if (tab==='components') renderComponentsPanel();
}

function switchRightTab(tab) {
  document.querySelectorAll('#right-tabs .ptab').forEach(t=>t.classList.toggle('on',t.dataset.rtab===tab));
  document.getElementById('design-content').style.display=tab==='design'?'block':'none';
  document.getElementById('proto-content').style.display=tab==='proto'?'block':'none';

  if (tab==='proto') {
    if (!S.protoMode) {
      S.protoMode = true;
      document.getElementById('proto-layer').classList.add('active');
      renderAll(); // re-render to show proto handles
    }
    updateProtoPanel();
  } else if (tab==='design') {
    if (S.protoMode) {
      S.protoMode = false;
      S._selConn = null; S._protoDrag = false; S._protoDragFrom = null;
      document.getElementById('proto-layer').classList.remove('active');
      renderAll(); // re-render to hide proto handles
    }
    updateProps();
  }
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

// ── Canvus AI — WebSocket receiver ───────────────────────────────────────────
// Connects to the Cloudflare Worker's Durable Object room.
// When the CLI runs `canvus-ai "…" --apply`, the Worker broadcasts
// { type:"ai:ops", ops:[] } here and we apply them live.
//
// Enable by setting window.CANVUS_AI_WS_URL before app.js loads, e.g.:
//   <script>window.CANVUS_AI_WS_URL = "wss://canvus-ai.your-name.workers.dev";</script>
// or leave unset to keep the stubs silent.

(function initAISocket() {
  const BASE = window.CANVUS_AI_WS_URL;
  if (!BASE) return;                          // opt-in only

  const room = new URLSearchParams(location.search).get('room') || 'default';
  const wsUrl = BASE.replace(/^http/, 'ws') + '/ai/ws?room=' + encodeURIComponent(room);

  let _ws, _pingTimer;

  function connect() {
    _ws = new WebSocket(wsUrl);

    _ws.onopen = () => {
      notify('Canvus AI connected');
      _pingTimer = setInterval(() => _ws.readyState === 1 && _ws.send('ping'), 30000);
    };

    _ws.onmessage = (ev) => {
      if (ev.data === 'pong') return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type !== 'ai:ops' || !Array.isArray(msg.ops)) return;
      pushUndo();
      applyOps(msg.ops);                      // defined in canvus-ai/ai/apply.js
      renderAll(); updateProps(); updateLayers();
      notify(`AI applied ${msg.ops.length} op${msg.ops.length !== 1 ? 's' : ''}`);
    };

    _ws.onclose = () => {
      clearInterval(_pingTimer);
      setTimeout(connect, 3000);              // reconnect after 3 s
    };

    _ws.onerror = () => _ws.close();
  }

  connect();
})();


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
// IMPORT FIGMA JSON
// ════════════════════════════════════════════════════════════
function importFigmaFile(ev) {
  const file = ev.target.files[0]; if (!file) return;
  ev.target.value = '';
  if (file.name.endsWith('.fig')) {
    notify('.fig binary format not supported — use Figma Plugins → JSON export');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    try { importFigmaJSON(JSON.parse(e.target.result)); }
    catch(_) { notify('Invalid JSON — could not parse file'); }
  };
  reader.readAsText(file);
}

function importFigmaJSON(data) {
  const beforeLen = S.els.length;
  let nodes = [];
  // Full Figma export: {document: {children: [{page}, ...]}}
  if (data.document?.children?.[0]?.children) nodes = data.document.children[0].children;
  // Simplified / plugin export: {children: [...]}
  else if (data.children) nodes = data.children;
  // Raw array
  else if (Array.isArray(data)) nodes = data;

  if (!nodes.length) { notify('No importable nodes found'); return; }
  nodes.forEach(n => mapFigmaNode(n, null));

  const newEls = S.els.slice(beforeLen);
  if (newEls.length) {
    centerImportedEls(newEls);
    S.selIds = newEls.filter(e=>!e.parentId).map(e=>e.id);
  }
  renderAll(); updateProps(); updateLayers();
  notify(`Imported ${newEls.length} element${newEls.length!==1?'s':''} from Figma`);
}

function mapFigmaNode(node, parentId) {
  if (!node?.type) return null;
  const bb = node.absoluteBoundingBox || node.absoluteRenderBounds || {x:0,y:0,width:100,height:100};
  const x = bb.x||0, y = bb.y||0, w = Math.max(1, bb.width||100), h = Math.max(1, bb.height||100);
  let el = null;

  if (node.type==='FRAME'||node.type==='COMPONENT'||node.type==='INSTANCE'||node.type==='COMPONENT_SET') {
    el = mkEl('frame', x, y, w, h);
    el.fills = parseFigmaFills(node.fills||[]);
    el.rx = node.cornerRadius || 0;
    if (node.strokes?.length) { el.stroke=figmaColorToHex(node.strokes[0].color); el.strokeWidth=node.strokeWeight||1; }
  } else if (node.type==='GROUP') {
    el = mkEl('frame', x, y, w, h);
    el.fills = [];
  } else if (node.type==='RECTANGLE') {
    el = mkEl('rect', x, y, w, h);
    el.rx = node.cornerRadius || (node.rectangleCornerRadii?node.rectangleCornerRadii[0]:0) || 0;
    el.fills = parseFigmaFills(node.fills||[]);
    if (node.strokes?.length) { el.stroke=figmaColorToHex(node.strokes[0].color); el.strokeWidth=node.strokeWeight||1; }
  } else if (node.type==='ELLIPSE') {
    el = mkEl('ellipse', x, y, w, h);
    el.fills = parseFigmaFills(node.fills||[]);
    if (node.strokes?.length) { el.stroke=figmaColorToHex(node.strokes[0].color); el.strokeWidth=node.strokeWeight||1; }
  } else if (node.type==='VECTOR'||node.type==='BOOLEAN_OPERATION'||node.type==='STAR'||node.type==='POLYGON') {
    // Fallback to rect with fill approximation
    el = mkEl('rect', x, y, w, h);
    el.rx = node.cornerRadius || 0;
    el.fills = parseFigmaFills(node.fills||[]);
  } else if (node.type==='TEXT') {
    el = mkEl('text', x, y, w, h);
    el.text = node.characters || '';
    el.fills = [];
    const st = node.style||{};
    el.fontSize = st.fontSize||16;
    el.lineHeight = st.lineHeightPx ? Math.round(st.lineHeightPx) : Math.round((st.fontSize||16)*1.4);
    el.fontWeight = String(st.fontWeight||400);
    const tf = (node.fills||[]).find(f=>f.type==='SOLID'&&f.visible!==false);
    if (tf) el.textColor = figmaColorToHex(tf.color);
  } else if (node.type==='LINE') {
    el = mkEl('line', x, y, Math.max(w,1), Math.max(h,1));
    el.fills = parseFigmaFills(node.strokes||[]);
    if (!el.fills.length) el.fills = [mkFill('#888899')];
  }

  // Recurse into unsupported container types (they may have importable children)
  if (!el) {
    if (node.children) node.children.forEach(c=>mapFigmaNode(c, parentId));
    return null;
  }

  el.name    = node.name || el.name;
  el.opacity = node.opacity!=null ? Math.round(node.opacity*100) : 100;
  el.visible = node.visible!==false;
  el.page    = S.page;
  if (parentId) el.parentId = parentId;
  syncLegacyFill(el);

  if (node.children) node.children.forEach(c=>mapFigmaNode(c, el.id));
  return el;
}

function parseFigmaFills(figmaFills) {
  return (figmaFills||[]).filter(f=>f.visible!==false).map(f=>{
    const fill = mkFill('#cccccc');
    if (f.type==='SOLID') {
      fill.type='solid';
      fill.color=figmaColorToHex(f.color);
      fill.opacity=Math.round((f.color?.a??1)*(f.opacity??1)*100);
    } else if (f.type==='GRADIENT_LINEAR') {
      fill.type='linear';
      fill.stops=(f.gradientStops||[]).map(s=>({pos:Math.round(s.position*100),color:figmaColorToHex(s.color),opacity:Math.round((s.color?.a??1)*100)}));
      fill.angle=135;
    } else if (f.type==='GRADIENT_RADIAL') {
      fill.type='radial';
      fill.stops=(f.gradientStops||[]).map(s=>({pos:Math.round(s.position*100),color:figmaColorToHex(s.color),opacity:Math.round((s.color?.a??1)*100)}));
    }
    return fill;
  });
}

function figmaColorToHex(c) {
  if (!c) return '#cccccc';
  const r=Math.round((c.r||0)*255), g=Math.round((c.g||0)*255), b=Math.round((c.b||0)*255);
  return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
}

function centerImportedEls(els) {
  if (!els.length) return;
  const minX=Math.min(...els.map(e=>e.x)), minY=Math.min(...els.map(e=>e.y));
  const maxX=Math.max(...els.map(e=>e.x+e.w)), maxY=Math.max(...els.map(e=>e.y+e.h));
  const cw=canvasWrap.offsetWidth, ch=canvasWrap.offsetHeight;
  const vx=(cw/2-S.panX)/S.zoom, vy=(ch/2-S.panY)/S.zoom;
  const dx=vx-(minX+maxX)/2, dy=vy-(minY+maxY)/2;
  els.forEach(e=>{e.x=snapV(e.x+dx); e.y=snapV(e.y+dy);});
}

// ════════════════════════════════════════════════════════════
// MEDIA DROP + CLIPBOARD PASTE (Images & Videos)
// ════════════════════════════════════════════════════════════
function handleMediaDrop(file, x, y) {
  const isImg=file.type.startsWith('image/'), isVid=file.type.startsWith('video/');
  if (!isImg&&!isVid) return;
  const reader=new FileReader();
  reader.onload=e=>{
    const src=e.target.result;
    if (isImg) {
      const img=new Image();
      img.onload=()=>{
        const maxW=400, scale=Math.min(1,maxW/img.naturalWidth);
        const w=Math.round(img.naturalWidth*scale), h=Math.round(img.naturalHeight*scale);
        const el=mkEl('rect',snapV(x-w/2),snapV(y-h/2),w,h);
        el.name=file.name.replace(/\.[^.]+$/,'');
        el.imageSrc=src; el.fills=[];
        S.selIds=[el.id]; renderAll(); updateProps(); updateLayers();
        notify('Image added — '+el.name);
      };
      img.src=src;
    } else {
      const el=mkEl('rect',snapV(x-200),snapV(y-112),400,225);
      el.type='video'; el.name=file.name.replace(/\.[^.]+$/,'');
      el.videoSrc=src; el.fills=[];
      S.selIds=[el.id]; renderAll(); updateProps(); updateLayers();
      notify('Video added — '+el.name);
    }
  };
  reader.readAsDataURL(file);
}

document.addEventListener('paste', ev=>{
  if (['INPUT','TEXTAREA'].includes(ev.target.tagName)||ev.target.contentEditable==='true') return;
  const items=Array.from(ev.clipboardData?.items||[]);
  const imgItem=items.find(it=>it.type.startsWith('image/'));
  if (!imgItem) return;
  ev.preventDefault();
  const file=imgItem.getAsFile(); if(!file) return;
  const cw=canvasWrap.offsetWidth, ch=canvasWrap.offsetHeight;
  const cx=(cw/2-S.panX)/S.zoom, cy=(ch/2-S.panY)/S.zoom;
  handleMediaDrop(file, cx, cy);
});

// ════════════════════════════════════════════════════════════
// AUTO LAYOUT
// ════════════════════════════════════════════════════════════
function applyAutoLayout(frame) {
  if (!frame.autoLayout) return;
  const {direction, gap, padding, align} = frame.autoLayout;
  // Children in their current S.els order (order = visual order)
  const children = S.els.filter(e=>e.parentId===frame.id&&e.visible!==false&&e.page===S.page);
  if (!children.length) return;

  const isH = direction==='horizontal';
  let cursor = (isH ? frame.x : frame.y) + padding;
  const crossOrig = isH ? frame.y : frame.x;
  const crossSize = isH ? frame.h : frame.w;

  children.forEach(child=>{
    if (isH) {
      child.x = cursor;
      if      (align==='start')  child.y = crossOrig + padding;
      else if (align==='center') child.y = crossOrig + (crossSize - child.h) / 2;
      else                       child.y = crossOrig + crossSize - padding - child.h;
      cursor += child.w + gap;
    } else {
      child.y = cursor;
      if      (align==='start')  child.x = crossOrig + padding;
      else if (align==='center') child.x = crossOrig + (crossSize - child.w) / 2;
      else                       child.x = crossOrig + crossSize - padding - child.w;
      cursor += child.h + gap;
    }
  });
}

function toggleAutoLayout(elId) {
  const el=getEl(elId); if(!el||el.type!=='frame') return;
  el.autoLayout = el.autoLayout ? null : {direction:'horizontal', gap:16, padding:16, align:'start'};
  renderAll(); updateProps();
  notify(el.autoLayout ? 'Auto Layout enabled' : 'Auto Layout disabled');
}

function setAL(elId, key, val) {
  const el=getEl(elId); if(!el||!el.autoLayout) return;
  el.autoLayout[key]=val;
  renderAll();
}

// ── Layout Grid helpers ──
function addLayoutGrid(elId) {
  const el=getEl(elId); if(!el||el.type!=='frame') return;
  pushUndo();
  if (!el.layoutGrids) el.layoutGrids = [];
  el.layoutGrids.push({type:'columns', count:12, gutter:16, margin:16, color:'#ff0000', opacity:10, visible:true});
  renderAll(); updateProps();
}
function deleteLayoutGrid(elId, idx) {
  const el=getEl(elId); if(!el||!el.layoutGrids) return;
  pushUndo();
  el.layoutGrids.splice(idx,1);
  renderAll(); updateProps();
}
function setLayoutGrid(elId, idx, key, val) {
  const el=getEl(elId); if(!el||!el.layoutGrids||!el.layoutGrids[idx]) return;
  el.layoutGrids[idx][key] = val;
  renderAll();
}
function toggleLayoutGridVisible(elId, idx) {
  const el=getEl(elId); if(!el||!el.layoutGrids||!el.layoutGrids[idx]) return;
  el.layoutGrids[idx].visible = !el.layoutGrids[idx].visible;
  renderAll(); updateProps();
}

function renderLayoutGrid(frameDom, el) {
  if (!el.layoutGrids || !el.layoutGrids.length) return;
  const w = el.w, h = el.h;
  el.layoutGrids.forEach(grid => {
    if (!grid.visible) return;
    const rgba = `${grid.color}${Math.round(grid.opacity/100*255).toString(16).padStart(2,'0')}`;
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:9000;overflow:hidden;`;

    if (grid.type === 'columns') {
      const count = Math.max(1, grid.count||12);
      const margin = grid.margin||0;
      const gutter = grid.gutter||0;
      const totalGutters = (count-1)*gutter;
      const colW = (w - margin*2 - totalGutters) / count;
      for (let i=0; i<count; i++) {
        const x = margin + i*(colW+gutter);
        const col = document.createElement('div');
        col.style.cssText = `position:absolute;top:0;bottom:0;left:${x}px;width:${colW}px;background:${rgba};`;
        overlay.appendChild(col);
      }
    } else if (grid.type === 'rows') {
      const count = Math.max(1, grid.count||5);
      const margin = grid.margin||0;
      const gutter = grid.gutter||0;
      const totalGutters = (count-1)*gutter;
      const rowH = (h - margin*2 - totalGutters) / count;
      for (let i=0; i<count; i++) {
        const y = margin + i*(rowH+gutter);
        const row = document.createElement('div');
        row.style.cssText = `position:absolute;left:0;right:0;top:${y}px;height:${rowH}px;background:${rgba};`;
        overlay.appendChild(row);
      }
    } else if (grid.type === 'grid') {
      const size = Math.max(1, grid.gutter||8);
      // Vertical lines
      for (let x=0; x<w; x+=size) {
        const ln = document.createElement('div');
        ln.style.cssText = `position:absolute;top:0;bottom:0;left:${x}px;width:1px;background:${rgba};`;
        overlay.appendChild(ln);
      }
      // Horizontal lines
      for (let y=0; y<h; y+=size) {
        const ln = document.createElement('div');
        ln.style.cssText = `position:absolute;left:0;right:0;top:${y}px;height:1px;background:${rgba};`;
        overlay.appendChild(ln);
      }
    }

    frameDom.appendChild(overlay);
  });
}

// ════════════════════════════════════════════════════════════
// FILE SYSTEM — localStorage persistence layer
// ════════════════════════════════════════════════════════════
const FS = {
  _KEY: 'canvus_files',
  load()    { try { return JSON.parse(localStorage.getItem(this._KEY)||'[]'); } catch(_){return[];} },
  save(arr) {
    try { localStorage.setItem(this._KEY, JSON.stringify(arr)); }
    catch(_) {
      // Retry stripping large media blobs
      const slim = arr.map(f=>({...f, els:(f.els||[]).map(e=>{const c={...e};delete c.imageSrc;delete c.videoSrc;return c;})}));
      try { localStorage.setItem(this._KEY, JSON.stringify(slim)); }
      catch(__) { notify('Storage full — free browser storage to save'); }
    }
  },
  all()     { return this.load(); },
  active()  { return this.load().filter(f=>!f.deleted).sort((a,b)=>b.modified-a.modified); },
  deleted() { return this.load().filter(f=> f.deleted).sort((a,b)=>b.modified-a.modified); },
  get(id)   { return this.load().find(f=>f.id===id)||null; },
  put(file) { const a=this.load(); const i=a.findIndex(f=>f.id===file.id); i>=0?a[i]=file:a.push(file); this.save(a); },
  remove(id){ this.save(this.load().filter(f=>f.id!==id)); },
};

// ════════════════════════════════════════════════════════════
// WORKSPACE — dashboard UI
// ════════════════════════════════════════════════════════════
let _wsSection = 'recent';
let _wsCtxId   = null;

// Save current editor state to FS
function wsSaveCurrentFile() {
  if (!S.fileId) S.fileId = S.collab.shareId || ('file_'+Math.random().toString(36).slice(2,10));
  const existing = FS.get(S.fileId);
  FS.put({
    id:          S.fileId,
    name:        document.getElementById('file-name').value.trim() || 'Untitled File',
    created:     existing?.created || Date.now(),
    modified:    Date.now(),
    deleted:     existing?.deleted || false,
    els:         JSON.parse(JSON.stringify(S.els)),
    pages:       JSON.parse(JSON.stringify(S.pages)),
    nextId:      S.nextId,
    protoConns:  JSON.parse(JSON.stringify(S.protoConns)),
    comments:    JSON.parse(JSON.stringify(S.comments)),
    colorStyles: JSON.parse(JSON.stringify(S.colorStyles)),
  });
}

function openWorkspace() {
  wsSaveCurrentFile();
  _wsSection = 'recent';
  document.getElementById('workspace').classList.add('open');
  wsSection('recent');
}

function closeWorkspace() {
  document.getElementById('workspace').classList.remove('open');
}

function openPresent() {
  wsSaveCurrentFile();
  if (!S.fileId) { notify('Save the file first'); return; }
  window.open('present.html?fileId=' + encodeURIComponent(S.fileId), '_blank');
}

function wsSection(sec) {
  _wsSection = sec;
  document.querySelectorAll('.ws-nav-item').forEach(i=>i.classList.toggle('on', i.dataset.section===sec));
  document.getElementById('ws-section-title').textContent = {recent:'Recent',drafts:'Drafts',trash:'Trash'}[sec]||sec;
  wsRender();
}

// ── File operations ──
function wsNewFile() {
  wsSaveCurrentFile();
  S.fileId  = 'file_'+Math.random().toString(36).slice(2,10);
  S.els=[]; S.pages=[{id:1,name:'Page 1'}]; S.page=1;
  S.nextId=1; S.protoConns=[]; S.comments=[]; S.selIds=[];
  S.protoMode=false; S.protoFrom=null;
  document.getElementById('file-name').value='Untitled File';
  wsSaveCurrentFile();
  closeWorkspace();
  S.zoom=1; S.panX=80; S.panY=70; applyTransform();
  renderAll(); updateProps(); updatePages(); updateLayers();
  notify('New file created');
}

function wsOpenFile(id) {
  const file = FS.get(id); if (!file||file.deleted) return;
  wsSaveCurrentFile();
  S.fileId = file.id;
  S.els          = JSON.parse(JSON.stringify(file.els||[]));
  S.pages        = JSON.parse(JSON.stringify(file.pages||[{id:1,name:'Page 1'}]));
  S.page         = S.pages[0]?.id || 1;
  S.protoConns   = JSON.parse(JSON.stringify(file.protoConns||[]));
  S.comments     = JSON.parse(JSON.stringify(file.comments||[]));
  S.colorStyles  = JSON.parse(JSON.stringify(file.colorStyles||S.colorStyles));
  S.nextId       = Math.max(file.nextId||1, ...(S.els.map(e=>e.id||0).concat([0]))) + 1;
  S.selIds=[]; S.protoMode=false; S.protoFrom=null;
  document.getElementById('file-name').value = file.name;
  closeWorkspace();
  S.zoom=1; S.panX=80; S.panY=70; applyTransform();
  renderAll(); updateProps(); updatePages(); updateLayers();
  notify('Opened "'+file.name+'"');
}

function wsRenameFile(id) {
  const file=FS.get(id); if(!file) return;
  // Inline rename on the card .ws-name span
  const card=document.querySelector(`.ws-card[data-id="${id}"]`); if(!card) return;
  const nameEl=card.querySelector('.ws-name');
  const orig=file.name;
  const inp=document.createElement('input');
  inp.value=orig;
  inp.style.cssText='width:100%;background:var(--surface2);border:1px solid var(--accent);border-radius:4px;padding:2px 5px;font-size:12px;color:var(--text);outline:none;font-family:inherit;';
  nameEl.replaceWith(inp); inp.focus(); inp.select();
  const commit=()=>{
    file.name=inp.value.trim()||orig; file.modified=Date.now(); FS.put(file);
    if (file.id===S.fileId) document.getElementById('file-name').value=file.name;
    wsRender();
  };
  inp.addEventListener('keydown',ev=>{
    ev.stopPropagation();
    if(ev.key==='Enter'){ev.preventDefault();commit();}
    if(ev.key==='Escape'){inp.value=orig;commit();}
  });
  inp.addEventListener('blur',commit);
}

function wsDuplicateFile(id) {
  const file=FS.get(id); if(!file) return;
  FS.put({...file, id:'file_'+Math.random().toString(36).slice(2,10), name:file.name+' copy', created:Date.now(), modified:Date.now(), deleted:false, els:JSON.parse(JSON.stringify(file.els||[]))});
  wsRender(); notify('Duplicated "'+file.name+'"');
}

function wsSoftDelete(id) {
  const file=FS.get(id); if(!file) return;
  file.deleted=true; file.modified=Date.now(); FS.put(file);
  wsRender(); notify('"'+file.name+'" moved to Trash');
}

function wsRestore(id) {
  const file=FS.get(id); if(!file) return;
  file.deleted=false; file.modified=Date.now(); FS.put(file);
  wsRender(); notify('"'+file.name+'" restored');
}

function wsPermDelete(id) {
  if (!confirm('Permanently delete this file? This cannot be undone.')) return;
  FS.remove(id); wsRender(); notify('File permanently deleted');
}

// ── Thumbnail ──
function wsMakeThumb(file) {
  const pid=(file.pages?.[0]?.id)||1;
  const els=(file.els||[]).filter(e=>e.page===pid&&e.visible!==false&&e.type!=='video');
  if (!els.length) return `<div class="ws-thumb-empty"></div>`;
  const minX=Math.min(...els.map(e=>e.x)), minY=Math.min(...els.map(e=>e.y));
  const maxX=Math.max(...els.map(e=>e.x+(e.w||0))), maxY=Math.max(...els.map(e=>e.y+(e.h||0)));
  const vw=Math.max(1,maxX-minX), vh=Math.max(1,maxY-minY);
  const pad=Math.max(vw,vh)*0.06;
  const shapes=els.slice(0,40).map(el=>{
    const ex=el.x-minX, ey=el.y-minY, op=(el.opacity||100)/100;
    const fill=el.imageSrc?'#5566aa':el.fills?.[0]?.color||el.fill||'#555566';
    const rx=Math.min(el.rx||0, Math.min((el.w||0),(el.h||0))/2);
    if (el.type==='ellipse') return `<ellipse cx="${ex+(el.w||0)/2}" cy="${ey+(el.h||0)/2}" rx="${(el.w||0)/2}" ry="${(el.h||0)/2}" fill="${fill}" opacity="${op}"/>`;
    if (el.type==='text')    return `<rect x="${ex}" y="${ey}" width="${el.w||60}" height="${Math.max(el.h||0,4)}" fill="${el.textColor||'#aaa'}" opacity="${op*0.45}" rx="2"/>`;
    if (el.type==='line')    return `<line x1="${ex}" y1="${ey}" x2="${ex+(el.w||0)}" y2="${ey+(el.h||0)}" stroke="${fill}" stroke-width="2" opacity="${op}"/>`;
    return `<rect x="${ex}" y="${ey}" width="${el.w||8}" height="${el.h||8}" fill="${fill}" opacity="${op}" rx="${rx}"/>`;
  }).join('');
  return `<svg viewBox="${-pad} ${-pad} ${vw+pad*2} ${vh+pad*2}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="background:var(--canvas)">${shapes}</svg>`;
}

// ── Date formatting ──
function wsFmtDate(ts) {
  if (!ts) return '';
  const diff=Date.now()-ts;
  if (diff<60000)     return 'just now';
  if (diff<3600000)   return Math.floor(diff/60000)+'m ago';
  if (diff<86400000)  return Math.floor(diff/3600000)+'h ago';
  if (diff<604800000) return Math.floor(diff/86400000)+'d ago';
  return new Date(ts).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'});
}

// ── Render grid ──
function wsRender() {
  const grid=document.getElementById('ws-grid'); if(!grid) return;
  let files=[];
  if (_wsSection==='recent') {
    files=FS.active();
  } else if (_wsSection==='drafts') {
    files=FS.active().filter(f=>f.name==='Untitled File'||f.name.startsWith('Untitled '));
  } else {
    files=FS.deleted();
  }
  if (!files.length) {
    const msg=_wsSection==='trash'?'Trash is empty':'No files here yet';
    const hint=_wsSection!=='trash'?`<div style="font-size:11px;margin-top:5px;color:var(--text3);">Click <b style="color:var(--text2);">+ New File</b> to start</div>`:'';
    grid.innerHTML=`<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;padding:56px 0;"><svg width="44" height="44" viewBox="0 0 44 44" fill="none" style="opacity:.18;margin-bottom:14px;"><rect x="5" y="5" width="34" height="34" rx="5" stroke="#9090a8" stroke-width="1.5" stroke-dasharray="5 4"/></svg><div style="font-size:13px;color:var(--text3);">${msg}</div>${hint}</div>`;
    return;
  }
  grid.innerHTML=files.map(f=>{
    const isOpen=f.id===S.fileId;
    const thumb=wsMakeThumb(f);
    const openBadge=isOpen?`<span style="font-size:9px;color:var(--accent);background:var(--accent-soft);padding:1px 5px;border-radius:3px;flex-shrink:0;">open</span>`:'';
    return `<div class="ws-card${isOpen?' ws-card-open':''}" data-id="${f.id}"
        onclick="wsCardClick('${f.id}')"
        oncontextmenu="wsShowCtx(event,'${f.id}');return false;"
        title="${escHtml(f.name)}">
      <div class="ws-thumb">${thumb}</div>
      <div class="ws-info">
        <div class="ws-name">${escHtml(f.name)}${openBadge}</div>
        <div class="ws-date">${wsFmtDate(f.modified)}</div>
      </div>
      <button class="ws-menu-btn" onclick="wsShowCtx(event,'${f.id}')" title="File options">···</button>
    </div>`;
  }).join('');
}

function wsCardClick(id) {
  if (_wsSection==='trash') { wsShowCtx(null, id); return; }
  if (id===S.fileId)        { closeWorkspace(); return; }
  wsOpenFile(id);
}

// ── Context menu ──
function wsShowCtx(ev, id) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  _wsCtxId=id;
  const file=FS.get(id);
  const ctx=document.getElementById('ws-ctx');
  ctx.innerHTML=file?.deleted ? `
    <div class="ws-ctx-item" onclick="wsRestore('${id}');wsHideCtx()">↩ Restore</div>
    <div class="ws-ctx-sep"></div>
    <div class="ws-ctx-item danger" onclick="wsPermDelete('${id}');wsHideCtx()">Delete Forever</div>
  ` : `
    <div class="ws-ctx-item" onclick="wsRenameFile('${id}');wsHideCtx()">✏️ Rename</div>
    <div class="ws-ctx-item" onclick="wsDuplicateFile('${id}');wsHideCtx()">⧉ Duplicate</div>
    <div class="ws-ctx-sep"></div>
    <div class="ws-ctx-item danger" onclick="wsSoftDelete('${id}');wsHideCtx()">🗑 Move to Trash</div>
  `;
  if (ev) {
    const x=Math.min(ev.clientX, window.innerWidth-180);
    const y=Math.min(ev.clientY, window.innerHeight-130);
    ctx.style.left=x+'px'; ctx.style.top=y+'px';
  } else {
    const card=document.querySelector(`.ws-card[data-id="${id}"]`);
    if (card) { const r=card.getBoundingClientRect(); ctx.style.left=(r.right-175)+'px'; ctx.style.top=r.bottom+'px'; }
  }
  ctx.classList.add('open');
}

function wsHideCtx() {
  document.getElementById('ws-ctx')?.classList.remove('open');
}

// Close context menu on any outside click (bubble phase so onclick runs first)
document.addEventListener('click', ()=>wsHideCtx());
// Prevent the ctx div from closing itself when clicking items
document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('ws-ctx')?.addEventListener('click', ev=>ev.stopPropagation());
});

// Sync file-name input → FS on change
document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('file-name').addEventListener('change', ev=>{
    if (S.fileId) {
      const f=FS.get(S.fileId);
      if (f){ f.name=ev.target.value.trim()||'Untitled File'; f.modified=Date.now(); FS.put(f); }
    }
  });
});

// ════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════
(function boot() {
  setTool('select');
  applyTransform();

  // Restore last saved session if one exists
  const _sf = FS.load().filter(f=>!f.deleted).sort((a,b)=>b.modified-a.modified);
  if (_sf.length) {
    const _f = _sf[0];
    S.fileId     = _f.id;
    S.els        = JSON.parse(JSON.stringify(_f.els||[]));
    S.pages      = JSON.parse(JSON.stringify(_f.pages||[{id:1,name:'Page 1'}]));
    S.page       = S.pages[0]?.id||1;
    S.protoConns = JSON.parse(JSON.stringify(_f.protoConns||[]));
    S.comments   = JSON.parse(JSON.stringify(_f.comments||[]));
    S.colorStyles= JSON.parse(JSON.stringify(_f.colorStyles||S.colorStyles));
    S.nextId     = Math.max(_f.nextId||1,...(S.els.map(e=>e.id||0).concat([0])))+1;
    document.getElementById('file-name').value = _f.name;
    updatePages(); renderAll(); updateProps(); updateLayers();
    
    // Initialize page info display
    const currentPage = S.pages.find(p => p.id === S.page);
    if (currentPage) {
      updatePageInfoDisplay(currentPage);
    }
    
    setTimeout(()=>notify('Welcome back ✦ '+_f.name), 400);
    return;
  }

  // No saved files — seed the Welcome demo
  updatePages();
  
  // Initialize page info display
  const currentPage = S.pages.find(p => p.id === S.page);
  if (currentPage) {
    updatePageInfoDisplay(currentPage);
  }

 // --- Seed: Welcome demo ---

// Big white card
const card = mkEl('rect', 96, 96, 920, 580);
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
const qsBg = mkEl('rect', 128, 400, 840, 260);
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
  setTimeout(wsSaveCurrentFile, 0);
  setTimeout(()=>notify('Welcome to Canvus ✦  Hold Alt over elements to measure spacing'), 400);

  // Init theme from localStorage
  (function(){
    const t = localStorage.getItem('canvus-theme') || 'light';
    document.documentElement.dataset.theme = t;
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.innerHTML = t === 'light' ? _ICON_MOON : _ICON_SUN;
  })();
})();

// ── Theme ─────────────────────────────────────────────────────────────────────
const _ICON_SUN  = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M6.5 1v1.2M6.5 10.8V12M1 6.5h1.2M10.8 6.5H12M2.85 2.85l.85.85M9.3 9.3l.85.85M9.3 2.85l-.85.85M3.7 9.3l-.85.85" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
const _ICON_MOON = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M10.2 7.2A4.7 4.7 0 0 1 5.8 2.8c0-.45.06-.88.18-1.3A4.7 4.7 0 1 0 10.2 7.2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('canvus-theme', next);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.innerHTML = next === 'light' ? _ICON_MOON : _ICON_SUN;
  renderGrid();
}

// ── Canvus AI panel ───────────────────────────────────────────────────────────
const _AI_URL      = '/ai';
const _STATE_URL   = '/state';
const _GENERATE_URL = '/generate';

// ─── Cloud Sync ───────────────────────────────────────────────────────────────

async function pullFromCloud() {
  const btn = document.getElementById('btn-pull-cloud');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const res = await fetch(_STATE_URL);
    if (!res.ok) { notify('No cloud state — run: canvus-ai "create ..."'); return; }
    const doc = await res.json();
    if (!doc || !Array.isArray(doc.els)) { notify('Cloud state is empty'); return; }
    pushUndo();
    S.els         = JSON.parse(JSON.stringify(doc.els        || []));
    S.pages       = JSON.parse(JSON.stringify(doc.pages      || [{id:1,name:'Page 1'}]));
    S.page        = doc.page        || S.pages[0]?.id || 1;
    S.protoConns  = JSON.parse(JSON.stringify(doc.protoConns || []));
    S.comments    = JSON.parse(JSON.stringify(doc.comments   || []));
    S.colorStyles = JSON.parse(JSON.stringify(doc.colorStyles|| S.colorStyles));
    S.nextId      = Math.max(doc.nextId || 1, ...S.els.map(e => (e.id||0)+1));
    renderAll(); updateProps(); updateLayers(); updatePages();
    notify('↓ Design pulled from cloud');
  } catch (err) {
    notify('Pull failed: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↓ AI'; }
  }
}

async function pushToCloud() {
  const btn = document.getElementById('btn-push-cloud');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const doc = JSON.parse(_snapState());
    const res = await fetch(_STATE_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (!res.ok) { notify('Push failed'); return; }
    notify('↑ Design pushed to cloud');
  } catch (err) {
    notify('Push failed: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↑ AI'; }
  }
}

function toggleAI() {
  const panel = document.getElementById('ai-panel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) document.getElementById('ai-input').focus();
}

function closeAI() {
  document.getElementById('ai-panel').classList.remove('open');
}

let _aiMode = 'edit'; // 'edit' | 'generate'
function setAIMode(mode) {
  _aiMode = mode;
  document.getElementById('ai-tab-edit').classList.toggle('active', mode === 'edit');
  document.getElementById('ai-tab-gen').classList.toggle('active', mode === 'generate');
  const input = document.getElementById('ai-input');
  input.placeholder = mode === 'generate'
    ? 'Describe a page to create… e.g. "landing page with hero and 3 feature cards"'
    : 'Ask AI to edit your design… (Enter to send)';
}

async function sendAIPrompt() {
  const input  = document.getElementById('ai-input');
  const status = document.getElementById('ai-status');
  const btn    = document.getElementById('ai-send');
  const prompt = input.value.trim();
  if (!prompt) return;

  btn.disabled = true;
  btn.textContent = '…';
  status.textContent = 'Thinking…';

  try {
    if (_aiMode === 'generate') {
      // ── Generate mode: create a full document from scratch ──────────────────
      const res = await fetch(_GENERATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch {
        status.textContent = `Worker error ${res.status} — see console.`;
        btn.disabled = false; btn.textContent = 'Send'; return;
      }
      if (!res.ok || data.error) {
        status.textContent = data?.error || `Worker error ${res.status}.`;
        btn.disabled = false; btn.textContent = 'Send'; return;
      }
      const doc = data.document;
      if (!doc || !Array.isArray(doc.els)) {
        status.textContent = 'AI returned an empty document.';
        btn.disabled = false; btn.textContent = 'Send'; return;
      }
      pushUndo();
      S.els         = JSON.parse(JSON.stringify(doc.els        || []));
      S.pages       = JSON.parse(JSON.stringify(doc.pages      || [{id:1,name:'Page 1'}]));
      S.page        = doc.page        || S.pages[0]?.id || 1;
      S.protoConns  = JSON.parse(JSON.stringify(doc.protoConns || []));
      S.comments    = JSON.parse(JSON.stringify(doc.comments   || []));
      S.colorStyles = JSON.parse(JSON.stringify(doc.colorStyles|| S.colorStyles));
      S.nextId      = Math.max(doc.nextId || 1, ...S.els.map(e => (e.id||0)+1));
      // Ensure all elements have the correct page field (AI may omit it)
      S.els.forEach(el => { if (el.page == null) el.page = S.page; });
      renderAll(); updateProps(); updateLayers(); updatePages(); zoomToFit();
      input.value = '';
      status.textContent = data.summary || 'Page generated.';
    } else {
      // ── Edit mode: modify current canvas with JS code ────────────────────────
      const doc = {
        pageName: S.pages.find(p => p.id === S.page)?.name || 'Page',
        page: S.page,
        els: S.els.filter(e => e.page === S.page).map(e => ({
          id: e.id, type: e.type, name: e.name,
          x: e.x, y: e.y, w: e.w, h: e.h,
          ...(e.parentId ? { parentId: e.parentId } : {}),
          ...(e.text     ? { text: e.text }         : {}),
        })),
      };
      const res = await fetch(_AI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, document: doc, selIds: S.selIds }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch {
        status.textContent = `Worker error ${res.status} — see console.`;
        btn.disabled = false; btn.textContent = 'Send'; return;
      }
      if (!res.ok) {
        status.textContent = data.error || `Worker error ${res.status}.`;
        btn.disabled = false; btn.textContent = 'Send'; return;
      }
      if (data.ops?.length) {
        const { applied, skipped } = applyOps(data.ops);
        input.value = '';
        status.textContent = data.summary || `Applied ${applied.length} change${applied.length !== 1 ? 's' : ''}.`;
        if (skipped.length) console.warn('[Canvus AI] skipped ops:', skipped);
      } else {
        status.textContent = data.summary || data.error || 'No changes made.';
      }
    }
  } catch (err) {
    console.error('[Canvus AI] fetch failed:', err);
    status.textContent = `Network error: ${err.message}`;
  }

  btn.disabled = false;
  btn.textContent = 'Send';
}

// Send on Enter (Shift+Enter = newline)
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('ai-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAIPrompt(); }
  });
});

// ════════════════════════════════════════════════════════════
// HTML IMPORT — Convert HTML+CSS subset to Canvus nodes
// Uses the browser's own layout engine (hidden iframe) so all
// CSS — flexbox, variables, cascade — is resolved for free.
// ════════════════════════════════════════════════════════════

let _htmlImportMode = 'page'; // 'page' | 'component'

function showHTMLImportModal() {
  document.getElementById('html-import-modal').classList.add('open');
}
function closeHTMLImportModal() {
  document.getElementById('html-import-modal').classList.remove('open');
}
function setHTMLImportMode(mode) {
  _htmlImportMode = mode;
  document.getElementById('html-import-tab-page').classList.toggle('active', mode === 'page');
  document.getElementById('html-import-tab-component').classList.toggle('active', mode === 'component');
  document.getElementById('html-import-id-row').style.display = mode === 'component' ? 'flex' : 'none';
}
function htmlImportLoadFile(ev, target) {
  const file = ev.target.files[0]; if (!file) return;
  ev.target.value = '';
  const reader = new FileReader();
  reader.onload = e => { document.getElementById(`html-import-${target}`).value = e.target.result; };
  reader.readAsText(file);
}

async function runHTMLImport() {
  const htmlStr = document.getElementById('html-import-html').value.trim();
  const cssStr  = document.getElementById('html-import-css').value.trim();
  if (!htmlStr) { notify('Paste or load HTML to import'); return; }

  const isComponent = _htmlImportMode === 'component';
  const targetId    = isComponent ? document.getElementById('html-import-cid').value.trim() : '';
  if (isComponent && !targetId) { notify('Enter a data-canvus-id to identify the component root'); return; }

  closeHTMLImportModal();

  const unsupported = [];
  const newEls      = [];

  // ── 1. Render in a sandboxed iframe for accurate layout ───────────────────
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1440px;height:5000px;border:none;pointer-events:none;opacity:0;z-index:-9999;';
  document.body.appendChild(iframe);

  const iDoc = iframe.contentDocument;
  iDoc.open();
  iDoc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box;}${cssStr}</style></head><body style="margin:0;padding:0;">${htmlStr}</body></html>`);
  iDoc.close();

  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const iWin    = iframe.contentWindow;
  const bodyEl  = iDoc.body;
  const bodyRect = bodyEl.getBoundingClientRect();

  // ── 2a. Component mode — locate subtree by data-canvus-id ─────────────────
  if (isComponent) {
    const rootDomEl = iDoc.querySelector(`[data-canvus-id="${CSS.escape(targetId)}"]`);
    if (!rootDomEl) {
      document.body.removeChild(iframe);
      notify(`No element with data-canvus-id="${targetId}" found`);
      return;
    }

    const compRect = rootDomEl.getBoundingClientRect();
    const compW    = Math.max(1, Math.round(compRect.width));
    const compH    = Math.max(1, Math.round(compRect.height));
    const { x: placeX, y: placeY } = _htmlImportNextToExisting();

    // Build the component master frame
    const compFrame           = mkEl('frame', placeX, placeY, compW, compH);
    compFrame.name            = '⬡ ' + targetId;
    compFrame.isComponent     = true;
    compFrame.componentId     = null;
    compFrame.overrides       = {};
    compFrame.variantProps    = {};
    compFrame.page            = S.page;

    // Apply the root element's own styles
    const computed = iWin.getComputedStyle(rootDomEl);
    const styles   = _htmlExtractStyles(rootDomEl, computed, unsupported);
    _htmlApplyFrameStyles(compFrame, styles);
    if (computed.display === 'flex' || computed.display === 'inline-flex') {
      const isRow = !computed.flexDirection?.startsWith('column');
      compFrame.autoLayout = {
        direction: isRow ? 'horizontal' : 'vertical',
        gap:       Math.round(parseFloat(computed.gap || computed.rowGap || computed.columnGap) || 0),
        padding:   Math.round(parseFloat(computed.paddingTop) || 0),
        align:     _htmlMapAlign(computed.alignItems),
      };
    }
    syncLegacyFill(compFrame);
    newEls.push(compFrame);

    // Walk children of the component root
    for (const child of rootDomEl.children) {
      _htmlWalkNode(child, compFrame.id, compRect, iWin, newEls, unsupported);
    }

    document.body.removeChild(iframe);
    pushUndo();
    S.els.push(...newEls);
    S.selIds = [compFrame.id];
    renderAll(); updateProps(); updateLayers();
    zoomToSel();
    notify(`Imported component "⬡ ${targetId}" — ${newEls.length} element${newEls.length !== 1 ? 's' : ''}`);
    if (unsupported.length) _htmlImportShowDebug(unsupported);
    return;
  }

  // ── 2b. Full-page mode ────────────────────────────────────────────────────
  const docW = Math.max(390, Math.round(iDoc.documentElement.scrollWidth  || bodyRect.width  || 1440));
  const docH = Math.max(100, Math.round(iDoc.documentElement.scrollHeight || bodyRect.height || 900));
  const rootFrame = mkEl('frame', 200, 200, docW, docH);
  rootFrame.name  = 'Imported Page';
  rootFrame.fills = [{ ...mkFill('#ffffff'), opacity: 100 }];
  rootFrame.page  = S.page;
  newEls.push(rootFrame);

  for (const child of bodyEl.children) {
    _htmlWalkNode(child, rootFrame.id, bodyRect, iWin, newEls, unsupported);
  }

  document.body.removeChild(iframe);
  pushUndo();
  S.els.push(...newEls);
  S.selIds = [rootFrame.id];
  renderAll(); updateProps(); updateLayers();
  zoomToFit();
  notify(`Imported ${newEls.length} element${newEls.length !== 1 ? 's' : ''} from HTML`);
  if (unsupported.length) _htmlImportShowDebug(unsupported);
}

// Returns a canvas position just to the right of all existing top-level elements
function _htmlImportNextToExisting() {
  const pageEls = S.els.filter(e => e.page === S.page && !e.parentId);
  if (!pageEls.length) return { x: 200, y: 200 };
  const maxX = Math.max(...pageEls.map(e => e.x + e.w));
  const minY = Math.min(...pageEls.map(e => e.y));
  return { x: maxX + 100, y: minY };
}

// ─── Tag categories ───────────────────────────────────────────────────────────
const _HTML_FRAME_TAGS  = new Set(['div','section','main','header','footer','nav','aside','article','form','ul','ol','li','figure','fieldset','details','summary','address']);
const _HTML_TEXT_TAGS   = new Set(['p','span','h1','h2','h3','h4','h5','h6','label','strong','em','small','time','blockquote','cite','code','pre','td','th','caption','dt','dd','legend']);
const _HTML_BUTTON_TAGS = new Set(['button','a']);
const _HTML_IMG_TAGS    = new Set(['img','picture']);
const _HTML_SKIP_TAGS   = new Set(['script','style','head','link','meta','noscript','template','svg','use','defs','path','circle','rect','polygon','br','hr','input','select','textarea','iframe']);

// ─── Recursive DOM walker ─────────────────────────────────────────────────────
function _htmlWalkNode(domEl, parentId, parentRect, iWin, newEls, unsupported) {
  const tag = domEl.tagName?.toLowerCase();
  if (!tag || _HTML_SKIP_TAGS.has(tag)) return;

  const rect = domEl.getBoundingClientRect();
  const w    = Math.round(rect.width);
  const h    = Math.round(rect.height);
  if (w < 1 || h < 1) return;

  // Coordinates relative to parent element's top-left
  const x = Math.round(rect.left - parentRect.left);
  const y = Math.round(rect.top  - parentRect.top);

  const computed = iWin.getComputedStyle(domEl);
  if (computed.display === 'none' || computed.visibility === 'hidden') return;

  const styles   = _htmlExtractStyles(domEl, computed, unsupported);
  const canvusId = domEl.getAttribute('data-canvus-id');
  if (!canvusId) console.warn(`[HTML Import] <${tag}${domEl.className ? '.' + domEl.className.trim().split(/\s+/)[0] : ''}> missing data-canvus-id`);

  let el       = null;
  const extras = []; // button text child etc.

  // ── Map element type ──────────────────────────────────────────────────────
  if (_HTML_IMG_TAGS.has(tag)) {
    el           = mkEl('rect', x, y, w, h);
    el.imageSrc  = domEl.getAttribute('src') || domEl.currentSrc || '';
    el.fills     = [];
    el.name      = domEl.getAttribute('alt') || canvusId || 'Image';

  } else if (_HTML_TEXT_TAGS.has(tag)) {
    const text = domEl.textContent?.trim() || '';
    if (!text) return; // skip visually empty text containers
    el           = mkEl('text', x, y, w, h);
    el.text      = text;
    el.name      = canvusId || text.slice(0, 40) || tag;
    el.fills     = [];
    _htmlApplyTextStyles(el, styles);

  } else if (_HTML_BUTTON_TAGS.has(tag)) {
    el      = mkEl('frame', x, y, w, h);
    el.name = canvusId || domEl.textContent?.trim().slice(0, 40) || 'Button';
    _htmlApplyFrameStyles(el, styles);
    // Inline text label as a child text node
    const text = domEl.textContent?.trim() || '';
    if (text) {
      const lbl        = mkEl('text', 0, 0, w, h);
      lbl.text         = text;
      lbl.name         = el.name + ' Label';
      lbl.parentId     = el.id;
      lbl.page         = S.page;
      lbl.fills        = [];
      lbl.textAlign    = 'center';
      _htmlApplyTextStyles(lbl, styles);
      extras.push(lbl);
    }

  } else {
    // Generic frame (div, section, nav, …)
    el      = mkEl('frame', x, y, w, h);
    el.name = canvusId || domEl.id || domEl.className?.trim().split(/\s+/)[0] || tag;
    _htmlApplyFrameStyles(el, styles);

    // Map flexbox → Canvus autoLayout
    if (computed.display === 'flex' || computed.display === 'inline-flex') {
      const isRow  = !computed.flexDirection?.startsWith('column');
      const gap    = parseFloat(computed.gap || computed.rowGap || computed.columnGap) || 0;
      const pt     = parseFloat(computed.paddingTop)    || 0;
      const pr     = parseFloat(computed.paddingRight)  || 0;
      const pb     = parseFloat(computed.paddingBottom) || 0;
      const pl     = parseFloat(computed.paddingLeft)   || 0;
      el.autoLayout = {
        direction: isRow ? 'horizontal' : 'vertical',
        gap:       Math.round(gap),
        padding:   Math.round((pt + pr + pb + pl) / 4), // avg for single-value approximation
        align:     _htmlMapAlign(computed.alignItems),
      };
    }
  }

  if (!el) return;
  el.parentId = parentId;
  el.page     = S.page;
  syncLegacyFill(el);

  newEls.push(el, ...extras);

  // Recurse into children (text/button/img content handled inline above)
  if (!_HTML_TEXT_TAGS.has(tag) && !_HTML_BUTTON_TAGS.has(tag) && !_HTML_IMG_TAGS.has(tag)) {
    for (const child of domEl.children) {
      _htmlWalkNode(child, el.id, rect, iWin, newEls, unsupported);
    }
  }
}

// ─── Style extraction (reads computed styles from browser) ────────────────────
function _htmlExtractStyles(domEl, c, unsupported) {
  const s = {
    bg:          _htmlRgbToHex(c.backgroundColor),
    bgOpacity:   _htmlRgbaOpacity(c.backgroundColor),
    rx:          parseFloat(c.borderRadius)  || 0,
    borderW:     parseFloat(c.borderTopWidth || c.borderWidth) || 0,
    borderColor: _htmlRgbToHex(c.borderColor),
    opacity:     Math.round(parseFloat(c.opacity) * 100),
    fontSize:    parseFloat(c.fontSize)      || 16,
    fontWeight:  c.fontWeight                || '400',
    lineHeight:  parseFloat(c.lineHeight)    || 0,
    textAlign:   c.textAlign                 || 'left',
    color:       _htmlRgbToHex(c.color)      || '#111111',
    shadow:      c.boxShadow !== 'none' ? c.boxShadow : null,
  };

  // Collect unsupported CSS for the debug panel
  const tag = domEl.tagName?.toLowerCase();
  const checks = [
    ['display:grid',       c.display === 'grid' || c.display === 'inline-grid' ? `${tag}: display:${c.display}` : null],
    ['transform',          c.transform !== 'none' ? `${tag}: ${c.transform.slice(0,40)}` : null],
    ['filter',             c.filter !== 'none' ? `${tag}: ${c.filter.slice(0,40)}` : null],
    ['clip-path',          c.clipPath !== 'none' ? `${tag}: ${c.clipPath.slice(0,40)}` : null],
    ['background-image',   c.backgroundImage !== 'none' ? `${tag}: ${c.backgroundImage.slice(0,50)}` : null],
    ['position:absolute',  (c.position === 'absolute' || c.position === 'fixed') ? `${tag}: position:${c.position}` : null],
    ['text-overflow',      c.textOverflow !== 'clip' ? `${tag}: text-overflow:${c.textOverflow}` : null],
  ];
  for (const [prop, val] of checks) {
    if (val) unsupported.push({ prop, val });
  }
  return s;
}

// ─── Apply styles to Canvus frame element ────────────────────────────────────
function _htmlApplyFrameStyles(el, s) {
  if (s.bg) {
    const f     = mkFill(s.bg);
    f.opacity   = s.bgOpacity;
    el.fills    = [f];
  } else {
    el.fills    = [{ ...mkFill('#ffffff'), opacity: 0 }]; // transparent frame
  }
  el.rx      = Math.round(s.rx);
  el.opacity = s.opacity;
  if (s.borderW > 0 && s.borderColor) {
    el.stroke      = s.borderColor;
    el.strokeWidth = Math.round(s.borderW);
  } else {
    el.stroke      = 'none';
    el.strokeWidth = 0;
  }
  if (s.shadow) {
    const sh = _htmlParseShadow(s.shadow);
    if (sh) el.effects = [{ type: 'drop-shadow', visible: true, color: sh.color, opacity: sh.opacity, x: sh.x, y: sh.y, blur: sh.blur, spread: sh.spread }];
  }
}

// ─── Apply styles to Canvus text element ─────────────────────────────────────
function _htmlApplyTextStyles(el, s) {
  el.fontSize   = Math.round(s.fontSize);
  el.fontWeight = String(s.fontWeight);
  el.lineHeight = s.lineHeight > 0 ? Math.round(s.lineHeight) : Math.round(s.fontSize * 1.4);
  el.textAlign  = s.textAlign === 'start' ? 'left' : s.textAlign === 'end' ? 'right' : (s.textAlign || 'left');
  el.textColor  = s.color || '#111111';
  el.opacity    = s.opacity;
}

// ─── Color helpers ────────────────────────────────────────────────────────────
function _htmlRgbToHex(val) {
  if (!val || val === 'transparent') return null;
  const m = val.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (!m) return null;
  // Fully transparent → treat as no fill
  const a = val.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
  if (a && parseFloat(a[1]) === 0) return null;
  const r = Math.round(parseFloat(m[1]));
  const g = Math.round(parseFloat(m[2]));
  const b = Math.round(parseFloat(m[3]));
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
}

function _htmlRgbaOpacity(val) {
  if (!val) return 100;
  const m = val.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
  return m ? Math.round(parseFloat(m[1]) * 100) : 100;
}

function _htmlParseShadow(val) {
  // Take first shadow only, skip inset
  const first = val.split(/,\s*(?![^()]*\))/)[0].replace(/^\s*inset\s+/, '');
  const colorM = first.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/);
  const numsM  = first.replace(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/g, '').match(/([-\d.]+)px/g);
  if (!numsM || numsM.length < 2) return null;
  const nums  = numsM.map(n => parseFloat(n));
  const color = colorM ? (_htmlRgbToHex(colorM[0]) || '#000000') : '#000000';
  const aM    = (colorM?.[0] || '').match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
  return { x: nums[0]||0, y: nums[1]||0, blur: nums[2]||8, spread: nums[3]||0, color, opacity: aM ? Math.round(parseFloat(aM[1])*100) : 30 };
}

function _htmlMapAlign(alignItems) {
  return { 'flex-start':'start', 'flex-end':'end', 'center':'center', 'stretch':'stretch' }[alignItems] || 'start';
}

// ─── Debug panel ──────────────────────────────────────────────────────────────
function _htmlImportShowDebug(unsupported) {
  let panel = document.getElementById('html-import-debug');
  if (!panel) { panel = document.createElement('div'); panel.id = 'html-import-debug'; document.body.appendChild(panel); }

  const grouped = {};
  for (const { prop, val } of unsupported) {
    (grouped[prop] = grouped[prop] || []).push(val);
  }
  const total = Object.keys(grouped).length;
  panel.innerHTML = `
    <div class="html-debug-hdr">
      <span>Import Debug — ${total} unsupported style${total !== 1 ? 's' : ''}</span>
      <button onclick="this.closest('#html-import-debug').remove()">×</button>
    </div>
    <div class="html-debug-body">
      ${Object.entries(grouped).map(([prop, vals]) => `
        <div class="html-debug-group">
          <div class="html-debug-prop">${prop}</div>
          ${vals.slice(0, 4).map(v => `<div class="html-debug-item">${v.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div>`).join('')}
          ${vals.length > 4 ? `<div class="html-debug-item">…+${vals.length - 4} more</div>` : ''}
        </div>`).join('')}
    </div>`;
}
