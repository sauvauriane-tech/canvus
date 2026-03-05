/**
 * worker.ts — Canvus AI Cloudflare Worker
 *
 * Endpoints:
 *   POST /ai        — in-browser AI panel (sends JS code back to browser)
 *   GET  /state     — read current document from KV
 *   PUT  /state     — save document to KV
 *   POST /generate  — ask Mistral to generate/modify a full document, save to KV
 *
 * Deploy:
 *   wrangler deploy
 *
 * Setup KV:
 *   wrangler kv namespace create CANVUS_STATE
 *   → paste the returned id into wrangler.toml [[kv_namespaces]]
 *
 * Environment variables (Cloudflare dashboard → Worker → Settings → Variables):
 *   MISTRAL_API_KEY  — your Mistral API key
 *   ALLOWED_ORIGIN   — e.g. https://your-canvus-domain.com (or * for dev)
 */

import type { DocumentSnapshot } from '../ai/ops.js';

// ─── Cloudflare Worker env ───────────────────────────────────────────────────
interface Env {
  MISTRAL_API_KEY: string;
  ALLOWED_ORIGIN:  string;
  CANVUS_STATE:    KVNamespace;
}

// ─── Route handler ────────────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN || '*';
    const url    = new URL(request.url);
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin':  origin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // ── GET /state ────────────────────────────────────────────────────────────
    if (url.pathname === '/state' && method === 'GET') {
      const doc = await env.CANVUS_STATE?.get('doc', 'json');
      return json(doc || emptyDoc(), 200, origin);
    }

    // ── PUT /state ────────────────────────────────────────────────────────────
    if (url.pathname === '/state' && method === 'PUT') {
      let body: unknown;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, origin); }
      await env.CANVUS_STATE?.put('doc', JSON.stringify(body));
      return json({ ok: true }, 200, origin);
    }

    // ── POST /generate ────────────────────────────────────────────────────────
    if (url.pathname === '/generate' && method === 'POST') {
      return handleGenerate(request, env, origin);
    }

    // ── POST /ai (in-browser code execution panel) ────────────────────────────
    if (url.pathname === '/ai' && method === 'POST') {
      return handleAIPanel(request, env, origin);
    }

    return json({ error: 'Not found' }, 404, origin);
  },
};

// ─── POST /generate ───────────────────────────────────────────────────────────
async function handleGenerate(request: Request, env: Env, origin: string): Promise<Response> {
  let body: { prompt: string; document?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return json({ error: 'Invalid JSON body' }, 400, origin); }

  const { prompt, document: existingDoc } = body;
  if (!prompt) return json({ error: 'Missing prompt' }, 400, origin);

  // If no doc provided, try to load from KV
  const currentDoc = existingDoc || await env.CANVUS_STATE?.get('doc', 'json') || null;

  const systemPrompt = buildGenerateSystemPrompt();
  const userMessage  = currentDoc
    ? `CURRENT DOCUMENT:\n${JSON.stringify(currentDoc, null, 2)}\n\nRequest: ${prompt}`
    : `Request: ${prompt}`;

  let mistralRes: Response;
  try {
    mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:       'mistral-large-latest',
        messages:    [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage },
        ],
        tools:       [GENERATE_TOOL],
        tool_choice: 'any',
        temperature: 0.3,
        max_tokens:  8192,
      }),
    });
  } catch { return json({ error: 'Failed to reach Mistral API' }, 502, origin); }

  if (!mistralRes.ok) {
    const errText = await mistralRes.text();
    return json({ error: `Mistral error: ${errText}` }, 502, origin);
  }

  const data    = await mistralRes.json() as any;
  const message = data.choices?.[0]?.message;

  if (!message?.tool_calls?.length) {
    return json({ error: 'Mistral did not return a document', summary: message?.content || '' }, 200, origin);
  }

  const toolCall = message.tool_calls.find((tc: any) => tc.function?.name === 'set_document');
  if (!toolCall) return json({ error: 'No set_document call in response' }, 200, origin);

  let args: { document: unknown; summary?: string };
  try { args = JSON.parse(toolCall.function.arguments); }
  catch { return json({ error: 'Failed to parse tool arguments' }, 200, origin); }

  const doc = args.document;

  // Save to KV for browser to pull
  await env.CANVUS_STATE?.put('doc', JSON.stringify(doc));

  return json({ document: doc, summary: args.summary || '' }, 200, origin);
}

