/**
 * validation.test.ts — AJV op validation tests
 *
 * Run: jest tests/validation.test.ts
 */

import { validateOps } from '../ai/validate.js';

describe('validateOps', () => {

  // ── Happy paths ──────────────────────────────────────────────────────────
  it('accepts a valid create_element op', () => {
    const { valid, ops, errors } = validateOps([{
      type: 'create_element', elType: 'rect', x: 0, y: 0, w: 100, h: 80,
      name: 'Button', fill: '#7c6aee', reason: 'Creating a button',
    }]);
    expect(valid).toBe(true);
    expect(ops).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid set_property op', () => {
    const { valid } = validateOps([{
      type: 'set_property', ids: [1, 2], key: 'opacity', value: 50,
    }]);
    expect(valid).toBe(true);
  });

  it('accepts a valid batch op', () => {
    const { valid, ops } = validateOps([{
      type: 'batch',
      ops: [
        { type: 'rename_element', id: 5, name: 'Header Frame' },
        { type: 'set_fill', ids: [5], color: '#ffffff' },
      ],
    }]);
    expect(valid).toBe(true);
    expect(ops[0].type).toBe('batch');
  });

  it('accepts a texture effect op', () => {
    const { valid } = validateOps([{
      type: 'add_effect', ids: [3],
      effectType: 'texture', preset: 'grain', scale: 75, opacity: 20, blend: 'overlay',
    }]);
    expect(valid).toBe(true);
  });

  it('accepts all known op types without errors', () => {
    const allOps = [
      { type: 'create_element',            elType: 'frame', x: 0, y: 0, w: 375, h: 812 },
      { type: 'delete_elements',           ids: [99] },
      { type: 'set_property',              ids: [1], key: 'opacity', value: 80 },
      { type: 'move_elements',             ids: [1], dx: 16, dy: 0 },
      { type: 'resize_element',            id: 1, w: 200, h: 48 },
      { type: 'rename_element',            id: 1, name: 'Primary Button' },
      { type: 'reorder_element',           id: 1, position: 'front' },
      { type: 'group_elements',            ids: [1, 2], name: 'Button Group' },
      { type: 'set_fill',                  ids: [1], fillIndex: 0, color: '#7c6aee', opacity: 100 },
      { type: 'add_fill',                  ids: [1], color: '#000000', opacity: 10 },
      { type: 'remove_fill',               ids: [1], fillIndex: 1 },
      { type: 'set_stroke',                ids: [1], color: '#7c6aee', width: 2, align: 'inside' },
      { type: 'add_effect',                ids: [1], effectType: 'drop-shadow', color: '#000000', opacity: 25, x: 0, y: 4, blur: 12 },
      { type: 'remove_effect',             ids: [1], effectIndex: 0 },
      { type: 'set_auto_layout',           id: 1, direction: 'horizontal', gap: 16, padding: 16, align: 'center' },
      { type: 'remove_auto_layout',        id: 1 },
      { type: 'align_elements',            ids: [1, 2], direction: 'left' },
      { type: 'distribute_elements',       ids: [1, 2, 3], axis: 'h' },
      { type: 'add_prototype_connection',  fromId: 1, toId: 2, trigger: 'click', animation: 'slide-left' },
    ];
    const { errors } = validateOps(allOps);
    expect(errors).toHaveLength(0);
  });

  // ── Rejection cases ───────────────────────────────────────────────────────
  it('rejects a non-array input', () => {
    const { valid, errors } = validateOps({ type: 'set_property' } as any);
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/array/);
  });

  it('rejects an op with unknown type', () => {
    const { valid, errors, ops } = validateOps([{ type: 'teleport_element', id: 1 }]);
    expect(ops).toHaveLength(0);
    expect(errors[0]).toMatch(/unknown op type/);
  });

  it('rejects create_element missing required fields', () => {
    const { valid, errors } = validateOps([{ type: 'create_element', elType: 'rect' }]);
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/create_element/);
  });

  it('rejects set_property with empty ids array', () => {
    const { valid } = validateOps([{ type: 'set_property', ids: [], key: 'opacity', value: 50 }]);
    expect(valid).toBe(false);
  });

  it('rejects invalid hex color', () => {
    const { valid } = validateOps([{ type: 'add_fill', ids: [1], color: 'blue' }]);
    expect(valid).toBe(false);
  });

  it('rejects opacity > 100', () => {
    const { valid } = validateOps([{ type: 'set_fill', ids: [1], opacity: 150 }]);
    expect(valid).toBe(false);
  });

  it('rejects invalid stroke align', () => {
    const { valid } = validateOps([{ type: 'set_stroke', ids: [1], align: 'diagonal' as any }]);
    expect(valid).toBe(false);
  });

  it('rejects invalid texture preset', () => {
    const { valid } = validateOps([{ type: 'add_effect', ids: [1], effectType: 'texture', preset: 'rubber' as any }]);
    expect(valid).toBe(false);
  });

  // ── Partial validation (drop invalid, keep valid) ─────────────────────────
  it('drops invalid ops and returns only valid ones', () => {
    const { valid, ops, errors } = validateOps([
      { type: 'rename_element', id: 1, name: 'Good Name' },
      { type: 'unknown_type' },
      { type: 'create_element' }, // missing required fields
      { type: 'move_elements', ids: [2], dx: 10, dy: 0 },
    ]);
    expect(valid).toBe(false);
    expect(ops).toHaveLength(2);
    expect(errors).toHaveLength(2);
  });
});
