/**
 * worker.ts — Canvus AI Cloudflare Worker
 *
 * Sends the user's prompt + document context to Mistral and asks it
 * to write a JavaScript snippet that the browser will execute directly.
 *
 * Deploy:
 *   wrangler deploy
 *
 * Environment variables (set in wrangler.toml or Cloudflare dashboard):
 *   MISTRAL_API_KEY  — your Mistral API key
 *   ALLOWED_ORIGIN   — e.g. https://your-canvus-domain.com (or * for dev)
 */

import type { DocumentSnapshot } from '../ai/ops.js';

// ─── Cloudflare Worker env ───────────────────────────────────────────────────
interface Env {
  MISTRAL_API_KEY: string;
  ALLOWED_ORIGIN:  string;
}

// ─── Tool definition ──────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'apply_code',
      description: 'Write a JavaScript snippet that will be executed in the Canvus browser app to apply the design change.',
      parameters: {
        type: 'object',
        required: ['code'],
        properties: {
          code: {
            type: 'string',
            description: 'Valid JavaScript to execute in the browser. No markdown, no code fences.',
          },
          summary: {
            type: 'string',
            description: 'One-sentence plain-English summary of what changed, shown to the user.',
          },
        },
      },
    },
  },
];

// ─── System prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt(): string {
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
4. Use exact numeric ids from the document. When the user refers to "selected" use S.selIds.
5. To change a fill color: const el = getEl(ID); if (el && el.fills.length) el.fills[0].color = '#hex';
6. Do not delete elements unless the user explicitly asks.`;
}

// ─── Request → Mistral → Response ─────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN || '*';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin':  origin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    // Parse body
    let body: { prompt: string; document: DocumentSnapshot; selIds?: number[] };
    try {
      body = await request.json() as typeof body;
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const { prompt, document: doc, selIds = [] } = body;
    if (!prompt || !doc) return json({ error: 'Missing prompt or document' }, 400);

    const docSummary = buildDocSummary(doc, selIds);
    const userMessage = `${docSummary}\n\nUser request: ${prompt}`;

    // Call Mistral
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
            { role: 'system', content: buildSystemPrompt() },
            { role: 'user',   content: userMessage },
          ],
          tools:       TOOLS,
          tool_choice: 'any',
          temperature: 0.2,
          max_tokens:  1024,
        }),
      });
    } catch (err) {
      return json({ error: 'Failed to reach Mistral API' }, 502);
    }

    if (!mistralRes.ok) {
      const errText = await mistralRes.text();
      return json({ error: `Mistral error: ${errText}` }, 502);
    }

    const mistralData = await mistralRes.json() as any;
    const message = mistralData.choices?.[0]?.message;

    if (!message?.tool_calls?.length) {
      return json({
        code:    '',
        summary: message?.content || 'No changes suggested.',
      }, 200, origin);
    }

    const toolCall = message.tool_calls.find((tc: any) => tc.function?.name === 'apply_code');
    if (!toolCall) return json({ error: 'No apply_code call in response', code: '' }, 200, origin);

    let args: { code: string; summary?: string };
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      return json({ error: 'Failed to parse tool arguments', code: '' }, 200, origin);
    }

    // Strip any accidental markdown code fences Mistral might add
    let code = (args.code || '').trim();
    code = code.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```$/i, '').trim();

    return json({ code, summary: args.summary || '' }, 200, origin);
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildDocSummary(doc: DocumentSnapshot, selIds: number[]): string {
  const sel = selIds.length
    ? `Selected element IDs: [${selIds.join(', ')}]\n`
    : 'No selection.\n';

  const elLines = doc.els.slice(0, 80).map(e =>
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
