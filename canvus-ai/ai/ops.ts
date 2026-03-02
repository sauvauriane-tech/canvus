/**
 * ops.ts — Canvus AI Op Type Definitions
 *
 * Every mutation the AI can perform is expressed as a typed Op object.
 * Ops are:
 *   1. Returned by the Mistral tool-call response
 *   2. Validated by AJV against ops-schemas.json
 *   3. Applied to state by apply.js (in-browser)
 *   4. Reversible via pushUndo() before application
 */

// ─── Shared ──────────────────────────────────────────────────────────────────
export type ElType      = 'rect' | 'ellipse' | 'frame' | 'text' | 'line' | 'group';
export type BlendMode   = 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'hard-light' | 'color-dodge' | 'color-burn' | 'luminosity';
export type StrokeAlign = 'inside' | 'center' | 'outside';
export type AlignDir    = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom';
export type EffectType  = 'drop-shadow' | 'inner-shadow' | 'layer-blur' | 'bg-blur' | 'noise' | 'glass' | 'texture';
export type TexturePreset = 'noise' | 'grain' | 'paper' | 'linen' | 'concrete' | 'dots' | 'lines' | 'grid';

interface OpBase {
  type:    string;
  reason?: string;  // human-readable justification from the AI
}

// ─── Element creation ────────────────────────────────────────────────────────
export interface CreateElementOp extends OpBase {
  type:      'create_element';
  elType:    ElType;
  x:         number;
  y:         number;
  w:         number;
  h:         number;
  name?:     string;
  fill?:     string;        // hex
  stroke?:   string;
  text?:     string;
  fontSize?: number;
  parentId?: number;
}

// ─── Deletion ────────────────────────────────────────────────────────────────
export interface DeleteElementsOp extends OpBase {
  type: 'delete_elements';
  ids:  number[];
}

// ─── Generic property setter ─────────────────────────────────────────────────
/** Set any scalar property on one or more elements at once. */
export interface SetPropertyOp extends OpBase {
  type:  'set_property';
  ids:   number[];
  key:   string;    // must be a valid CanvusElement key
  value: string | number | boolean | null;
}

// ─── Geometry ────────────────────────────────────────────────────────────────
export interface MoveElementsOp extends OpBase {
  type: 'move_elements';
  ids:  number[];
  dx:   number;     // delta in canvas px
  dy:   number;
}

export interface ResizeElementOp extends OpBase {
  type: 'resize_element';
  id:   number;
  x?:   number;
  y?:   number;
  w?:   number;
  h?:   number;
}

// ─── Naming / organisation ───────────────────────────────────────────────────
export interface RenameElementOp extends OpBase {
  type: 'rename_element';
  id:   number;
  name: string;
}

export interface ReorderElementOp extends OpBase {
  type:     'reorder_element';
  id:       number;
  position: 'front' | 'back' | 'forward' | 'backward';
}

export interface GroupElementsOp extends OpBase {
  type:  'group_elements';
  ids:   number[];
  name?: string;
}

export interface UngroupElementsOp extends OpBase {
  type: 'ungroup_elements';
  ids:  number[];   // group element ids
}

// ─── Fill ────────────────────────────────────────────────────────────────────
export interface SetFillOp extends OpBase {
  type:       'set_fill';
  ids:        number[];
  fillIndex?: number;     // 0 = first fill; defaults to 0
  color?:     string;     // hex
  opacity?:   number;     // 0–100
  visible?:   boolean;
  blend?:     BlendMode;
}

export interface AddFillOp extends OpBase {
  type:     'add_fill';
  ids:      number[];
  color:    string;
  opacity?: number;
  blend?:   BlendMode;
}

export interface RemoveFillOp extends OpBase {
  type:      'remove_fill';
  ids:       number[];
  fillIndex: number;
}

// ─── Stroke ──────────────────────────────────────────────────────────────────
export interface SetStrokeOp extends OpBase {
  type:    'set_stroke';
  ids:     number[];
  color?:  string;
  width?:  number;
  align?:  StrokeAlign;
  dash?:   boolean;
}

// ─── Effects ─────────────────────────────────────────────────────────────────
export interface AddEffectOp extends OpBase {
  type:       'add_effect';
  ids:        number[];
  effectType: EffectType;
  // Shadow params
  color?:     string;
  opacity?:   number;
  x?:         number;
  y?:         number;
  blur?:      number;
  spread?:    number;
  // Blur / glass params
  radius?:    number;
  // Noise params
  amount?:    number;
  // Texture params
  preset?:    TexturePreset;
  scale?:     number;
  blend?:     BlendMode;
}

export interface RemoveEffectOp extends OpBase {
  type:        'remove_effect';
  ids:         number[];
  effectIndex: number;
}

// ─── Auto layout ─────────────────────────────────────────────────────────────
export interface SetAutoLayoutOp extends OpBase {
  type:       'set_auto_layout';
  id:         number;
  direction:  'horizontal' | 'vertical';
  gap:        number;
  padding:    number;
  align:      'start' | 'center' | 'end';
}

export interface RemoveAutoLayoutOp extends OpBase {
  type: 'remove_auto_layout';
  id:   number;
}

// ─── Align / distribute ──────────────────────────────────────────────────────
export interface AlignElementsOp extends OpBase {
  type:      'align_elements';
  ids:       number[];
  direction: AlignDir;
}

export interface DistributeElementsOp extends OpBase {
  type: 'distribute_elements';
  ids:  number[];
  axis: 'h' | 'v';
}

// ─── Prototype ───────────────────────────────────────────────────────────────
export interface AddPrototypeConnectionOp extends OpBase {
  type:       'add_prototype_connection';
  fromId:     number;
  toId:       number;
  trigger?:   'click' | 'hover';
  animation?: 'instant' | 'slide-left' | 'slide-right' | 'fade';
}

// ─── Batch ───────────────────────────────────────────────────────────────────
/** Container for multiple ops applied atomically (single undo step). */
export interface BatchOp extends OpBase {
  type: 'batch';
  ops:  AnyOp[];
}

// ─── Union ───────────────────────────────────────────────────────────────────
export type AnyOp =
  | CreateElementOp
  | DeleteElementsOp
  | SetPropertyOp
  | MoveElementsOp
  | ResizeElementOp
  | RenameElementOp
  | ReorderElementOp
  | GroupElementsOp
  | UngroupElementsOp
  | SetFillOp
  | AddFillOp
  | RemoveFillOp
  | SetStrokeOp
  | AddEffectOp
  | RemoveEffectOp
  | SetAutoLayoutOp
  | RemoveAutoLayoutOp
  | AlignElementsOp
  | DistributeElementsOp
  | AddPrototypeConnectionOp
  | BatchOp;

// ─── Document snapshot sent to the AI ────────────────────────────────────────
export interface CanvusElementSnapshot {
  id:        number;
  type:      ElType;
  name:      string;
  x:         number;
  y:         number;
  w:         number;
  h:         number;
  fill?:     string;
  stroke?:   string;
  opacity?:  number;
  text?:     string;
  fontSize?: number;
  parentId?: number | null;
  children?: CanvusElementSnapshot[];  // nested for readability
}

export interface DocumentSnapshot {
  page:    number;
  pageName:string;
  els:     CanvusElementSnapshot[];  // flat, current page only
}

// ─── AI response envelope ────────────────────────────────────────────────────
export interface AIResponse {
  ops:      AnyOp[];
  summary?: string;   // one-sentence description of what will change
}
