# Elusion Works

Elusion Works is the public showcase site for the websites, tools, and future games being built by Kol Tregaskes.

## What This Repo Contains

- A fast static showcase site for `Elusion Works`
- Structured listing data for the websites, tools, and games featured on the homepage
- A public showcase layer for experiments, curation formats, and design notes
- Brand and showcase assets for favicons, social previews, and section artwork
- Light documentation for setup, architecture, and brand direction
- A GitHub Pages workflow for deployment

## Local Structure

- `index.html` - single-page site shell
- `styles.css` - visual system and layout styling
- `showcase-pages.css` - shared styling for the public showcase sub-pages
- `app.js` - data-driven rendering for the three homepage sections
- `data/estate.js` - structured entries for websites, tools, and games
- `experiments/` - design-led microsite launch set
- `demos/` - public demo index and individual prototype mini-sites
- `creative-radar/` - permission-first curation format
- `remix-relay/` - tiny daily remix-chain prototype
- `design-notes/` - public case-study and reference layer
- `assets/` - favicon, mark, social preview, and showcase assets
- `docs/` - brand guidance and site architecture notes
- `.local/` - local-only previews, screenshots, and experiments that never ship

## Public vs Local-Only

- `data/estate.js` is the only public data source for homepage listings.
- Internal review feeds, dashboards, scratch files, and temporary verification artefacts should stay in `.local/`.
- The GitHub Pages workflow copies only the public site bundle so local operational files do not leak into deployment.

## Local Preview

Because this is a static site, any simple local web server will work.

Example with Python:

```powershell
python -m http.server 8123
```

Then open `http://localhost:8123`.

## Deployment

This repo is set up for GitHub Pages using the workflow in `.github/workflows/pages.yml`.

The workflow publishes only the public site files, not the repo docs or local-only workspace artefacts.

The repo also includes a scheduled browser-based health check in `.github/workflows/site-health.yml`.
The current cadence is twice daily in UTC:

- `07:00 UTC` scheduled refresh deploy
- `07:15 UTC` live browser health check
- `19:00 UTC` scheduled refresh deploy
- `19:15 UTC` live browser health check

## Security

- Public reporting guidance lives in `SECURITY.md`.
- The site publishes `security.txt` at `/security.txt`.

## Brand Direction

The current recommended structure is:

- `Elusion Works` as the public umbrella label for the portfolio
- `Elusion` only as internal shorthand for the underlying brand idea, not as the standalone public label
- distinctive product names only where a property has earned its own identity
- experiments, curation formats, and small social toys should launch inside Elusion Works before they earn their own domains or brands

See [docs/brand-architecture.md](docs/brand-architecture.md) for the current naming model.

## Launch checks

`npm ci --ignore-scripts` installs the pinned test tools. `npm run build` uses the
same allowlisted assembly as Pages; it generates the sitemap, complete route
metadata and RSS in `_site/`, never in tracked source. Previous local output is
retained under ignored `.local/`. The source `scripts/` and demo build tools are
not published.

`npm run test:links -- --external` checks every built HTML destination and asset.
Only confirmed HTTP 404/410 results fail the crawl. Rate limits, bot denials and
network failures are explicitly unverified warnings, not proof that a URL works.
Preconnect/DNS hints are not navigable links.

`npm run test:launch -- --width=320` and `--width=1280` check **every** built HTML
page, including pages marked noindex, for serious/critical WCAG A/AA axe findings
and horizontal overflow. CI splits each width into four shards and preserves
JSON diagnostics. Requests are fulfilled from the actual bundle using an HTTPS
test origin; outside requests are blocked and no server or port is started.
This deterministic fallback-font/offline pass complements final deployed,
keyboard, screen-reader and real-GPU acceptance; it does not prove external API
availability or content rendered only by third-party scripts.

The browser gate uses Windfield's supported `?q=low` render setting to keep
software-rendered CI within its five-minute limit. The viewport remains 320px
or 1280px; every route, control and axe rule stays in scope. Default/high-quality
render performance remains a real-GPU acceptance check. Reports record this
render profile and save each completed route before closing its page, so a
cancelled run retains partial coverage and findings rather than an empty artifact.

## Public contact destination

`site.config.json` contains the single `contactUrl` value used to build the site
contact links and both `/security.txt` and `/.well-known/security.txt`. The current
working public contact form is retained. There is no existing Elusion Works email
address in source, so the build does not guess one or switch to unconfirmed mail
routing. After Kol confirms routing and an external delivery/receipt test,
change this one value to `mailto:contact@elusionworks.com` and rerun the build.
The source configuration and validation scripts are not published. Fictional
forms inside demos are separate from this real site contact route.

The existing Pages workflow reports catalogue acquisition through a separate health job. Failed/skipped acquisition makes that job red while build/publication retain their existing fallback path. This uses the existing Actions failure signal, not a new issue alert, controller or schedule. A green static deployment alone is not catalogue freshness proof; real notification delivery still needs operational rehearsal.
