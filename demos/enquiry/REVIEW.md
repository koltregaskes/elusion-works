# Start a project: review

Gap demo 4 of 7 on the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876): a multi-step form, as an enquiry flow for Elusion Works.
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to try. Not published, not in the gallery or the sitemap.

**It sends nothing and there is nowhere for it to send to.** The questions, the kinds of work and the budget bands are made up. Nobody has filled it in on a phone or heard it in a screen reader.

**Quality bar it sets:** a form whose rules live in one file that the page cannot disagree with: every question, every answer and every error message is checked in the browser against that file, the focus is followed through every step and every mistake, and Send is proved to send nothing.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| A multi-step form | Five steps: the work, about it, timing and budget, how to reach you, check your answers; then the text that would have been sent | `index.html`, `js/app.js` |
| Elusion Works enquiry flow | Questions an enquiry needs, with two that depend on earlier answers | `js/flow.js` |
| Kol's taste: title card, charcoal, white, one green; comic-book, not anime | A big white headline on charcoal, one green. Problems are black-on-white captions with a hard shadow, not a second colour | `screenshot.jpg` |
| Own folder, own review, nothing live | `demos/enquiry/`, this file, `noindex`, no gallery card, no sitemap entry | `index.html` |

## Checks run (17 Nov 2026)

Verified by running. All passed on the code as committed.

- `node demos/enquiry/tools/flow.test.mjs`: pass.
  - A good enquiry passes every step. 48 wrong answers each get the one message that says what to do, and 36 awkward but right ones pass (the test counts them as it runs).
  - No step can be reached past an unfinished one. Answers to questions not asked are dropped. What pasting leaves behind is tidied off.
- `node demos/enquiry/tools/smoke.mjs`: pass, in headless Chromium.
  - Scripts off, and before the script arrives: every question on one page; Enter in a box sends nothing and goes nowhere.
  - Each step offers exactly the answers the rules know. Every problem is listed at the top, said beside its question, marked and tied to its message, and the list takes the focus. A problem put right, or whose question goes away, leaves the list.
  - A new step takes the focus at its heading and changes the address and the title. The page's Back goes where the browser's would.
  - The check page shows the answers in the rules' own words. After a change you come straight back to it. Back and Forward move between the steps and the end.
  - Send makes no request. The text shown and copied is exactly what the rules say would be sent.
  - Phones 390x800, 320x568 and 740x360, and 1920x1080: every step fits, buttons and choices are at least 44 px tall, each new step and the end start in sight.
  - A browser really set to text twice the size: every step and the end fit a phone 390 and 320 wide.
  - axe WCAG 2.2 A and AA on all five steps and the end at five sizes, with problems showing, at large text and with scripts off. No console errors, no outside requests.
- One-off, by hand: with both guards against sending taken out, Enter does send the answers in the address; with either one in, it does not. So the check above would catch the fault.
- The repo's own rules, run locally: no element wider than the page at 320, 390 and 1280; axe clean; the first three Tabs land on visible things; `python3 scripts/build-site.py` passes.

## Not verified

1. **A screen reader.** What is said when the list of problems takes the focus is unheard.
2. **The look**, judged by a person. The reviewer called the first version a stock dark form; it was changed, and nobody has judged the result.
3. A real phone, Safari and Firefox, and a browser's own autofill.
4. Whether the questions are the ones Elusion Works wants to ask.

## Known limits

- No server, so no enquiry can arrive anywhere.
- The email check is a shape check.
- Only full-width, Arabic and Persian figures are read as plain ones in a phone number.
- Coming back to the page with the browser's Back, the browser may put old answers back in the boxes. The page then makes its count and its steps agree with them.
- In the list of steps the third is named "Time, budget", shorter than its heading, "Timing and budget".

## Independent review

A second pass by a separate Claude agent (Opus), read-only, given the brief and not the author's conclusions. It drove the form by keyboard and by touch at five sizes and at large text, and tried awkward input against the rules. 16 findings: 1 blocker, 8 should-fix, 7 minor.

| # | Finding | What was done | Held by |
|---|---|---|---|
| 1 | Blocker. With scripts off, or before the script arrived, Enter in a box sent every answer to the server in the address | The form's button is off until the script runs, and the form's method is one that goes nowhere. Either alone stops it | browser check, scripts off and script held back; one-off with the guards removed |
| 2 | At text twice the size the buttons ran off the side | Buttons wrap, and stack on a narrow screen; the headline, the steps and long words in the choices now fit | browser check in a browser set to 32 px text |
| 3 | The page's Back added a history entry, so the browser's Back then went forward | The page's Back goes back in history when the step before is there | browser check |
| 4 | After Send the browser's Back did nothing and the address did not match | The end has its own address. Back shows the answers again, Forward the end | browser check |
| 5 | A Change link sent you back through every later step | After a change the button reads "Back to your answers" and goes there, unless the change leaves a later step unfinished | browser check |
| 6 | Real inputs wrongly refused or taken: phone extensions and other scripts' figures, pasted addresses, addresses with stray dots and hyphens, links with other alphabets, words counted wrongly in Chinese or Japanese, lengths counted in code units | Rules rewritten. Links on localhost and links holding a password are still refused, on purpose | rules test, 84 cases |
| 7 | The checks claimed more than they did, and their counts were typed by hand | Every step and the end are axe-checked at every size; the page's Back and Enter with scripts off are pressed; counts are worked out as the test runs | the checks themselves |
| 8 | The README linked to this file before it existed, and names the owner | This file. The name stays, as in every demo on this list | |
| 9 | The look was a stock dark form: a second colour for errors, a step bar of bare numbers on phones, a left column with no relation to the step | Errors are black-on-white captions. The steps moved beside the form and show each finished answer; on a phone the step you are on is named. The step label inside the card is gone. The "Elusion Works" label above the headline stays: it is the house title card | by looking; not judged by a person |
| 10 | A problem stayed after its question went away | Problems leave the list when put right or no longer asked | browser check |
| 11 | Being put back by the address gave no reason | The step's problems are shown | browser check |
| 12 | An address that is no step stayed in the bar | It is corrected | browser check |
| 13 | Access details: problems likely read twice; a message read after a long hint; nothing marked as needed; the count never said aloud; done steps shown by colour only; Enter on a tick box went on a step | The list is a named group, not an alert. The message is read first. Needed boxes are marked. The count is said after a pause. Done steps carry a tick and the word. Enter on a choice does nothing | browser check for the order, the marking, the tick and Enter; the rest by reading the code |
| 14 | Coming back to the page brought old answers and a stale count; "gone when you leave" was not quite true | The page re-reads the boxes when shown again. The note no longer makes that claim | browser check for the count |
| 15 | A class that did nothing | Removed | |
| 16 | Words: lines that implied a reply would come; figures as words in one place and digits in another; "That is 5."; "press Send" | Reworded | by reading |

## Provenance

- No library, no font, picture or data file.
- The questions and the budget bands are original and made up for the demonstration.
