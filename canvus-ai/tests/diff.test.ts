/**
 * diff.test.ts — Op diff preview tests
 *
 * Tests the dry-run mode of applyOps, which returns a structured diff
 * without mutating state. The diff is shown to the user before they
 * confirm applying the AI's suggestions.
 */

export {};   // make this file an ES module (prevents top-level declaration conflicts)

// ─── Minimal shim (same pattern as undo-redo.test.ts) ────────────────────────
const S: any = { els: [], selIds: [], nextId: 1, page: 1, protoConns: [] };
function getEl(id: number) { return S.els.find((e: any) => e.id === id) || null; }
function pushUndo() {}
function mkEl(type: string, x: number, y: number, w: number, h: number) {
  return { id: S.nextId++, type, x, y, w, h, name: type, page: 1, fills: [], effects: [] };
}
function mkFill(color: string) { return { color, opacity: 100 }; }
function renderAll() {} function updateProps() {} function updateLayers() {}
Object.assign(global, { S, getEl, pushUndo, mkEl, mkFill, renderAll, updateProps, updateLayers });

function resetState() { S.els = []; S.selIds = []; S.nextId = 1; S.protoConns = []; }
function addEl(overrides: object) {
  const el = { id: S.nextId++, type: 'rect', name: 'Rect', x: 0, y: 0, w: 100, h: 100, page: 1, fills: [], effects: [], ...overrides };
  S.els.push(el); return el;
}

// ─── Diff structure tests ─────────────────────────────────────────────────────
describe('dry-run diff output', () => {
  beforeEach(resetState);

  it('TODO: dry-run returns diff entries for each op', () => {
    // addEl({ id: 1, x: 50, y: 50 });
    // const { diff, applied } = applyOps(
    //   [{ type: 'move_elements', ids: [1], dx: 10, dy: -10 }],
    //   { dryRun: true }
    // );
    // expect(applied).toContain('move_elements');
    // expect(diff[0]).toMatchObject({ op: 'move_elements', from: { x: 50, y: 50 }, to: { x: 60, y: 40 } });
  });

  it('TODO: dry-run diff for rename shows from/to names', () => {
    // addEl({ id: 2, name: 'Old Name' });
    // const { diff } = applyOps([{ type: 'rename_element', id: 2, name: 'New Name' }], { dryRun: true });
    // expect(diff[0]).toMatchObject({ from: 'Old Name', to: 'New Name' });
  });

  it('TODO: dry-run does not add elements', () => {
    // applyOps([{ type: 'create_element', elType: 'rect', x: 0, y: 0, w: 100, h: 80 }], { dryRun: true });
    // expect(S.els).toHaveLength(0);
  });

  it('TODO: dry-run does not delete elements', () => {
    // addEl({ id: 3 });
    // applyOps([{ type: 'delete_elements', ids: [3] }], { dryRun: true });
    // expect(S.els).toHaveLength(1);
  });

  it('TODO: batch op dry-run returns diff for all nested ops', () => {
    // addEl({ id: 4, name: 'A' }); addEl({ id: 5, name: 'B' });
    // const { diff } = applyOps([{ type: 'batch', ops: [
    //   { type: 'rename_element', id: 4, name: 'A2' },
    //   { type: 'rename_element', id: 5, name: 'B2' },
    // ]}], { dryRun: true });
    // expect(diff).toHaveLength(2);
  });
});

// ─── CLI diff formatter tests ─────────────────────────────────────────────────
// These test the formatOp() function from cli/canvus-ai.ts
// Pull it out as a pure function if needed.

describe('formatOp (CLI display)', () => {
  it('TODO: formats create_element op readably', () => {
    // const line = formatOp({ type: 'create_element', elType: 'frame', x: 0, y: 0, w: 375, h: 812 }, { els: [] });
    // expect(line).toMatch(/CREATE frame/);
    // expect(line).toMatch(/375×812/);
  });

  it('TODO: formats move_elements with deltas', () => {
    // const doc = { els: [{ id: 1, name: 'Card' }] };
    // const line = formatOp({ type: 'move_elements', ids: [1], dx: 16, dy: 0 }, doc);
    // expect(line).toMatch(/MOVE.*Card.*\+16.*0/);
  });

  it('TODO: formats batch op with count', () => {
    // const line = formatOp({ type: 'batch', ops: [{}, {}] }, { els: [] });
    // expect(line).toMatch(/BATCH \[2 ops\]/);
  });
});
