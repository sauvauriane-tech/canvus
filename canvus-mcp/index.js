/**
 * canvus-mcp — MCP server for the Canvus design tool
 *
 * Runs as a local stdio MCP server (Claude Code connects to it).
 * Also runs a WebSocket server on port 3131 that the Canvus browser tab
 * connects to by setting:  window.CANVUS_AI_WS_URL = "http://localhost:3131"
 *
 * Tools exposed to Claude:
 *   import_html       — import raw HTML into the canvas
 *   import_from_url   — fetch a URL and import the page
 *   get_canvas        — read all elements on the current page
 *   update_element    — change element properties (color, text, size, etc.)
 *   create_element    — add a new element (frame, rect, text…)
 *   delete_elements   — remove elements by id
 *   move_elements     — move elements to new coordinates
 *   select_elements   — select elements by id
 */

import { McpServer }          from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer }    from 'ws';
import { z }                  from 'zod';

const WS_PORT = 3131;

// ── WebSocket server (Canvus connects here) ───────────────────────────────────
const wss = new WebSocketServer({ port: WS_PORT });
let canvusWs = null;                      // active Canvus browser connection
const pending = new Map();                // reqId → { resolve, reject, timer }

wss.on('connection', (ws) => {
  canvusWs = ws;
  log('Canvus connected');

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg._reqId && pending.has(msg._reqId)) {
      const { resolve, timer } = pending.get(msg._reqId);
      clearTimeout(timer);
      pending.delete(msg._reqId);
      resolve(msg);
    }
  });

  ws.on('close', () => {
    canvusWs = null;
    log('Canvus disconnected');
  });
});

wss.on('listening', () => log(`WebSocket server listening on ws://localhost:${WS_PORT}`));

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg) { process.stderr.write(`[canvus-mcp] ${msg}\n`); }

function requireCanvus() {
  if (!canvusWs) throw new Error(
    'Canvus is not connected. Open Canvus and set: window.CANVUS_AI_WS_URL = "http://localhost:3131"'
  );
}

function send(msg) {
  requireCanvus();
  canvusWs.send(JSON.stringify(msg));
}

function sendAndWait(msg, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    requireCanvus();
    const reqId = Math.random().toString(36).slice(2, 10);
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error('Timeout waiting for Canvus response'));
    }, timeoutMs);
    pending.set(reqId, { resolve, reject, timer });
    canvusWs.send(JSON.stringify({ ...msg, _reqId: reqId }));
  });
}

function ok(text) {
  return { content: [{ type: 'text', text: String(text) }] };
}

// ── MCP server ────────────────────────────────────────────────────────────────
const server = new McpServer({ name: 'canvus', version: '1.0.0' });

// import_html
server.tool(
  'import_html',
  'Import raw HTML (and optional CSS) into the current Canvus page as editable design elements.',
  {
    html: z.string().describe('Full HTML string to import'),
    css:  z.string().optional().describe('Optional CSS string'),
  },
  async ({ html, css }) => {
    send({ type: 'html:import', html, css: css || '' });
    return ok('HTML imported into Canvus.');
  }
);

// import_from_url
server.tool(
  'import_from_url',
  'Fetch a URL and import the page into Canvus as editable elements. Works best with localhost pages.',
  {
    url: z.string().describe('URL to fetch, e.g. http://localhost:8080/page.html'),
  },
  async ({ url }) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const html = await res.text();
    send({ type: 'html:import', html, css: '' });
    return ok(`Fetched and imported ${url} into Canvus.`);
  }
);

// get_canvas
server.tool(
  'get_canvas',
  'Return the current page elements and pages from the Canvus canvas as JSON.',
  {},
  async () => {
    const resp = await sendAndWait({ type: 'canvas:get' });
    return ok(JSON.stringify(resp.state, null, 2));
  }
);

// update_element
server.tool(
  'update_element',
  'Update properties of one or more elements. Supports any element property: textColor, fontSize, text, fills, opacity, rx, stroke, etc.',
  {
    updates: z.array(z.object({
      id:    z.number().describe('Element id from get_canvas'),
      props: z.record(z.unknown()).describe('Properties to set, e.g. {"textColor":"#7c6aee","fontSize":24}'),
    })).describe('List of {id, props} pairs'),
  },
  async ({ updates }) => {
    const ops = updates.flatMap(({ id, props }) =>
      Object.entries(props).map(([prop, val]) => ({ type: 'set_property', id, prop, val }))
    );
    const { applied, skipped } = applyOpsViaWS(ops);
    return ok(`Applied ${ops.length} update(s).${skipped?.length ? ' Skipped: ' + skipped.join(', ') : ''}`);
  }
);

// create_element
server.tool(
  'create_element',
  'Create a new element on the canvas (frame, rect, ellipse, text).',
  {
    elType:   z.enum(['frame','rect','ellipse','text']).describe('Element type'),
    x:        z.number().describe('X position in canvas pixels'),
    y:        z.number().describe('Y position in canvas pixels'),
    w:        z.number().describe('Width in pixels'),
    h:        z.number().describe('Height in pixels'),
    name:     z.string().optional().describe('Layer name'),
    text:     z.string().optional().describe('Text content (for text elements)'),
    fillColor:z.string().optional().describe('Fill color hex, e.g. "#7c6aee"'),
    parentId: z.number().optional().describe('Parent frame id'),
  },
  async (params) => {
    send({ type: 'ai:ops', ops: [{ type: 'create_element', ...params }] });
    return ok(`Created ${params.elType} element.`);
  }
);

// delete_elements
server.tool(
  'delete_elements',
  'Delete elements from the canvas by id.',
  {
    ids: z.array(z.number()).describe('Element ids to delete'),
  },
  async ({ ids }) => {
    send({ type: 'ai:ops', ops: [{ type: 'delete_elements', ids }] });
    return ok(`Deleted ${ids.length} element(s).`);
  }
);

// move_elements
server.tool(
  'move_elements',
  'Move elements to new canvas coordinates.',
  {
    moves: z.array(z.object({
      id: z.number(),
      x:  z.number(),
      y:  z.number(),
    })).describe('List of {id, x, y}'),
  },
  async ({ moves }) => {
    const ops = moves.map(({ id, x, y }) => ({ type: 'move_elements', ids: [id], dx: x, dy: y, absolute: true }));
    send({ type: 'ai:ops', ops });
    return ok(`Moved ${moves.length} element(s).`);
  }
);

// select_elements
server.tool(
  'select_elements',
  'Select elements on the canvas by id so the user can see them.',
  {
    ids: z.array(z.number()).describe('Element ids to select'),
  },
  async ({ ids }) => {
    send({ type: 'canvas:select', ids });
    return ok(`Selected ${ids.length} element(s).`);
  }
);

// Helper — send ai:ops and don't wait (fire-and-forget)
function applyOpsViaWS(ops) {
  send({ type: 'ai:ops', ops });
  return { applied: ops.map(o => o.type), skipped: [] };
}

// ── Connect stdio transport ───────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
log('MCP server ready (stdio).');
