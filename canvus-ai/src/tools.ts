/**
 * tools.ts — Canvus AI tool schema definitions
 *
 * Each entry maps one-to-one with an op type in ai/ops.ts.
 * Injected into every Mistral request by worker.ts; the client
 * never needs to send this in the request body.
 *
 * Format: Mistral function-calling shape
 *   { type: "function", function: { name, description, parameters } }
 */

// ─── Shared sub-schemas (inlined to keep tools.ts self-contained) ─────────────
const HEX     = { type: "string", pattern: "^#[0-9a-fA-F]{3,8}$", description: "CSS hex color, e.g. #7c6aee" };
const IDS     = { type: "array", items: { type: "integer", minimum: 1 }, minItems: 1, description: "Element IDs to target" };
const OPACITY = { type: "number", minimum: 0, maximum: 100, description: "Opacity percentage (0–100)" };
const REASON  = { type: "string", maxLength: 200, description: "Why this change is being made (shown to the user)" };
const BLEND   = { type: "string", enum: ["normal","multiply","screen","overlay","soft-light","hard-light","color-dodge","color-burn","luminosity"] };

export interface ToolDef {
  type: "function";
  function: {
    name:        string;
    description: string;
    parameters:  Record<string, unknown>;
  };
}

// ─── Helper: wrap a parameter object in the standard JSON Schema envelope ─────
function params(
  required: string[],
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return { type: "object", required, additionalProperties: false, properties };
}

