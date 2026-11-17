# The weekly digest: an email template for AI Resource Hub

A newsletter template. One issue of plain data goes in; an email and its plain-text twin come out, and a preview page shows the email as a desktop and a phone would, with the checks an email has to pass. The sixth of the seven gap demos on Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

**It is a sample issue, and nothing is sent.** There is no mailing list behind it. The resources and figures in the email are made up, and every link in it leads to the Hub's front page.

**It has not been opened in an email program.** It was checked against the rules email programs are known to enforce, and looked at in one browser. Outlook, Gmail and Apple Mail have not seen it.

**Quality bar it sets:** an email that is built, not hand-edited: one file of data in, the email and its plain text out, and 14 rules run on the finished email itself, each proved to fail when its fault is put in by hand.
Use it as the reference for newsletters and any email sent to more than one person.

## What it does

- **The email.** A title, an opening note, four new resources, three figures, three things to read, a prompt to try, one button, and a footer with a way to stop the emails and a place for the sender's postal address. Charcoal, white and one green, as on the site.
- **Written for inboxes.** Tables for layout, every style on the element it applies to, no pictures to be blocked, no script, nothing fetched, no web fonts. One column up to 600 wide that narrows by itself, so it still fits a phone when an email program throws its style block away.
- **The same issue as plain text,** wrapped at 72 characters, with every link the email has.
- **How an inbox shows it:** the sender, the subject and the hidden line that follows the subject.
- **Desktop, Phone, Plain text.** The preview shows the email 600 wide, 375 wide, or as its plain text.
- **14 checks, run on the finished email:** small enough not to be cut off by Gmail, a subject that fits, the hidden line, no pictures, no script, nothing fetched, secure links, a way to stop the emails and who sent them, layout tables that screen readers skip, only styling that Outlook and Gmail keep, text large enough, colour pairs that are easy to read, the language and title, and a plain text that says the same. The page runs them again in your browser on the file as served.
- **Copy the HTML, Copy the plain text,** and links to each file on its own.
- **With scripts off** the email is still shown, with the inbox line, the checks as they were when it was made, and a link to the plain text.

## How it is made

- `js/issue.js`: one issue as plain data. This is the only file an editor changes.
- `js/email.js`: `render()` makes the email and its plain text from an issue; `lint()` checks the result. A link that is not a full, secure address stops the build. Words are made safe, so the data cannot put markup into the email. No page, so it runs in Node.
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

- No email program has opened it. The rules it is checked against are the well-known ones (table layout, inline styles, no pictures, size under Gmail's cut-off), but rules are not the same as seeing it in Outlook. Before a first real send it should be sent to test inboxes.
- Nothing sends it. A real newsletter needs a sending service, a list of people who asked for it, and a working way to stop. None of that is here, and none of it should be added without Kol's say-so.
- UK rules ask a marketing email to say who sent it and how to stop it. The template has a place for both; whether a given send meets the rules is for whoever sends it.
- The email is dark in every inbox. It does not turn light for readers who prefer light, on purpose: it is the site's look.
- The sample's resources, figures and titles are made up. The Hub's address, theairesourcehub.com, is taken from this site's own list of sites it links to; this session did not open it.
- Checked only in headless Chromium, and no screen reader has been heard on it.

## Status

Unlisted. The preview page and the email file both carry `noindex`, and neither is in the gallery or the sitemap. Nothing here is published or sent.
