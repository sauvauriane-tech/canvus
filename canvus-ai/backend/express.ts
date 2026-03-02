/**
 * express.ts — Canvus AI Express Backend (local-dev alternative to the Worker)
 *
 * Usage:
 *   MISTRAL_API_KEY=sk-... npx ts-node backend/express.ts
 *   # or: node dist/backend/express.js
 *
 * Install:
 *   npm install express cors dotenv
 *   npm install -D @types/express @types/cors ts-node typescript
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import { validateOps } from '../ai/validate.js';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3333;

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

// ─── POST /ai ─────────────────────────────────────────────────────────────────
app.post('/ai', async (req: Request, res: Response) => {
  const { prompt, document: doc, selIds = [] } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt is required' });
  }
  if (!doc) {
    return res.status(400).json({ error: 'document snapshot is required' });
  }

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'MISTRAL_API_KEY not set' });

  const systemPrompt = buildSystemPrompt();
  const userMessage  = buildUserMessage(doc, selIds, prompt);

  let mistralRes: globalThis.Response;
  try {
    mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       'mistral-large-latest',
        messages:    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
        tools:       TOOLS,
        tool_choice: 'any',
        temperature: 0.2,
        max_tokens:  4096,
      }),
    });
  } catch (err) {
    console.error('Mistral fetch error:', err);
    return res.status(502).json({ error: 'Failed to reach Mistral' });
  }

  if (!mistralRes.ok) {
    const text = await mistralRes.text();
    console.error('Mistral error response:', text);
    return res.status(502).json({ error: `Mistral: ${text}` });
  }

  const data = await mistralRes.json() as any;
  const message = data.choices?.[0]?.message;

  if (!message?.tool_calls?.length) {
    return res.json({ ops: [], summary: message?.content || '', rawText: message?.content });
  }

  const toolCall = message.tool_calls.find((tc: any) => tc.function?.name === 'apply_ops');
  if (!toolCall) return res.json({ ops: [], summary: 'No changes.' });

  let args: { ops: unknown[]; summary?: string };
  try { args = JSON.parse(toolCall.function.arguments); }
  catch { return res.status(200).json({ error: 'Failed to parse tool arguments', ops: [] }); }

  const { valid, errors, ops } = validateOps(args.ops);

  return res.json({ ops, summary: args.summary || '', validationErrors: valid ? undefined : errors });
});

// ─── GET /health ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => console.log(`Canvus AI backend → http://localhost:${PORT}`));

// ─── Shared helpers (duplicated from worker.ts for standalone use) ─────────────
function buildSystemPrompt(): string {
  return `You are Canvus AI, an expert design assistant. Express all design changes as a list of typed ops via the apply_ops tool. Include a reason on each op. Keep changes minimal.`;
}

function buildUserMessage(doc: any, selIds: number[], prompt: string): string {
  const sel = selIds.length ? `Selected: [${selIds.join(', ')}]\n` : '';
  const els = (doc.els || []).slice(0, 80)
    .map((e: any) => `  id:${e.id} ${e.type} "${e.name}" x:${e.x} y:${e.y} w:${e.w} h:${e.h}`)
    .join('\n');
  return `Page: ${doc.pageName}\n${sel}Elements:\n${els}\n\nRequest: ${prompt}`;
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'apply_ops',
      description: 'Apply design operations to the Canvus document.',
      parameters: {
        type: 'object', required: ['ops'],
        properties: {
          ops:     { type: 'array', items: { type: 'object' } },
          summary: { type: 'string' },
        },
      },
    },
  },
];
