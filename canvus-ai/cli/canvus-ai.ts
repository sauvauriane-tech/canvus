#!/usr/bin/env node
/**
 * canvus-ai — Canvus AI CLI
 *
 * Usage:
 *   canvus-ai "Rename all layers"               # plan only
 *   canvus-ai "Align buttons" --apply           # plan then broadcast via /ai/apply
 *   canvus-ai apply --ops ops.json              # apply a saved ops file directly
 *
 * Environment:
 *   CANVUS_WORKER_URL   Worker base URL (default: http://localhost:8787)
 *   CANVUS_ROOM         Room ID for WebSocket broadcast (default: "default")
 */

import * as fs from "fs";
import { parseArgs } from "node:util";

// ── Config ────────────────────────────────────────────────────────────────────
const WORKER = (process.env.CANVUS_WORKER_URL ?? "http://localhost:8787").replace(/\/$/, "");
const ROOM   =  process.env.CANVUS_ROOM ?? "default";

// ── Args ──────────────────────────────────────────────────────────────────────
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    apply: { type: "boolean", short: "a", default: false },
    sel:   { type: "string",  short: "s", default: "" },
    ops:   { type: "string",  short: "o" },
    room:  { type: "string",  default: ROOM },
    help:  { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
  strict: false,
});

if (values.help) { printHelp(); process.exit(0); }

// ── Subcommand: apply a saved ops file directly ───────────────────────────────
if (positionals[0] === "apply") {
  const path = values.ops as string | undefined;
  if (!path || !fs.existsSync(path)) {
    console.error("Error: --ops <file> required for apply subcommand"); process.exit(1);
  }
  await postApply(JSON.parse(fs.readFileSync(path, "utf8")), values.room as string);
  process.exit(0);
}

// ── Default: chat ─────────────────────────────────────────────────────────────
const prompt = positionals.join(" ").trim();
if (!prompt) { printHelp(); process.exit(1); }

const selectionIds = (values.sel as string)
  .split(",").map(s => s.trim()).filter(Boolean);

console.log(`\n  → ${WORKER}/ai/chat`);
console.log(`  Prompt : "${prompt}"`);
if (selectionIds.length) console.log(`  Sel    : [${selectionIds.join(", ")}]`);

