# Design System Specification: gh-notifier

## 1. Overview & Creative North Star: "The Digital Lithograph"
This design system is a high-performance framework crafted for the modern developer. It moves away from the "web-app-in-a-box" aesthetic, leaning into a **"Digital Lithograph"** philosophy: where every pixel feels etched into the macOS interface with surgical precision. 

The goal is to eliminate visual noise. By leveraging the **Tauri-desktop** ethos, we prioritize edge-to-edge clarity, intentional negative space, and a layout that feels "carved" rather than "assembled." We break the traditional grid through **asymmetric information density**—where critical task data is given expansive room to breathe, while secondary metadata (GitHub tags, commit hashes) is treated with micro-scale typographic elegance.

---

## 2. Colors: Tonal Orchestration
Our palette is a restrained study in luminosity. The primary blue is not just a color; it is a "Surgical Strike" intended to draw the eye only to the most critical actions.

### The "No-Line" Rule
Traditional 1px borders are strictly prohibited for sectioning. Structural boundaries must be defined through **Background Color Shifts**. 
- Use `surface` (#f9f9fb) for the main application canvas.
- Use `surface_container_low` (#f3f3f5) for persistent sidebars.
- Use `surface_container_highest` (#e2e2e4) to denote active, hovered, or "lifted" interactive zones.

### Glass & Gradient Soul
To achieve a premium desktop feel, floating elements (Modals, Popovers) should utilize **Glassmorphism**.
- **Surface:** `surface_container_lowest` (#ffffff) at 80% opacity.
- **Effect:** 20px Backdrop Blur.
- **Accent:** Use a subtle linear gradient from `primary` (#0052d1) to `primary_container` (#156aff) for high-intent CTAs to provide a tactile, "pressable" depth.

---

## 3. Typography: The Hierarchy of Action
We utilize a high-contrast scale to separate "Doing" from "Referencing."

| Level | Token | Usage |
| :--- | :--- | :--- |
| **Display** | `display-md` | Empty states or major dashboard headers. |
| **Headline** | `headline-sm` | Task titles within an expanded view. |
| **Title** | `title-sm` | Standard task list headers. High-contrast (`on_surface`). |
| **Label** | `label-sm` | GitHub repository names and PR numbers. Use `on_surface_variant`. |

**Editorial Note:** Use `label-sm` for metadata with increased letter-spacing (0.05rem). This creates an authoritative, "spec-sheet" look that balances the larger `title-sm` task descriptions.

---

## 4. Elevation & Depth: Tonal Layering
Depth in this system is a result of light physics, not CSS defaults.

*   **The Layering Principle:** Avoid shadows for static elements. Instead, "nest" your surfaces. A `surface_container_lowest` card sitting on a `surface_container_low` background provides sufficient contrast without cluttering the render engine.
*   **Ambient Shadows:** For floating utility panels, use extra-diffused shadows:
    *   `box-shadow: 0 12px 40px rgba(26, 28, 29, 0.06);` (Using `on_surface` color at 6%).
*   **The Ghost Border:** For accessibility in dark mode or high-density lists, use a 1px border with `outline_variant` at **15% opacity**. It should be felt, not seen.

---

## 5. Components: Precision Primitives

### Tasks & Notifications
*   **Active State:** Use a 3px vertical "pill" of `primary` on the left edge. The background should shift to `surface_container_lowest`.
*   **Snoozed State:** Reduce opacity of the entire item to 60%. Replace the `primary` accent with `secondary_fixed_dim`. Use `surface_dim` for the background to "push" the task into the distance.
*   **Dense Lists:** Forbid the use of horizontal dividers. Separate GitHub notifications using `spacing.2` for internal grouping and `spacing.4` to separate unique repositories.

### Buttons
*   **Primary:** Background `primary`, text `on_primary`. Shape `rounded-md`.
*   **Secondary/Ghost:** No background. Text `primary`. On hover, apply `surface_container_high`.
*   **Tertiary (The "Danger" Action):** Use `tertiary` (#9e3d00) sparingly for destructive GitHub actions (e.g., "Close PR without merging").

### Inputs & Search
*   **Search Bar:** Use `surface_container_high` with a `full` roundedness scale. This mimics the native macOS Spotlight/Raycast feel. 
*   **Focus State:** Do not use a heavy glow. Use a 2px `primary` "Ghost Border" at 40% opacity.

---

## 6. Do’s and Don’ts

### Do
*   **DO** use `surface_tint` at low opacities to give neutral grays a slight blue temperature, making the app feel "tech-forward."
*   **DO** use `spacing.10` and `spacing.12` for page margins to create a high-end editorial "frame" around your data.
*   **DO** use `tertiary_container` for "Urgent/Breaking" build alerts—it provides a sophisticated warmth that is less jarring than standard red.

### Don’t
*   **DON'T** use `error` red for anything other than a terminal-level failure. Use `tertiary` for warnings to maintain the restrained palette.
*   **DON'T** use standard 1px `#ccc` borders. If you can't define a boundary with a color shift, rethink the layout hierarchy.
*   **DON'T** clutter the UI with icons. Use typography (e.g., `label-md`) to describe actions wherever possible to maintain the "Architect" aesthetic.

---

## 7. Motion & Interaction
To reflect the "Tauri" desktop feel, all transitions should use a **Cubic Bezier (0.2, 0.8, 0.2, 1)**. 
- **Surface Hover:** Subtle shift from `surface` to `surface_container_low` over 150ms.
- **Active Task Expansion:** "Spring" animation (stiffness: 300, damping: 30) to feel like a physical layer lifting off the screen.
