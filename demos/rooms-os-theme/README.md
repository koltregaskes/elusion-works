# Rooms OS house theme

A look for the Claude desktop and mobile apps in the Rooms OS house style: charcoal, white ink, one green, and a faint floor plan behind the conversation whose rooms light up in turn. Demo 10 of Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

After [a post by ClaudeDevs](https://x.com/ClaudeDevs/status/2121392666244186327) about themes for the Claude apps. An original theme, not made by or with Anthropic.

**Quality bar it sets:** a theme that is data, with one source for its colours and its scene; checked by the apps' own validator, type check and tests, and by a preview page that reads the same files and works out every contrast figure it prints a second way.
Use it as the reference for Claude app themes and for any page that shows a palette.

**Not yet seen in the apps.** Everything below was checked without them. Nobody has looked at this theme painted in a real Claude app. That is the first thing to do with it.

## What is here

- `mod/`: the theme itself, a small mod for Claude Code.
  - `.claude-plugin/plugin.json`, `hooks/hooks.json`: what the mod is and where its code is.
  - `hooks/house.js`: the look as data. Eighteen colours (seven for the night half, six for the day half, five roles) and the scene, an SVG floor plan of about 2,600 characters.
  - `hooks/register.tsx`: sets the look when a session starts, and draws the scene where an app asks for it.
  - `hooks/register.test.tsx`: the mod's own tests.
  - `hooks/make-colors.js`, `make-colors.d.ts`: the colour maker from Claude Code's mod toolkit, copied unchanged as the toolkit says to. It turns the eighteen colours into about a hundred for each half of the day.
- `index.html`, `js/`: a preview page. It paints a made-up window with the theme's colours and scene, and a table of every colour with how well it reads. It is a specimen, not a screenshot of the apps.
- `tools/`: checks for the colours, the scene and the preview page.

## The look

- **Night** is the house style: page `#111315`, ink `#f4f5f3`, and three more surfaces a few percent lighter each, so cards read as the same material as the page.
- **Day** is the same idea by daylight: cool drawing-office paper, near-black ink.
- **One green.** `#3fe08a` is given as the accent. The apps keep its hue and choose their own lightness for each job, so buttons come out a deeper green (`#009057`). Forcing the exact green onto buttons was tried and left out: a white switch knob then reads at only 1.7 to 1 against it.
- **Meaning is kept.** Danger is a red, success a leaf green (a different green from the accent, so code keeps five distinct colours), warning an amber, pro a violet.
- **The scene.** Squared paper and eight rooms round the edge of the sheet. Six of them light up green one after another, nine seconds each, 54 seconds a round, never brighter than 13%. Nothing is drawn across the middle, where the words are, or along the foot, where the message box is. With the animation taken out, which the apps do for anyone who asks for less motion, one room rests lit.

## Trying it

For a session started from a terminal, from a copy of this repository:

```bash
claude --plugin-dir demos/rooms-os-theme/mod
```

That lasts for the one session and installs nothing. Themes are drawn by the apps, so open the session in the Claude desktop or mobile app to see it; a terminal draws none, and the mod says so in the status line.

For sessions the desktop app starts there is no flag. Claude Code reads the same folders from `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`: put the folder's full path there, and take it out again to remove the look. That is a change to your own settings, so it is yours to make.

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

- **Not seen in the apps**, in either half of the day, at any text size, or with a long code block. The mod's tests draw the scene through the engine on the desktop and mobile surfaces, which proves the engine accepts it, not how it looks.
- **Early access.** Themes for the apps are new and the way they are written may change between releases. `make-colors.js` is a copy and falls behind when the toolkit moves on: copy it again and re-run the checks.
- **The day half has twelve notes** from the colour maker, each a near miss of a few hundredths against a bar the design system's own colours only just clear. None stops the apps painting the theme. The night half has none.
- **The preview's coloured words are a best guess.** The apps choose their own shade of each role for words. The preview takes the first shade the theme holds that reads at 4.5 to 1.
- The validator notes that the mod has no licence file and no icon. Both matter only if it is submitted to the plugin directory, and choosing a licence is Kol's call.
- Permission prompts keep the apps' own look. That is the apps' rule.

## Status

Unlisted. The page carries `noindex`, and it is not in the gallery or the sitemap. The mod is not installed anywhere and not offered through any marketplace. Nothing here is published.
