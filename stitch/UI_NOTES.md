# Nab UI Notes
> Things to keep in mind when implementing from the Stitch mock.

---

## What to Follow From the Mock

- Dark theme `#0F0F0F` base — keep it
- Left sidebar navigation only (Projects, Annotate, Train, Inference, Export)
- Annotate screen layout — canvas center, image list left, classes + annotations right
- Train screen layout — config top, loss chart center, terminal log below, mAP panel right
- Inference screen — exactly as mocked, no changes needed
- New Project modal — pill tag input for classes, clean and minimal
- Class color dots in sidebar (consistent per class index, not random)
- WebGPU/CPU badge on Inference screen bottom bar

---

## Fix These — Don't Copy From Mock

### Dashboard
- **Remove bottom stats bar** (GPU UTIL / ACTIVE SERVERS / LATENCY) — not relevant for a desktop app
- **Remove top nav from Dashboard** — use left sidebar only, consistent with all other screens
- **"KINETIC LABORATORY"** sub-brand under logo — remove, replace with just "Nab"
- Replace generic placeholder copy everywhere

### Export Screen
- Headline and subtitle copy is placeholder — rewrite with real simple copy
- e.g. "Export Your Model" / "Choose a format for your use case"

---

## Colors — Adjust From Mock

| Element | Use This |
|---|---|
| Background | `#0F0F0F` |
| Surface / cards | `#1A1A1A` |
| Borders | `#2E2E2E` |
| Primary text | `#FFFFFF` |
| Secondary text | `#888888` |
| Accent (buttons, active) | `#3B82F6` — pure, don't desaturate |
| Success / Trained badge | `#22C55E` green |
| Warning / Annotating badge | `#EAB308` yellow |
| Info / Ready badge | `#3B82F6` blue |

### Class Colors (fixed per index, don't randomize)
```
0 → #3B82F6  blue
1 → #22C55E  green
2 → #EF4444  red
3 → #F97316  orange
4 → #A855F7  purple
5 → #14B8A6  teal
6 → #F59E0B  amber
7 → #EC4899  pink
```

---

## Navigation — Single Rule

**Left sidebar only.** No top nav bar. Active screen highlighted in sidebar.

```
[ Nab ]
─────────────
  Projects       ← default landing
  Annotate
  Train
  Inference
  Export
─────────────
  + New Project
─────────────
  Documentation
  Support
```

---

## Typography

| Use case | Font | Size |
|---|---|---|
| UI labels, body | Inter | 13-14px |
| Numbers, logs, coordinates, loss values | JetBrains Mono | 12-13px |
| Screen titles | Inter semibold | 18-20px |

---

## Theming — CSS Variables Rule

**Never hardcode a color hex anywhere in a component.** All colors must go through CSS variables so light/dark theme is a single attribute swap.

```css
:root[data-theme="dark"] {
  --bg:         #0F0F0F;
  --surface:    #1A1A1A;
  --border:     #2E2E2E;
  --text:       #FFFFFF;
  --text-muted: #888888;
  --accent:     #3B82F6;
}

:root[data-theme="light"] {
  --bg:         #F5F5F5;
  --surface:    #FFFFFF;
  --border:     #E0E0E0;
  --text:       #111111;
  --text-muted: #666666;
  --accent:     #3B82F6;
}
```

```ts
// Toggle theme — one line
document.documentElement.setAttribute("data-theme", "light")
```

**Gotchas to watch:**
- Annotation canvas background → must use `var(--bg)`, not hardcoded
- Loss chart colors → set via JS using `getComputedStyle` to read variables, not hardcoded hex
- Class color palette stays the same in both themes (they're vivid enough for both)

---

## What the Mock Nailed — Don't Change

- Annotate screen: canvas focus, minimal toolbar, commit button top right
- Bounding box style: thin border + class label pill on top left of box
- Train screen: loss chart lines (box loss solid, cls loss dashed)
- Inference detected objects list with confidence scores on the right
- Confidence threshold slider
- Export format rows with file size badge + Export button per row
- ONNX row showing "Ready / Open Folder" state after export