const res = await fetch(`${WORKER}/ai/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    prompt,
    context: { selectionIds },    // tools are injected server-side
  }),
});

if (!res.ok) { console.error(`  ✗ ${res.status} ${res.statusText}`); process.exit(1); }

const data = await res.json() as any;
const toolCalls: MistralToolCall[] = data.choices?.[0]?.message?.tool_calls ?? [];

if (!toolCalls.length) {
  console.log(`\n  AI: ${data.choices?.[0]?.message?.content ?? "(no response)"}\n`);
  process.exit(0);
}

// Parse arguments string → plain op objects
const ops = toolCalls.map(tc => ({
  type: tc.function.name,
  ...JSON.parse(tc.function.arguments),
}));

console.log(`\n  ${ops.length} op${ops.length !== 1 ? "s" : ""} proposed:\n`);
console.log(formatPlan(toolCalls));

if (values.apply) {
  console.log();
  await postApply(ops, values.room as string);
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface MistralToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// ── formatPlan ────────────────────────────────────────────────────────────────
function formatPlan(toolCalls: MistralToolCall[]): string {
  const ICONS: Record<string, string> = {
    create_element: "+", delete_elements: "−", rename_element: "↳",
    set_property: "·", move_elements: "→", resize_element: "↔",
    group_elements: "⊡", ungroup_elements: "⊡",
    set_fill: "◉", add_fill: "◉", remove_fill: "◉", set_stroke: "▭",
    add_effect: "✦", remove_effect: "✦",
    align_elements: "⊞", distribute_elements: "⊟",
    set_auto_layout: "⊛", remove_auto_layout: "⊛",
    add_prototype_connection: "⇢", batch: "◈",
  };

  return toolCalls.map((tc, i) => {
    const args = JSON.parse(tc.function.arguments);
    const icon = ICONS[tc.function.name] ?? "·";
    const desc = describeOp(tc.function.name, args);
    const why  = args.reason ? `\n       ${dim(args.reason)}` : "";
    return `  ${String(i + 1).padStart(2)}. ${icon}  ${desc}${why}`;
  }).join("\n");
}

function describeOp(name: string, a: Record<string, any>): string {
  const ids = a.ids ? `[${(a.ids as number[]).join(", ")}]` : "";
  switch (name) {
    case "create_element":           return `CREATE ${a.elType} "${a.name ?? ""}"  (${a.x},${a.y})  ${a.w}×${a.h}`;
    case "delete_elements":          return `DELETE ${ids}`;
    case "rename_element":           return `RENAME #${a.id}  →  "${a.name}"`;
    case "set_property":             return `SET ${a.key} = ${JSON.stringify(a.value)}  on ${ids}`;
    case "move_elements":            return `MOVE ${ids}  dx:${sign(a.dx)}  dy:${sign(a.dy)}`;
    case "resize_element":           return `RESIZE #${a.id}  ${a.w ?? "?"}×${a.h ?? "?"}`;
    case "group_elements":           return `GROUP ${ids}  →  "${a.name ?? ""}"`;
    case "ungroup_elements":         return `UNGROUP ${ids}`;
    case "set_fill":                 return `FILL ${ids}  ${a.color ?? ""}  ${a.opacity != null ? a.opacity + "%" : ""}`;
    case "add_fill":                 return `ADD FILL ${a.color}  on ${ids}`;
    case "remove_fill":              return `REMOVE FILL [${a.fillIndex}]  from ${ids}`;
    case "set_stroke":               return `STROKE ${ids}  ${a.color ?? ""}  ${a.width != null ? a.width + "px" : ""}`;
    case "add_effect":               return `EFFECT ${a.effectType}${a.preset ? ` (${a.preset})` : ""}  on ${ids}`;
    case "remove_effect":            return `REMOVE EFFECT [${a.effectIndex}]  from ${ids}`;
    case "align_elements":           return `ALIGN ${ids}  →  ${a.direction}`;
    case "distribute_elements":      return `DISTRIBUTE ${ids}  axis:${a.axis}`;
    case "set_auto_layout":          return `AUTO LAYOUT #${a.id}  ${a.direction}  gap:${a.gap}`;
    case "remove_auto_layout":       return `REMOVE AUTO LAYOUT #${a.id}`;
    case "add_prototype_connection": return `PROTO #${a.fromId}  →  #${a.toId}  (${a.trigger ?? "click"})`;
    case "batch":                    return `BATCH  [${(a.ops as any[]).length} ops]`;
    default:                         return `${name}  ${JSON.stringify(a).slice(0, 80)}`;
  }
}

// ── postApply ─────────────────────────────────────────────────────────────────
async function postApply(ops: unknown[], roomId: string): Promise<void> {
  console.log(`  → ${WORKER}/ai/apply  (room: ${roomId})`);

  const res = await fetch(`${WORKER}/ai/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ops, room: roomId }),
  });

  const data = await res.json() as any;
  if (!res.ok) { console.error(`  ✗ apply failed: ${JSON.stringify(data)}`); process.exit(1); }
  console.log(`  ✓ Broadcast to ${data.broadcast ?? "?"} client(s)\n`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sign(n: number) { return n >= 0 ? `+${n}` : String(n); }
function dim(s: string)  { return `\x1b[2m${s}\x1b[0m`; }

function printHelp() {
  console.log(`
  canvus-ai "<prompt>" [--apply] [--sel <ids>] [--room <id>]
  canvus-ai apply --ops <ops.json> [--room <id>]

  -a, --apply        Broadcast ops to Canvus via /ai/apply after planning
  -s, --sel <ids>    Comma-separated element IDs treated as selected
      --room <id>    WebSocket room (default: "default")
  -o, --ops <file>   Ops JSON file (apply subcommand only)

  Env:
    CANVUS_WORKER_URL  (default: http://localhost:8787)
    CANVUS_ROOM        (default: "default")

  Examples:
    canvus-ai "Align the nav items"
    canvus-ai "Add grain texture to hero" --apply
    canvus-ai "Rename layers" --sel 12,14 --apply --room session-42
    canvus-ai apply --ops plan.json
  `);
}
