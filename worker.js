/**
 * Canvus app Worker
 *
 * Handles POST /ai (calls Mistral, returns ops) and falls through
 * to static assets for everything else.
 *
 * Requires the MISTRAL_API_KEY secret:
 *   wrangler secret put MISTRAL_API_KEY
 */

// ─── Tool definition sent to Mistral ─────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'apply_ops',
      description:
        'Apply a sequence of design operations to the Canvus document. Return ALL changes as a single call.',
      parameters: {
        type: 'object',
        required: ['ops'],
        properties: {
          ops: {
            type: 'array',
            description: 'Ordered list of ops to apply.',
            items: { type: 'object' },
          },
          summary: {
            type: 'string',
            description:
              'One-sentence plain-English summary of what will change, shown to the user.',
          },
        },
      },
    },
  },
];

const KNOWN_OP_TYPES = new Set([
  'create_element', 'delete_elements', 'set_property', 'move_elements',
  'resize_element', 'rename_element', 'reorder_element', 'group_elements',
  'ungroup_elements', 'set_fill', 'add_fill', 'remove_fill', 'set_stroke',
  'add_effect', 'remove_effect', 'set_auto_layout', 'remove_auto_layout',
  'align_elements', 'distribute_elements', 'add_prototype_connection', 'batch',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildSystemPrompt() {
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

function buildDocSummary(doc, selIds) {
  const sel = selIds.length
    ? `Selected element IDs: [${selIds.join(', ')}]\n`
    : 'No selection.\n';
  const elLines = doc.els.slice(0, 80).map(e =>
    `  id:${e.id} type:${e.type} name:"${e.name}" x:${e.x} y:${e.y} w:${e.w} h:${e.h}` +
    (e.parentId ? ` parent:${e.parentId}` : '') +
    (e.text ? ` text:"${e.text.slice(0, 40)}"` : '')
  ).join('\n');
  return (
    `PAGE: ${doc.pageName} (id:${doc.page})\n` +
    `${sel}ELEMENTS (${doc.els.length} total${doc.els.length > 80 ? ', showing first 80' : ''}):\n` +
    elLines
  );
}

function validateOps(raw) {
  if (!Array.isArray(raw)) return { ops: [], errors: ['Expected array of ops'] };
  const ops = [], errors = [];
  for (let i = 0; i < raw.length; i++) {
    const op = raw[i];
    if (!op || typeof op !== 'object' || !op.type) {
      errors.push(`Op[${i}]: missing 'type' field`); continue;
    }
    if (!KNOWN_OP_TYPES.has(op.type)) {
      errors.push(`Op[${i}]: unknown op type '${op.type}'`); continue;
    }
    ops.push(op);
  }
  return { ops, errors };
}

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Main fetch handler ───────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    // ── POST /ai — AI prompt handler ──────────────────────────────────────────
    if (pathname === '/ai') {
      if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405);

      let body;
      try { body = await request.json(); }
      catch { return jsonRes({ error: 'Invalid JSON body' }, 400); }

      const { prompt, document: doc, selIds = [] } = body;
      if (!prompt || !doc) return jsonRes({ error: 'Missing prompt or document' }, 400);

      if (!env.MISTRAL_API_KEY) {
        return jsonRes({ error: 'MISTRAL_API_KEY secret not set on this Worker' }, 500);
      }

      // Call Mistral
      let mistralRes;
      try {
        mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'mistral-large-latest',
            messages: [
              { role: 'system', content: buildSystemPrompt() },
              { role: 'user',   content: buildDocSummary(doc, selIds) + '\n\nUser request: ' + prompt },
            ],
            tools: TOOLS,
            tool_choice: 'any',
            temperature: 0.2,
            max_tokens: 4096,
          }),
        });
      } catch (err) {
        return jsonRes({ error: 'Failed to reach Mistral: ' + err.message }, 502);
      }

      if (!mistralRes.ok) {
        const errText = await mistralRes.text();
        return jsonRes({ error: 'Mistral error: ' + errText }, 502);
      }

      const mistralData = await mistralRes.json();
      const message = mistralData.choices?.[0]?.message;

      if (!message?.tool_calls?.length) {
        return jsonRes({ ops: [], summary: message?.content || 'No changes suggested.' });
      }

      const toolCall = message.tool_calls.find(tc => tc.function?.name === 'apply_ops');
      if (!toolCall) return jsonRes({ ops: [], error: 'Model did not call apply_ops' });

      let args;
      try { args = JSON.parse(toolCall.function.arguments); }
      catch { return jsonRes({ ops: [], error: 'Failed to parse tool arguments' }); }

      const { ops, errors } = validateOps(args.ops);
      return jsonRes({
        ops,
        summary: args.summary || '',
        ...(errors.length ? { validationErrors: errors } : {}),
      });
    }

    // ── Everything else → static assets ──────────────────────────────────────
    return env.ASSETS.fetch(request);
  },
};
