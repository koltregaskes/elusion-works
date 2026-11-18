# The weekly digest: an email template for AI Resource Hub

A newsletter template. One issue of plain data goes in; an email and its plain-text twin come out, and a preview page shows the email as a desktop and a phone would, with the checks an email has to pass. The sixth of the seven gap demos on Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

**It is a sample issue, and nothing is sent.** There is no mailing list behind it. The resources and figures in the email are made up. Its links lead to the Hub's front page, or are left for the sender to fill in.

**It has not been opened in an email program.** It was checked against the rules email programs are known to enforce, and looked at in one browser. Outlook, Gmail and Apple Mail have not seen it.

**Quality bar it sets:** an email that is built, not hand-edited: one file of data in, the email and its plain text out, and 14 rules that read the finished email itself, tag by tag and piece of text by piece of text. 65 faults put in by hand, several ways for each rule, are each caught by the right rule.
Use it as the reference for newsletters and any email sent to more than one person.

## What it does

- **The email.** A title in a panel of its own, an opening note, four new resources, a strip of figures, three things to read, a prompt to try, one button, and a footer with a way to stop the emails and a place for the sender's postal address. Charcoal, white and one green, as on the site, with section names as black-on-white captions. A part left empty in the data is left out, heading and all.
- **Written for inboxes.** Tables for layout, every style on the element it applies to, no pictures to be blocked, no script, nothing fetched, no web fonts. One column up to 600 wide that narrows by itself, so it still fits a phone when an email program throws its style block away. The button's colour and padding are on its table cell, so it stays a button where a link's own padding is ignored. Long words wrap.
- **The same issue as plain text,** wrapped at 72 characters, with every link the email has.
- **How an inbox shows it:** the sender, the subject and the hidden line that follows the subject.
- **600 wide, 375 wide, Plain text.** The preview shows the email at its full width, at about a phone's width, or as its plain text, and says what width it is really shown at. A frame 375 wide is not a phone: a phone's email program adds its own margins and may change the colours. A link pressed in the preview does nothing but say where it would go.
- **14 checks that read the finished email.** They take the email apart into its tags and its pieces of text, and work out for each piece the colour, the background and the size it ends up with. Small enough not to be cut off by Gmail; a subject that fits; a hidden line for the inbox, first and really hidden; no pictures; no script, form or frame; nothing fetched; every link a full, secure address or left for the sender; a way to stop and a place for who sent it, both in words a reader sees; layout tables that screen readers skip; no flex, grid or positioning; every piece of text large enough; every piece of text easy to read against what is behind it; the language said on the page and on the email; and a plain text that holds every piece of text and every link. The page runs them again in your browser on the file as served.
- **Copy the HTML, Copy the plain text,** and links to each file on its own.
- **With scripts off** the email is still shown, with the inbox line, the checks as they were when it was made, and a link to the plain text.

## How it is made

- `js/issue.js`: one issue as plain data. This is the only file an editor changes.
- `js/email.js`: `render()` makes the email and its plain text from an issue; `lint()` checks the result. An issue filled in wrongly, or a link that is not a full, secure address, stops the build and says what is needed. Words are made safe, so the data cannot put markup into the email. No page, so it runs in Node.
- `tools/build.mjs`: writes `email.html`, `email.txt` and the parts of the preview page that come from the issue. It refuses to write an email that fails a check.
- `email.html`, `email.txt`: the built email. `email.html` carries one line that is for the web and not for inboxes, a `noindex` mark, because the file is also served as a page here.
- `js/app.js`, `index.html`: the preview page.
- Three places are left for whatever sends the email to fill in: `{{unsubscribe_url}}`, `{{view_online_url}}` and `{{postal_address}}`.
- No library, no font or picture file, no outside request.

## Checks

From the site's root, with the site served on port 8785:

```bash
node demos/hub-digest/tools/email.test.mjs
```

```bash
node demos/hub-digest/tools/smoke.mjs node_modules/axe-core/axe.min.js http://127.0.0.1:8785
```

```bash
node demos/hub-digest/tools/shots.mjs http://127.0.0.1:8785 demos/hub-digest
```

After changing the issue, make the email again:

```bash
node demos/hub-digest/tools/build.mjs
```

The second and third need the site's development packages (Playwright and axe-core, from `npm install` at the site's root) and a Chromium that Playwright can find, or `PW_CHROMIUM` set to one. [REVIEW.md](REVIEW.md) lists what each one proves, what an independent review found and what nobody has checked.

## Honest limits

- No email program has opened it. The checks are rules, and rules are not the same as seeing it in Outlook, Gmail or Apple Mail. Before a first real send it has to be sent to test inboxes. Things most likely to differ there, none of them seen: Outlook on Windows ignores rounded corners and some spacing, and is expected to let only the button's words be pressed, not the green round them (everywhere else the whole button is the link); some programs lighten or invert a dark email in their own dark mode (two lines in the style block are there for Outlook's, untested); a phone may turn the date or the address into a link.
- The checks cannot see layout. They do not know whether something sticks out. That is checked in a browser, on the sample and on five awkward issues, not on whatever an editor writes next.
- Nothing sends it. A real newsletter needs a sending service, a list of people who asked for it, and a working way to stop. The sending service also has to add the one-click unsubscribe headers that Gmail and Yahoo ask of bulk senders, and its tracked links and encoding make the email bigger than the size measured here. None of that is here, and none of it should be added without Kol's say-so.
- The template has a place for a way to stop the emails and for who sent them. Whether a given send meets the law is for whoever sends it to check; nothing here is legal advice.
- It is designed dark, on purpose: it is the site's look. Whether every inbox leaves it dark is not known.
- The sample's resources, figures and titles are made up. The Hub's address, theairesourcehub.com, is taken from this site's own list of sites it links to; this session did not open it.
- With scripts off, the preview's links are live and load in the frame.
- Checked only in headless Chromium, and no screen reader has been heard on it.

## Status

Unlisted draft. The preview page and the email file both carry `noindex`, and neither is in the gallery or the sitemap. Nothing here is published or sent. The site deploys its main branch, so merging this would put the preview page and the email file on the live site at /demos/hub-digest/, where anyone with the address could open them.
