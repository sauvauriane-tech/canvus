#!/usr/bin/env node
/**
 * canvus-ai — Canvus AI CLI
 *
 * Usage:
 *   canvus-ai "create a landing page"                       # generate, save output.canvus.json
 *   canvus-ai --input design.canvus.json "make hero taller" # edit existing doc
 *   canvus-ai push design.canvus.json                       # push file to cloud (KV)
 *   canvus-ai pull                                          # pull cloud state to canvus-state.json
 *   canvus-ai pull --output my.canvus.json                  # pull to specific file
 *
 * After generating, open Canvus in your browser and click "↓ AI" to load the design.
 * After editing in Canvus, click "↑ AI" to push changes, then run canvus-ai again to iterate.
 *
 * Environment:
 *   CANVUS_WORKER_URL   Worker base URL (default: http://localhost:8787)
 */

import * as fs from 'fs';
import { parseArgs } from 'node:util';

// ── Config ────────────────────────────────────────────────────────────────────
const WORKER = (process.env.CANVUS_WORKER_URL ?? 'http://localhost:8787').replace(/\/$/, '');

// ── Args ──────────────────────────────────────────────────────────────────────
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    input:  { type: 'string',  short: 'i' },
    output: { type: 'string',  short: 'o' },
    help:   { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
  strict: false,
});

if (values.help || positionals.length === 0) { printHelp(); process.exit(0); }

const subcommand = positionals[0];

// ── canvus-ai pull ────────────────────────────────────────────────────────────
if (subcommand === 'pull') {
  const outFile = (values.output as string | undefined) || 'canvus-state.json';
  console.log(`\n  Pulling state from ${WORKER}/state ...`);
  const res = await fetch(`${WORKER}/state`);
  if (!res.ok) { console.error(`  x ${res.status} ${res.statusText}`); process.exit(1); }
  const doc = await res.json();
  fs.writeFileSync(outFile, JSON.stringify(doc, null, 2));
  console.log(`  Saved to ${outFile}\n`);
  process.exit(0);
}

// ── canvus-ai push <file> ─────────────────────────────────────────────────────
if (subcommand === 'push') {
  const inFile = positionals[1] || (values.input as string | undefined);
  if (!inFile || !fs.existsSync(inFile)) {
    console.error('  Error: provide a file path  ->  canvus-ai push design.canvus.json');
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  console.log(`\n  Pushing ${inFile} -> ${WORKER}/state ...`);
  const res = await fetch(`${WORKER}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });
  if (!res.ok) { console.error(`  x ${res.status} ${res.statusText}`); process.exit(1); }
  console.log(`  Pushed. Open Canvus and click "down AI" to load the design.\n`);
  process.exit(0);
}

// ── canvus-ai "prompt" [--input file] ─────────────────────────────────────────
const prompt = positionals.join(' ').trim();
if (!prompt) { printHelp(); process.exit(1); }

// Load existing document if --input provided
let existingDoc: unknown = null;
const inputFile = values.input as string | undefined;
if (inputFile) {
  if (!fs.existsSync(inputFile)) { console.error(`  Error: file not found: ${inputFile}`); process.exit(1); }
  existingDoc = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  console.log(`\n  Using existing document: ${inputFile}`);
}

console.log(`\n  -> ${WORKER}/generate`);
console.log(`  Prompt: "${prompt}"`);
console.log(`  Generating ...\n`);

const res = await fetch(`${WORKER}/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt, ...(existingDoc ? { document: existingDoc } : {}) }),
});

if (!res.ok) {
  const err = await res.json() as any;
  console.error(`  x ${res.status}: ${err.error || res.statusText}`);
  process.exit(1);
}

const data = await res.json() as { document: unknown; summary?: string; error?: string };

if (data.error) { console.error(`  x ${data.error}`); process.exit(1); }
if (!data.document) { console.error('  x No document returned'); process.exit(1); }

const outFile = (values.output as string | undefined) || 'output.canvus.json';
fs.writeFileSync(outFile, JSON.stringify(data.document, null, 2));

console.log(`  ${data.summary || 'Done.'}`);
console.log(`  Saved to: ${outFile}`);
console.log(`\n  Next steps:`);
console.log(`    1. Open Canvus in your browser`);
console.log(`    2. Click "down AI" in the toolbar to load the design`);
console.log(`    3. Edit in Canvus, then click "up AI" to push changes back`);
console.log(`    4. Run: canvus-ai --input ${outFile} "your next prompt"\n`);

// ── Helpers ───────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
  canvus-ai "<prompt>" [--input <file>] [--output <file>]
  canvus-ai push <file>
  canvus-ai pull [--output <file>]

  Commands:
    "<prompt>"    Generate or modify a Canvus document using Mistral AI
    push <file>   Push a local .canvus.json file to the cloud (Cloudflare KV)
    pull          Pull the current cloud state to a local file

  Options:
    -i, --input <file>   Existing .canvus.json to modify (for iterative editing)
    -o, --output <file>  Where to save the result (default: output.canvus.json)
    -h, --help           Show this help

  Environment:
    CANVUS_WORKER_URL    Worker URL (default: http://localhost:8787)

  Workflow:
    canvus-ai "create a landing page with a hero and 3 features"
    # -> open Canvus, click "down AI" to see the design
    # -> edit in Canvus, click "up AI" to push edits
    canvus-ai pull --output my-design.canvus.json
    canvus-ai --input my-design.canvus.json "make the hero section taller"
  `);
}
