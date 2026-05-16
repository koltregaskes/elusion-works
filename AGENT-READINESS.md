# Elusion Works — Agent Readiness

**Status:** DRAFT — awaiting Kol's sign-off. Not yet committed.
**Last updated:** 2026-05-16
**Estate-wide policy:** `W:\Websites\AGENT-READINESS-ESTATE.md`
**Repo:** `W:\Websites\sites\elusion-works`
**Domain:** elusionworks.com (per memory; CNAME not present at repo root — Kol to confirm)
**Stack:** Static HTML + vanilla CSS/JS with `@property` animated custom properties
**Existing description:** *"Elusion Works is a showcase for websites, tools, experiments, and future interactive ideas by Kol Tregaskes."*

**Name discipline (per memory):** "Elusion" not "Illusion". Codex must not let any IDE auto-correct slip through.

---

## 1. Schema strategy

Elusion Works is a **showcase / portfolio site for interactive web experiments**. Schema fits:

### 1.1 Home page (`index.html`)

**`Organization`**:

```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": "https://elusionworks.com/#organization",
  "name": "Elusion Works",
  "url": "https://elusionworks.com",
  "logo": "https://elusionworks.com/favicon.svg",
  "description": "A showcase for websites, tools, experiments, and future interactive ideas by Kol Tregaskes.",
  "founder": { "@id": "https://koltregaskes.com/#person-kol" },
  "sameAs": [
    "https://github.com/koltregaskes/elusion-works",
    "https://github.com/koltregaskes"
  ],
  "parentOrganization": { "@id": "https://koltregaskes.com/#organization" }
}
```

**`WebSite`** + **`CreativeWork`** wrapping the whole experiment set:

```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": "https://elusionworks.com/#website",
  "name": "Elusion Works",
  "url": "https://elusionworks.com",
  "publisher": { "@id": "https://elusionworks.com/#organization" }
}
```

### 1.2 Experiment / demo pages (`experiments/`, `demos/`, `creative-radar/`, `remix-relay/`, `claude-design/`)

Each subdirectory is an interactive demo. Schema as `CreativeWork` or `SoftwareApplication`:

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": "https://elusionworks.com/creative-radar/#app",
  "name": "Creative Radar",
  "description": "<short summary of what the demo does>",
  "url": "https://elusionworks.com/creative-radar/",
  "applicationCategory": "WebApplication",
  "operatingSystem": "Web",
  "author": { "@id": "https://koltregaskes.com/#person-kol" },
  "creativeWorkStatus": "Demo",
  "isPartOf": { "@id": "https://elusionworks.com/#website" },
  "image": "<screenshot URL — Kol to provide or Codex captures from prod>"
}
```

For pure design / animation showcases (no app functionality), use `CreativeWork` instead of `SoftwareApplication`.

Codex should walk the experiment directories and confirm what each demo IS (an app, a design study, an animation, etc.) before picking the schema type. Don't apply blanket `SoftwareApplication` to everything.

### 1.3 Design notes pages (`design-notes/`)

If these are write-ups about the demos: `Article` per page, with `about` pointing at the `@id` of the demo it discusses.

### 1.4 Implementation pattern (for Codex)

Static HTML, no build system. Inline JSON-LD per page. Reuse `Organization` and `Person` blocks by `@id` reference.

The site's CSS uses `@property` animations — Codex must NOT introduce any DOM-mutating JS that causes layout shift. Per the web.dev spec, "Ensure stable layout. Agents that take screenshots will likely be confused if your website layout is constantly shifting." The existing `@property` animations are GPU-driven and don't shift layout — keep that approach.

---

## 2. Robots.txt and sitemap

### Robots.txt

Already present at repo root (good). Codex aligns to estate baseline.

### Sitemap.xml

Not visible in repo root listing — Codex verifies. If absent, generate one listing:
- `/index.html`
- Each experiment / demo directory
- Each design-notes page

If demos have stable URLs, list them with `lastmod` from git history.

---

## 3. Browser-agent UX audit (web.dev spec)

This site is the highest interactivity in the estate. **Most likely to fail agent-friendliness checks.** Codex should audit thoroughly:

- `app.js`, `cursor.js`, and per-experiment JS likely create custom controls. Verify every interactive element is `<button>` / `<a>` or has `role` + `tabindex` + keyboard handlers.
- Demos that involve custom cursors (`cursor.js`) are particularly suspect — agents that take screenshots may not see custom cursor state. The actionable behaviour must still be discoverable from the DOM.
- `@property`-driven animations — stable layout ✅ but verify the live values are not changing element sizes mid-render. Use `transform` not `width/height` for any movement.
- "Ghost" overlays for visual effects — verify they don't block clicks (`pointer-events: none`).

Per-experiment audit list (Codex enumerates):

- [ ] `creative-radar/`
- [ ] `remix-relay/`
- [ ] `claude-design/`
- [ ] Each entry in `demos/`
- [ ] Each entry in `experiments/`

---

## 4. Content cadence — non-commodity check

Showcase sites have an inherent agent-readiness advantage: each demo is genuinely unique work. Less risk of commodity-content downrank.

What could go wrong:
- A demo described in vague terms ("Interactive thing", "A demo") rather than with a specific description of what the user / agent can do with it. Each demo's schema `description` must be ≥ 1 sentence answering *what the visitor can interact with*.
- Demos without entry points or visible action affordances. Browser agents trying to "use" the demo will be lost.

---

## 5. Crawl budget

Small site, no concerns.

---

## 6. Open items and dependencies

- **Domain confirmation** — CNAME absent at repo root. Memory says `elusionworks.com`. Codex verifies (may be configured in GitHub Pages settings or Cloudflare elsewhere).
- **Per-demo description content** — Kol or Claude writes one-line descriptions for each experiment. Without them, schema is empty and the agent-readiness payoff drops.
- **Screenshots for demo schema** — Codex can capture from prod once the site is browseable.

---

## 7. Definition of done for Codex

- [ ] `Organization` + `WebSite` JSON-LD on home + every page
- [ ] `SoftwareApplication` or `CreativeWork` on each experiment / demo
- [ ] `Article` on each design-notes page (if any)
- [ ] `BreadcrumbList` on deep pages
- [ ] `robots.txt` matches estate baseline
- [ ] `sitemap.xml` present and current
- [ ] Every demo passes the web.dev/ai-agent-site-ux semantic checks (`<button>`, `<a>`, labels, `cursor: pointer`, stable layout, no ghost overlays)
- [ ] `audit-agent-ready.py` passes
