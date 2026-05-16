# Elusion Works — Design Specification

**Last updated:** 2026-05-02 (revised after Kol feedback)
**Stack:** Static HTML + vanilla CSS/JS, animated CSS custom properties (`@property`)
**Source of truth:** `styles.css` + `showcase-pages.css`

---

## 1. Visual Theme & Atmosphere

The master estate showcase. Elusion Works is the **business root** that highlights all the branches underneath: websites (Ghost in the Models, Axylusion, Kol Tregaskes Photography, AI Resource Hub, Kol's Korner), tools (StackScout), games (Games Hub), and the growing demos shelf.

**The directive (Kol, 2026-05-02):** This is one of his favourites. Don't change the fluid OKLCH atmosphere — that's the brand. But it's currently **too padded / not dense enough**, and it should feel **slightly more corporate** without becoming corporate-bland. The branches should be the body of the page. The demos section should be a featured shelf.

Tone words: alive, cinematic, sophisticated, slightly corporate, branch-led.

---

## 2. Colour Palette & Roles

### Surfaces
- `--bg` `#030305` — near-black base
- `--bg-soft` `#0c0c14` — mid-step
- `--panel` `rgba(10, 10, 15, 0.7)` — translucent shell
- `--panel-strong` `rgba(15, 15, 23, 0.85)` — solid panel

### Accents (dual — unique among Kol's sites)
- `--accent` `#ff3366` — magenta-red (primary signal)
- `--accent-secondary` `#ff9933` — burnt orange (secondary signal)
- `--success` `#34d399` — mint
- `--cool` `#60a5fa` — sky blue (used in showcase pages)

### Text
- `--text` `#ffffff` — primary
- `--muted` `#a1a1aa` — secondary
- `--soft` `#71717a` — tertiary / placeholder

### Lines
- `--line` `rgba(255, 255, 255, 0.08)` — hairline
- `--line-strong` `rgba(255, 255, 255, 0.15)` — emphasis

---

## 3. Typography Rules

| Role | Family | Notes |
|------|--------|-------|
| Display | **Outfit** | Headings, brand lockup |
| Body | **Inter** | Default text |
| Mono | **IBM Plex Mono** (Cascadia Code fallback) | Eyebrows, section indices, code |

- Eyebrow / section index: mono, uppercase, `0.14em` tracking, `0.68rem`
- Brand lockup: 50×50 mark + two-line copy stack
- Pill skip-link uses mono

---

## 4. Component Stylings — the branches kit

### Header
- Sticky pill, 999px radius, backdrop-blur 18px
- Tighter padding now: 0.85rem 1rem (was 1rem 1.25rem)
- Brand lockup left, nav right (Branches · Demos · About · Contact)

### Branch card (the new core component)
A branch is a sub-property (website, tool, game, demo). Each branch card:
- Aspect ratio 4:3, panel-strong fill, 1px line border
- Top: large hero image / pattern / live screenshot
- Bottom strip: mono eyebrow ("WEBSITE", "TOOL", "DEMO"), Outfit title, 1-line description in Inter, "Visit →" link
- Hover: line lifts to `--line-strong`, accent-magenta glow at 0.2 opacity
- Each branch card may carry its own micro-accent (Ghost = aurora gradient, Axylusion = amber, Photography = brass, etc.) but at 12% opacity max — never overpowers the parent palette

### Branches grid (the body of the homepage)
- Asymmetric bento, 8 cards visible above the second fold
- One feature card spans 2x2 — defaults to "Demos" since that's the active showcase
- Container queries for re-flow

### Demos shelf
- Distinct horizontal scroll-snap rail OR full-width section below the branches grid
- Each demo gets a card with title, screenshot, "Open demo →"
- Reference: `/demos/golden/` is the first showcase demo

### Shell pattern (kept — it's the brand)
`header-shell`, `hero-shell`, `section-shell`, `footer-shell`, `error-card` all share:
- `width: min(100%, var(--max))` (1320px)
- 1px line border
- Layered background: `linear-gradient(180deg, white 0.03, transparent 58%)` over translucent panel
- `--shadow-md` `0 20px 48px rgba(0,0,0,0.3)`

### Animated background (the signature — DO NOT REMOVE)
```css
@property --grad-x { syntax: "<percentage>"; initial-value: 10%; }
@property --grad-y { syntax: "<percentage>"; initial-value: 0%; }
@property --grad-x2 { syntax: "<percentage>"; initial-value: 90%; }
/* 15s ease-in-out infinite — the drift */
```
Two radial gradients (warm OKLCH + cool OKLCH) plus a vertical fade.

---

## 5. Layout Principles — branches as the body

**Above the fold (1080p desktop):**
1. ~64px sticky pill header
2. ~88px hero strip — small Outfit headline + 2-line proposition + CTA. **Smaller than before** — Kol said "tighter spacing".
3. **Branches grid begins here** — 4–6 branch cards visible

The branches are the body. The hero is just a label, not a marketing block.

### Page architecture
- **Homepage:** masthead → tight hero strip → branches bento → demos shelf → "what's coming" rail → footer
- **Branch detail (per sub-property):** uses showcase-pages.css for the longer story
- **Demos index:** `demos/index.html` — full-page demo gallery
- **Demo detail:** standalone (e.g. `demos/golden/`) — uses its own design

### Spacing (tightened)
- Section gap shrinks from 96px → 64px
- Branch card gap: 16px (was 24px)
- Inner card padding: 20px (was 28px)

This is what makes it feel "slightly corporate" — denser, more business-like, less ambient.

---

## 6. Depth & Elevation

- `--shadow-md` `0 20px 48px rgba(0,0,0,0.3)` — default shell
- `--shadow-lg` `0 30px 90px rgba(0,0,0,0.5)` — featured branch card
- `--shadow-glow` `0 0 40px rgba(255,51,102,0.2)` — magenta accent glow on focus / hover

Three layers: body (animated OKLCH gradient + 94px grid mesh) → shells (panel + line) → branch cards (panel-strong + line-strong).

---

## 7. Do's and Don'ts

**Do**
- Keep the OKLCH animated body gradient — it's the brand
- Keep the shell pattern for sections
- Use both accents (magenta + orange) where the page genuinely needs two signals (primary CTA = magenta, secondary "explore" CTA = orange)
- Use mono eyebrows for every section header
- Treat every sub-property as a branch — feature them as the page body
- Make Demos a visible feature, not an inner page hidden behind nav

**Don't**
- Pad the homepage. Tighter spacing throughout.
- Add a marketing hero block bigger than 88px
- Introduce a third accent
- Remove the body animation
- Drop the 1px hairline on shells
- Let any branch's micro-accent dominate (12% max opacity)

---

## 8. Responsive Behaviour

- **≥ 1280px:** full shell with horizontal padding, 4-column branch grid + 2x2 feature
- **1024–1280px:** 3-column branch grid, feature 2x2 still spans
- **768–1024px:** 2-column branch grid, feature reduces to 2x1
- **≤ 768px:** single-column branch list, demos shelf becomes a card list
- Body animation continues at all breakpoints
- Body grid mesh stays at 94px regardless

---

## 9. Agent Prompt Guide

> "Design for Elusion Works. BRANCHES-LED architecture — Elusion Works is a business showcase whose body IS its sub-properties (Ghost in the Models, Axylusion, Kol Tregaskes Photography, AI Resource Hub, Kol's Korner, StackScout, Games Hub, Demos). Sticky pill header → ~88px tight hero strip → branches bento (4-col with one 2x2 feature defaulting to Demos) → demos shelf → 'what's coming' rail → footer. Near-black `#030305` body with animated OKLCH radial gradients drifting on 15s loop. 94px grid mesh fading top-to-bottom. Outfit display, Inter body, IBM Plex Mono for eyebrows. Two accents allowed: `#ff3366` magenta (primary signal) + `#ff9933` orange (secondary). Shell pattern (1320px max-width, 1px line border, translucent panel, 20px Y shadow). Tighter spacing than typical — section gap 64px (not 96px), branch card gap 16px, inner padding 20px. Slightly corporate (dense, business-like) but never corporate-bland — keep the fluid OKLCH atmosphere."

---

## What's changing from the previous DESIGN.md

The previous spec described the atmosphere correctly but was too generous on spacing and didn't make the branches/demos the body of the page. This revision:
- **Tightens spacing** (section gap 96 → 64, card gap 24 → 16, inner padding 28 → 20)
- **Establishes branches as the homepage body** (asymmetric bento with one feature 2x2)
- **Promotes demos to a featured shelf** (was buried)
- **Shrinks the hero strip** (~88px label, not a marketing block)
- **Per-branch micro-accents** capped at 12% opacity so the parent palette stays dominant

The fluid OKLCH animated body, the shell pattern, the 94px grid mesh, the dual-accent system, and the typography all stay.

---

## Files

- `styles.css` — main system
- `showcase-pages.css` — sub-property showcase
- `cursor.js`, `app.js` — interaction
- `index.html`, `404.html`
- `experiments/`, `creative-radar/`, `claude-design/`, `remix-relay/`, `design-notes/` — internal labs
- `demos/index.html`, `demos/golden/` — public demos shelf
