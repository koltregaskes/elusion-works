# Elusion Works Site Architecture

## Intent

Launch a fast static umbrella site that introduces the brand and links directly to the active estate.

## Public IA

- Home
- Websites & Hubs
- Tools
- Games
- About

## Rendering Model

- `index.html` provides the static shell.
- `data/estate.js` holds the structured listing data.
- `app.js` renders featured entries and the three catalogue sections.

## Entry Model

Each entry supports:

- `name`
- `group`
- `type`
- `status`
- `url`
- `blurb`
- `tags`
- `featured`

## Design Direction

- Industrial / crafted / technical
- Bone text on charcoal surfaces
- Ember orange accent with cool cyan support
- Strong hero poster rather than a dashboard or SaaS card wall
