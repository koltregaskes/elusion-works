# Elusion Works

Elusion Works is the umbrella brand and central index for the websites, tools, hubs, and games in the wider estate.

## What This Repo Contains

- A static brand and index site for `Elusion Works`
- Brand assets that can be reused across favicons, avatars, and social previews
- Light documentation for setup, design direction, and logo exploration
- A GitHub Pages workflow for fast deployment

## Local Structure

- `index.html` - single-page site
- `styles.css` - full visual system and layout styling
- `app.js` - data-driven rendering and filters
- `data/estate.js` - structured entries for websites, hubs, tools, and games
- `assets/` - favicon, mark, and social preview assets
- `docs/` - brand guidance, prompts, architecture, and naming notes

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
- `Elusion Works` as the umbrella operating brand
- distinctive product names only where a property has earned its own identity

See [docs/brand-architecture.md](docs/brand-architecture.md) for the current naming model.
