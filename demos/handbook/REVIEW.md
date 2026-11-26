# Rooms OS handbook: review

Gap demo 1 of 7 on the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876): a docs page.
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to read. Not published, not in the gallery or the sitemap.

**The words are sample text, written by the model that built the page.** They are in the spirit of Rooms OS and are not the working rulebook. Nobody who runs Rooms OS has edited them, and nobody has read the page through by hand.

**Quality bar it sets:** a documentation page that is one HTML file of plain words which works with scripts off, where search, the contents list and the code colouring are added on top and each is checked against the words on the page.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| A docs page: Rooms OS handbook | Nine pages of sample text in one file, one shown at a time, each with its own address | `index.html` |
| Sidebar | A list of pages down the side, a drawer on a phone, and a list of each page's sections that marks where you are | `js/app.js` |
| Search | Sections, best first, with the words found marked; stems, beginnings of words, possessives, and words in code | `js/search.js` |
| Code blocks | Seven samples in four languages, coloured, each with a Copy button named for what it copies | `js/search.js`, `js/app.js` |
| Dark mode | Follows the device, switches on a button, is not remembered. One green in both looks | `index.html` |
| Own folder, own review, nothing live | `demos/handbook/`, this file, `noindex`, no gallery card, no sitemap entry | `index.html` |

## Checks run (17 Nov 2026)

Verified by running. All passed on the code as committed, last run after the outside review's fix below.

- `node demos/handbook/tools/search.test.mjs`: pass.
  - Words are folded; a heading outranks text; a page's own name puts that page first.
  - 14 pairs of word forms meet (approve and approval, delete and deleting, statuses and status). A possessive is its word. "Silent" finds "silence".
  - Words only in a code sample, and the name of its language, find the section; the snippet stays prose.
  - Every word asked for is required, in any order. Common words alone find nothing. Odd input is harmless.
  - Colouring: nine samples in five languages come back exactly as they went in. In YAML a figure or "no" is coloured only when it is the whole value. In JavaScript `throw` is a keyword and the inside of `${ }` is code.
- `node demos/handbook/tools/smoke.mjs`: pass, in headless Chromium.
  - Scripts off: one long page, all nine pages, every link working, no dead control, at 1280 and at 320 wide.
  - Each page opens alone with its heading focused and its contents listed. Previous and Next walk the book. Back returns to your place on the page.
  - "Skip to the page" keeps the page. The contents list marks every one of 30 or more sections gone to. An address that cannot be read does no harm. Text half as big again spills nothing.
  - Search on the real words: every heading finds itself first; the reviewer's 11 missed words now find something; the list says when there are more; keyboard and mouse both work.
  - Seven code samples keep their words, are coloured rightly, and copy exactly. Seven buttons and seven regions have names of their own.
  - Light and dark follow the device and are not remembered. The search box's edge is 3 to 1 or better against the bar in both. Print is black on white whichever look is on.
  - Forced colours: the current page is outlined in the list.
  - Phones 390x800, 320x568 and 740x360: the drawer opens at the page you are on and shuts on a choice, Escape, or Tab past its end; the search box is wide enough to read; code sits below its Copy button.
  - axe WCAG 2.2 A and AA in both looks, with scripts off, with the drawer open, at five sizes. No console errors, no outside requests.
- `node demos/handbook/tools/notice.mjs`: pass, in headless Chromium.
  - "Demo handbook: fictional sample rules" is inside the window, not covered, and above the heading gone to: all nine pages and two section links (`#claims-stale`, `#reference-glossary`), at 1280x800 and 390x800, scripts on and scripts off, and again scrolled to the foot of each. 88 views.
  - With text at 150% on a 320x568 phone the notice takes two lines and a section link still stops below it; nothing is wider than the window.
  - Printed, the strip is left off and every one of the nine pages is headed with the notice instead.
  - It failed on the page as it was before the fix (no notice on any view but the top of Start here), and fails again if the strip is made to scroll away.
