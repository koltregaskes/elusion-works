# The weekly digest: review

Gap demo 6 of 7 on the Fable 5.2 benchmark list (hub issue koltregaskes/rooms-os-hub#1876): a newsletter template, as a weekly digest for AI Resource Hub.
Built 17 November 2026 by Claude Fable 5.2 in a Claude Code cloud session. Reviewed the same day.

## Verdict

Ready for Kol to look at. Not published, not sent, not in the gallery or the sitemap.

**No email program has opened it.** It passes 14 rules and fits in one browser. That is not the same as Outlook, Gmail or Apple Mail, and it must be sent to test inboxes before any real send. **The issue is a sample:** its resources and figures are made up.

**Quality bar it sets:** an email that is built, not hand-edited: one file of data in, the email and its plain text out, and 14 rules that read the finished email itself, tag by tag and piece of text by piece of text.

## Against the brief

| Asked for | Result | Evidence |
|---|---|---|
| A newsletter template | One issue of plain data is made into an email and its plain text. Parts left empty are left out | `js/issue.js`, `js/email.js` |
| AI Resource Hub digest | A weekly digest: a note, new resources, figures, reading, a prompt, a button | `email.html`, `email.txt` |
| Kol's taste: title card, charcoal, white, one green; comic-book, not anime | White on charcoal, one green. The title sits in a panel, section names are black-on-white captions, the figures are a strip of panels | `thumbnail.png` |
| Own folder, own review, nothing live | `demos/hub-digest/`, this file, `noindex` on the page and the email, no gallery card, no sitemap entry. Nothing is sent | `index.html`, `email.html` |

## Checks run (17 Nov 2026)

Verified by running. All passed on the code as committed.

- `node demos/hub-digest/tools/email.test.mjs`: pass.
  - The files beside the page are the ones the issue makes. The sample passes all 14 checks.
  - 81 faults put in by hand on the finished email, several ways for each check, are each caught by the right check and no other. They include the ways the first version of the checks missed.
  - Words that only look like faults pass. Markup in the words is made safe. An issue filled in wrongly, or a link that cannot be sent, stops the build.
  - Parts left out are left out. Japanese, and a name of one very long word, still build. Dates, reading time, wrapping and contrast match values worked out by hand.
- `node demos/hub-digest/tools/smoke.mjs`: pass, in headless Chromium.
  - Scripts off: the email in its frame, a link to its plain text, the inbox line and the checks as made.
  - The checks are run again in the browser on the file as served. Tab follows what is seen without the page moving.
  - The email shows 600 and 375 wide in a frame as tall as its words. The whole button is its link: the link fills the green shape, a press on the green away from the words reaches it, and its focus ring is white where the other links' is green. A link pressed in the preview leaves it as it was and fetches nothing.
  - The email on its own fits 1280, 600, 375 and 320 wide, also with its style block taken out. Five awkward issues fit at 600, 375 and 320.
  - Phones 390x800, 320x568 and 740x360 by touch, 1920x1080, and text at twice the size: the preview page fits.
  - axe WCAG 2.2 A and AA on the preview page in its three looks and on the email. No console errors.
- The repo's own rules, run locally: no element wider than the page at 320, 390 and 1280; axe clean; `python3 scripts/build-site.py` passes, including its check on outside addresses.

## Not verified

1. **Any email program.** Outlook on Windows, Gmail on the web and in its apps, Apple Mail, Outlook.com, Yahoo. This is the big one.
2. **Dark and light modes in real inboxes.** Some programs change a dark email's colours. Two lines are in the style block for Outlook's; nobody has seen them work.
3. **The look**, judged by a person. The reviewer called the first version a stock dark newsletter; it was changed, and nobody has judged the result.
4. **A screen reader**, and a real phone.
5. Whether theairesourcehub.com is the Hub's live address. It comes from this site's own list.

## Known limits

- The checks read tags, text, colours and sizes. They cannot see layout, so whether something sticks out is a browser check on the sample and five awkward issues.
- Contrast is held to 4.5 to 1 for every piece of text, large or small.
- A colour written as a name, or a size not in px, fails the checks on purpose: they cannot weigh it up.
- The plain-text check compares letters and figures only, so it would not notice punctuation that differs.
- With scripts off, links in the preview load in the frame.

## Independent review

A second pass by a separate Claude agent (Opus), read-only, given the brief and not the author's conclusions. It read the email as an email developer, tried to get faults past each check, changed the data, and drove the preview at five sizes. It tested in no email program. 13 findings: 3 blockers, 6 should-fix, 4 minor.

| # | Finding | What was done | Held by |
|---|---|---|---|
| 1 | Blocker. Ten of the 14 checks were weaker than their names. Each could be passed by a slightly different fault: small text written with a space, a colour pair never worked out, a script handler in single quotes, a hidden line that was not hidden, a plain text with only the links | The checks were rebuilt. They now take the email apart and work on its tags and on each piece of text with its own colour, background and size. Names say what is tested. Words that only look like faults pass | builder test: faults by hand (64 at the time; 81 now), including the reviewer's |
| 2 | Blocker. The button's padding was on the link, which Outlook ignores | Colour and padding were put on the table cell. (That left only the words pressable; the outside review below caught it. The padding is now on the link, and on the cell for Outlook alone) | builder test and browser check of the markup; not seen in Outlook |
| 3 | Blocker. One very long word, or wide figures, made the email wider than the screen, and empty parts kept their headings | Words wrap. Figures are limited to 7 characters and 2 to 4 in a row, share the width evenly and shrink on a phone. Empty parts are left out. An issue filled in wrongly stops the build | builder test; browser check on five awkward issues at three widths |
| 4 | Markup gaps for real sending: no exact line heights for Outlook, a padded paragraph, the language only where webmail removes it, the lead story not a heading, no thought for dark mode | Exact line heights throughout. The notice is a table cell. The language and a label are on the email itself. The lead story is a heading. Two lines for Outlook's dark mode. The README lists what a sender still has to do | builder test for the markup; none seen in a client |
| 5 | A link pressed in the preview replaced the email with a missing page, or went to the Hub | Links in the preview do nothing but say where they would go | browser check |
| 6 | The first Tab jumped far down the page, past the choices in view | The page is in reading order: title, email, checks | browser check: Tab lands on what is seen and the page does not move |
| 7 | "Desktop" on a narrow screen was not a desktop, and "Phone" was only a narrow frame | The choices are "600 wide" and "375 wide". The page says the width really shown, and that a frame is not a phone | browser check |
| 8 | Wording that claimed too much: "every link leads to the Hub", "UK rules ask for both in any marketing email", "dark in every inbox", checks "proved" | Reworded. The legal line now says only that both are present and that the sender must check | by reading |
| 9 | Tests that proved less than they said: colours for a light theme, the Tab check, a colour fault that never reached the sum | Removed or replaced with real ones | the checks themselves |
| 10 | Logic: 31 February accepted; good links refused and bad ones taken; apostrophes not made safe; "1 minutes" | Dates checked against the calendar. Links are parsed, not pattern-matched. Apostrophes are made safe. Minutes must be whole numbers | builder test |
| 11 | Preview details: the sender read out twice, an unclear message when copying fails | Fixed | browser check for the message |
| 12 | Words: the opening note did not match the list; "31 checked and still working"; "a prompt that checks its own work"; capitals after "Good for:" | Rewritten | by reading |
| 13 | The look: a stock dark newsletter, nothing of the comic about it | The title sits in a panel, section names are captions, the figures are a strip, and the rules between sections are gone | by looking; not judged by a person |

Two things found by the author on the way. The site's own build refuses a page that names an outside address it does not list, so the sample's links go to the Hub's own address and the plain text is read from its file. And the email file is served as a page here, so it carries a `noindex` mark that an inbox ignores.

## Outside review

A second, outside review was posted on the pull requests on 18 November 2026: ChatGPT in chat mode at Pro, driven by another Claude session at Kol's request. It covered this demo with Close Shave, read the code and pictures, and did not open the email. It scored the pair 7 out of 10 and said HOLD. It found no tracking, no sending code and no real address in the email.

| Finding | What was done | Held by |
|---|---|---|
| Only the button's words could be pressed. The padding was on the table cell, so the green round the words was not part of the link | True. The link itself is now padded and coloured, so the whole green shape is the link. For Outlook on Windows, which throws a link's padding away, the same padding is put on the cell by a rule only Outlook reads, so it should still look like a button there, though there only its words can be pressed | builder test of the markup, cell and link; browser check: the link's box is the button's box, all four corners and the edge are the link, and a real press on the edge reaches it |
| The button's focus ring was the same green as the button, so it could not be seen | True. The button's ring is white and stands three pixels clear of the green. The other links keep the green ring, which shows against the dark page | builder test; browser check of the ring's colour, width and gap; looked at in a picture |
| The check measured the table cell, not the link | True. It now measures the link | the checks above |
| No email program has opened it, in light or dark | Still true, and still the big one. Listed under Not verified. The Outlook rule above is the part most in need of a real look | |
| The demo's own tests do not run in the repo's CI | Not done here: CI is shared by the whole site, and changing it is outside this demo's folder | |

The same reviewer, reading other demos, found two places where a comment written part way along a line had swallowed the code after it. Every demo was scanned for that mistake, and this one's rules test had it: one of the faults put in by hand, a link with no words to press, was never tried. It is restored and is caught by the right rule, so the count is 65 faults, not 64.

### Second-family review, 20 November 2026

Codex, a model from a different family, read the code, tests and CI results on 19 November (relayed onto the pull request by another Claude session) and said to keep this in draft. Its test reviewer found two things that mattered.

| Finding | What was done | Held by |
|---|---|---|
| The email a visitor would copy from the built website was not the email the builder made. The website adds lines of its own to every page when it is built, and the preview page read the email from that page. A real build confirmed it: 22,467 bytes served against 21,984 made, the extra being the website's security policy and referrer rule. Copy the HTML would have handed those over as part of the email | The email itself is now also written to `email.html.txt`, a file the website leaves alone, and that is what the page copies, checks and counts. `email.html` stays as the page shown in the frame. The one line this demo used to put in the email for the web's sake (`noindex`) is no longer in the email at all: it is added only to the page | `built.test.mjs`, new: after a real build, the two files a visitor takes are the email byte for byte, and the page differs from it by three web lines and nothing else. It fails on one changed byte in either file (tried). The browser check passes against the built site as well as the source |
| Three faults got past all 14 checks: two resources' names changed over in the plain text; the headline made the colour of the page by a rule in the style block; the table only Outlook reads made 900 wide | True of all three. The plain text is now held to the email's order, each link with its own words. The style block may set a colour only in the two dark mode lines and only to the colour the thing already has, and may hide nothing. The Outlook table must be there once, marked as layout, and 600 wide | builder test: 16 more faults by hand, 81 in all, each caught by the right check and no other |
| To hold the order, the plain text had to follow the email's | It now gives the name, the link to read online, the title and the issue line in that order, and each resource as "Tool: Lanternfile" where it had "Lanternfile (Tool)" | builder test |
| No email program has opened it; whether `REVIEW.md` and `proof.jpg` are meant to stay as public files | Still true; for Kol | Kol |

The preview already on the live site, copied there on 18 November by another session, has the first fault: its Copy the HTML gives the retagged page.

## Provenance

- No library, no font, picture or data file.
- The issue's words are original sample text. Its resources, figures and titles are made up.
