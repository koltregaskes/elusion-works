# Elusion Works — Front-Door Design

> The umbrella for everything Kol Tregaskes builds — websites, tools, games,
> images, video, posts. Some live, some in build, some still on the bench.

This document is the **design scope** for the next iteration of the Elusion
Works front door (`elusionworks.com`). It is paired with a working
mid-fidelity HTML prototype at `frontdoor/d6/`, which Claude Code should treat
as the source of truth for visual + motion direction.

---

## 1. Intent

Elusion Works is **not** a portfolio. It's an evolving umbrella for one
person's working studio: public websites, the systems that run them, future
games, and a constant stream of images, video, and writing.

The front door's job is to:

1. **Answer "what is this place" in five seconds.** One-line hero, plain
   English, no metaphor theatre.
2. **Show the work, sized by importance.** Bigger plates for the bigger
   destinations; smaller plates for tools and concepts. No uniform grid.
3. **Feel alive.** This is also a showcase of the studio's web-craft. The
   motion design has to earn that — current site is generic-portfolio-flat.
4. **Make WIP a feature, not a bug.** "Company in formation" stays visible.
   Plates carry their status: LIVE / IN BUILD / COMING SOON.

---

## 2. What changed vs. the live site

| Live site                                         | Front-door redesign                              |
| ------------------------------------------------- | ------------------------------------------------ |
| Generic hero stack (eyebrow + H1 + CTAs + counts) | Plain hero + animated split-text headline        |
| Uniform card grid                                 | Cabinet with importance-weighted plate sizes     |
| Static cards                                      | 3D pointer-tilt, image parallax, magnetic halo   |
| No scroll feedback                                | Scroll-progress rail + scroll-driven entry       |
| Standard mouse                                    | Custom copper cursor (dot + ring, mix-blend)     |
| Single theme                                      | Dark default + light, with View-Transitions wipe |
| Static content                                    | Live ticker, count-up stats, marquee strip       |
| Body copy about "the next showcase release"       | Concrete copy about what the studio actually is  |

---

## 3. Visual system

### 3.1 Theme tokens

All theming lives on `:root` and `[data-theme="light"]` in `cabinet.css`.
Copy verbatim into the production stylesheet.

| Token                 | Dark default          | Light                    | Purpose                 |
| --------------------- | --------------------- | ------------------------ | ----------------------- |
| `--bg-0`              | `#030305`             | `#f7f3ec`                | Page background         |
| `--bg-1`, `--bg-2`    | near-black warm slate | warm paper               | Ambient layers          |
| `--panel`             | translucent dark      | translucent paper        | Cards, header, footer   |
| `--fg-1` / `-2` / `-3`| `#f4efe7` → muted     | `#1a1410` → muted        | Type tiers              |
| `--copper`            | `#d7a16f`             | `#b87a3d`                | Primary accent          |
| `--copper-2`          | `#f5c79a`             | `#d39a64`                | Highlight, glow         |
| `--slate`             | `#9bb0c2`             | unchanged                | Secondary ambient       |
| `--green`             | `#8fd0a6`             | unchanged                | "LIVE" status pill      |
| `--line` / `-strong`  | low / med alpha       | low / med alpha          | Hairlines, borders      |

Theme switches via `[data-theme]` attribute on `<html>` and is animated using
the View-Transitions API with a circle wipe from the toggle button.

### 3.2 Type

- **Display:** Outfit (500/600/700) — H1, plate names, count-ups.
- **Body:** Inter (400/500/600) — sub-copy, blurbs.
- **Mono:** IBM Plex Mono (400/500) — eyebrows, kickers, status pills, kind
  labels. Always uppercase, letter-spacing `0.16em`–`0.18em`.

Hero H1 uses `clamp(2.8rem, 5.4vw, 5rem)` with `letter-spacing: -0.05em` and
`line-height: 0.96`. The `<em>` portion is rendered in copper, not bold.

### 3.3 Spacing & shape

- `--max-w: 1320px`, `--gutter: 22px`.
- Plates `border-radius: 22px`, hero & footer `40px` / `24px`.
- Card padding `14px`; image frame inset `12px`, frame radius `12px`.

### 3.4 Motion identity

A single coherent motion language across the page:

- **Cursor:** copper dot + outline ring, `mix-blend-mode: difference`. Ring
  grows when over `.ew-plate` or any `a` / `button`.
