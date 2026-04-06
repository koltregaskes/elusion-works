# Elusion Works Site Architecture

## Intent

Launch a fast static showcase site that introduces the Elusion Works label and highlights the
current work.

## Public IA

- Overview
- Websites
- Tools
- Games
- Company soon placeholder

## Rendering Model

- `index.html` provides the static shell.
- `data/estate.js` holds the structured listing data.
- `app.js` renders the three showcase sections and the overview counts.

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
