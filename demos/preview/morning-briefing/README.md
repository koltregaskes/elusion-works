# Morning Briefing

A phone screen for a 06:30 briefing. Seven cards to swipe through, and a player that reads them aloud a sentence at a time and marks its place in the words. The second of the seven gap demos on Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

**The briefing is a sample.** The day, the jobs, the sites, the costs and the list are made up. No real system is read. The first card and the page both say so.

**Quality bar it sets:** a phone screen whose reading and swiping are arithmetic that runs without a browser, so that the page can be held to it: the sentences it reads, how long each takes, when a card turns, and what a drag comes to are all worked out once and checked twice.
Use it as the reference for phone-first screens, card decks and anything with a player.

## What it does

- **Seven cards.** The short version, overnight, sites, lanes, costs, today's three things, and the end. One on top, the next showing its edge beneath.
- **Swipe.** Drag a card left to go on, right to go back, from anywhere on it. It follows the finger and tips as it goes. A short drag, or one taken back, lets it settle where it was. Up and down scrolls a tall card, and a tall card says when there is more below.
- **Or use the buttons and keys.** Back and Next under the cards; left and right arrows; Space to play or pause. With the briefing selected, comma and full stop go back and on a sentence.
- **Listen.** Play reads the briefing one sentence at a time in a voice your device says is its own (the browser's `localService` flag). The sentence being read is marked and the ones before it go quiet. When the reading reaches the next card, the card turns by itself.
- **Read along in silence.** Switch the voice off and the marking carries on at the same pace. A device that offers no voice of its own does this from the start and says why: no voices yet (they may still be loading), only voices that may send the words to a service elsewhere, or no English one. Such voices are never given the words, and neither is the browser's default. If a voice of the device's own arrives later, it takes over from the next sentence.
- **Voices that go wrong.** A voice that never starts, never says it has finished, says so at once, or fails is caught. The page says what happened, reads along in silence, and leaves the Voice button on so that it can be tried again.
- **Move about.** Back a sentence, on a sentence, a slider over the whole briefing, and four speeds. Turning a card takes the reading with it.
- **Today's list** has tick boxes. Ticks are not kept: nothing is stored.
- **Scripts off.** The seven cards show one after another, and the controls that could not work are not shown.

## How it is made

- `index.html`: every word of the briefing, the styles and the markup. On a wide screen it shows a phone beside a title; on a phone the phone is the page.
- `js/reader.js`: splitting prose into sentences, how long each takes to say, the player (advance, hold for a voice, seek, speed, end), which voice may be used (`pickVoice`) and what a drag comes to. No page and no sound, so all of it runs in Node.
- `js/app.js`: turns the cards, listens to fingers and keys, speaks through the Web Speech API where there is one, and paints the player.
- No library, no audio file, no outside request from the page, nothing stored. The words go only to a voice the device calls its own; whether that is true is the device's word, which a page cannot check.

## Checks

From the site's root, with the site served on port 8781:

```bash
node demos/morning-briefing/tools/reader.test.mjs
```

```bash
node demos/morning-briefing/tools/smoke.mjs node_modules/axe-core/axe.min.js http://127.0.0.1:8781
```

```bash
node demos/morning-briefing/tools/shots.mjs http://127.0.0.1:8781 demos/morning-briefing
```

The second and third need the site's development packages (Playwright and axe-core, from `npm install` at the site's root) and a Chromium that Playwright can find, or `PW_CHROMIUM` set to one. [REVIEW.md](REVIEW.md) lists what each one proves, what an independent review found and what nobody has checked.

## Honest limits

- **Nobody has heard it.** The checks use a stand-in for the device's voice. How a real voice sounds, how well the marking keeps up with it, and whether British English is what a given phone offers are all unheard.
- The voice is the device's. Some browsers have none, some may offer only voices they mark as not their own (and then this page stays silent), some stop speaking when the screen locks, and none let a page seek within a sentence: pausing and resuming says the sentence again from its start.
- Timings are estimates at 165 words a minute. With a voice, the player waits for the voice; the clock times shown are still the estimates.
- Nobody has swiped it with a real finger. The checks send touch input through the browser itself, which is closer than made-up events and is what caught a swipe that never turned a card, but it is not a hand on glass.
- Sentence splitting is rules of thumb. It is right for the 42 sentences here and for the awkward cases in the test; prose can always be found that fools it.
- Checked only in headless Chromium. Not yet seen in Safari or Firefox or on a real phone, and no screen reader has been heard on it.

## Status

A draft, and unlisted. The page carries `noindex`, and it is not in the gallery or the sitemap.

Unlisted is not private. The site deploys whatever is merged, so merging this would put the page on the live site at its own address (`/demos/morning-briefing/`): not listed anywhere, but reachable by anyone who has the link.