- The repo's own rules, run locally: no element wider than the page at 320, 390 and 1280; axe clean; the first three Tabs land on visible things; `python3 scripts/build-site.py` passes.

## Not verified

1. **The words.** Nobody has read all nine pages for sense. A reader who knows Rooms OS should.
2. **A screen reader.** Focus moves to the heading of the page gone to; what NVDA or VoiceOver then says is unheard.
3. **The browser's Find** opening a hidden page: the event was sent by the check, not by a person pressing Ctrl F.
4. Safari and Firefox, a real phone, real Windows high contrast, and paper. Print was checked only as a PDF from headless Chromium.
5. A real refusal of the clipboard; the check stands in for one.
6. The notice's wording. Nobody but the model has read "Demo handbook: fictional sample rules" and judged it clear enough.

## Known limits

- Stemming is rough. It does not correct spelling and knows no synonyms.
- Until the script loads, the whole handbook shows for a moment as one long page.
- Find-in-page reaches hidden pages only where the browser supports `hidden="until-found"`.
- On a light device the page opens light: a dark headline on off-white, with a darker green so that it can be read. That is the dark-mode feature working, and a departure from white on charcoal.
- Results stop at eight; the list says how many more there are but does not show them.

## Independent review

A second pass by a separate Claude agent (Opus), read-only, given the brief and not the author's conclusions. It read every page and drove the page at desktop and phone sizes, in both looks, with scripts on and off. 26 findings: 1 blocker, 14 should-fix, 11 minor.

| # | Finding | What was done | Held by |
|---|---|---|---|
| 1 | Blocker. "Skip to the page" threw the reader back to Start here | A link to something outside the pages keeps the page and focuses its heading | browser check |
| 2 | A dead Pages button showed with scripts off on a phone | Hidden | browser check at 320 |
| 3 | The contents list marked the wrong section on short pages | The section gone to is the one marked, until the reader scrolls | browser check, every section of every page |
| 4 | Safety said never delete; Approvals listed deleting among things needing a yes | Approvals now says overwriting, or moving to the archive | browser check on the words |
| 5 | Search missed ordinary forms: approve, verify, archived, statuses, silent and more | A rough stemmer on both sides, and near-identical words meet | search test, 14 pairs; browser check, 11 words |
| 6 | Apostrophes broke ranking: "owner's" found "Other people's rooms" first | A possessive is its word; a lone letter is not a word | search test; browser check |
| 7 | At 320 wide the search box was 64 px: you could not see what you typed | The box has a row of its own on narrow phones | browser check |
| 8 | Copy and the language label sat on top of the code | The code starts below them | browser check on three phones |
| 9 | The drawer let Tab escape to the page behind it, opened at the wrong link, and stayed open on the current page's link | Shuts when focus leaves it; opens at the current page; shuts on any link | browser check |
| 10 | Code coloured wrongly: "no" and figures inside YAML sentences, `throw`, the inside of `${ }` | YAML is coloured a line at a time and only whole values; more keywords; template insides are code | search test; browser check |
| 11 | The "/" shortcut failed WCAG 2.1.4: a single key, with no way to turn it off | Control K or Command K | browser check |
| 12 | The search box's edge was 1.4 to 1 against the bar | A stronger edge: measured at 3 to 1 or better in both looks | browser check |
| 13 | Back went to the top of the page, not to where you were | The place is kept with each history entry | browser check |
| 14 | README named a REVIEW.md that did not exist, and two claims were false | This file; the claims are now true and checked | |
| 15 | Words used inconsistently: "claim of fact", "handoff", "pages" for themes, Before and Next, "Blocked" in two senses, and more | Statement of fact; handover throughout; light and dark "looks"; Previous and Next; the evidence word is "Cannot check"; "Not started" added to the status words; the two accounts of closing a room agree | browser check for handoff; the rest by reading |
| 16 | Print used the light look's colours, and left headings alone at the foot of a sheet | Black on white whichever look; headings stay with their text | browser check |
| 17 | In forced colours the current page was shown only by bold | Outlined; marks and the magnifier use system colours | browser check for the outline |
| 18 | A malformed address showed all nine pages and broke the script | Read safely | browser check, on a fresh load too |
| 19 | Seven regions and seven buttons with the same names | Each named for what it holds | browser check |
| 20 | Font sizes fixed in pixels | All in rem | browser check at one and a half times |
| 21 | Search: common words returned arbitrary sections; no sign of more results; language names found nothing; snippets ran prose into code; Claims ranked 4th for "claim" | Each fixed | search test; browser check |
| 22 | The current page's link scrolled to 18 px and left focus on the body | Goes to the top and focuses the heading | browser check |
| 23 | The live region repeated the heading that had just been focused | Nothing is announced on a page change; the focused heading is what is read | browser check |
| 24 | House style: several colours in code, a second green for links, a yellow mark | One green: links, marks and strings are the accent; keywords and names are bold ink | browser check that links are the accent |
| 25 | Unused pictures in the folder | `light.jpg` removed. `screenshot.jpg`, `proof.jpg` and `phone.jpg` are kept: the pull request shows them, as for the other demos | |
| 26 | The browser's Find could not reach hidden pages | Pages not shown are hidden until found, and a find opens the page | browser check, by sending the event |