- **Page spotlight:** radial copper gradient at `var(--mx, --my)`, soft and
  always-on, follows the cursor with eased lerp.
- **Plate hover:** pointer-driven 3D tilt (`rotateX/Y`), image parallax inside
  the frame (`translate3d`), sheen sweep (radial gradient with
  `mix-blend-mode: overlay`), copper halo bloom behind the card.
- **Plate entry:** scroll-driven `animation-timeline: view()`, plates fly in
  from alternating sides with rotation + blur, settle into place.
- **Hero H1:** chars staggered with 3D rotateX + blur, ~32ms per char.
- **Scroll rail:** copper gradient fills as you scroll; "SCROLL" tick rides
  the fill edge.
- **Theme toggle:** circular `clip-path` wipe from the button position via
  `document.startViewTransition`.
- **Ticker:** vertical-slide rotation every 3s. Three alt variants live in
  `cabinet.jsx` (split-flap, marquee, typewriter) — pick once.

All motion respects `prefers-reduced-motion`.

---

## 4. Information architecture

### 4.1 Sections (in order, top to bottom)

1. **Sticky header.** Brand lockup left, nav center (Cabinet / Sites / Tools
   / Games / Hello), theme toggle floats top-right.
2. **Hero.** Eyebrow + status pill, animated H1, sub-copy, **ticker**.
3. **Studio stats strip.** Count-ups for Sites / Pipelines / Games + a live
   status mini-marquee.
4. **Cabinet.** The grid of plates (see 4.2).
5. **Footer.** Brand block left, nav links right, base line.

No "feed" strip, no "showcase wave" launcher, no oversized CTAs — the live
site has these; the redesign deliberately doesn't.

### 4.2 Cabinet — plate inventory

Six-column grid (`grid-template-columns: repeat(6, 1fr)`), 220px rows,
`grid-auto-flow: dense`. Spans must total 6 per visual row so nothing leaves
holes. Current arrangement:

| Plate                     | Kind    | Status      | Span (col × row) |
| ------------------------- | ------- | ----------- | ---------------- |
| AI Resource Hub           | WEBSITE | LIVE        | 4 × 2            |
| Kol's Korner              | WEBSITE | LIVE        | 2 × 2            |
| Ghost in the Model        | WEBSITE | LIVE        | 2 × 2            |
| Axy Lusion                | WEBSITE | IN BUILD    | 4 × 2            |
| KT Photography            | WEBSITE | IN BUILD    | 3 × 2            |
| Shared Website Tools      | TOOL    | COMING SOON | 3 × 2            |
| Website News Pipeline     | TOOL    | IN BUILD    | 3 × 1            |
| Gallery Pipeline          | TOOL    | IN BUILD    | 3 × 1            |
| Games In Development      | GAME    | COMING SOON | 3 × 2            |
| Interactive Experiments   | GAME    | COMING SOON | 6 × 2            |

Plates carry: thumbnail (image for sites, poster SVG for tools/games),
kind label, status pill, name (Outfit 600), 2-line blurb (Inter 400),
family tag, OPEN → CTA. Tools / games have a copper-tinted gradient frame
to differentiate from website screenshots.

### 4.3 Ticker — content concept

**This is the thing that needs real data wiring.** Currently fed from a
static `TICKER_LINES` array in `cabinet.jsx`. The intent is:

> "Latest from the studio" — a single rotating line at the top of the cabinet,
> showing what's just happened across all the sites + the creator feed.

Per item:

- `kind`: BUILDING / POSTED / SHIPPED / WRITING / FILMING / CURATING
  (lookup table of past-tense verbs; choose one per source type)
- `text`: short headline (~60 chars max for split-flap variant)
- `tag`: source label (TOOL / IMAGES / POST / VIDEO / CURATION / ON THE BENCH)
- `href`: destination link
- `timestamp`: ISO date; used for sort order, not displayed

**Wiring options** for Claude Code:

1. **Static `latest.json`** per site, polled from a worker once an hour and
   collapsed into a single `/api/feed` endpoint. Cheapest.
2. **RSS aggregation** for sites that already publish feeds (Kol's Korner,
   Ghost in the Model). Worker pulls + normalises.
3. **Hand-curated `feed.json`** in the repo for events that don't have a
   natural source (build logs, photo drops). Edit by PR.

Recommend a mix of 2 + 3 to start, with `/api/feed.json` as the single
client-facing source.

### 4.4 Hero copy (locked default)

