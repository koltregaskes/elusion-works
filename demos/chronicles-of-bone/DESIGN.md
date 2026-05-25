---
version: alpha
name: Chronicles of Bone
description: Single-page horizontally-scrolling cinematic showcase for a fictional feature film, doubling as a quiet portrait of the modern director's toolkit.

colors:
  bg: "#020204"
  bg-1: "#07060a"
  bg-2: "#0d0a0e"
  copper: "#d7a16f"
  copper-deep: "#a67149"
  amber: "#f5c79a"
  ember: "#ff8a3a"
  ink: "#f1e7dc"
  ink-dim: "#9a8f80"
  ink-faint: "#54483c"
  ink-ghost: "#26201a"
  pill-live: "#8fd0a6"
  pill-in-build: "#d7a16f"
  glass-bg: "#0a080d"
  glass-bg-strong: "#13101a"
  glass-border: "#d7a16f"
  glass-border-soft: "#d7a16f"

typography:
  display:
    fontFamily: Cinzel
    fontWeight: 500
  display-xl:
    fontFamily: Cinzel
    fontSize: 3.5rem
    fontWeight: 600
    lineHeight: 1.0
    letterSpacing: -0.02em
  body:
    fontFamily: Outfit
    fontSize: 1rem
    fontWeight: 300
    lineHeight: 1.5
  body-emphasis:
    fontFamily: Outfit
    fontSize: 1rem
    fontWeight: 500
  mono:
    fontFamily: IBM Plex Mono
    fontWeight: 400
  mono-eyebrow:
    fontFamily: IBM Plex Mono
    fontSize: 0.72rem
    fontWeight: 500
    letterSpacing: 0.14em
  mono-meta:
    fontFamily: IBM Plex Mono
    fontSize: 0.62rem
    fontWeight: 400
    letterSpacing: 0.18em
  mono-numeral:
    fontFamily: Cinzel
    fontSize: 0.9rem
    fontWeight: 600

rounded:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 30px
  hero: 40px
  pill: 999px

spacing:
  rail: 92px
  act-pad-y-top: 48px
  act-pad-y-bottom: 100px
  act-pad-x-min: 48px
  act-pad-x-max: 120px
  stage-min-w: 1280px
  stage-min-h: 720px

components:
  act:
    backgroundColor: "{colors.bg}"
    padding: "{spacing.act-pad-y-top} {spacing.act-pad-x-max} {spacing.act-pad-y-bottom}"
  pin:
    backgroundColor: "{colors.copper}"
    rounded: "{rounded.pill}"
    size: 24px
  pill-live:
    backgroundColor: "{colors.pill-live}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    typography: "{typography.mono-meta}"
  pill-in-build:
    backgroundColor: "{colors.pill-in-build}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    typography: "{typography.mono-meta}"
  rail-button:
    textColor: "{colors.ink-faint}"
    typography: "{typography.mono-eyebrow}"
  magnetic-button:
    backgroundColor: "{colors.copper}"
    textColor: "{colors.bg}"
    rounded: "{rounded.pill}"
    padding: 0.9rem 1.5rem
    typography: "{typography.mono-eyebrow}"
  terminal:
    backgroundColor: "{colors.glass-bg-strong}"
    textColor: "{colors.amber}"
    rounded: "{rounded.md}"
    typography: "{typography.mono}"
---

## Overview

Chronicles of Bone is a 1280×720-bound horizontal film-strip — five "acts"
laid side-by-side at 100vw each, navigable by mouse wheel, ←/→/↑/↓, Space,
PageUp/PageDown, digit keys 1–5, side-rail clicks, edge arrows, bottom
progress ticks, and touch swipe. It tells the visual story of a fictional
post-collapse feature film and, in passing, names the 2026 production tools
a single director would use to make it.

**Audience:** film-curious technologists, production peers, prospective
collaborators. They appreciate craft and they recognise the tool names on
Act IV.

**Tone:** late-90s Criterion / A24 press kit, with the chrome of a colour
suite. Confident, restrained, slightly mythic. Never "demo-ware."

