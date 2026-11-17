// Start a project: the enquiry form's rules. What the steps are, what each one asks, what counts as an answer, what is wrong with an answer that is not one, and what the finished enquiry says.
// Nothing here touches the page, so every rule can be checked in Node.

export const STEPS = [
  { id: 'need', title: 'What do you need?', short: 'The work' },
  { id: 'work', title: 'Tell us about it', short: 'About it' },
  { id: 'when', title: 'Timing and budget', short: 'Time, budget' },
  { id: 'you', title: 'How do we reach you?', short: 'You' },
  { id: 'check', title: 'Check your answers', short: 'Check' },
];
export const NEEDS = [['site', 'A website or a page'], ['demo', 'A demo or a prototype'], ['auto', 'An automation or a data pipeline'], ['review', 'A second pair of eyes on something you have'], ['other', 'Something else']];
export const WHEN = [['soon', 'As soon as possible'], ['month', 'In the next month or two'], ['later', 'Later this year'], ['open', 'There is no date']];
export const BUDGET = [['small', 'Under £1,000'], ['mid', '£1,000 to £5,000'], ['large', 'Over £5,000'], ['unsure', 'Not sure yet']];
export const REPLY = [['email', 'By email'], ['phone', 'By phone']];
export const LIMITS = { aboutMin: 10, aboutMax: 300, otherMax: 80, nameMax: 80 };
export const blank = () => ({ needs: [], other: '', about: '', link: '', when: '', budget: '', name: '', email: '', reply: 'email', phone: '', agree: false });