> **One studio. *Many projects.***
>
> Websites, tools, games, images, video, and writing — built by Kol Tregaskes,
> in public, all under one umbrella. Some live, some in build, some still on
> the bench.

Two alternates kept on file in case the team wants to A/B:

- "Everything Kol Tregaskes builds — under one roof."
- "A working studio. One person. Many fronts."

---

## 5. Technical scope for Claude Code

### 5.1 Implementation notes

- **Framework:** keep static-first / no build step is fine (the live site is
  already that way). React-via-Babel was used for the prototype to move fast;
  in production, port to whatever the rest of the site uses.
- **CSS:** vanilla CSS with custom properties. Uses:
  - `color-mix(in oklab, ...)` — needs Safari 16.4+.
  - `animation-timeline: view()` — needs Chrome 115+ / Safari 26+. Provide a
    `prefers-reduced-motion` fallback (already in `motion.css`).
  - `View Transitions API` — feature-detect (`document.startViewTransition`).
  - `:has()` for cursor-state — Chrome / Safari OK.
  - Container queries on `.ew-plate` — for blurb hide at narrow widths.
- **Fonts:** Outfit / Inter / IBM Plex Mono via Google Fonts. Pre-connect.
- **JS additions** (in `motion.jsx`):
  - `PageEffects` — cursor coords, scroll progress, theme transition
  - `useMagnetics` — pulls `.ew-magnet` elements toward the cursor
  - `SplitHeading` — splits H1 into per-char spans for stagger
  - `CountUp` — IntersectionObserver count-up on first view
  - Each plate has its own `useRef`-driven pointer-tilt handler

### 5.2 Performance budget

- LCP target: hero H1 + first plate row visible in <2.0s on 4G.
- Lazy-load all plate images. Hero thumbs `loading="eager"`, rest lazy.
- Total CSS <40KB, total JS <30KB excluding fonts.
- No third-party trackers, no animation libraries — everything is hand-CSS
  or vanilla DOM.

### 5.3 Accessibility

- All animated decorations marked `aria-hidden`.
- `prefers-reduced-motion: reduce` disables: cursor, spotlight, scroll rail,
  letter-split, plate fly-in. Hover effects degrade to a simple border tint.
- Plate links use `<a>` with full overlay + `aria-label`. Focus-visible
  rings inside the card border-radius.
- Status pills are decorative; status is also in the plate name's title
  attribute when needed.
- Hero ticker has `aria-live="polite"`. Marquee variants would need an off
  switch — recommend defaulting to slide variant for AA compliance.

### 5.4 Routing

Plate `href`s should point to:

- AI Resource Hub → `https://theairesourcehub.com/`
- Kol's Korner → `https://koltregaskes.com/`
- Ghost in the Model → `https://ghostinthemodels.com/`
- Axy Lusion → `https://axylusion.com/`
- KT Photography → `https://koltregaskesphotography.com/`
- Tools — internal anchor or `#` until a tool detail page exists
- Games — internal anchor; "COMING SOON" badge implies no link yet

---

## 6. File map (handoff)

```
frontdoor/d6/
├── index.html         — page shell, fonts, mount point, tweak defaults
├── cabinet.jsx        — main components (Header, Hero+Ticker, Plate, Cabinet, Footer)
├── motion.jsx         — PageEffects, useMagnetics, SplitHeading, CountUp, StudioStrip
├── cabinet.css        — visual system, theming, base motion
├── motion.css         — extended motion: cursor, spotlight, scroll rail, split-text
├── tweaks-panel.jsx   — design-time tweak UI (not for production)
├── img/               — placeholder screenshots & posters
├── DESIGN.md          — this file
├── HANDOFF.md         — short legacy notes; superseded by this DESIGN.md
└── CONTENT.md         — copy & status table (separate sheet)
```

---

## 7. Out of scope / open questions

- **Mobile pass.** Current breakpoints collapse to 3-col at ≤980px but the
  full mobile design hasn't been pushed. Treat as a separate sprint.
- **Project detail pages.** Plate `OPEN →` currently routes to the external
  destination. A future "case-study layer" page per project is out of scope
  for v1.
- **"Hello" page.** Nav links to `#hello` but no page exists. Decide later
  whether it's a one-liner contact card or a full About.
- **Image / video assets.** Current plate thumbnails are screenshots; the
  brief alludes to richer media (animated previews, short loops). v1 keeps
  static thumbnails; v2 can layer in `<video>` autoplay-on-hover.
