# Design System Strategy: YOLOStudio

## 1. Overview & Creative North Star
**Creative North Star: The Kinetic Laboratory**

This design system moves beyond the standard "SaaS Dark Mode" to create a high-precision, editorial environment for AI development. It treats the interface not as a collection of boxes, but as a calibrated instrument. By rejecting traditional structural lines (borders) and embracing **Tonal Layering**, we create a UI that feels carved out of a single obsidian block.

The experience is defined by **intentional asymmetry**—where technical logs in `JetBrains Mono` offset the clean, Swiss-style `Inter` UI—and a rigorous commitment to whitespace that allows complex neural network data to breathe. We are not just building a tool; we are building a high-performance cockpit for machine learning.

---

## 2. Colors & Surface Architecture
The palette is a sophisticated range of "near-blacks" designed to reduce eye strain during long training sessions while maintaining elite contrast.

### The "No-Line" Rule
**Borders are a design failure.** To achieve a premium, seamless feel, designers are prohibited from using 1px solid strokes to define sections. Instead, boundaries are created through:
- **Background Shifts:** Placing a `surface-container-high` (#2A2A2A) element against the `background` (#131313).
- **Negative Space:** Using the Spacing Scale (specifically `8` and `12` tokens) to create natural psychological groupings.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of materials. 
1.  **Base Layer:** `surface-dim` (#131313) for the main application canvas.
2.  **Navigation/Sidebar:** `surface-container-low` (#1C1B1B) to provide a subtle anchor.
3.  **Active Workspace Cards:** `surface-container-high` (#2A2A2A) to bring focus to the training data.
4.  **Floating Modals/Command Palettes:** `surface-container-highest` (#353534) for maximum prominence.

### The Glass & Texture Exception
While the UI is "flat," main CTAs (like "Start Training") should utilize a subtle vertical shift from `primary` (#ADC6FF) to `primary-container` (#4D8EFF). This 2% shift provides a "soul" to the button that a flat hex code cannot achieve, mimicking the look of a premium physical toggle.

---

## 3. Typography
The typographic system creates a dialogue between human-readable UI and machine-readable data.

- **Display & Headlines (`Inter`):** Used for high-level status (e.g., "Model Epoch 42"). High tracking (letter-spacing: -0.02em) on `headline-lg` creates a condensed, authoritative look.
- **Body & Labels (`Inter`):** The workhorse. `body-md` is the default for all interface interactions.
- **Technical Values (`JetBrains Mono`):** All AI metrics (Loss, mAP, IOU), file paths, and logs must use this mono-spaced font. It signals to the user that they are looking at "raw" data.

**Editorial Hierarchy:** Use `label-sm` in all-caps with 0.1rem letter-spacing for category headers to create an architectural, "blueprinted" aesthetic.

---

## 4. Elevation & Depth
Depth is achieved through **Tonal Layering** rather than structural shadows.

- **The Layering Principle:** To lift a card, do not add a shadow. Instead, move it one step up the surface scale (e.g., from `surface-container` to `surface-container-high`).
- **Ambient Shadows:** Only permitted for floating overlays (Command Palettes). Use a 32px blur, 0px offset, at 8% opacity using the `on-surface` color to mimic natural light dispersion.
- **The "Ghost Border" Fallback:** If a technical visualization requires a container boundary, use `outline-variant` (#424754) at **15% opacity**. It should be felt, not seen.
- **Backdrop Blurs:** Use `surface-container-lowest` with a 12px blur for the sidebar or top navigation blur-overs to maintain context of the underlying "data stream" during scrolls.

---

## 5. Components

### Buttons
- **Primary:** `primary` (#ADC6FF) background, `on-primary` (#002E6A) text. 6px radius. No border.
- **Secondary:** `surface-container-highest` (#353534) background. Provides a "tactile matte" feel.
- **Tertiary:** Transparent background, `primary` text. Use for low-emphasis actions like "Cancel."

### Input Fields
- **Default State:** `surface-container-highest` background, 6px radius. No border.
- **Focus State:** Background remains the same, but a 1px "Ghost Border" of `primary` at 40% opacity appears.
- **Monospace Inputs:** Parameters (e.g., Learning Rate: 0.001) must use `JetBrains Mono` for the value text.

### Progress & Status
- **Training Bars:** Use `primary` (#ADC6FF) for the fill. The track should be `surface-container-lowest` (#0E0E0E) to create a "carved out" effect in the UI.
- **Status Chips:** Small, 2px radius. Use `tertiary` (#FFB786) for "Processing" and `primary` for "Complete."

### Navigation Sidebar (220px)
- Fixed width. Background: `surface-container-low` (#1C1B1B).
- **Active State:** A subtle vertical pill (4px wide) of `primary` on the left edge, with the menu item text shifting to `on-surface`.

---

## 6. Do's and Don'ts

### Do
- **Do** use `JetBrains Mono` for any value that an AI model would output.
- **Do** use `spacing-12` (4rem) to separate major sections like "Data Preview" and "Hyperparameters."
- **Do** use `surface-container` shifts to highlight "hover" states on list items rather than underlines.

### Don't
- **Don't** use 1px solid white or grey borders to separate columns. Use the `surface` color steps.
- **Don't** use standard "Drop Shadows" (Offset-Y: 4px, etc.). They break the Kinetic Lab aesthetic.
- **Don't** use icons with fills. Use `Lucide` line icons at 1.5px stroke weight to match the wireframe-thin precision of the typography.
- **Don't** use dividers in lists. Use 1.4rem (`spacing-4`) of vertical padding between items to create separation.