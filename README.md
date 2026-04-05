# Elusion Works

Elusion Works is the public company site for the websites, tools, hubs, and future games being built by Kol Tregaskes.

## What This Repo Contains

- A fast static company site for `Elusion Works`
- Structured listing data for selected work and the wider portfolio directory
- Brand assets for favicons, social previews, and showcase visuals
- Light documentation for setup, architecture, and brand direction
- A GitHub Pages workflow for deployment

## Local Structure

- `index.html` - single-page site shell
- `styles.css` - visual system and layout styling
- `app.js` - data-driven rendering for selected work, counts, and filters
- `data/estate.js` - structured entries for websites, hubs, tools, and games
- `assets/` - favicon, mark, social preview, and showcase assets
- `docs/` - brand guidance and site architecture notes

## Local Preview

Because this is a static site, any simple local web server will work.

Example with Python:

```powershell
python -m http.server 8123
```

Then open `http://localhost:8123`.

## Deployment

This repo is set up for GitHub Pages using the workflow in `.github/workflows/pages.yml`.

The workflow publishes only the public site files, not the repo docs.

## Brand Direction

The current recommended structure is:

- `Elusion` as the root brand idea
- `Elusion Works` as the public company layer
- distinctive product names only where a property has earned its own identity

See [docs/brand-architecture.md](docs/brand-architecture.md) for the current naming model.
