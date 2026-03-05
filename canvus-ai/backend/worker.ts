/**
 * worker.ts — Canvus AI Cloudflare Worker
 *
 * Sends the user's prompt + document context to Mistral and returns
 * a plain-text confirmation of what was understood / will be done.
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

// ─── System prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt(): string {
  return `You are Canvus AI, a design assistant embedded in a Figma-like design tool.
The user will describe a design change they want to make.
Reply with a single short sentence confirming what you understood and what you would do.
Example: "Got it — I'll change the rectangle fill to red."
Be concise. Do not ask questions. Do not explain. Just confirm the action.`;
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
          temperature: 0.2,
          max_tokens:  128,
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
    const reply = mistralData.choices?.[0]?.message?.content || 'Done.';

    return json({ ops: [], summary: reply }, 200, origin);
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildDocSummary(doc: DocumentSnapshot, selIds: number[]): string {
  const sel = selIds.length
    ? `Selected element IDs: [${selIds.join(', ')}]\n`
    : 'No selection.\n';

  const elLines = doc.els.slice(0, 80).map(e =>
    `  id:${e.id} type:${e.type} name:"${e.name}"${e.text ? ` text:"${e.text.slice(0,40)}"` : ''}`
  ).join('\n');

  return `PAGE: ${doc.pageName}\n${sel}ELEMENTS:\n${elLines}`;
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