One thing found while fixing: following a link into a hidden page also sends the browser's "found" event, and the first version of the handler for finding 26 rewrote the address and lost the section. The search check caught it.

One thing found afterwards, by the author, while building the next demo: the page had padding at its top to keep headings clear of the bar, and that padding made the browser scroll the page to the top whenever the search box or a button in the bar took the focus. Control K from half-way down a page threw the reader to its top. The clearance is now set on the headings themselves, and a browser check holds it.

## Outside review

Reviewed by ChatGPT in chat mode at Pro, driven by another Claude session at the owner's request, on 17 November 2026. It read the code and the pictures and did not run the page. It reviewed this demo together with two others (pull requests 141 and 142) and gave the set 7/10, HOLD for reuse as approved templates; for this demo, "merge after fixes". Only its points about this demo, and those it made about all three, are below.

| Finding | What was done | Held by |
|---|---|---|
| The sample warning lives only in the Start here page, so a direct link to any other page or section shows the rules with no warning in view, only the footer | True: run in a browser, the warning was on screen only at the top of Start here; on `#claims-stale` only the footer was. Fixed: a strip, "Demo handbook: fictional sample rules", sits under the bar on every page with scripts on and off, stays there as the page scrolls, and heads every printed page. One green as before; the strip is plain ink on the sidebar grey | `tools/notice.mjs`; `tools/smoke.mjs` (scripts off, a page link stops just below the notice) |
| The demo's own checks (search, browser) are not run by the site's automatic checks on a pull request | True: no workflow in `.github/workflows` runs anything in `demos/handbook/tools`. Not done: changing the site's workflows is outside this demo's folder. Needs the owner | |
| No reference comparisons and no real-phone evidence, which the shared quality bar asks for | Real phone: true, nobody has opened it on one. Reference comparisons: could not be checked, the quality bar file is not on this machine. Not done: needs a person with a phone and the bar | |
| "Unlisted" will not mean private after merging | True: `scripts/build-site.py` copies every demo folder into the public bundle, and a local build put `demos/handbook/index.html` in it. Not a code fix: the README's Status now says so plainly | README |
| No personal records or private links in the words or pictures | Agreed; nothing to do | |
| Not verified by the reviewer: live site, real touch, Safari, Firefox, screen reader, paper, phone speed | Still not verified here either; listed under Not verified | |

One more fault turned up when the author re-ran the checks on this change, and it was not in the outside review. Opening a search result could show two pages at once for a moment: the browser reveals the page a link goes into before the handbook has hidden the one you were on. The browser check caught it in two runs out of five. The page being left is now hidden at the same moment the new one is revealed, and the check looks straight after the result is opened, with no wait. It then passed six runs out of six.

## Provenance

- No library, no font, no picture or data file.
- The words are original sample text. They describe a way of working; they quote no document.