// Words and characters are counted as a reader would count them, where the browser can: "don't" is one word, a sentence of Japanese is more than one, and an accented letter or an emoji is one character.
const cutter = how => (typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en-GB', { granularity: how }) : null), BY_WORD = cutter('word'), BY_CHAR = cutter('grapheme');
export const words = text => { const t = String(text).trim(); if (!t) return 0; if (!BY_WORD) return (t.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length; let n = 0; for (const part of BY_WORD.segment(t)) if (part.isWordLike) n++; return n; };
export const chars = text => (BY_CHAR ? [...BY_CHAR.segment(String(text))].length : [...String(text)].length);
const label = (list, key) => (list.find(x => x[0] === key) || [])[1] || '';
// A host name: letters and figures of any alphabet in parts joined by full stops, no part starting or ending with a hyphen, and a last part of two letters or more.
const PART = '[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]*[\\p{L}\\p{N}])?', HOST = new RegExp(`^${PART}(?:\\.${PART})*\\.(?:\\p{L}{2,}|xn--[a-z0-9-]{2,})$`, 'iu');
const isEmail = s => { const at = s.lastIndexOf('@'), name = s.slice(0, at); return at > 0 && /^[^\s@<>()[\],;:\\"]+$/.test(name) && !/^\.|\.$|\.\./.test(name) && HOST.test(s.slice(at + 1)); };
// A web address: with or without http, a host, and whatever follows. An address with a name and password in it is refused, and so is one on this machine: neither is something to send.
const isLink = s => { const m = /^(?:https?:\/\/)?([^\s/?#:@]+)(?::\d{1,5})?(?:[/?#]\S*)?$/iu.exec(s); return !!m && HOST.test(m[1]); };
const digits = s => (String(s).match(/\d/g) || []).length;
// Figures typed full width, or in Arabic or Persian script, as plain figures.
const plainFigures = s => s.normalize('NFKC').replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x6f0));
// What to do about a phone number that will not do, or '' if it will. A note in brackets at the end, such as (mobile), and an extension are allowed for.
export const PHONE = { least: 7, most: 15 };
function phoneFix(phone) { let main = phone.replace(/\s*\([^()\d]*\)\s*$/, ''); const ext = /\s*(?:ext\.?|extension|x)\s*\d{1,6}$/i.exec(main); if (ext) main = main.slice(0, ext.index); const n = digits(main);
  if (/[^\d\s()+./-]/.test(main) || main.replace(/^\s*\(?\+/, '').includes('+') || /[./-]\s*[./-]/.test(main) || !n) return 'Enter a phone number in figures, like 020 7946 0000';
  if (n < PHONE.least) return `Enter the whole phone number, with its area code. You have entered ${n} ${n === 1 ? 'figure' : 'figures'}.`; if (n > PHONE.most) return `Enter a shorter phone number. You have entered ${n} figures, and ${PHONE.most} is the most a phone number has.`; return ''; }

// The answers with the space round them taken off, and with answers to questions that were not asked taken out: the "something else" text when Something else is not ticked, the phone number when the reply is by email.
export function tidy(d) { const t = { ...blank(), ...d, needs: NEEDS.map(n => n[0]).filter(k => (d.needs || []).includes(k)) }; for (const k of ['other', 'about', 'link', 'when', 'budget', 'name', 'email', 'reply', 'phone']) t[k] = String(t[k] ?? '').trim(); if (!t.needs.includes('other')) t.other = ''; if (t.reply !== 'phone') { t.reply = 'email'; t.phone = ''; } t.agree = !!t.agree;
  /* What pasting leaves behind: "Sam Carter <sam@example.com>" from a mail program, a comma after an address, a bracket or a full stop after a link. */
  const inside = /<([^<>\s]+)>$/.exec(t.email); if (inside) t.email = inside[1]; t.email = t.email.replace(/[,;]+$/, ''); while (/[.,;]$/.test(t.link) || (t.link.endsWith(')') && !t.link.includes('('))) t.link = t.link.slice(0, -1); t.phone = plainFigures(t.phone); return t; }

// What is wrong with a step's answers: a list of { field, message }, empty when nothing is. The message says what to do, not what went wrong.
export function check(step, data) { const d = tidy(data), out = [], bad = (field, message) => out.push({ field, message });
  if (step === 'need') { if (!d.needs.length) bad('needs', 'Choose at least one kind of work'); if (d.needs.includes('other')) { if (!d.other) bad('other', 'Say what the something else is'); else if (chars(d.other) > LIMITS.otherMax) bad('other', `Say what it is in ${LIMITS.otherMax} characters or fewer`); } }
  if (step === 'work') { const n = words(d.about); if (!n) bad('about', 'Tell us about the work'); else if (n < LIMITS.aboutMin) bad('about', `Tell us a little more: ${LIMITS.aboutMin} words or more. You have written ${n}.`); else if (n > LIMITS.aboutMax) bad('about', `Keep it to ${LIMITS.aboutMax} words. You have written ${n}.`); if (d.link && !isLink(d.link)) bad('link', 'Enter a web address like example.com, or leave this empty'); }
  if (step === 'when') { if (!label(WHEN, d.when)) bad('when', 'Choose when you need it'); if (!label(BUDGET, d.budget)) bad('budget', 'Choose a budget, or choose "Not sure yet"'); }
  if (step === 'you') { if (!d.name) bad('name', 'Enter your name'); else if (chars(d.name) > LIMITS.nameMax) bad('name', `Enter a name of ${LIMITS.nameMax} characters or fewer`); if (!d.email) bad('email', 'Enter your email address'); else if (!isEmail(d.email)) bad('email', 'Enter an email address like name@example.com'); if (d.reply === 'phone') { if (!d.phone) bad('phone', 'Enter a phone number'); else if (phoneFix(d.phone)) bad('phone', phoneFix(d.phone)); } }
  if (step === 'check') { if (!d.agree) bad('agree', 'Tick the box to say you understand that nothing is sent'); }
  return out; }
// The furthest step that may be shown: the first one with something wrong, or the last. A step cannot be reached by its address while an earlier one is unfinished.
export const furthest = data => { const i = STEPS.findIndex(s => s.id !== 'check' && check(s.id, data).length); return i < 0 ? STEPS.length - 1 : i; };
export const stepOf = id => Math.max(0, STEPS.findIndex(s => s.id === id));
// Whether the whole enquiry is ready to send.
export const ready = data => STEPS.every(s => !check(s.id, data).length);

// The answers as the check page shows them: for each step that asked something, its questions and answers in words.
export function answers(data) { const d = tidy(data); return [
  { step: 'need', rows: [['Kind of work', d.needs.map(k => (k === 'other' ? `Something else: ${d.other}` : label(NEEDS, k))).join('; ')]] },
  { step: 'work', rows: [['About the work', d.about], ['A link', d.link || 'None given']] },
  { step: 'when', rows: [['When', label(WHEN, d.when)], ['Budget', label(BUDGET, d.budget)]] },
  { step: 'you', rows: [['Name', d.name], ['Email', d.email], ['Reply', d.reply === 'phone' ? `By phone, on ${d.phone}` : 'By email']] },
]; }
// The enquiry as it would be sent: plain text, a line to a question.
export function letter(data) { const lines = ['New enquiry for Elusion Works', '']; for (const part of answers(data)) for (const [q, a] of part.rows) lines.push(`${q}: ${String(a).replace(/\s*\n\s*/g, ' / ')}`); return lines.join('\n'); }
// How the word count under the box reads.
export const count = text => { const n = words(text); return n === 0 ? `Aim for ${LIMITS.aboutMin} words or more.` : n < LIMITS.aboutMin ? `${n} ${n === 1 ? 'word' : 'words'}. ${LIMITS.aboutMin - n} more to go.` : n > LIMITS.aboutMax ? `${n} words. ${n - LIMITS.aboutMax} too many.` : `${n} words.`; };
