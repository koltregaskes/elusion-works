# The Catch Is You

A Kol's Korner essay turned into an explainer film of a minute and a half, written as code and rendered with HyperFrames. Demo 6 of Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

**Quality bar it sets:** an explainer that is all argument and no filler: the essay's own words, set as type on a beat, in Kol's title-card look, with a transcript that drives the film. The film is a small project anyone can edit and render again.
Use it as the reference for turning writing into short films.

## What is here

| File | What it is |
|---|---|
| `index.html` | The page: the film, a transcript whose times play the film from that line, and how it was made |
| `efficiency-catch.mp4` | The film: 1 minute 34 seconds, 1920 by 1080, 30 frames a second, 9 MB |
| `poster.jpg` | The picture shown before the film plays |
| `thumbnail.png`, `screenshot.jpg`, `proof.jpg`, `phone.jpg` | Pictures of the page and the film, for the gallery card and the pull request |
| `tools/film/` | The film's source: a HyperFrames project. `index.html` mounts seven scenes from `compositions/`; `assets/` holds the fonts, the animation library and the music |
| `tools/make-bed.mjs` | Makes the music from arithmetic: a pad, a soft pulse, and accents where the hard lines land |
| `tools/transcript.json` | The film's words with their times. The page and the checks both read from it |
| `tools/essay.md` | A copy of the essay, so the words can be checked against it |
| `tools/check.mjs`, `tools/smoke.mjs` | Checks on the film file and on the page |

## The film

- **Source:** "AI's Efficiency Promise Has a Catch - You", published on Kol's Korner on 12 February 2026 (`content/ai-efficiency-burnout.md` in the kols-korner repository).
- **Words:** every one of the 39 sentences on screen is taken word for word from the essay. Many are cut out of longer sentences ("Consumption exploded." from "they made coal so efficient that consumption exploded"), and nothing is reworded or added. `tools/check.mjs` fails if any line is not in the essay.
- **Look:** charcoal ground, white type, one green. Comic-book touches (a starburst, speech bubbles, dots) used sparingly.
- **Time:** 100 beats a minute. Each of the seven scenes starts on a bar; the six hard lines land on a beat, where the music has an accent. The check measures those accents in the finished film's sound, not only in the source.
- **Sound:** music only, no speech. Every word is on screen and in the transcript, so nothing is lost with the sound off.

## Change it and render it again

```bash
cd demos/efficiency-catch/tools/film
```

```bash
npm run check
```

```bash
node ../make-bed.mjs
```

```bash
npx --yes hyperframes@0.9.61 render -o ../../efficiency-catch.mp4 --fps 30
```

The first command checks the project (structure, layout, contrast, reading time, sound). The second remakes the music and is only needed if the timing changed; it needs ffmpeg, and it must run before the render, which takes the music in. The render takes one to two minutes on a small machine, and gives the same file every time on the same machine. If a line of text changes, change it in `tools/transcript.json` and in the page's transcript too: `tools/check.mjs` compares them with the scenes and with the essay.

## Checks

```bash
node demos/efficiency-catch/tools/check.mjs
```

```bash
PW_CHROMIUM=/opt/pw-browsers/chromium node demos/efficiency-catch/tools/smoke.mjs node_modules/axe-core/axe.min.js
```

The first reads the film file (format, length, loudness, frames), checks the transcript against the page and the scenes both ways, checks each line's time against the moment its words are told to appear and that its words appear before the next line's time, measures the six accents in the sound, and checks every sentence against the essay. The second drives the page in a browser (pressing times, bringing the film on screen before it plays, the message when the film will not play or load, phones and reduced motion, axe) on its own small server (`tools/serve.mjs`), because jumping about in a video needs a server that answers partial requests; GitHub Pages does.

## What is borrowed

- **HyperFrames** (the `hyperframes` command, version 0.9.61, open source) checks and renders the project. It is not bundled here.
- **GSAP 3.15.0** (`tools/film/assets/vendor/gsap.min.js`) animates the scenes. It is under GreenSock's standard no-charge licence.
- **Outfit** and **JetBrains Mono** (`tools/film/assets/fonts/`) are under the SIL Open Font License 1.1; each font's full licence text is beside it.
- The `tools` folder is left out of the published site, so none of these is served to visitors. What is served is the page, the film, the poster and the four pictures listed above.

## Credit

The idea follows a post by Matt Shumer about turning an essay into an explainer video (x.com/mattshumer_/status/2119884041331892403). The film, its design and its music were made for this demo.

## Status

Draft, unlisted. The page carries `noindex`, is not in the demo gallery and is not in the sitemap. The site deploys whatever is merged, so merging this would put the page on the live site at its own address (/demos/efficiency-catch/): unlisted, but reachable by anyone with the link. See `REVIEW.md` for what was checked and what was not, including an outside review.