**Origin:** Claude Design handoff bundle (`Chronicles of Bone-handoff.zip`,
dated 2026-05-25). Full original spec preserved at
`W:\Websites\claude-designs\extracted\chronicles-of-bone\`.

**Build status:** placed and verified. Five acts render, side rail and
keyboard nav work, 4 pins / 10 plates / 6 reel rows / 5 image-slots / 20
bench ticker items all present. Title/meta, logline, Bone decision, and
Gemini Omni plate split are shipped. Five image-slots still require real
production assets. An empty `image-slots.state.json` sidecar ships with the
demo so the empty slot prompts render without a fetch 404 on GitHub Pages.

## Colors

A tight, restrained palette. No more than one accent on screen at a time.

- **Charcoal base** (`bg`, `bg-1`, `bg-2`) — near-black. Dark only; no
  light mode is supported.
- **Copper** (`copper` `#d7a16f`) — the single brand accent. Used only for
  section indices (`01`/`02`/`03`), CTA arrows, the primary button, tiny
  status pills, and soft radial glows behind hero shells. Pair with
  `copper-deep` for the filled lower edge of plates and `amber` for
  highlights / magnetic hover / hero stat numbers. `ember` is reserved.
- **Ink** (`ink` `#f1e7dc`) — primary text. The `ink-dim`/`-faint`/`-ghost`
  tokens are derived: `ink` rendered at 62% / 32% / 14% over the base
  background. Use those for hierarchy rather than introducing new greys.

**Strict rule:** do not introduce new colors. If a new variant is needed
add it to the YAML token list — never hardcode hex in components.

## Typography

Three families, sharply separated by role. Loaded from Google Fonts and
pre-connected in `index.html`.

- **Cinzel** — display. Headlines, section indices, numerals. The
  brand-specific decision is that `Cinzel` (not Outfit) is the display
  face here; the broader Elusion Works brand uses Outfit for display.
  This demo's Criterion-press-kit register requires the serif chisel of
  Cinzel.
- **Outfit** — body. Light (300) for body copy, 500 for emphasis.
- **IBM Plex Mono** — labels, eyebrows, side-rail Roman numerals, status
  pills, meta. Always uppercase; tight (0.62rem / 0.72rem) with wide
  tracking (0.14–0.18em).

H1 sits at `clamp(2.5rem, 5.5vw, 3.5rem)` weight 500 / letter-spacing
`-0.02em`. Body is calm. The contrast between large display type and
tiny mono labels is the typographic signature.

## Layout

A **fixed-size stage** holds all five acts. Built around three
primitives:

- `.stage` — fixed window, `overflow: hidden`.
- `.strip` — horizontal flex container holding every `.act`. Translated
  by `transform: translateX(-Npx)` where `N = idx * window.innerWidth`.
  **Recomputed on every resize via a listener in `app.jsx`** — do not
  "simplify" back to `translateX(-${idx*100}vw)`, which breaks in some
  sandboxed iframes.
- `.act` — `width: 100vw; height: 100vh`. Vertical flex: head → body →
  footer. The body uses `flex: 1; min-height: 0` so child frames can
  constrain to height.

**Hard constraint:** every act must fit `1280×720` with zero content
overflow. The frame primitive (`.frame`) uses `aspect-ratio: 21/9`,
`height: 100%; width: auto; max-width: 100%` — the single most fragile
rule in the project. Do not change `width: 100%` without alternative
height constraint.

**Background system** is intentionally layered:

1. **Page** — three-stop vertical gradient (`bg → bg-2 → bg`) with two
   offset radial glows (warm copper top-left, cool steel top-right) that
   drift on a 15s loop via `@property` custom properties.
2. **Grid overlay** — fixed `94px × 94px` grid at 2% opacity, masked to
   fade out 84% down the page. Technical texture without noise.
3. **Ambient particles** — 0.7px dots every 5px at 4% opacity, drifting
   8px vertically over 20s.
4. **Shells** — each container (header, hero, section, card, footer)
   carries a subtle top-lit linear gradient on its panel colour.

## Elevation & Depth

Three shadow tiers plus one glow:

- **sm** — `0 8px 16px rgba(0,0,0,0.22)` — pills.
- **md** — `0 20px 48px rgba(0,0,0,0.30)` — section shells.
- **lg** — `0 30px 90px rgba(0,0,0,0.50)` — hero shell.
- **glow** — `0 0 40px rgba(215,161,111,0.22)` — copper hover only.

