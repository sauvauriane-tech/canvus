/**
 * Canvus app Worker
 *
 * Handles POST /ai (calls Mistral, returns ops) and falls through
 * to static assets for everything else.
 *
 * Requires the MISTRAL_API_KEY secret:
 *   wrangler secret put MISTRAL_API_KEY
 */

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
10. Keep changes minimal — don't modify unrelated elements.

OP SCHEMAS — use exactly these field names:
set_fill:            { type, ids:[int], color?:'#hex', opacity?:0-100, fillIndex?:0, blend?:'normal', visible?:bool }
add_fill:            { type, ids:[int], color:'#hex', opacity?:100, blend?:'normal' }
remove_fill:         { type, ids:[int], fillIndex:int }
set_stroke:          { type, ids:[int], color?:'#hex', width?:int, align?:'inside'|'outside'|'center', dash?:bool }
set_property:        { type, ids:[int], key:string, value:any }
move_elements:       { type, ids:[int], dx:number, dy:number }
resize_element:      { type, id:int, x?:number, y?:number, w?:number, h?:number }
rename_element:      { type, id:int, name:string }
reorder_element:     { type, id:int, position:'front'|'back'|'forward'|'backward' }
create_element:      { type, elType:'rect'|'ellipse'|'frame'|'text'|'line', x:int, y:int, w:int, h:int, name?:string, text?:string, fill?:'#hex', parentId?:int }
delete_elements:     { type, ids:[int] }
group_elements:      { type, ids:[int], name?:string }
ungroup_elements:    { type, ids:[int] }
add_effect:          { type, ids:[int], effectType:'drop-shadow'|'inner-shadow'|'layer-blur'|'bg-blur', color?:'#hex', opacity?:25, x?:2, y?:4, blur?:8 }
remove_effect:       { type, ids:[int], effectIndex:int }
set_auto_layout:     { type, id:int, direction:'row'|'column', gap:int, padding:int, align:'start'|'center'|'end' }
remove_auto_layout:  { type, id:int }
align_elements:      { type, ids:[int], direction:'left'|'right'|'top'|'bottom'|'center-h'|'center-v' }
distribute_elements: { type, ids:[int], axis:'h'|'v' }
add_prototype_connection: { type, fromId:int, toId:int, trigger?:'click', animation?:'instant' }
batch:               { type, ops:[...ops] }
IMPORTANT: ids is always an array of integers. Never use a single 'id' for multi-element ops.`;
}

function buildGenerateSystemPrompt() {
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

    // ── POST /generate — full document generation ─────────────────────────────
    if (pathname === '/generate') {
      if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405);

      let body;
      try { body = await request.json(); }
      catch { return jsonRes({ error: 'Invalid JSON body' }, 400); }

      const { prompt } = body;
      if (!prompt) return jsonRes({ error: 'Missing prompt' }, 400);

      if (!env.MISTRAL_API_KEY) {
        return jsonRes({ error: 'MISTRAL_API_KEY secret not set on this Worker' }, 500);
      }

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
              { role: 'system', content: buildGenerateSystemPrompt() },
              { role: 'user',   content: prompt },
            ],
            tools: [GENERATE_TOOL],
            tool_choice: 'any',
            temperature: 0.3,
            max_tokens: 8192,
          }),
        });
      } catch (err) {
        return jsonRes({ error: 'Failed to reach Mistral: ' + err.message }, 502);
      }

      if (!mistralRes.ok) {
        const errText = await mistralRes.text();
        return jsonRes({ error: 'Mistral error: ' + errText }, 502);
      }

      const genData = await mistralRes.json();
      const genMsg  = genData.choices?.[0]?.message;

      if (!genMsg?.tool_calls?.length) {
        return jsonRes({ error: 'Mistral did not return a document', summary: genMsg?.content || '' });
      }

      const genCall = genMsg.tool_calls.find(tc => tc.function?.name === 'set_document');
      if (!genCall) return jsonRes({ error: 'No set_document call in response' });

      let genArgs;
      try { genArgs = JSON.parse(genCall.function.arguments); }
      catch { return jsonRes({ error: 'Failed to parse tool arguments' }); }

      // Optional KV save (graceful no-op when KV not configured)
      if (env.CANVUS_STATE) {
        await env.CANVUS_STATE.put('doc', JSON.stringify(genArgs.document)).catch(() => {});
      }

      return jsonRes({ document: genArgs.document, summary: genArgs.summary || '' });
    }

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

    // ── POST /terminal — terminal command handler ─────────────────────────────
    if (pathname === '/terminal') {
      if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405);

      let body;
      try { body = await request.json(); }
      catch { return jsonRes({ error: 'Invalid JSON body' }, 400); }

      const { command, args = [] } = body;
      if (!command) return jsonRes({ error: 'Missing command' }, 400);

      // Terminal command processor
      let response = { success: true, output: '' };

      try {
        switch (command.toLowerCase()) {
          case 'echo':
            response.output = args.join(' ');
            break;
          case 'date':
            response.output = new Date().toISOString();
            break;
          case 'help':
            response.output = 'Available commands: echo, date, help, import';
            break;
          case 'import':
            if (args.length < 2) {
              response = { success: false, error: 'import requires filename and target URL' };
              break;
            }
            const [filename, targetUrl] = args;
            // Validate URL format
            if (!targetUrl.includes('#/file_') || !targetUrl.includes('/page_')) {
              response = { success: false, error: 'Invalid target URL format. Use: #/file_<fileId>/page_<pageId>' };
              break;
            }
            
            // Extract fileId and pageId from URL
            const urlParts = targetUrl.split('/');
            const fileId = urlParts.find(part => part.startsWith('file_'))?.replace('file_', '');
            const pageId = urlParts.find(part => part.startsWith('page_'))?.replace('page_', '');
            
            if (!fileId || !pageId) {
              response = { success: false, error: 'Could not extract fileId and pageId from URL' };
              break;
            }
            
            // Store the import request (in a real app, this would trigger actual import processing)
            // For now, we'll simulate a successful import and return the data that would be created
            response.output = `Import scheduled: ${filename} -> file_${fileId}/page_${pageId}`;
            
            // Simulate import completion by returning mock data that would be created
            response.importData = {
              fileId: fileId,
              pageId: parseInt(pageId),
              filename: filename,
              elementsCreated: 15,  // Mock: 15 elements imported
              status: 'queued',
              timestamp: new Date().toISOString(),
              targetUrl: targetUrl
            };
            
            // In a real implementation, this would:
            // 1. Store the import request in a database/queue
            // 2. Process the HTML file and convert to Canvus elements
            // 3. Save to the specified fileId/pageId
            // 4. Return the actual imported elements
            
            break;
          default:
            response = { success: false, error: `Unknown command: ${command}` };
        }
      } catch (err) {
        response = { success: false, error: err.message };
      }

      return jsonRes(response);
    }

    // ── POST /api/import — HTML/JSON import endpoint ────────────────────────
    if (pathname === '/api/import') {
      if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405);

      let body;
      try { body = await request.json(); }
      catch { return jsonRes({ error: 'Invalid JSON body' }, 400); }

      const { fileId, pageId, data } = body;
      if (!fileId || !pageId || !data) {
        return jsonRes({ error: 'Missing required fields: fileId, pageId, or data' }, 400);
      }

      // Validate the Canvus JSON structure
      if (!data.els || !Array.isArray(data.els) || !data.pages || !Array.isArray(data.pages)) {
        return jsonRes({ error: 'Invalid Canvus JSON structure' }, 400);
      }

      try {
        // In a real implementation, this would:
        // 1. Store the data in a database/queue
        // 2. Broadcast to connected clients via WebSocket
        // 3. Return success confirmation
        
        // For now, simulate successful import
        const elementsCreated = data.els.length;
        const pagesCreated = data.pages.length;
        
        // Simulate WebSocket broadcast to clients
        console.log(`[IMPORT] Broadcasting to file_${fileId}/page_${pageId}: ${elementsCreated} elements`);
        
        return jsonRes({
          success: true,
          fileId: fileId,
          pageId: pageId,
          elementsCreated: elementsCreated,
          pagesCreated: pagesCreated,
          message: 'Import successful. Data ready for client synchronization.'
        });
      } catch (err) {
        return jsonRes({ error: 'Import processing failed: ' + err.message }, 500);
      }
    }

    // ── Everything else → static assets ──────────────────────────────────────
    return env.ASSETS.fetch(request);
  },
};
