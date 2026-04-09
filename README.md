# Elusion Works

Elusion Works is the public showcase site for the websites, tools, and future games being built by Kol Tregaskes.

## What This Repo Contains

- A fast static showcase site for `Elusion Works`
- Structured listing data for the websites, tools, and games featured on the homepage
- Brand and showcase assets for favicons, social previews, and section artwork
- Light documentation for setup, architecture, and brand direction
- A GitHub Pages workflow for deployment

## Local Structure

- `index.html` - single-page site shell
- `styles.css` - visual system and layout styling
- `app.js` - data-driven rendering for the three homepage sections
- `data/estate.js` - structured entries for websites, tools, and games
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

See [docs/brand-architecture.md](docs/brand-architecture.md) for the current naming model.