No inner shadows. No neumorphism. Borders are 1px `ink` at 8% or 15%
opacity — never solid white.

The header uses `backdrop-filter: blur(18px)` over a low-alpha dark
panel. Blur is not used decoratively anywhere else.

## Shapes

Corner radius scales by surface importance:

| Token | Px | Used for |
|---|---|---|
| `rounded.xs` | 4 | Tiny toggles |
| `rounded.sm` | 8 | Form fields, inner media |
| `rounded.md` | 16 | Terminal, inner cards |
| `rounded.lg` | 24 | Section shells, feature cards |
| `rounded.xl` | 30 | Showcase cards |
| `rounded.hero` | 40 | Hero shell |
| `rounded.pill` | 999 | Header, buttons, status chips, side-rail items |

## Components

### `<ActHero />` (Act I — Opening Title)

Logline, big title, ticker, runtime stats. `<image-slot id="hero-bg">`
holds an edge-masked backdrop at 18% opacity. Three runtime stats are
hard-coded in JSX — change the JSX, there is no data prop.

### `<ActDeconstruct />` (Act II — Anatomy of a Shot)

A single frame (SCN 04 — Colossus Rising) decomposed into four craft
decisions via numbered hotspots. Source of truth: the `BLADES` array
(4 entries, each `{ id, x, y, cat, title, desc, note, params }`). Pins
use absolute positioning at `left: x%; top: y%` inside the frame. The
terminal types `blade.note` character-by-character via `useTypewriter`.
`<image-slot id="act2-still">` is the drop-zone for the real frame.

### `<ActUpscale />` (Act III — Before / After)

A 21:9 frame with two layered halves; the right half clipped via
`clip-path: inset(0 0 0 var(--split))`. `split` is a 0–100 percentage
in component state; pointer drag updates it. Two image-slots
(`act3-before`, `act3-after`) — both clip with the same rule.

### `<ActStack variant />` (Act IV — Director's Toolkit)

Ten hero tools as periodic-table plates with parallax tilt; ten more
tools scroll below in a seamless ticker. Sources: `STACK_PLATES` (10
entries), `STACK_TICKER` (10 strings). Total plate cell-spans must stay
≤ 18. Current periodic plate spans total 17 cells. Bench ticker renders `[...STACK_TICKER, ...STACK_TICKER]` for the
loop; animation: `tickerScroll 60s linear infinite`. **Plate tilt is
computed inline in `onPointerMove`** — do not extract to CSS, it must
react to live pointer position.

Variant prop (`'periodic' | 'bento' | 'drawers'`) comes from Tweaks.

### `<ActCut />` (Act V — Director's Cut)

Director's statement quote, chapter manifest (6 reels), CTAs. The
`<image-slot id="director-avatar" shape="circle">` clips itself round —
do not wrap in another `border-radius` div.

### Shared atoms (`shell.jsx`)

- `<CursorRing />` — copper ring + dot trailing the pointer. Single
  instance only. `requestAnimationFrame` with lerp 0.55. Body class
  `.no-cursor` disables it. Hidden on `@media (hover: none)`.
- `<SideRail activeIndex onJump muted onToggleMute />` — five Roman
  numeral buttons + brand mark + ambient toggle. The `ACTS` array on
  `window.ACTS` is the source of truth for labels.
- `<TopBar activeNumeral activeLabel total />` — top-right meta strip.
- `<Ticker />` — Act I bottom. Reads `TICKER` constant. Renders three
  times in a row for the seamless loop. `tickerScroll 48s linear`.
- `<MagneticButton />` — pill-shaped CTA that drifts toward the pointer
  on hover. Animated `--bmx / --bmy` for the radial glow.

### `<image-slot id="…">` (custom element, `image-slot.js`)

User-fillable image placeholders. Render their own "drop here" prompt
when empty and persist dropped images to `localStorage` keyed by `id`.
**Each slot must have a unique `id`** — duplicates share storage.

### `<TweaksPanel />` (`tweaks-panel.jsx`)

Toggle cursor / noise / motion / density / cabinet variant. Defaults
defined inline:

```js
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "cursor": true, "noise": true, "motion": true,
  "density": "default", "stackVariant": "periodic"
}/*EDITMODE-END*/;
```

