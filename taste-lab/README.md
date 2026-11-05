# This or That: taste lab

A blind A/B rater for building a record of Kol's taste. It shows two candidates side by side, Kol picks the better one (or both good, both weak, or skip), ticks the parts he liked on either side, and can say why. Every vote is stored where agents can read it before they build anything in that category.

It is modelled on John Lindquist's [this-or-that](https://github.com/johnlindquist/this-or-that) pairwise ranking kit.

- Live page (private to Kol): https://claude.ai/artifact/U6wmTwtpWt7oHZzDBs7GMJ
- Tracking: Linear KOL-6633
- How agents use it: the "Creative Brief Standard" page under Creative Quality System in Notion

This folder is **not** deployed to elusionworks.com. The Pages workflow copies only the named public folders.

## What is in it

| Category | Candidates | How they vary |
| --- | --- | --- |
| Dashboards | 16 | 4 layouts (Command, Bento, Briefing, Console) × 4 themes |
| Infographics | 12 | 3 layouts (Poster, Explainer, Small multiples) × 4 themes |
| Web pages | 16 | 4 layouts (Statement, Showcase, Split, Index) × 4 themes |
| App UI | 16 | 4 layouts (Three-pane, Board, Command palette, Timeline) × 4 themes |
| Motion | 12 | 12 motion styles on one fixed scene |

The four themes are Swiss, Graphite, Field Notes and Signal. Each is a complete token set in `candidates/themes.js`.

Content by category:

- **Dashboards:** internally consistent sample data about scheduled runs, labelled as sample data.
- **Infographics:** the NASA Planetary Fact Sheet.
- **Web pages:** the real Elusion Works estate, using its sites, screenshots, tools and demos.
- **App UI:** a sample day of agent sessions, labelled as sample data.

The web candidates load screenshots from `candidates/img/`. That folder is not committed. At publish time, map each file there from `assets/showcase/` using the Artifact tool's `files` map.

## Why candidates are generated, not hand-made

Each generator page draws every combination from one URL hash: `candidates/dashboard.html#bento-signal`, `candidates/infographic.html#poster-field`, `candidates/motion.html#wave`. This does two things:

1. **It keeps tokens low.** One layout crossed with four themes gives four candidates for the cost of one.
2. **Every vote scores the parts.** Because each candidate is tagged with its factors, a pick also counts as a win for its layout, palette, type, density or motion curve wherever the pair differs. The "What it learned" tab shows those win rates.

## Quick round

The lab opens on **Quick round**: 20 pairs mixed across every category, always serving the least-judged category next, then a summary of what the round covered. It is the fastest way to give every category data. The category tabs are still there for focused sessions.

## How the ranking works

- Elo, K = 24, starting at 1000.
- "Both good" and "both weak" move each candidate by 8 points and record no head-to-head result.
- "Skip" changes nothing.
- Pairing favours the least-judged candidates, then the closest Elo, and avoids repeating a pair.
- Under about 2.5 judgements per candidate the order still moves. Treat it as a preference record, not proof of quality.

## Data

Votes live in the artifact's shared store, in collection `votes`, one document per judgement:

```json
{ "cat": "dashboards", "a": "dashboards/bento-signal", "b": "dashboards/console-swiss",
  "pick": "a | b | both-good | both-weak | skip", "likedA": ["Colour"], "likedB": [],
  "note": "free text", "at": "ISO time", "by": "opaque viewer id", "v": 1 }
```

An agent reads them with the ArtifactData tool (`action: "list"`, `collection: "votes"`) on the URL above. The page's "What it learned" tab also copies a Markdown taste profile.

To turn votes into a versioned profile, run the rater's own scoring code with `tools/profile.mjs`:

1. Export the votes with ArtifactData `list` (`collection: "votes"`, `out_dir` set).
2. Run `node taste-lab/tools/profile.mjs <out_dir> --version N --out profile.md`.

It also accepts a single JSON array of votes. Kol's notes are personal, so keep the profiles in Notion or Linear, not in this public repo.

If the page is opened outside claude.ai, it saves in that browser only, and the status line says so.

## Adding a category

1. Write a generator page in `candidates/` that renders one candidate from `location.hash` and re-renders on `hashchange`. Use a fixed design size, which the rater scales to fit.
2. Add it to `CATS` in `index.html` with its size, the "Liked here" aspects and a tags object per candidate. The tags are what the taste view learns from.
3. Screenshot every candidate and fix what looks wrong before Kol sees it. The bar is the Creative Quality System gate: 8 or more to enter the lab.
4. Republish the artifact from `index.html`, with the candidate files as supporting files.

## Local preview

The page is written as an artifact fragment with no `<html>` wrapper. Serve the folder (`python -m http.server 8477`), then open any candidate page directly. The rater runs in local-storage mode outside claude.ai.
