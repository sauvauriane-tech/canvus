# Introducing Canvus AI: Design with your words

*Posted by the Canvus team · [DATE]*

---

We built Canvus because we believe a design tool should be fast, open, and yours. No subscriptions for basic features. No electron app consuming 800MB of RAM. Just a browser tab and a blank canvas.

Today we're adding something new: **Canvus AI** — a design copilot that understands your document and makes changes when you ask.

---

## The problem with AI in design tools

Everyone's doing AI in design tools now. Auto-fill, copilot sidebars, "magic" layouts. Most of it is one of two things:

**Type 1: Decorative AI.** It generates content you'll immediately replace. A placeholder image. A Lorem Ipsum alternative. Nice for demos, not a workflow.

**Type 2: Black-box AI.** You click "make this better" and it does *something* — and now you have a design you don't quite recognise, made of layers you didn't build, with names like "AI_Generated_Frame_2". You can't undo step by step. You can't hand it off with confidence.

We wanted neither.

---

## The Canvus AI approach: structured ops, not generation

Canvus AI doesn't generate a design from scratch. It reads your current design — the element tree, positions, fills, effects — and proposes specific, typed changes:

```
Designer: "Align the buttons, add drop shadows, and rename the layers."

Canvus AI proposes:
  ⊞ Align [4 elements] → left          (reason: elements have inconsistent x positions)
  ✦ Add drop shadow to "CTA Button"     (reason: adds depth to primary action)
  ✦ Add drop shadow to "Secondary Btn"  (reason: visual consistency with CTA)
  ↳ Rename "Rectangle 14" → "CTA Button"
  ↳ Rename "Frame 6" → "Action Bar"
  ↳ Rename "Text 3" → "Button Label"
```

You see a plain-English diff. You click **Apply** or **Discard**. If you apply, it's one undo step — `⌘Z` takes you back cleanly.

No black box. No mystery. The AI tells you what it's doing and why.

---

## Under the hood

Canvus AI is powered by **Mistral** (specifically `mistral-large-latest`) with a custom tool-calling interface we built around Canvus's document model.

The AI has access to 20 typed "ops" — operations it can request:

- `create_element` — draw a new rect, frame, text, etc.
- `move_elements` — shift elements by delta x/y
- `rename_element` — give a layer a semantic name
- `set_fill` — change fill color, opacity, blend mode
- `add_effect` — add drop shadow, texture, glass blur
- `align_elements` — align to left/center/right/top/bottom
- `set_auto_layout` — apply auto layout to a frame
- `add_prototype_connection` — wire two frames
- `batch` — apply multiple ops as one undo step
- ... and 11 more

Every op is validated against a strict JSON schema (AJV) before it touches your design. The AI can't do anything that Canvus itself can't do. It has no special powers — it's just using the same state mutation system you interact with every time you drag a resize handle.

---

## The CLI

For design engineers who want to script changes, there's a CLI:

```bash
# Install
npm install -g canvus-ai

# Preview what the AI would do (no changes written)
canvus-ai --doc my-design.json --dry-run "Rename all layers semantically"

# Apply and save
canvus-ai --doc my-design.json --apply --output my-design-v2.json \
  "Align all buttons, distribute vertically with 16px gaps"
```

The CLI calls the same backend as the browser panel, gets the same validated ops, and prints a human-readable diff. You can use it in CI to enforce naming conventions, apply design tokens, or audit your design files.

---

## What it's good at (and what it isn't)

**Good at:**
- Layout: aligning, distributing, snapping to 8px grid
- Naming: making "Rectangle 14" into "Primary CTA Button"
- Styling: applying consistent shadows, fills, textures across selections
- Organising: grouping elements, applying auto layout, wiring prototypes
- Accessibility audits: finding small tap targets, vague layer names

**Not yet:**
- Generating components from scratch (coming in v1.5)
- Understanding visual intent from screenshots
- Multi-turn conversation (planned for v1.0)
- Design token extraction and application

We're being deliberate. It's better to do ten things well than fifty things badly.

---

## Try it

Canvus AI is live in beta at [canvus.design/ai].

Open a document, select some elements, and type a prompt. See what happens.

If you're building on top of Canvus or want early access to the backend API, reach out at [founders@canvus.design].

---

*Canvus is open source. The AI ops layer is MIT licensed. The backend is a Cloudflare Worker you can deploy yourself.*

---

**Comments? [Discuss on Twitter →](#)  |  [Star on GitHub →](#)  |  [Join the Discord →](#)**