The block must stay valid JSON; the design-time editor rewrites it on
persisted edits. Tweaks wire to body classes (`.no-cursor`, `.no-noise`,
`.no-motion`, `.density-compact`, `.density-spacious`).

## Do's and Don'ts

- ✅ Use the tokens above. Add new ones to YAML if you need them.
- ✅ Respect `prefers-reduced-motion` — disables cursor, spotlight,
  drift, particles, and entry animations.
- ✅ Run at 1280×720 first; mentally walk all five acts before
  declaring done.
- ✅ Keep the strip transform formula (`idx * window.innerWidth`) as
  live-pixel — the resize listener depends on it.
- ❌ **Do not call this page or the film "AI-made"** in user-facing
  copy. The film is *made*. Tools are listed on Act IV — the viewer
  knows what they are. The shipped `<title>` now uses the compliant
  "Chronicles of Bone — A Cinematic Showcase" framing.
- ❌ No emoji. None appear anywhere in the live brand and none should
  appear here.
- ❌ No new fonts. The three families are pinned in `index.html`.
- ❌ No build step. No ES modules. No bundler. The prototype is
  inline-Babel-JSX (`<script type="text/babel">`) and that is the
  shipping form for now.
- ❌ Don't introduce an icon system. The mark is the only logo; mono
  labels (`01`, `WEBSITES`, `LIVE`, `IN BUILD`) carry indicator weight;
  the ASCII arrow `->` is the only inline glyph used in copy. If you
  must add icons, use Lucide at 1.5px stroke and flag the additions.
- ❌ Do not name a JS variable `styles` (Babel concatenates all `.jsx`
  files into one global scope; collisions are silent). Use
  `heroStyles`, `plateStyles`, etc.

## Stack & Load Order

Plain HTML, no build, no install. Load order matters and is fixed:

```
<link rel="stylesheet" href="styles.css">
<script src="react@18.3.1">
<script src="react-dom@18.3.1">
<script src="@babel/standalone@7.29.0">
<script type="text/babel" src="tweaks-panel.jsx">  (do not edit)
<script src="image-slot.js">                       (do not edit)
<script type="text/babel" src="shell.jsx">
<script type="text/babel" src="acts.jsx">
<script type="text/babel" src="app.jsx">
```

CDN scripts use `integrity` SRI hashes — keep them when bumping versions.

## Outstanding Work

Tracked in original `CONTENT.md` (archived at
`W:\Websites\claude-designs\extracted\chronicles-of-bone\project\CONTENT.md`).
Current status after the Codex content pass:

- **Shipped:** page title and metadata no longer use forbidden framing.
- **Shipped:** Act I logline tightened to 40 words.
- **Shipped:** Act V director's statement retained; it is first-person,
  under 40 words, and still scans.
- **Shipped:** "Bone" uses the poetic/no-acronym reading. Act V now carries
  the quiet line: "Bones beneath the dust."
- **Shipped:** Gemini Omni is split into its own `Gm` plate. Current plate
  spans total 17 cells, under the ≤ 18 contract.
- **Shipped:** mobile responsive safety pass keeps all five acts inside the
  fixed stage at 390px wide; side arrows are desktop-only to avoid covering
  scene copy on narrow screens.
- **Still needs real assets from Kol:** `hero-bg` wide dust-toned plate or
  muted loop, `act2-still` SCN 04 Colossus Rising 21:9 still,
  `act3-before` raw 1080p frame, `act3-after` matching finished 8K frame,
  and `director-avatar` square portrait. The demo keeps its existing
  drop-zone prompts until those assets exist.
- **Optional future video backdrop:** swap `<image-slot id="hero-bg">` for a
  `<video>` inside the same `.hero-bg-slot` wrapper only when the actual
  loop asset is available.

## Provenance

| Field | Value |
|---|---|
| Source | Claude Design handoff bundle |
| Bundle file | `Chronicles of Bone-handoff.zip` |
| Bundle date | 2026-05-25 |
| Bundle archive | `W:\Websites\claude-designs\extracted\chronicles-of-bone\` |
| Placement date | 2026-05-25 |
| Initial placement by | Build (Claude Code) |
| Deployed URL | `https://elusionworks.com/demos/chronicles-of-bone/` |
| Pixel-perfect target | 1280×720 |
| Production target | Static-first (Elusion Works estate) |
