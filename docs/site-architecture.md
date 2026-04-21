# Elusion Works Site Architecture

## Intent

Launch a fast static showcase site that introduces the Elusion Works label and highlights the
current work.

## Public IA

- Overview
- Showcases
- Websites
- Tools
- Games
- Features
- Footer links

## Rendering Model

- `index.html` provides the static shell.
- `data/estate.js` holds the structured listing data.
- `app.js` renders the homepage listing sections and the overview counts.
- `showcase-pages.css` styles the public sub-pages for the showcase layer.
- The showcase layer currently lives at:
  - `/experiments/`
  - `/creative-radar/`
  - `/remix-relay/`
  - `/design-notes/`
- Internal operational views should live outside the public bundle and outside the deployed data directory.

## Entry Model

Each entry supports:

- `id`
- `name`
- `group`
- `type`
- `family`
- `status`
- `url`
- `blurb`
- `tags`
- `sectionOrder`
- `media`

## Design Direction

- Calm / editorial / technical
- Bone text on charcoal surfaces
- Warm copper accent with cool slate support
- Graphical showcase first, explanation second
- New concepts should launch as Elusion Works showcase work before earning standalone brands or domains
