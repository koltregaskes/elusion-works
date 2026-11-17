# Start a project: an enquiry form in steps

A five-step enquiry form for Elusion Works: what you need, a few words about it, timing and budget, how to reach you, then a page to check your answers before anything goes anywhere. The fourth of the seven gap demos on Kol's Fable 5.2 benchmark list, built with Claude Fable 5.2.

**It is a demonstration. Nothing is sent and nothing is stored.** There is no server behind it. Pressing Send shows the text that would have been sent, and that is all.

**Quality bar it sets:** a form whose rules live in one file that the page cannot disagree with: every question, every answer and every error message is checked in the browser against that file, the focus is followed through every step and every mistake, and Send is proved to send nothing.
Use it as the reference for forms, sign-ups and anything that asks people questions in order.

## What it does

- **Five steps, one at a time.** A row of numbered steps along the top shows where you are. The step's heading takes the focus when it opens, so a screen reader says where you now are.
- **Questions that depend on answers.** "Something else" asks what. "By phone" asks for a number. An answer to a question that is no longer asked is dropped.
- **Mistakes said plainly, twice.** Press Continue with something missing and a list of problems opens at the top of the step and takes the focus. Each line is a link to its question. The same words appear beside the question, and the box is marked and tied to its message. Messages say what to do ("Enter an email address like name@example.com"), not what went wrong.
- **A word count that helps.** Under the big box: how many words so far, how many more to go, or how many too many.
- **Check your answers.** Every answer in words, each part with a Change link back to its step. Your answers are still there when you get back.
- **Back and Forward work.** The address says which step is shown. A step past an unfinished one cannot be reached by its address.
- **The end.** "Nothing was sent", and the exact text of the enquiry, with a button to copy it and a button to start again.
- **With scripts off** every question shows on one page, and the page says that it can then neither check nor show the answers.

## How it is made

- `js/flow.js`: the rules. The steps, the choices, what counts as an answer, the message for each wrong one, how far you may go, the answers in words and the text of the enquiry. No page, so it runs in Node.
- `js/app.js`: shows a step, reads the form, asks the rules what is wrong and says it, and builds the check page and the end from what the rules return.
- `index.html`: every question, the styles and the markup.
- No library, no font or picture file, no outside request.

## Checks

From the site's root, with the site served on port 8783:

```bash
node demos/enquiry/tools/flow.test.mjs
```

```bash
node demos/enquiry/tools/smoke.mjs node_modules/axe-core/axe.min.js http://127.0.0.1:8783
```

```bash
node demos/enquiry/tools/shots.mjs http://127.0.0.1:8783 demos/enquiry
```

The second and third need the site's development packages (Playwright and axe-core, from `npm install` at the site's root) and a Chromium that Playwright can find, or `PW_CHROMIUM` set to one. [REVIEW.md](REVIEW.md) lists what each one proves, what an independent review found and what nobody has checked.

## Honest limits

- There is nowhere for an enquiry to go. Making this a working form means a server or a form service, and a decision about where enquiries are kept. Neither is here.
- The questions, the kinds of work and the budget bands are made up for the demonstration. They are not Elusion Works' real offer or prices.
- The email check is a shape check. It cannot tell whether an address exists.
- Answers are lost if the page is reloaded. Nothing is stored, on purpose.
- Checked only in headless Chromium. Not yet seen in Safari or Firefox or on a real phone, and no screen reader has been heard on it.

## Status

Unlisted. The page carries `noindex`, and it is not in the gallery or the sitemap. Nothing here is published.
