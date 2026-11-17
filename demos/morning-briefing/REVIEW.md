# Morning Briefing: review

Gap demo 2 of 7 on the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876): a phone briefing screen.
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to try on a phone. Not published, not in the gallery or the sitemap.

**Nobody has heard it, and nobody has swiped it with a finger.** The voice is the device's own, and the checks use a stand-in for it. Swiping is checked with touch input sent through the browser, not with a hand. The first minute on a real phone is part of the review.

**Quality bar it sets:** a phone screen whose reading and swiping are arithmetic that runs without a browser, so that the page can be held to it: the sentences it reads, how long each takes, when a card turns, and what a drag comes to are worked out once and checked twice.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| A phone briefing screen: 06:30 briefing reader | Seven sample cards for a 06:30 briefing, on a phone-sized screen; the phone is the page on a phone | `index.html` |
| Swipe cards | A deck: the card follows the finger, tips, and turns on a long drag or a flick; buttons and arrow keys too | `js/app.js`, `js/reader.js` |
| Audio player | Reads the briefing in the device's voice, a sentence at a time, marking its place; back, on, a slider, four speeds; reads along in silence where there is no voice | `js/app.js` |
| Kol's taste: charcoal, white, one green | White headlines on charcoal cards, one green for the accent, the progress and Play | `screenshot.jpg` |
| Own folder, own review, nothing live | `demos/morning-briefing/`, this file, `noindex`, no gallery card, no sitemap entry | `index.html` |

## Checks run (17 Nov 2026)

Verified by running. All passed on the code as committed.

- `node demos/morning-briefing/tools/reader.test.mjs`: pass.
  - Sentences split at real stops only, and lose nothing: abbreviations, initials, figures, times, quotes, list numbers, and a figure that starts a sentence.
  - Figures count as the words they are said in. Lines follow one another.
  - The player advances, carries over, holds for a voice, ends once, seeks within bounds and changes speed.
  - A long drag, a flick, a twitch and a drag taken back each come out as they should.
- `node demos/morning-briefing/tools/smoke.mjs`: pass, in headless Chromium.
  - Scripts off: seven cards one after another, saying it is a sample, with no control that could not work.
  - The page reads exactly the 42 sentences the arithmetic makes of its words, with the same lengths.
  - Buttons and arrow keys turn the cards and stop at the ends, where the focus passes to the other button. A long drag turns a card, tipping it by the angle the arithmetic gives. A press on a tick box ticks it; a drag across one turns the card and does not tick.
  - Looking through the cards marks nothing as read until Play has been pressed.
  - The player, in silence with the clock moved by hand: the sentence being read is marked; the card turns by itself; pause holds; speed changes the pace and the length; back, on, the slider and the keys work; a sentence chosen while a card is turning is kept; the end stops, says so, and starts again.
  - With a stand-in voice: each sentence goes to the device in British English at the speed chosen; the reading waits for the voice. Voices that never start, never finish, finish at once or fail are each caught, said, read in silence and can be tried again.
  - Eleven window sizes, from 320x568 to 1920x1080, with four phones on their side: Play and the card in sight on every card, nothing overlapping. A real touch swipe turns the card both ways on six of them. A tall card says there is more below.
  - Reduced motion; axe WCAG 2.2 A and AA; no console errors; no outside requests.
- The repo's own rules, run locally: no element wider than the page at 320, 390 and 1280; axe clean; the first three Tabs land on visible things; `python3 scripts/build-site.py` passes.

## Not verified

1. **The voice.** No real voice has spoken it. Whether the marking keeps up, whether the phone offers British English, and how each failure case really shows itself on iOS and Android are unheard.
2. **A finger.** Touch was sent through the browser's own input. Pinch to zoom over the cards was allowed in the styles, not tried.
3. **A screen reader.** The speech of the briefing and the speech of a screen reader may talk over each other; that has not been heard.
4. Safari and Firefox. A locked screen on iOS.
5. A drag in hand at the moment the reading reaches the next card: handled in the code, not covered by a check.

## Known limits

