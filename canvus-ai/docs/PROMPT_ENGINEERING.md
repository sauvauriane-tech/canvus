# Canvus AI — Prompt Engineering Notes

Internal guide for extending the AI system. Read before adding new prompts, tools, or changing the system prompt.

---

## How it works

```
User prompt  →  [backend/worker.ts]
                  builds system + user message
                  calls Mistral with apply_ops tool
                  Mistral returns tool_call { ops[], summary }
                  AJV validates each op
              →  [browser: apply.js]
                  pushUndo()
                  applyOps(ops)
                  renderAll()
```

---

## System prompt principles

### 1. Single tool call, all changes at once
The model must call `apply_ops` exactly once with all changes. Multiple calls cause ordering bugs and race conditions on the client. The system prompt says: *"Return ALL changes as a single call."*

If you need the model to reason step-by-step, put all ops into a `batch` op. The client applies them atomically (single undo step).

### 2. Reason field on every op
Every op should include `"reason": "..."` — a short explanation of why the AI made that change. This is shown to the user in the diff preview panel. It builds trust and makes the AI's decisions legible.

Bad: `{ "type": "rename_element", "id": 5, "name": "Header" }`
Good: `{ "type": "rename_element", "id": 5, "name": "Header", "reason": "Generic name 'Frame 5' replaced with semantic role" }`

### 3. Minimal changes
The model should only touch what the user asked about. Don't add effects to every element if the user only said "clean up spacing". Add this rule to the system prompt explicitly: *"Keep changes minimal — don't modify unrelated elements."*

### 4. Grid snapping
Canvus uses an 8pt grid. Coordinates should snap to multiples of 8. Add: *"Snap to 8px increments when possible."* The model is surprisingly good at this when told explicitly.

### 5. Prefer semantic op types
Prefer `rename_element` over `set_property` with key `"name"`. Prefer `align_elements` over multiple `move_elements`. Prefer `set_auto_layout` over calculating positions manually. These ops are safer and produce better diffs.

### 6. Document context size
The full S.els array can be huge (thousands of elements). Truncate to the first 80 elements of the current page and always include selected elements even if they exceed the limit. See `buildDocSummary()` in worker.ts.

For large documents, pre-filter: only send elements within viewport ± 200px or elements matching the selection hierarchy.

---

## Adding a new op type

1. Add the TypeScript interface to `ai/ops.ts`
2. Add the AJV schema to `ai/schemas.ts` (include `additionalProperties: false`)
3. Add a case to `_applyOne()` in `ai/apply.js`
4. Add a `formatOp()` case to `cli/canvus-ai.ts` for CLI display
5. Add validation tests to `tests/validation.test.ts`
6. Update the system prompt if the op needs to be explained to the model

---

## Mistral-specific notes

### Model choice
- `mistral-large-latest` — best reasoning, use for production
- `mistral-small-latest` — 3× cheaper, good for simple layout tasks
- `codestral-latest` — good if ops resemble code; not recommended here

### tool_choice: 'any' vs 'auto'
Use `tool_choice: 'any'` to force the model to always call a tool. If you use `'auto'`, the model sometimes replies in plain text when it can't figure out the right ops — you then get no ops, just a text message. Handle both cases on the client (show text as a notification).

### Temperature
`0.2` — low temperature gives consistent, predictable ops. Higher values produce more creative suggestions but also more schema violations.

### Token budget
- System prompt: ~400 tokens
- Doc summary (80 elements): ~800 tokens
- User message: ~50 tokens
- Completion (ops): ~600–1200 tokens
- Total: ~2000–2400 tokens per call (well within 32k context)

---

## Common failure modes

| Failure | Cause | Fix |
|---------|-------|-----|
| Model returns plain text | `tool_choice: 'auto'`, model confused | Use `tool_choice: 'any'` |
| Op missing required field | Schema mismatch | AJV drops it; check `validationErrors` in response |
| Coordinates off-grid | Model doesn't know about snapping | Add grid rule to system prompt |
| Model renames unrelated elements | Prompt too vague | Add "Keep changes minimal" rule |
| model hallucinates element IDs | Doc context truncated | Ensure selected IDs always appear in context |
| `batch` op with 0 children | Model bug | AJV rejects `minItems: 1`; check validation errors |
| Op order matters for moves | Children moved before frame | Sort ops: moves/resizes before creates, creates before deletes |

---

## Extending the canned prompts library

Rules for writing good canned prompts (`ai/prompts.ts`):

1. **Be specific about numbers.** "Add a shadow" is ambiguous. "Add drop shadow x:0, y:4, blur:16, opacity:20%" is deterministic.

2. **Name the op types** when it matters. "Use set_property ops" or "Use align_elements op" steers the model to the right approach.

3. **Scope clearly.** Say "selected elements" for selection-aware prompts. Say "all top-level frames on the page" when not selection-dependent.

4. **Use design vocabulary.** The model knows terms like "optical alignment", "8pt grid", "visual hierarchy", "card component". Use them.

5. **Test prompts on real documents.** Run `canvus-ai --doc tests/fixtures/sample.json "<prompt>"` before adding to the library.

---

## Document snapshot format

The AI receives this JSON as context (built by `buildDocSummary`):

```
Page: Homepage (id:1)
Selected: [12, 14]
Elements (47 total):
  id:1  type:frame  name:"Mobile Frame"  x:0  y:0  w:375  h:812
  id:5  type:rect   name:"Hero BG"       x:0  y:0  w:375  h:400  parent:1
  id:12 type:rect   name:"CTA Button"    x:40 y:320 w:295 h:48   parent:1  text:"Get Started"
  ...
```

Note: fills, effects, and children are not included to save tokens. If a prompt requires knowing fills, inject them for the selected elements only.

---

## Future: multi-turn conversation

The current system is single-turn (one prompt → one set of ops). For multi-turn, maintain a conversation history array and re-send it with each call. The model can then reference previous changes: "make the button you just created primary colored."

Implementation: store `[{role, content}]` in `S._aiHistory` and append each turn before calling the backend.
