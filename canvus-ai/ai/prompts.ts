/**
 * prompts.ts — Canvus AI Canned Prompt Library
 *
 * These prompts are shown in the AI panel as quick-action chips.
 * Each entry maps to a user-visible label, a tooltip, the actual prompt
 * sent to the AI, and optional context requirements.
 *
 * Usage:
 *   import { PROMPT_GROUPS } from './prompts.js';
 *   // Render as clickable chips in the AI side-panel.
 */

export interface CannedPrompt {
  id:           string;
  label:        string;        // chip text
  tooltip:      string;        // shown on hover
  prompt:       string;        // sent to backend
  requiresSel?: boolean;       // only show when elements are selected
  requiresFrame?: boolean;     // only show when a frame is selected
  tags:         string[];      // for search/filter
}

export interface PromptGroup {
  title:   string;
  prompts: CannedPrompt[];
}

// ─── Layout & spacing ─────────────────────────────────────────────────────────
const LAYOUT: CannedPrompt[] = [
  {
    id:          'align-left',
    label:       'Align left',
    tooltip:     'Align all selected elements to the leftmost edge.',
    prompt:      'Align all selected elements to the left edge of the leftmost element.',
    requiresSel: true,
    tags:        ['align', 'layout', 'spacing'],
  },
  {
    id:          'align-center-h',
    label:       'Center horizontally',
    tooltip:     'Center selected elements on the horizontal axis.',
    prompt:      'Align all selected elements to the horizontal center.',
    requiresSel: true,
    tags:        ['align', 'center', 'layout'],
  },
  {
    id:          'align-center-v',
    label:       'Center vertically',
    tooltip:     'Center selected elements on the vertical axis.',
    prompt:      'Align all selected elements to the vertical center.',
    requiresSel: true,
    tags:        ['align', 'center', 'layout'],
  },
  {
    id:          'distribute-h',
    label:       'Distribute evenly',
    tooltip:     'Space selected elements with equal horizontal gaps.',
    prompt:      'Distribute all selected elements with equal horizontal spacing.',
    requiresSel: true,
    tags:        ['distribute', 'spacing', 'layout'],
  },
  {
    id:          'snap-to-grid',
    label:       'Snap to 8px grid',
    tooltip:     'Move selected elements so x/y/w/h are all multiples of 8.',
    prompt:      'Move and resize each selected element so that its x, y, w, and h are all multiples of 8. Use set_property ops.',
    requiresSel: true,
    tags:        ['grid', 'snap', 'tidy'],
  },
  {
    id:          'even-gaps',
    label:       'Clean up spacing',
    tooltip:     'Set equal 16px gaps between all selected elements.',
    prompt:      'Distribute selected elements with 16px gaps between them, keeping them aligned.',
    requiresSel: true,
    tags:        ['spacing', 'gap', 'tidy'],
  },
  {
    id:          'auto-layout',
    label:       'Apply auto layout',
    tooltip:     'Wrap selected frame with horizontal auto layout.',
    prompt:      'Apply horizontal auto layout with 16px gap and 16px padding to the selected frame.',
    requiresFrame: true,
    tags:        ['auto-layout', 'layout'],
  },
];

// ─── Naming & organisation ────────────────────────────────────────────────────
const NAMING: CannedPrompt[] = [
  {
    id:          'rename-semantic',
    label:       'Rename layers',
    tooltip:     'Give each layer a descriptive name based on its content and role.',
    prompt:      'Look at the name, type, and content of each element on this page and rename layers to be semantic (e.g. "Hero Frame", "Primary CTA Button", "Nav Logo"). Rename vague names like "Rectangle 12" or "Frame 4" first.',
    tags:        ['rename', 'naming', 'organisation'],
  },
  {
    id:          'rename-selected',
    label:       'Rename selected',
    tooltip:     'Give selected layers better names based on context.',
    prompt:      'Rename the selected elements based on their visual role and content.',
    requiresSel: true,
    tags:        ['rename', 'naming'],
  },
  {
    id:          'group-selection',
    label:       'Group & name',
    tooltip:     'Group selected elements and name the group semantically.',
    prompt:      'Group the selected elements into a logically-named group. Infer the name from their types and positions.',
    requiresSel: true,
    tags:        ['group', 'organisation'],
  },
];

