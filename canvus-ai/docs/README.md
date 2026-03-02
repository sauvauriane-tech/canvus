# Canvus AI

AI design assistant for Canvus. Powered by Mistral. Ops-based. Fully undoable.

---

## Quick start

### 1. Deploy the backend

**Option A — Cloudflare Worker (recommended for production)**

```bash
cd canvus-ai
npm install
npx wrangler login
npx wrangler deploy backend/worker.ts
```

Set your Mistral API key in the Cloudflare dashboard:
```
Workers > canvus-ai-backend > Settings > Variables
MISTRAL_API_KEY = sk-...
ALLOWED_ORIGIN  = https://your-canvus-domain.com
```

**Option B — Express (local dev)**

```bash
# In canvus-ai/
cp .env.example .env
# Edit .env and set MISTRAL_API_KEY=sk-...

npm install
npm run dev
# → Canvus AI backend → http://localhost:3333
```

**`.env.example`**
```env
MISTRAL_API_KEY=sk-your-mistral-key-here
ALLOWED_ORIGIN=*
PORT=3333
```

---

### 2. Point Canvus at the backend

In the Canvus app (Settings > Integrations or the AI panel):

```
Backend URL: http://localhost:3333
```

Or set the env var for the CLI:
```bash
export CANVUS_AI_URL=http://localhost:3333
```

---

### 3. Use the CLI

```bash
npm install -g .    # from canvus-ai/

# Export your current design from Canvus (File > Export JSON)
# Then run:

canvus-ai --doc my-design.json "Rename all layers semantically"
canvus-ai --doc my-design.json --dry-run "Align buttons horizontally"
canvus-ai --doc my-design.json --apply "Add 8px corner radius to all rectangles"
```

**Full CLI usage:**
```
canvus-ai [options] "<prompt>"

Options:
  -d, --doc <file>      Canvus document JSON snapshot (required)
  -s, --sel <ids>       Comma-separated element IDs to treat as selected
  -n, --dry-run         Preview ops without applying
  -a, --apply           Write the modified document back to --output or --doc
  -o, --output <file>   Output file for the applied document
      --url <url>       Backend URL (default: $CANVUS_AI_URL or http://localhost:3333)
  -h, --help            Show help
```

---

## Architecture

```
canvus-ai/
  src/              # App.js module split (state, renderer, tools, panels)
  ai/
    ops.ts          # TypeScript op type definitions
    schemas.ts      # AJV JSON schemas for every op
    validate.ts     # Op validator (used by backend + optionally in-browser)
    apply.js        # In-browser op applier (reads/writes global S state)
    prompts.ts      # Canned prompt library for the AI panel
  backend/
    worker.ts       # Cloudflare Worker (production)
    express.ts      # Express server (local dev)
  cli/
    canvus-ai.ts    # CLI entry point
  tests/
    validation.test.ts
    undo-redo.test.ts
    diff.test.ts
  docs/
    README.md              ← you are here
    AI_PANEL_COPY.md       UX copy for the panel
    PROMPT_ENGINEERING.md  Internal guide for extending the AI
  marketing/
    ONE_PAGER.md
    BLOG_POST.md
```

---

## Op reference

All ops the AI can produce. Validated by AJV before reaching the browser.

| Op | Required fields | What it does |
|----|----------------|--------------|
| `create_element` | `elType, x, y, w, h` | Creates a new element |
| `delete_elements` | `ids[]` | Deletes elements (and orphaned children) |
| `set_property` | `ids[], key, value` | Sets any scalar property |
| `move_elements` | `ids[], dx, dy` | Moves elements by delta |
| `resize_element` | `id` + any of `x,y,w,h` | Resizes/repositions one element |
| `rename_element` | `id, name` | Renames a layer |
| `reorder_element` | `id, position` | front/back/forward/backward |
| `group_elements` | `ids[]` | Groups elements, computes bounding box |
| `ungroup_elements` | `ids[]` | Dissolves groups, re-parents children |
| `set_fill` | `ids[]` | Updates a fill layer |
| `add_fill` | `ids[], color` | Adds a new fill layer |
| `remove_fill` | `ids[], fillIndex` | Removes a fill layer |
| `set_stroke` | `ids[]` | Updates stroke color/width/align |
| `add_effect` | `ids[], effectType` | Adds shadow/blur/texture/glass |
| `remove_effect` | `ids[], effectIndex` | Removes an effect |
| `set_auto_layout` | `id, direction, gap, padding, align` | Applies auto layout |
| `remove_auto_layout` | `id` | Removes auto layout |
| `align_elements` | `ids[], direction` | Aligns to left/right/center/top/bottom |
| `distribute_elements` | `ids[], axis` | Distributes with equal gaps |
| `add_prototype_connection` | `fromId, toId` | Wires prototype link |
| `batch` | `ops[]` | Atomic group (one undo step) |

Full TypeScript types in [ai/ops.ts](../ai/ops.ts).
Full AJV schemas in [ai/schemas.ts](../ai/schemas.ts).

---

## Running tests

```bash
npm install
npm test

# Run specific suites
npx jest tests/validation.test.ts
npx jest tests/undo-redo.test.ts
npx jest tests/diff.test.ts
```

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MISTRAL_API_KEY` | Yes | — | Mistral API key |
| `ALLOWED_ORIGIN` | No | `*` | CORS origin whitelist |
| `PORT` | No | `3333` | Express server port |
| `CANVUS_AI_URL` | No | `http://localhost:3333` | CLI backend URL |

---

## Extending

- **New op type:** See [PROMPT_ENGINEERING.md](PROMPT_ENGINEERING.md#adding-a-new-op-type)
- **New canned prompt:** Add to [ai/prompts.ts](../ai/prompts.ts)
- **Different AI model:** Change `model:` in worker.ts or express.ts
- **Change system prompt:** Edit `buildSystemPrompt()` in worker.ts