// ─── Tool definitions ─────────────────────────────────────────────────────────
export const CANVUS_TOOLS: ToolDef[] = [

  // ── Element creation ────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "create_element",
      description: "Create a new element (rect, ellipse, frame, text, line) on the canvas.",
      parameters: params(["elType", "x", "y", "w", "h"], {
        elType:   { type: "string", enum: ["rect","ellipse","frame","text","line","group"], description: "Shape type" },
        x:        { type: "number", description: "Left edge in canvas px. Snap to multiples of 8." },
        y:        { type: "number", description: "Top edge in canvas px. Snap to multiples of 8." },
        w:        { type: "number", minimum: 1, description: "Width in px." },
        h:        { type: "number", minimum: 1, description: "Height in px." },
        name:     { type: "string", maxLength: 128, description: "Semantic layer name." },
        fill:     { ...HEX, description: "Initial fill hex color." },
        stroke:   HEX,
        text:     { type: "string", maxLength: 2000, description: "Text content (text elements only)." },
        fontSize: { type: "number", minimum: 4, maximum: 960 },
        parentId: { type: ["integer","null"], description: "Parent frame ID, if placing inside a frame." },
        reason:   REASON,
      }),
    },
  },

  // ── Deletion ────────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "delete_elements",
      description: "Permanently delete elements. Also removes their children. Only call when the user explicitly asks.",
      parameters: params(["ids"], { ids: IDS, reason: REASON }),
    },
  },

  // ── Generic property setter ──────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "set_property",
      description: "Set any scalar property (opacity, rx, rotation, fontSize, textAlign, etc.) on one or more elements at once.",
      parameters: params(["ids", "key", "value"], {
        ids:    IDS,
        key:    { type: "string", maxLength: 64, description: "Property name, e.g. 'opacity', 'fontSize', 'rotation'" },
        value:  { type: ["string","number","boolean","null"], description: "New value for the property." },
        reason: REASON,
      }),
    },
  },

  // ── Move ─────────────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "move_elements",
      description: "Translate one or more elements by a delta. Prefer 8px increments. Moves children with parent frames automatically.",
      parameters: params(["ids", "dx", "dy"], {
        ids:    IDS,
        dx:     { type: "number", description: "Horizontal delta in px (negative = left)." },
        dy:     { type: "number", description: "Vertical delta in px (negative = up)." },
        reason: REASON,
      }),
    },
  },

  // ── Resize ───────────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "resize_element",
      description: "Set the absolute x/y/w/h of a single element. Omit fields you don't want to change.",
      parameters: params(["id"], {
        id:     { type: "integer", minimum: 1 },
        x:      { type: "number" },
        y:      { type: "number" },
        w:      { type: "number", minimum: 0 },
        h:      { type: "number", minimum: 0 },
        reason: REASON,
      }),
    },
  },

  // ── Rename ───────────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "rename_element",
      description: "Give a layer a semantic name. Replace vague names like 'Rectangle 12' or 'Frame 4'.",
      parameters: params(["id", "name"], {
        id:     { type: "integer", minimum: 1 },
        name:   { type: "string", minLength: 1, maxLength: 128 },
        reason: REASON,
      }),
    },
  },

  // ── Z-order ──────────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "reorder_element",
      description: "Change an element's z-order within its parent.",
      parameters: params(["id", "position"], {
        id:       { type: "integer", minimum: 1 },
        position: { type: "string", enum: ["front","back","forward","backward"] },
        reason:   REASON,
      }),
    },
  },

  // ── Group / ungroup ──────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "group_elements",
      description: "Wrap elements in a group. Bounding box is computed automatically.",
      parameters: params(["ids"], {
        ids:    IDS,
        name:   { type: "string", maxLength: 128 },
        reason: REASON,
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "ungroup_elements",
      description: "Dissolve group(s), re-parenting children to the group's parent.",
      parameters: params(["ids"], { ids: IDS, reason: REASON }),
    },
  },

  // ── Fill ─────────────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "set_fill",
      description: "Update an existing fill layer on elements. fillIndex 0 = top fill.",
      parameters: params(["ids"], {
        ids:       IDS,
        fillIndex: { type: "integer", minimum: 0, default: 0 },
        color:     HEX,
        opacity:   OPACITY,
        visible:   { type: "boolean" },
        blend:     BLEND,
        reason:    REASON,
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "add_fill",
      description: "Append a new solid fill layer on top of existing fills.",
      parameters: params(["ids", "color"], {
        ids:     IDS,
        color:   HEX,
        opacity: OPACITY,
        blend:   BLEND,
        reason:  REASON,
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "remove_fill",
      description: "Remove a fill layer by index.",
      parameters: params(["ids", "fillIndex"], {
        ids:       IDS,
        fillIndex: { type: "integer", minimum: 0 },
        reason:    REASON,
      }),
    },
  },

  // ── Stroke ───────────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "set_stroke",
      description: "Set stroke color, width, position (inside/center/outside), and dash style.",
      parameters: params(["ids"], {
        ids:    IDS,
        color:  HEX,
        width:  { type: "number", minimum: 0, maximum: 200 },
        align:  { type: "string", enum: ["inside","center","outside"] },
        dash:   { type: "boolean", description: "true = dashed stroke" },
        reason: REASON,
      }),
    },
  },

  // ── Effects ──────────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "add_effect",
      description: "Add a visual effect to elements: drop-shadow, inner-shadow, layer-blur, bg-blur, noise, glass, or texture.",
      parameters: params(["ids", "effectType"], {
        ids:        IDS,
        effectType: { type: "string", enum: ["drop-shadow","inner-shadow","layer-blur","bg-blur","noise","glass","texture"] },
        // shadow
        color:      { ...HEX, description: "Shadow color (shadow types only)." },
        opacity:    OPACITY,
        x:          { type: "number", description: "Shadow X offset px." },
        y:          { type: "number", description: "Shadow Y offset px." },
        blur:       { type: "number", minimum: 0, description: "Blur radius px." },
        spread:     { type: "number", description: "Spread px (drop-shadow only)." },
        // blur / glass
        radius:     { type: "number", minimum: 0, description: "Blur radius (blur/glass types)." },
        // noise
        amount:     { ...OPACITY, description: "Noise opacity % (noise type only)." },
        // texture
        preset:     { type: "string", enum: ["noise","grain","paper","linen","concrete","dots","lines","grid"], description: "Texture preset (texture type only)." },
        scale:      { type: "number", minimum: 10, maximum: 300, description: "Texture scale % (texture type only)." },
        blend:      { ...BLEND, description: "Blend mode for texture/noise overlay." },
        reason:     REASON,
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "remove_effect",
      description: "Remove an effect layer by index.",
      parameters: params(["ids", "effectIndex"], {
        ids:         IDS,
        effectIndex: { type: "integer", minimum: 0 },
        reason:      REASON,
      }),
    },
  },

  // ── Auto layout ──────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "set_auto_layout",
      description: "Enable or update auto layout on a frame. Children will be positioned automatically.",
      parameters: params(["id", "direction", "gap", "padding", "align"], {
        id:        { type: "integer", minimum: 1 },
        direction: { type: "string", enum: ["horizontal","vertical"] },
        gap:       { type: "number", minimum: 0, description: "Gap between children in px. Use 8 or 16 as defaults." },
        padding:   { type: "number", minimum: 0, description: "Padding inside frame in px." },
        align:     { type: "string", enum: ["start","center","end"] },
        reason:    REASON,
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "remove_auto_layout",
      description: "Remove auto layout from a frame, leaving children at their current positions.",
      parameters: params(["id"], { id: { type: "integer", minimum: 1 }, reason: REASON }),
    },
  },

  // ── Align & distribute ───────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "align_elements",
      description: "Align a set of elements to a shared edge or center axis. Requires ≥ 2 elements.",
      parameters: params(["ids", "direction"], {
        ids:       IDS,
        direction: { type: "string", enum: ["left","center-h","right","top","center-v","bottom"] },
        reason:    REASON,
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "distribute_elements",
      description: "Space elements with equal gaps along an axis. Requires ≥ 3 elements.",
      parameters: params(["ids", "axis"], {
        ids:    IDS,
        axis:   { type: "string", enum: ["h","v"] },
        reason: REASON,
      }),
    },
  },

  // ── Prototype ────────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "add_prototype_connection",
      description: "Wire a prototype interaction from one frame/element to another.",
      parameters: params(["fromId", "toId"], {
        fromId:    { type: "integer", minimum: 1, description: "Source element ID." },
        toId:      { type: "integer", minimum: 1, description: "Destination frame ID." },
        trigger:   { type: "string", enum: ["click","hover"], default: "click" },
        animation: { type: "string", enum: ["instant","slide-left","slide-right","fade"], default: "instant" },
        reason:    REASON,
      }),
    },
  },

  // ── Batch ────────────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "batch",
      description: "Apply multiple ops as a single atomic undo step. Use when changes belong together (e.g. create + rename + style).",
      parameters: params(["ops"], {
        ops:    { type: "array", items: { type: "object" }, minItems: 1, description: "Ordered list of ops to apply together." },
        reason: REASON,
      }),
    },
  },

];
