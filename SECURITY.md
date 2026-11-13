# Security Policy

Elusion Works is a static GitHub Pages site and public showcase repo.

## In Scope

- public HTML, CSS, JavaScript, and assets in this repo
- the GitHub Pages deployment workflow
- published metadata and bundled static files

## Reporting

- For non-sensitive problems such as broken links, rendering bugs, or obvious content issues, use the public contact route linked from the site. Repository Issues may be disabled.
- For anything that could expose data, misroute visitors, or weaken the deployed site, prefer GitHub private vulnerability reporting if it is available on the repository.
- Do not post credentials, tokens, private paths, or personal data in a public issue.

## Repo Boundary

- `data/estate.js` is public source data for the live site.
- Local-only review feeds, screenshots, and experiments belong in `.local/` and should never be committed as public site content.

## Checks and hosting boundary

`npm audit --audit-level=low` audits the pinned development/test dependencies;
there are no production npm dependencies. `scripts/scan-secrets.py` runs the
checksum-pinned Gitleaks scanner over public source and the actual Pages bundle.
It excludes every environment filename without opening it, keeps scanner output
private, and emits aggregate counts only. No findings report is uploaded.
This current-tree/bundle scan does not claim a history scan.

The allowlisted Pages build excludes source scripts, demo build tools, local
content and environment files. All pages receive a strict-origin referrer
policy. Existing per-page CSPs stay intact; the root script policy uses self only,
without a fixed nonce or inline execution. JSON-LD is data, not executable code.
The root's existing inline **style** allowance is unchanged. Other demo routes
still need individual CSP design, including their external scripts/APIs; a global
policy would break those demos and is not silently applied.

GitHub Pages does not consume a `_headers` file or this repository's header JSON.
`config/response-headers.json` is the reviewed target for Kol's existing host/proxy
work, **not an active configuration**. `scripts/check-security.py --live` reports
header gaps by name. HSTS, X-Content-Type-Options, framing, response referrer and
Permissions-Policy remain host-owner acceptance under rooms-os-hub#1413/#1511.
Preserve same-origin framing and Orbit Census geolocation; do not disable those
features by copying a blanket policy. Check apex/www and redirects after the move.

The umbrella currently has no server-side form, Worker, checkout, webhook or
newsletter endpoint. Its support mock-ups are excluded from publishing and must
remain disabled until approved. Demo-only forms must not be represented as real
sign-up or payment services. Existing outbound API/data fetches and final deployed
contact, keyboard/screen-reader, CSP and third-party runtime checks remain launch
acceptance work. A red Actions run is the current failure signal; these checks
add no database secret, issue-alert workflow or repository setting change.