- A page cannot seek inside a spoken sentence: pausing and resuming says the sentence again from its start.
- Clock times are estimates at 165 words a minute, shown even when a voice is setting the real pace.
- Sentence splitting is rules of thumb.
- On a window both narrow and very short (under 540 by 560), the cards and player stack and the page scrolls.
- The comma and full stop keys work only while the briefing has the focus. That is on purpose: single keys that work everywhere get in the way of people who speak to their device.

## Independent review

A second pass by a separate Claude agent (Opus), read-only, given the brief and not the author's conclusions. It sent real touch input, used its own stand-in voices and tried its own prose. 28 findings: 1 blocker, 12 should-fix, 15 minor.

| # | Finding | What was done | Held by |
|---|---|---|---|
| 1 | Blocker. A finger swipe never turned a card: the browser took the sideways gesture, because each card scrolls and had not said which way a finger may go | The card itself now says so | browser check: real touch input, both ways, six sizes |
| 2 | Phones on their side broke at 915x412, 932x430 and 568x320 | The sideways layout is chosen by height | browser check at those three sizes |
| 3 | A voice that started and never finished froze the player for good | It is waited for three times the estimate and two seconds, then the reading goes on; twice, and the voice is switched off | browser check |
| 4 | A slow start or one error switched the voice off for the visit, with no way back | Four seconds to start; failures are said, and the Voice button stays on to try again | browser check |
| 5 | The sample contradicted itself: the silent job, the lanes, the costs | Rewritten so that the cards agree | by reading |
| 6 | The focus was lost at either end | It passes to the other button | browser check |
| 7 | Single keys worked anywhere on the page (WCAG 2.1.4) | Comma and full stop work only while the briefing has the focus | browser check |
| 8 | Looking through the cards looked like playback | Nothing is marked or called paused until Play has been pressed | browser check |
| 9 | A swipe could not start on a to-do item | It can; a press that became a drag does not tick | browser check |
| 10 | Tall cards gave no sign of more | The foot of the card says "More below" until it is reached | browser check at 320 |
| 11 | Pinch to zoom was blocked over the cards | Allowed | browser check on the style |
| 12 | The sentence splitter got ordinary prose wrong: figures after a stop, "plan A.", "9 a.m. The", list numbers; "1.8" counted as one word | New rules for each | reader test, 11 cases and 8 figures |
| 13 | README named a REVIEW.md that did not exist and claimed a finger swipe; dashes in a committed check | This file; the claim is now checked; no dashes | |
| 14 | Letting go of a drag as the reading turned the card skipped a card | The drag gives way to the reading | not covered by a check |
| 15 | A sentence chosen during a turn was undone | A turn in flight is overtaken, and the sentence stands | browser check |
| 16 | On a sentence at the last sentence spoke it again; back and on never switched off | Both switch off at their ends | browser check |
| 17 | A voice that ended at once ran through the briefing in a second and a half | An ending too quick to have been said is not believed | browser check |
| 18 | Lists inside cards were 20 px in from the text | Aligned | by looking |
| 19 | One card scrolled by a few pixels for no reason | Tightened | by looking |
| 20 | "62% used" sat at the halfway point | It sits at 62% | by looking |
| 21 | "1.8 s, slowest" wrapped | The name carries "slowest" | by looking |
| 22 | Play was announced as "Pause, pressed"; cards were articles with a group role; values came before their names | Play has one name and no pressed state; cards are plain groups named in the page itself; names come first | browser check |
| 23 | Amber was a second accent | Gone: white ink, a dashed edge, or the word itself | by looking |
| 24 | On a tablet the phone stretched to the full width | It keeps a phone's width, centred | browser check at 800x1000 |
| 25 | With scripts off the title was centred against a very long column | It stays at the top | by looking |
| 26 | The Space hint did not say that a focused button takes the key | It says so | |
| 27 | The card beneath showed behind the Back and Next buttons | It stays inside the deck | browser check |
| 28 | With no voice, Play stalled two and a half seconds | See 4. The wait is now four seconds, for slow voices, and is then said | browser check |

## Provenance

- No library, no audio, font or picture file. The voice is the device's own, through the Web Speech API.
- The briefing is invented sample text. It names no real system and reads none.
