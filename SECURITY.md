# Security Policy

Elusion Works is a static GitHub Pages site and public showcase repo.

## In Scope

- public HTML, CSS, JavaScript, and assets in this repo
- the GitHub Pages deployment workflow
- published metadata and bundled static files

## Reporting

- For non-sensitive problems such as broken links, rendering bugs, or obvious content issues, open a normal GitHub issue.
- For anything that could expose data, misroute visitors, or weaken the deployed site, prefer GitHub private vulnerability reporting if it is available on the repository.
- Do not post credentials, tokens, private paths, or personal data in a public issue.

## Repo Boundary

- `data/estate.js` is public source data for the live site.
- Local-only review feeds, screenshots, and experiments belong in `.local/` and should never be committed as public site content.
