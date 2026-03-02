/**
 * schemas.ts — AJV JSON Schema definitions for every Canvus AI op
 *
 * Usage:
 *   import Ajv from 'ajv';
 *   import { opSchema } from './schemas.js';
 *   const validate = new Ajv().compile(opSchema);
 *   if (!validate(payload)) throw new Error(validate.errors);
 */

// ─── Shared sub-schemas ───────────────────────────────────────────────────────
const HEX_COLOR  = { type: 'string', pattern: '^#[0-9a-fA-F]{3,8}$' };
const ID_ARRAY   = { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1 };
const OPACITY    = { type: 'number', minimum: 0, maximum: 100 };
const BLEND      = { type: 'string', enum: ['normal','multiply','screen','overlay','soft-light','hard-light','color-dodge','color-burn','luminosity'] };
const STROKE_AL  = { type: 'string', enum: ['inside','center','outside'] };
const EL_TYPE    = { type: 'string', enum: ['rect','ellipse','frame','text','line','group'] };
const EFF_TYPE   = { type: 'string', enum: ['drop-shadow','inner-shadow','layer-blur','bg-blur','noise','glass','texture'] };
const TEX_PRESET = { type: 'string', enum: ['noise','grain','paper','linen','concrete','dots','lines','grid'] };
const REASON     = { type: 'string', maxLength: 200 };