// ─── Visual styling ───────────────────────────────────────────────────────────
const STYLE: CannedPrompt[] = [
  {
    id:          'add-shadow',
    label:       'Add drop shadow',
    tooltip:     'Add a subtle drop shadow to selected elements.',
    prompt:      'Add a soft drop shadow to selected elements: color #000000, opacity 20%, x:0, y:4, blur:16.',
    requiresSel: true,
    tags:        ['shadow', 'effect', 'style'],
  },
  {
    id:          'add-grain',
    label:       'Add grain texture',
    tooltip:     'Apply a subtle noise/grain overlay.',
    prompt:      'Add a grain texture effect to the selected elements: preset:grain, scale:80, opacity:15, blend:overlay.',
    requiresSel: true,
    tags:        ['texture', 'grain', 'effect'],
  },
  {
    id:          'brand-colors',
    label:       'Apply brand purple',
    tooltip:     'Set fill to the Canvus accent purple #7c6aee.',
    prompt:      'Set the fill of all selected elements to the Canvus brand purple #7c6aee.',
    requiresSel: true,
    tags:        ['color', 'brand', 'fill'],
  },
  {
    id:          'glass-morph',
    label:       'Glassmorphism',
    tooltip:     'Apply a frosted glass look: white fill, bg-blur, glass effect.',
    prompt:      'Apply a glassmorphism style to selected elements: semi-transparent white fill (opacity 10%), background blur effect (radius 16), and a glass effect.',
    requiresSel: true,
    tags:        ['glass', 'style', 'effect'],
  },
  {
    id:          'make-dark',
    label:       'Dark variant',
    tooltip:     'Invert fills to a dark theme palette.',
    prompt:      'Convert the selected elements to a dark theme: change light fills to dark (#1a1a2e or #16213e), update text colors to light (#f0f0f0), and keep accent colors.',
    requiresSel: true,
    tags:        ['dark', 'theme', 'color'],
  },
];

// ─── Prototype & flows ────────────────────────────────────────────────────────
const PROTO: CannedPrompt[] = [
  {
    id:          'wire-screens',
    label:       'Wire prototype',
    tooltip:     'Connect frames in sequence as a linear flow.',
    prompt:      'Create prototype connections between all top-level frames in order from left to right (or top to bottom), using click trigger and slide-left animation.',
    tags:        ['prototype', 'flow', 'connect'],
  },
  {
    id:          'button-to-next',
    label:       'Button → next screen',
    tooltip:     'Connect the selected button to the next frame.',
    prompt:      'Connect the selected element as a prototype trigger to the next frame in the page (rightmost or below). Use click trigger.',
    requiresSel: true,
    tags:        ['prototype', 'button', 'connect'],
  },
];

// ─── Accessibility ────────────────────────────────────────────────────────────
const A11Y: CannedPrompt[] = [
  {
    id:          'fix-tap-targets',
    label:       'Fix tap targets',
    tooltip:     'Resize interactive elements to at least 44×44px.',
    prompt:      'Find all elements that look like buttons or interactive targets (by name or small size) and ensure they are at least 44px × 44px. Use resize_element ops.',
    tags:        ['a11y', 'tap-target', 'accessibility'],
  },
  {
    id:          'min-font-size',
    label:       'Fix small text',
    tooltip:     'Set minimum font size to 14px on all text elements.',
    prompt:      'Find all text elements with fontSize below 14 and set them to 14. Preserve their weight and color.',
    tags:        ['a11y', 'font', 'text', 'accessibility'],
  },
  {
    id:          'label-elements',
    label:       'Add aria labels',
    tooltip:     'Rename unlabelled UI elements to accessible names.',
    prompt:      'Rename any element whose name is generic (e.g. "Rectangle", "Ellipse", "Frame N") to a name that describes its UI role (e.g. "Profile Avatar", "Close Button").',
    tags:        ['a11y', 'rename', 'accessibility'],
  },
];

// ─── Exports ─────────────────────────────────────────────────────────────────
export const PROMPT_GROUPS: PromptGroup[] = [
  { title: 'Layout',          prompts: LAYOUT  },
  { title: 'Naming',          prompts: NAMING  },
  { title: 'Style',           prompts: STYLE   },
  { title: 'Prototype',       prompts: PROTO   },
  { title: 'Accessibility',   prompts: A11Y    },
];

export const ALL_PROMPTS: CannedPrompt[] = PROMPT_GROUPS.flatMap(g => g.prompts);

/** Find prompts applicable to the current context */
export function getContextualPrompts(selIds: number[], selTypes: string[]): CannedPrompt[] {
  const hasFrame = selTypes.includes('frame');
  return ALL_PROMPTS.filter(p => {
    if (p.requiresSel   && !selIds.length)  return false;
    if (p.requiresFrame && !hasFrame)       return false;
    return true;
  });
}
