/**
 * undo-redo.test.ts — Undo/redo and applyOps integration stubs
 *
 * These tests assume a jsdom environment (Jest default) with the Canvus
 * globals shimmed below. Run: jest tests/undo-redo.test.ts
 */

export {};   // make this file an ES module (prevents top-level declaration conflicts)

// ─── Minimal Canvus shim (replaces the full app.js globals) ──────────────────
const _undoStack: string[] = [];

const S: any = {
  els: [], selIds: [], nextId: 1, page: 1, protoConns: [],
};

function getEl(id: number) { return S.els.find((e: any) => e.id === id) || null; }

function pushUndo() {
  _undoStack.push(JSON.stringify({ els: S.els, protoConns: S.protoConns }));
}

function undo() {
  if (!_undoStack.length) return false;
  const snap = JSON.parse(_undoStack.pop()!);
  Object.assign(S, snap);
  return true;
}

function mkEl(type: string, x: number, y: number, w: number, h: number) {
  return { id: S.nextId++, type, x, y, w, h, name: type + S.nextId, page: S.page, fills: [], effects: [] };
}

function mkFill(color: string) { return { id: S.nextId++, type: 'solid', color, opacity: 100 }; }
function renderAll() {}
function updateProps() {}
function updateLayers() {}

// Inject globals so apply.js can find them
Object.assign(global, { S, getEl, pushUndo, mkEl, mkFill, renderAll, updateProps, updateLayers });

// ─── Import after shimming globals ────────────────────────────────────────────
// import { applyOps } from '../ai/apply.js';  // uncomment once globals are verified

// ─── Helpers ──────────────────────────────────────────────────────────────────
function resetState() {
  S.els = []; S.selIds = []; S.nextId = 1; S.protoConns = [];
  _undoStack.length = 0;
}

function addEl(overrides: object) {
  const el = { id: S.nextId++, type: 'rect', name: 'Rect', x: 0, y: 0, w: 100, h: 100, page: 1, fills: [], effects: [], ...overrides };
  S.els.push(el);
  return el;
}

// ─── Undo stack tests (pure state module) ─────────────────────────────────────
describe('pushUndo / undo', () => {
  beforeEach(resetState);

  it('snapshots and restores state', () => {
    addEl({ id: 10, name: 'Frame A' });
    pushUndo();
    S.els[0].name = 'Frame A (modified)';
    expect(S.els[0].name).toBe('Frame A (modified)');
    undo();
    expect(S.els[0].name).toBe('Frame A');
  });

  it('undo returns false when stack is empty', () => {
    expect(undo()).toBe(false);
  });

  it('supports multiple undo steps', () => {
    addEl({ name: 'v1' });
    pushUndo();
    S.els[0].name = 'v2';
    pushUndo();
    S.els[0].name = 'v3';

    undo(); expect(S.els[0].name).toBe('v2');
    undo(); expect(S.els[0].name).toBe('v1');
  });

  it('does not corrupt state when undoing create_element', () => {
    pushUndo();                   // capture empty state
    S.els.push(mkEl('rect', 0, 0, 100, 100));
    expect(S.els).toHaveLength(1);
    undo();
    expect(S.els).toHaveLength(0);
  });
});

// ─── applyOps integration stubs ───────────────────────────────────────────────
// Uncomment and fill in when apply.js is wired into the test env.

describe.skip('applyOps integration', () => {
  beforeEach(resetState);

  it('TODO: create_element op adds an element to S.els', async () => {
    // const { applied } = applyOps([{ type: 'create_element', elType: 'rect', x: 0, y: 0, w: 100, h: 80 }]);
    // expect(applied).toContain('create_element');
    // expect(S.els).toHaveLength(1);
  });

  it('TODO: delete_elements op removes elements', async () => {
    // addEl({ id: 5 });
    // applyOps([{ type: 'delete_elements', ids: [5] }]);
    // expect(S.els.find(e => e.id === 5)).toBeUndefined();
  });

  it('TODO: move_elements op changes x/y', async () => {
    // const el = addEl({ id: 7, x: 100, y: 200 });
    // applyOps([{ type: 'move_elements', ids: [7], dx: 16, dy: -8 }]);
    // expect(el.x).toBe(116);
    // expect(el.y).toBe(192);
  });

  it('TODO: batch op applies all children atomically', async () => {
    // addEl({ id: 1, name: 'A' });
    // addEl({ id: 2, name: 'B' });
    // applyOps([{ type: 'batch', ops: [
    //   { type: 'rename_element', id: 1, name: 'Alpha' },
    //   { type: 'rename_element', id: 2, name: 'Beta' },
    // ]}]);
    // expect(getEl(1)?.name).toBe('Alpha');
    // expect(getEl(2)?.name).toBe('Beta');
  });

  it('TODO: applyOps with dryRun:true does not mutate state', async () => {
    // addEl({ id: 3, name: 'Original' });
    // applyOps([{ type: 'rename_element', id: 3, name: 'Changed' }], { dryRun: true });
    // expect(getEl(3)?.name).toBe('Original');
  });

  it('TODO: skipped ops are reported separately', async () => {
    // addEl({ id: 1 });
    // const { skipped } = applyOps([
    //   { type: 'rename_element', id: 1, name: 'Good' },
    //   { type: 'rename_element', id: 9999, name: 'Missing' },  // nonexistent id
    // ]);
    // expect(skipped).toHaveLength(0);  // our impl silently skips missing els
  });
});
