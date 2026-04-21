# Handoff: Focus App — Dashboard & Project Detail

## Overview

Focus is a macOS desktop app (Electron + React + SQLite) for solo developers managing personal projects with GitHub integration. This handoff covers two primary screens: **Dashboard** and **Project Detail**, both using the selected "Option B" layout direction.

## About the Design Files

The files in this bundle are **design references created in HTML** — they are prototypes showing intended look, layout, and behavior. They are **not production code to copy directly**.

Your task is to **recreate these designs in the Electron + React codebase**, using its established component patterns and any existing UI libraries. The HTML files are browser-based approximations of a native macOS UI; the real implementation should feel native (use system fonts, native scroll behavior, etc. where appropriate).

Open the HTML files in a browser to inspect them interactively. The design canvas lets you pan/zoom; click any artboard label to focus it fullscreen.

- **`Focus Hi-Fi.html`** — High-fidelity screens. Pixel-close colors, typography, spacing. Implement these as closely as possible.
- **`Focus Wireframes.html`** — Lo-fi wireframes showing the three layout explorations considered. Included for context; hi-fi is the target.

## Fidelity

**High-fidelity.** The hi-fi screens represent the intended final design. Recreate colors, typography, spacing, and component structure as closely as the Electron/React environment allows. Where native macOS conventions conflict (e.g. window chrome, traffic lights), defer to the native behavior.

---

## Screens

### 1. Dashboard

**Purpose:** Shows all active projects at a glance. Answers "what am I working on and what do I do next?"

**Layout:**
- Two-pane: fixed sidebar (220px) + fluid main area
- Main area: toolbar (52px) + scrollable content

**Sidebar (220px wide):**
- Background: `oklch(93.5% 0.018 75)` / approx `#EDE8E0`
- Right border: `1px solid oklch(87% 0.020 75)` / approx `#D8D1C5`
- Traffic lights row: 52px tall, 18px left padding
- Section header "PROJECTS": `11px`, `600` weight, `0.06em` letter-spacing, muted color `oklch(62% 0.008 75)` / approx `#9B9590`
- Project rows: `14px`, `500` weight when unread, 7px border-radius selection highlight
- Selected state: `oklch(32% 0.09 255)` / approx `#1E3A6E` background, white text
- Unread badge: `oklch(61% 0.21 35)` / approx `#D4521D`, white text, `11px 600`, pill shape
- Snoozed section pinned to bottom, separated by top border

**Main area — toolbar (52px):**
- Background: same as main bg `oklch(98.5% 0.008 75)` / approx `#FDFCF9`
- Bottom border: `1px solid oklch(91% 0.012 75)` / approx `#E9E4DC`
- Title: `15px 600`
- "New project" button: right-aligned, `oklch(53% 0.185 255)` / approx `#3060D8` background, white text, `6px` border-radius

**Main area — Focus Banner:**
- Full-width card, `10px` border-radius, `14px 20px` padding
- Background: `oklch(28% 0.09 255)` / approx `#1A2E5C` with radial gradient overlay: `radial-gradient(ellipse at 10% 30%, oklch(35% 0.09 255), transparent 60%)`
- Label row: `10px 700`, `0.1em` letter-spacing, `rgba(255,255,255,0.35)`, play-arrow SVG icon inline
- Label text: `FOCUS NOW · [PROJECT NAME]` (project name uppercased)
- Action text: `20px 700`, white, `-0.01em` letter-spacing, `1.25` line-height

**Main area — Project rows (below banner):**
- Each row: `flex`, `11px 0` padding, `8px` border-radius
- Focused/active row: `oklch(96.5% 0.012 255)` background + `1px solid oklch(90% 0.025 255)` border
- Project name: `15px`, `600` if unread else `400`, `var(--text)`
- Next action text: `13px`, muted `oklch(62% 0.008 75)`, truncated with ellipsis
- Chevron icon: muted, right-aligned

**Main area — Snoozed footer:**
- Top border separator
- `13px` muted text + emoji
- "Show" link in blue, right-aligned

---

### 2. Project Detail

**Purpose:** Deep view of a single project. Shows next action prominently, quick-access links, and tabbed secondary content.

**Layout:**
- Same two-pane sidebar + main
- Main: toolbar + scrollable content column

**Toolbar:**
- Breadcrumb: "Projects /" in muted `13px`, then project name in `15px 600`
- Right actions: "Snooze" + "···" buttons (outlined, muted)

**Next Action Banner (always visible):**
- Same visual as dashboard Focus Banner but full-width, `16px 22px` padding, larger action text (`22px 700`)
- Additional action row below text: "Edit · Mark done · Remind me" in `12px`, `rgba(255,255,255,0.45)`, `cursor: pointer`