// ─── Per-op schemas ───────────────────────────────────────────────────────────
const opSchemas: Record<string, object> = {

  create_element: {
    type: 'object',
    required: ['type','elType','x','y','w','h'],
    additionalProperties: false,
    properties: {
      type:     { const: 'create_element' },
      reason:   REASON,
      elType:   EL_TYPE,
      x:        { type: 'number' },
      y:        { type: 'number' },
      w:        { type: 'number', minimum: 1 },
      h:        { type: 'number', minimum: 1 },
      name:     { type: 'string', maxLength: 128 },
      fill:     HEX_COLOR,
      stroke:   HEX_COLOR,
      text:     { type: 'string', maxLength: 2000 },
      fontSize: { type: 'number', minimum: 4, maximum: 960 },
      parentId: { type: ['integer','null'] },
    },
  },

  delete_elements: {
    type: 'object',
    required: ['type','ids'],
    additionalProperties: false,
    properties: { type: { const: 'delete_elements' }, reason: REASON, ids: ID_ARRAY },
  },

  set_property: {
    type: 'object',
    required: ['type','ids','key','value'],
    additionalProperties: false,
    properties: {
      type:   { const: 'set_property' },
      reason: REASON,
      ids:    ID_ARRAY,
      key:    { type: 'string', maxLength: 64 },
      value:  { type: ['string','number','boolean','null'] },
    },
  },

  move_elements: {
    type: 'object',
    required: ['type','ids','dx','dy'],
    additionalProperties: false,
    properties: {
      type:   { const: 'move_elements' },
      reason: REASON,
      ids:    ID_ARRAY,
      dx:     { type: 'number' },
      dy:     { type: 'number' },
    },
  },

  resize_element: {
    type: 'object',
    required: ['type','id'],
    additionalProperties: false,
    properties: {
      type:   { const: 'resize_element' },
      reason: REASON,
      id:     { type: 'integer', minimum: 1 },
      x:      { type: 'number' },
      y:      { type: 'number' },
      w:      { type: 'number', minimum: 0 },
      h:      { type: 'number', minimum: 0 },
    },
  },

  rename_element: {
    type: 'object',
    required: ['type','id','name'],
    additionalProperties: false,
    properties: {
      type:   { const: 'rename_element' },
      reason: REASON,
      id:     { type: 'integer', minimum: 1 },
      name:   { type: 'string', minLength: 1, maxLength: 128 },
    },
  },

  reorder_element: {
    type: 'object',
    required: ['type','id','position'],
    additionalProperties: false,
    properties: {
      type:     { const: 'reorder_element' },
      reason:   REASON,
      id:       { type: 'integer', minimum: 1 },
      position: { type: 'string', enum: ['front','back','forward','backward'] },
    },
  },

  group_elements: {
    type: 'object',
    required: ['type','ids'],
    additionalProperties: false,
    properties: {
      type:   { const: 'group_elements' },
      reason: REASON,
      ids:    ID_ARRAY,
      name:   { type: 'string', maxLength: 128 },
    },
  },

  set_fill: {
    type: 'object',
    required: ['type','ids'],
    additionalProperties: false,
    properties: {
      type:      { const: 'set_fill' },
      reason:    REASON,
      ids:       ID_ARRAY,
      fillIndex: { type: 'integer', minimum: 0 },
      color:     HEX_COLOR,
      opacity:   OPACITY,
      visible:   { type: 'boolean' },
      blend:     BLEND,
    },
  },

  add_fill: {
    type: 'object',
    required: ['type','ids','color'],
    additionalProperties: false,
    properties: {
      type:    { const: 'add_fill' },
      reason:  REASON,
      ids:     ID_ARRAY,
      color:   HEX_COLOR,
      opacity: OPACITY,
      blend:   BLEND,
    },
  },

  remove_fill: {
    type: 'object',
    required: ['type','ids','fillIndex'],
    additionalProperties: false,
    properties: {
      type:      { const: 'remove_fill' },
      reason:    REASON,
      ids:       ID_ARRAY,
      fillIndex: { type: 'integer', minimum: 0 },
    },
  },

  set_stroke: {
    type: 'object',
    required: ['type','ids'],
    additionalProperties: false,
    properties: {
      type:   { const: 'set_stroke' },
      reason: REASON,
      ids:    ID_ARRAY,
      color:  HEX_COLOR,
      width:  { type: 'number', minimum: 0, maximum: 200 },
      align:  STROKE_AL,
      dash:   { type: 'boolean' },
    },
  },

  add_effect: {
    type: 'object',
    required: ['type','ids','effectType'],
    additionalProperties: false,
    properties: {
      type:       { const: 'add_effect' },
      reason:     REASON,
      ids:        ID_ARRAY,
      effectType: EFF_TYPE,
      color:      HEX_COLOR,
      opacity:    OPACITY,
      x:          { type: 'number' },
      y:          { type: 'number' },
      blur:       { type: 'number', minimum: 0 },
      spread:     { type: 'number' },
      radius:     { type: 'number', minimum: 0 },
      amount:     OPACITY,
      preset:     TEX_PRESET,
      scale:      { type: 'number', minimum: 10, maximum: 300 },
      blend:      BLEND,
    },
  },

  remove_effect: {
    type: 'object',
    required: ['type','ids','effectIndex'],
    additionalProperties: false,
    properties: {
      type:        { const: 'remove_effect' },
      reason:      REASON,
      ids:         ID_ARRAY,
      effectIndex: { type: 'integer', minimum: 0 },
    },
  },

  set_auto_layout: {
    type: 'object',
    required: ['type','id','direction','gap','padding','align'],
    additionalProperties: false,
    properties: {
      type:      { const: 'set_auto_layout' },
      reason:    REASON,
      id:        { type: 'integer', minimum: 1 },
      direction: { type: 'string', enum: ['horizontal','vertical'] },
      gap:       { type: 'number', minimum: 0 },
      padding:   { type: 'number', minimum: 0 },
      align:     { type: 'string', enum: ['start','center','end'] },
    },
  },

  align_elements: {
    type: 'object',
    required: ['type','ids','direction'],
    additionalProperties: false,
    properties: {
      type:      { const: 'align_elements' },
      reason:    REASON,
      ids:       ID_ARRAY,
      direction: { type: 'string', enum: ['left','center-h','right','top','center-v','bottom'] },
    },
  },

  distribute_elements: {
    type: 'object',
    required: ['type','ids','axis'],
    additionalProperties: false,
    properties: {
      type:   { const: 'distribute_elements' },
      reason: REASON,
      ids:    ID_ARRAY,
      axis:   { type: 'string', enum: ['h','v'] },
    },
  },

  add_prototype_connection: {
    type: 'object',
    required: ['type','fromId','toId'],
    additionalProperties: false,
    properties: {
      type:      { const: 'add_prototype_connection' },
      reason:    REASON,
      fromId:    { type: 'integer', minimum: 1 },
      toId:      { type: 'integer', minimum: 1 },
      trigger:   { type: 'string', enum: ['click','hover'] },
      animation: { type: 'string', enum: ['instant','slide-left','slide-right','fade'] },
    },
  },

  batch: {
    type: 'object',
    required: ['type','ops'],
    additionalProperties: false,
    properties: {
      type:   { const: 'batch' },
      reason: REASON,
      ops:    { type: 'array', items: { type: 'object' }, minItems: 1 },
    },
  },
};

// ─── Top-level schema: an array of ops ───────────────────────────────────────
export const opsArraySchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'array',
  items: {
    type: 'object',
    required: ['type'],
    discriminator: { propertyName: 'type' },
    oneOf: Object.values(opSchemas),
  },
};

// Named export for individual op schema lookup
export { opSchemas };
