# Canvus AI — One-Pager

**For:** Investors, design leads, early adopters
**Version:** Beta roadmap, Q2 2025

---

## The problem

Design tools are powerful — and slow.

Designers spend hours on mechanical work: aligning elements, naming layers, wiring prototypes, fixing spacing, setting up grids. Every hour of that is an hour not spent on the actual design thinking.

Figma's AI features are shallow: rename suggestions, auto-fill, not much else. No tool yet lets you *talk* to your canvas.

---

## What Canvus AI does

**Canvus AI is a design copilot that understands your document and makes changes on command.**

You type a prompt. The AI proposes a set of structured design operations. You review a plain-English diff. You click Apply.

Every change is undoable. No black-box generation. No hallucinated components you can't edit.

```
Designer: "Align all the buttons, add grain texture, and rename layers semantically."

Canvus AI proposes:
  ⊞ Align [4 elements] → left
  ✦ Effect on "CTA Button": grain texture
  ↳ Rename "Rectangle 14" → "Primary CTA"
  ↳ Rename "Frame 6" → "Hero Section"

[ Apply ]   [ Discard ]
```

---

## How it works

```
Canvus document
      │
      ▼
  Structured snapshot (element tree, positions, fills)
      │
      ▼
  Mistral AI (via our backend proxy)
  + 20 typed tool definitions (create, move, rename, style, prototype…)
      │
      ▼
  Validated op array
      │
      ▼
  In-browser applier → renderAll()
  Single undo step
```

The AI never sees raw DOM or pixels. It reasons over a typed JSON model — the same model your browser uses to render the canvas. This makes its responses fast, deterministic, and safe to undo.

---

## Key design decisions

| Decision | Why |
|----------|-----|
| Ops-based, not generative | Changes are reviewable, editable, undoable |
| AJV schema validation | Bad AI output is caught before it touches state |
| Single undo step | Feels like a normal design action, not a magic box |
| Mistral, not OpenAI | Competitive pricing, EU data residency, strong function-calling |
| Cloudflare Worker | Zero cold starts, <50ms global edge latency |
| CLI (`canvus-ai`) | Design engineers can script batch changes |

---

## Traction opportunity

**Target designers:** Product designers at SaaS startups who do both design and handoff. Frustrated with Figma's pricing ($45/seat/month). Canvus is free or cheap.

**Key wedge:** AI-powered design work that Figma doesn't have yet. Canvus AI is the reason to switch, not just the reason to try.

**Distribution:** Launch on Product Hunt with a "try Canvus AI in the browser" live demo. No install. One prompt. Instant wow.

---

## Roadmap

| Phase | Milestone |
|-------|-----------|
| **Beta (now)** | 20 op types, canned prompts, diff preview, CLI |
| **v1.0** | Multi-turn conversation, selection-aware context, custom prompt library |
| **v1.5** | Component generation ("create a card component with variants"), design token extraction |
| **v2.0** | Real-time collab + AI: teammate can see AI suggestions live |
| **v3.0** | Code generation: AI ops → React + Tailwind components (via Canvus Code Connect) |

---

## Ask

We're looking for:
- **Design beta users** — 20 designers to use Canvus AI daily and give feedback
- **Angel / pre-seed investors** — $500K to hire one backend engineer and one design advocate
- **Integration partners** — design systems teams who want AI-assisted component governance

Contact: [founders@canvus.design]

---

*Canvus is a zero-dependency, browser-native design tool. No Electron. No install. Runs anywhere. Canvus AI runs on top of the same open model.*
