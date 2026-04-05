# Elusion Works Site Architecture

## Intent

Launch a fast static company site that introduces the brand and links directly to the active
portfolio.

## Public IA

- Overview
- Selected work
- Company model
- Portfolio directory

## Rendering Model

- `index.html` provides the static shell.
- `data/estate.js` holds the structured listing data.
- `app.js` renders selected work, overview counts, and the grouped directory.

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
- `featured`
- `featureOrder`
- `media`

## Design Direction

- Calm / editorial / technical
- Bone text on charcoal surfaces
- Warm copper accent with cool slate support
- Image-led company front door rather than a dashboard or SaaS card wall
