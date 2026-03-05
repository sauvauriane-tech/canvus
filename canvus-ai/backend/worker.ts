/**
 * worker.ts — Canvus AI Cloudflare Worker
 *
 * Proxies prompts to Mistral, validates the returned ops, and sends
 * them back to the Canvus client.
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

// ─── Mistral tool definitions ─────────────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'apply_ops',
      description: 'Apply a sequence of design operations to the Canvus document. Return ALL changes as a single call.',
      parameters: {
        type: 'object',
        required: ['ops'],
        properties: {
          ops: {
            type: 'array',
            description: 'Ordered list of ops to apply. Use a batch op if you need atomic grouping.',
            items: { type: 'object' },
          },
          summary: {
            type: 'string',
            description: 'One-sentence plain-English summary of what will change, shown to the user before applying.',
          },
        },
      },
    },
  },
];

// ─── System prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt(): string {
  return `You are Canvus AI, an expert design assistant embedded in a Figma-like design tool called Canvus.

Your job is to interpret the user's design intent and express it as a list of typed ops that Canvus understands.

DOCUMENT MODEL
- Elements have: id (integer), type (rect/ellipse/frame/text/line/group), name, x, y, w, h
- Positions are in canvas pixels (8pt grid). Snap to 8px increments when possible.
- Fills: array of { type:'solid'|'linear'|'radial', color:'#hex', opacity:0-100, blend }
- Effects: drop-shadow, inner-shadow, layer-blur, bg-blur, noise, glass, texture

RULES
1. ALWAYS call apply_ops — never reply with plain text only.
2. Include a 'reason' field on each op explaining why.
3. Use batch op when changes must be undone atomically.
4. Prefer rename_element ops to make layer names semantic.
5. Don't delete elements unless the user explicitly asks.
6. Use 8px or 16px gaps for spacing unless the user specifies otherwise.
7. Colors: use hex. If the user says "brand purple" use #7c6aee (Canvus accent).
8. If asked to "clean up" layout, prefer align_elements + distribute_elements over moving individually.
9. Prototype connections use click trigger by default.
10. Keep changes minimal — don't modify unrelated elements.`;
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

    // Build user message with document context
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
          max_tokens:  4096,
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
      // Model replied with text instead of a tool call — return it as a message
      return json({
        ops:     [],
        summary: message?.content || 'No changes suggested.',
        rawText: message?.content,
      }, 200, origin);
    }

    // Extract ops from the apply_ops tool call
    const toolCall = message.tool_calls.find((tc: any) => tc.function?.name === 'apply_ops');
    if (!toolCall) return json({ error: 'No apply_ops call in response', ops: [] }, 200, origin);

    let args: { ops: unknown[]; summary?: string };
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      return json({ error: 'Failed to parse tool arguments', ops: [] }, 200, origin);
    }

    return json({
      ops:     args.ops || [],
      summary: args.summary || '',
    }, 200, origin);
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
