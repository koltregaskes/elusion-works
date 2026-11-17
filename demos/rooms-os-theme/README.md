# Rooms OS house theme

A look for the Claude desktop and mobile apps in the Rooms OS house style: charcoal, white ink, one green, squared paper, and a small floor plan in the corner whose rooms light up in turn. Demo 10 of Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

After [a post by ClaudeDevs](https://x.com/ClaudeDevs/status/2121392666244186327) about themes for the Claude apps. An original theme, not made by or with Anthropic.

**Quality bar it sets:** a theme that is data, with one source for its colours and its scene; checked by Claude Code's own validator, type check and test runner, and by a preview page that reads the same files and works out every contrast figure it prints a second way.
Use it as the reference for how to build and check a Claude app theme, and for any page that shows a palette. It is not yet a reference for how one looks, because nobody has seen it in the apps.

**Not yet seen in the apps.** Everything below was checked without them. Nobody has looked at this theme painted in a real Claude app. That is the first thing to do with it.

## What is here

- `mod/`: the theme itself, a small mod for Claude Code.
  - `.claude-plugin/plugin.json`, `hooks/hooks.json`: what the mod is and where its code is.
  - `hooks/house.js`: the look as data. Eighteen colours (seven for the night half, six for the day half, five roles) and the scene, an SVG of about 2,100 characters.
  - `hooks/register.tsx`: sets the look when a session starts, and draws the scene where an app asks for it.
  - `hooks/register.test.tsx`: the mod's own tests.
  - `hooks/make-colors.js`, `make-colors.d.ts`: the colour maker from Claude Code's mod toolkit, copied unchanged as the toolkit says to. It turns the eighteen colours into about a hundred for each half of the day.
- `index.html`, `js/`: a preview page. It paints a made-up window with the theme's colours and scene, and a table of every colour with how well it reads. It is a specimen, not a screenshot of the apps.
- `tools/`: checks for the colours, the scene and the preview page.

## The look

- **Night** is the house style: page `#111315`, ink `#f4f5f3`, and three more surfaces a little lighter each, so cards read as the same material as the page. The toolkit asks for the night surfaces to stay close together, and they do.
- **Day** is the same idea in a drawing office: cool blueprint paper (`#f0f4f6`), near-black ink, and two lighter surfaces for cards and panels.
- **One green.** `#3fe08a` is given as the accent. The apps keep its hue and choose their own lightness for each job, so buttons come out a deeper green (`#009057`) with black ink on them, not the bright house green. Forcing the exact green onto buttons was tried and left out: a white switch knob then reads at only 1.7 to 1 against it. The bright green survives in links and in keywords in code.
- **Meaning is kept.** Danger is a red, success a lime, warning an amber, pro a violet. Success is a lime, not a second green, so that keywords and strings in code are told apart: every pair of the five is at least 30 degrees of hue apart, measured on the shades the theme yields.
- **The scene.** Squared paper across the whole ground, and a small floor plan of six rooms pinned to the top right-hand corner. The rooms light up green one after another, nine seconds each, 54 seconds a round, never brighter than 22%. The plan keeps to that corner at every window shape, a phone held upright included, so it is never behind the middle of the page or the message box. Its grey and green are chosen to show on charcoal and on paper alike, so the scene does not have to be told which half of the day it is. With the animation taken out, which the apps do for anyone who asks for less motion, one room rests lit.

## Trying it

For a session started from a terminal, from the top folder of a copy of this repository:

```bash
claude --plugin-dir demos/rooms-os-theme/mod
```

That lasts for the one session and installs nothing. Themes are drawn by the apps; a terminal draws none, and the mod says so in the status line. How a session started in a terminal is then opened in an app is not something the toolkit's notes settle, so the surer route is the next one.

For sessions the desktop app starts there is no flag. Claude Code reads the same folders from `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`: the folder's full path. Before doing that:

- The setting is a list of folders. If it already holds one, add to it, do not replace it.
- It loads the mod into every Claude Code session that reads that file, in a terminal as well as in the app.
- It is read when a session starts, so taking it out removes the look from new sessions, not from one already running.

That is a change to your own settings, so it is yours to make.

## Checks

From the site's root, with the site served on port 8777:

```bash
claude plugin validate demos/rooms-os-theme/mod
```

```bash
claude plugin test demos/rooms-os-theme/mod
```

```bash
node demos/rooms-os-theme/tools/palette.test.mjs
```

```bash
node demos/rooms-os-theme/tools/smoke.mjs node_modules/axe-core/axe.min.js http://127.0.0.1:8777
```

```bash
node demos/rooms-os-theme/tools/shots.mjs http://127.0.0.1:8777 demos/rooms-os-theme
```

The first two need Claude Code. The last two need the site's development packages (Playwright and axe-core, from `npm install` at the site's root) and a Chromium that Playwright can find, or `PW_CHROMIUM` set to one. `REVIEW.md` lists what each one proves and what nobody has checked.

## Honest limits

- **Not seen in the apps**, in either half of the day, at any text size, or with a long code block. The mod's tests draw the scene through the engine on the desktop and mobile surfaces, which proves the engine accepts it, not how it looks. `REVIEW.md` lists the first eight things to look at.
- **The scene is drawn on nothing.** It paints dots, walls and lamps, and no ground of its own, so whatever the apps put under a scene shows through. The toolkit does not say what that is.
- **The plan is pinned with nested drawings**, which is the way the toolkit gives for keeping a subject in view on every screen. It means the outermost drawing has no fixed sheet of its own. The engine accepts it and a browser draws it as intended; the apps are untested.
- **Early access.** Themes for the apps are new and the way they are written may change between releases. `make-colors.js` is a copy and falls behind when the toolkit moves on: copy it again and re-run the checks.
- **The day half has 25 notes** from the colour maker, each a near miss (the widest falls 0.12 short) against a bar the design system's own colours only just clear. None stops the apps painting the theme. An earlier, whiter day half had 12, but its cards could not be told from its page. The night half has none.
- **The preview's coloured words are a best guess.** The apps choose their own shade of each role for words. The preview takes the first shade the theme holds that reads at 4.5 to 1, and says so.
- The validator notes that the mod has no licence file and no icon. Both matter only if it is submitted to the plugin directory, and the licence is the owner's choice.
- Permission prompts keep the apps' own look. That is the apps' rule.

## Status

Unlisted. The page carries `noindex`, and it is not in the gallery or the sitemap. The mod is not installed anywhere and not offered through any marketplace. Nothing here is published.