**Links Strip (always visible, below banner):**
- `10px 14px` padding, `8px` border-radius
- Background: `oklch(93.5% 0.018 75)` (same as sidebar), `1px solid oklch(91% 0.012 75)` border
- "LINKS" label: `10px 700`, `0.08em` letter-spacing, muted
- Link pills: `13px 500`, `oklch(53% 0.185 255)` blue, `rgba(82,130,255,0.07)` background, `4px` border-radius, `2px 8px` padding
- "+ Add" ghost button in muted text

**Tabs (Todos / Notes / Notifications):**
- `14px`, active: `600` weight + `2px solid oklch(28% 0.09 255)` bottom border
- Inactive: muted `oklch(62% 0.008 75)`
- Notification tab has inline badge

**Todos tab:**
- Each row: `flex`, `9px 12px` padding, `7px` border-radius
- Checkbox: `16px` circle — unchecked: `1.5px solid oklch(86% 0.014 75)` border; checked: `oklch(58% 0.18 145)` green fill + white checkmark SVG
- Task text: `15px`, checked tasks: line-through + muted color
- "+ Add task" ghost row below

**Notes tab:**
- Bordered textarea-like area, linen background, freeform text

**Notifications tab:**
- Group header: repo name + full-width hairline divider, `11px 600 0.06em`
- Each notification row: unread dot (orange) / read dot (muted gray) + title + meta row
- Title: `14px`, `500` if unread
- Meta: repo name + type chip
- Type chips: PR = blue tint, Issue = orange tint, Release = green tint, all `11px 600`, `4px` border-radius
- "Unsubscribe" right-aligned, `12px` muted, tappable

---

## Design Tokens

```
/* Backgrounds */
--bg:              oklch(98.5% 0.008 75)   /* main area */
--bg-2:            oklch(97% 0.010 75)     /* subtle inset */
--sidebar:         oklch(93.5% 0.018 75)   /* sidebar + links strip */

/* Borders */
--border:          oklch(91% 0.012 75)
--border-2:        oklch(86% 0.014 75)     /* stronger dividers, checkbox */
--sidebar-border:  oklch(87% 0.020 75)

/* Text */
--text:            oklch(16% 0.010 75)     /* primary */
--text-2:          oklch(40% 0.010 75)     /* secondary */
--text-3:          oklch(62% 0.008 75)     /* muted / labels */

/* Accents */
--blue:            oklch(53% 0.185 255)    /* buttons, links, tab indicator */
--blue-dark:       oklch(28% 0.09 255)     /* next action banner bg */
--blue-mid:        oklch(40% 0.12 255)     /* PR type chip text */
--orange:          oklch(61% 0.21 35)      /* unread badges + dots */
--green:           oklch(58% 0.18 145)     /* checked checkbox, release chip */

/* Typography */
--font:            'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif
/* On macOS, -apple-system resolves to SF Pro which is ideal */
```

---

## Interactions & Behavior

| Element | Behavior |
|---|---|
| Project row (dashboard) | Click → navigate to Project Detail |
| Focus banner (dashboard) | Click action text → navigate to that project's detail |
| Next action text (detail) | Click → inline edit mode |
| "Mark done" | Clears next action; prompts to pull next todo up |
| Checkbox | Toggle done/undone; done tasks move to bottom with animation |
| Tab | Switch tab; remember last active tab per project (localStorage) |
| Link pill | Open URL in system browser (shell.openExternal) |
| "+ Add" (links) | Inline form: label + URL |
| "+ Add task" | Append input at bottom of todo list |
| Unread badge | Cleared when user views Notifications tab |
| "Unsubscribe" | Calls GitHub API; removes thread from list |
| Snooze button | Opens snooze picker modal (not yet designed) |
| Sidebar project click | Navigate to Project Detail |

**Animations:**
- Tab switch: content fades in, `150ms ease-out`
- Checkbox check: circle fills with `120ms` scale + fill transition
- New task appears: slides in from below, `180ms ease-out`

---

## State Management Notes

- **Active project** — which project is selected in sidebar
- **Active tab** per project — persisted in localStorage keyed by project ID
- **Todo items** — ordered array; checked items rendered last
- **Next action** — single string field on the project; editable inline
- **Links** — ordered array of `{label, url}` pairs

---

## Assets

No image assets. All iconography is inline SVG. Icons used:
- Traffic lights: three colored circles (red `#FF6159`, yellow `#FFBD2E`, green `#28C840`)
- Play arrow (next action label): simple filled triangle
- Chevron right (project row): thin stroke path
- Checkmark (completed todo): `M1 3l2 2 4-4` path, white on green circle
- Inbox icon: rectangle + tray-in path

---

## Files in this Package

| File | Purpose |
|---|---|
| `Focus Hi-Fi.html` | **Primary reference.** Open in browser. Both screens on an interactive canvas. |
| `Focus Wireframes.html` | Lo-fi wireframes showing all three layout options considered. Background context only. |
| `design-canvas.jsx` | Support file for the canvas; not relevant to implementation. |
| `macos-window.jsx` | Support file for window chrome; not relevant to implementation. |