// ─── POST /ai (in-browser panel) ─────────────────────────────────────────────
async function handleAIPanel(request: Request, env: Env, origin: string): Promise<Response> {
  let body: { prompt: string; document: DocumentSnapshot; selIds?: number[] };
  try { body = await request.json() as typeof body; }
  catch { return json({ error: 'Invalid JSON body' }, 400, origin); }

  const { prompt, document: doc, selIds = [] } = body;
  if (!prompt || !doc) return json({ error: 'Missing prompt or document' }, 400, origin);

  const docSummary  = buildDocSummary(doc, selIds);
  const userMessage = `${docSummary}\n\nUser request: ${prompt}`;

  let mistralRes: Response;
  try {
    mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.MISTRAL_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:       'mistral-large-latest',
        messages:    [
          { role: 'system', content: buildAIPanelSystemPrompt() },
          { role: 'user',   content: userMessage },
        ],
        tools:       [AI_PANEL_TOOL],
        tool_choice: 'any',
        temperature: 0.2,
        max_tokens:  1024,
      }),
    });
  } catch { return json({ error: 'Failed to reach Mistral API' }, 502, origin); }

  if (!mistralRes.ok) {
    const errText = await mistralRes.text();
    return json({ error: `Mistral error: ${errText}` }, 502, origin);
  }

  const mistralData = await mistralRes.json() as any;
  const message     = mistralData.choices?.[0]?.message;

  if (!message?.tool_calls?.length) {
    return json({ code: '', summary: message?.content || 'No changes suggested.' }, 200, origin);
  }

  const toolCall = message.tool_calls.find((tc: any) => tc.function?.name === 'apply_code');
  if (!toolCall) return json({ error: 'No apply_code call', code: '' }, 200, origin);

  let args: { code: string; summary?: string };
  try { args = JSON.parse(toolCall.function.arguments); }
  catch { return json({ error: 'Failed to parse tool arguments', code: '' }, 200, origin); }

  // Strip accidental markdown code fences
  let code = (args.code || '').trim();
  code = code.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```$/i, '').trim();

  return json({ code, summary: args.summary || '' }, 200, origin);
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const GENERATE_TOOL = {
  type: 'function',
  function: {
    name: 'set_document',
    description: 'Set the complete Canvus document. Call this with the full generated or modified document JSON.',
    parameters: {
      type: 'object',
      required: ['document'],
      properties: {
        document: {
          type: 'object',
          description: 'Complete Canvus document JSON',
        },
        summary: {
          type: 'string',
          description: 'One-sentence plain-English summary of what was created or changed.',
        },
      },
    },
  },
};

const AI_PANEL_TOOL = {
  type: 'function',
  function: {
    name: 'apply_code',
    description: 'Write a JavaScript snippet to execute in the Canvus browser app.',
    parameters: {
      type: 'object',
      required: ['code'],
      properties: {
        code:    { type: 'string', description: 'Valid JavaScript. No markdown or code fences.' },
        summary: { type: 'string', description: 'One-sentence plain-English summary shown to user.' },
      },
    },
  },
};

// ─── System prompts ───────────────────────────────────────────────────────────

function buildGenerateSystemPrompt(): string {
  return `You are Canvus AI. Generate or modify a complete Canvus document based on the user's request.

DOCUMENT SCHEMA (return this exact shape):
{
  "els": [ ...elements ],
  "pages": [{ "id": 1, "name": "Page 1" }],
  "page": 1,
  "nextId": <highest element id + 1>,
  "colorStyles": {},
  "protoConns": [],
  "comments": []
}

