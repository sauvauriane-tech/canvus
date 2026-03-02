# Canvus AI — UX Copy

All text strings for the AI side-panel, dialogs, and notifications.
Tone: direct, confident, minimal. No filler words. Match Canvus's existing dark-theme style.

---

## Panel header

```
AI Assistant
```
(No tagline. Panel title only.)

---

## Prompt input

**Placeholder text** (rotates every 5s):
- `Align the buttons evenly…`
- `Add a drop shadow to selected…`
- `Rename layers semantically…`
- `Make this a dark theme…`
- `Wire screens into a prototype…`

**Submit button label:** `Generate`
**Submit button loading state:** `Generating…`
**Keyboard shortcut hint (below input):** `⌘↵ to generate`

---

## Canned prompt chips

Display as horizontally-scrolling pill chips above the textarea.
Grouped by category with a thin separator.

**Category labels:**
- `Layout`
- `Naming`
- `Style`
- `Prototype`
- `Accessibility`

---

## Diff preview state

Shown after generation, before the user confirms or cancels.

**Header:** `N change${N !== 1 ? 's' : ''} proposed`

**Apply button:** `Apply`
**Cancel button:** `Discard`

**Confirmation toast (after Apply):** `Applied N changes`
**Cancel toast:** `Discarded`

**Undo hint (shown for 4s after apply):** `Undo with ⌘Z`

---

## Diff entry formats

Each proposed change appears as one line in the preview list.

| Op type | Format |
|---------|--------|
| create  | `+ Create <type> "<name>"` |
| delete  | `− Delete "<name>"` |
| rename  | `↳ Rename "<old>" → "<new>"` |
| move    | `→ Move "<name>" +Xpx, +Ypx` |
| resize  | `↔ Resize "<name>" W×H` |
| fill    | `◉ Fill "<name>" #hex` |
| effect  | `✦ Effect on "<name>": <type>` |
| align   | `⊞ Align [N elements] <direction>` |
| group   | `⊡ Group [N elements] → "<name>"` |
| proto   | `→ Connect "<from>" → "<to>"` |

**Reason text** (shown below each entry, dimmed):
`<reason text from AI>`

---

## Empty states

**Panel opened, no prompt yet:**
```
Describe a change to your design
and Canvus AI will propose it as editable ops.

Select elements to scope the request.
```

**No selection, prompt requires selection:**
```
Select one or more elements first.
```

**Backend returned no ops:**
```
No changes suggested.

Try rephrasing your prompt or being more specific.
```

---

## Error states

| Error | Message |
|-------|---------|
| Network / timeout | `Couldn't reach AI backend. Check your connection.` |
| Backend error 500 | `Something went wrong on the server. Try again.` |
| No API key set | `MISTRAL_API_KEY is not configured. See README.` |
| All ops invalid | `The AI returned changes that couldn't be applied. Try a different prompt.` |
| Partial validation | `N of M changes were valid and will be applied. <N errors details below>` |
| Rate limited | `Too many requests. Wait a moment and try again.` |

---

## Notifications (toast)

Shown in the bottom-center notification bar (existing `.notif` system).

```
Applied 5 changes  ·  Undo ⌘Z
Discarded AI suggestions
AI: nothing to change
AI backend unreachable
```

---

## Settings panel row (future)

Under Settings > Integrations:

```
Canvus AI
Connect to an AI backend to get design suggestions.

Backend URL  [http://localhost:3333       ]
             ⓘ Set CANVUS_AI_URL or enter a custom URL

[ Test connection ]   Status: ● Connected
```

---

## Onboarding tooltip (first open)

Shown once, dismissed on first use:

```
✦ Canvus AI is in beta.
Changes are fully undoable with ⌘Z.
Review the diff before applying.
```

---

## Keyboard shortcut hint in toolbar

Tooltip on the AI panel toggle button:
```
AI Assistant  ⌘K
```

---

## Accessibility labels (aria-label)

```html
<button aria-label="Open AI Assistant">AI</button>
<textarea aria-label="Describe a design change"></textarea>
<button aria-label="Generate AI suggestions">Generate</button>
<button aria-label="Apply proposed changes">Apply</button>
<button aria-label="Discard proposed changes">Discard</button>
<ul aria-label="Proposed changes">
  <li aria-label="Change 1 of 5: Rename Frame 3 to Hero Frame"></li>
</ul>
```