ELEMENT SCHEMA:
{
  "id": <unique integer, no gaps>,
  "type": "rect" | "ellipse" | "frame" | "text" | "line",
  "name": "<descriptive layer name>",
  "page": 1,
  "x": number, "y": number, "w": number, "h": number,
  "fills": [{ "id": <unique int>, "type": "solid", "color": "#hex", "opacity": 100, "visible": true, "blend": "normal" }],
  "rx": 0,
  "stroke": null, "strokeWidth": 1,
  "interactions": [], "effects": [],
  "parentId": <parent frame id, omit if top-level>
}

TEXT ELEMENTS — add these extra fields:
  "text": "...", "fontSize": 16, "fontWeight": 400, "textAlign": "left", "textColor": "#000000"

RULES:
1. Every element must have a unique integer id. Start at 1, no gaps.
2. nextId must be greater than all element ids.
3. Use a 1440×900 canvas by default. Align positions to 8px grid.
4. Use hex colors only (e.g. "#2563EB"). No CSS named colors.
5. Name layers semantically: "Hero Background", "CTA Button Label", etc.
6. For sections/cards use a "frame" as a container with children referencing its id in parentId.
   Children positions are relative to the frame's top-left.
7. Always include a page background frame (type:"frame", x:0, y:0, w:1440, h:900).
8. Call set_document with the complete document and a plain-English summary.`;
}

function buildAIPanelSystemPrompt(): string {
  return `You are Canvus AI. The user wants to modify a design in a browser-based canvas tool.
Write a JavaScript snippet to apply their change. It will be executed directly in the browser.

GLOBALS AVAILABLE:
- S.els        — array of all elements on the current page
- S.selIds     — array of currently selected element ids (integers)
- getEl(id)    — returns element by id, or null
- mkFill(color)— creates { id, type:'solid', color:'#hex', opacity:100, visible:true, blend:'normal' }
- renderAll()  — redraws the canvas (ALWAYS call this at the end)
- updateProps()— refreshes the properties panel (ALWAYS call this at the end)

ELEMENT SHAPE:
  { id:int, type:'rect'|'ellipse'|'frame'|'text'|'line'|'group',
    name:string, x, y, w, h,
    fills:[{ color:'#hex', opacity:0-100, visible:bool, blend:'normal' }],
    text?:string }

RULES:
1. Return ONLY valid JavaScript — no markdown, no code fences, no comments, no explanation.
2. Always end with: renderAll(); updateProps();
3. Use hex colors like '#ff0000'. NEVER use named colors like 'red' or 'blue'.
4. Use exact numeric ids from the document. When user refers to "selected" use S.selIds.
5. To change fill: const el = getEl(ID); if (el && el.fills.length) el.fills[0].color = '#hex';
6. Do not delete elements unless explicitly asked.`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyDoc() {
  return {
    els: [], pages: [{ id: 1, name: 'Page 1' }], page: 1,
    nextId: 1, colorStyles: {}, protoConns: [], comments: [],
  };
}

function buildDocSummary(doc: DocumentSnapshot, selIds: number[]): string {
  const sel = selIds.length
    ? `Selected element IDs: [${selIds.join(', ')}]\n`
    : 'No selection.\n';

  const elLines = doc.els.slice(0, 80).map((e: any) =>
    `  id:${e.id} type:${e.type} name:"${e.name}" x:${e.x} y:${e.y} w:${e.w} h:${e.h}${e.parentId ? ` parent:${e.parentId}` : ''}${e.text ? ` text:"${e.text.slice(0,40)}"` : ''}`
  ).join('\n');

  return `PAGE: ${doc.pageName} (id:${doc.page})
${sel}ELEMENTS (${doc.els.length} total${doc.els.length > 80 ? ', showing first 80' : ''}):\n${elLines}`;
}

function json(data: object, status = 200, origin = '*'): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': origin,
    },
  });
}
