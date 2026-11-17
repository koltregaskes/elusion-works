// Start a project: the enquiry form's rules. What the steps are, what each one asks, what counts as an answer, what is wrong with an answer that is not one, and what the finished enquiry says.
// Nothing here touches the page, so every rule can be checked in Node.

export const STEPS = [
  { id: 'need', title: 'What do you need?', short: 'The work' },
  { id: 'work', title: 'Tell us about it', short: 'About it' },
  { id: 'when', title: 'Timing and budget', short: 'When' },
  { id: 'you', title: 'How do we reach you?', short: 'You' },
  { id: 'check', title: 'Check your answers', short: 'Check' },
];
export const NEEDS = [['site', 'A website or a page'], ['demo', 'A demo or a prototype'], ['auto', 'An automation or a data pipeline'], ['review', 'A second pair of eyes on something you have'], ['other', 'Something else']];
export const WHEN = [['soon', 'As soon as possible'], ['month', 'In the next month or two'], ['later', 'Later this year'], ['open', 'There is no date']];
export const BUDGET = [['small', 'Under £1,000'], ['mid', '£1,000 to £5,000'], ['large', 'Over £5,000'], ['unsure', 'Not sure yet']];
export const REPLY = [['email', 'By email'], ['phone', 'By phone']];
export const LIMITS = { aboutMin: 10, aboutMax: 300, otherMax: 80, nameMax: 80 };
export const blank = () => ({ needs: [], other: '', about: '', link: '', when: '', budget: '', name: '', email: '', reply: 'email', phone: '', agree: false });

export const words = text => (String(text).trim().match(/\S+/g) || []).length;
const label = (list, key) => (list.find(x => x[0] === key) || [])[1] || '';
const isEmail = s => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(s) && !/\.\./.test(s) && /\.[^\s@.]{2,}$/.test(s);
const isLink = s => /^(https?:\/\/)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d+)?([/?#]\S*)?$/i.test(s);
const digits = s => (String(s).match(/\d/g) || []).length;

// The answers with the space round them taken off, and with answers to questions that were not asked taken out: the "something else" text when Something else is not ticked, the phone number when the reply is by email.
export function tidy(d) { const t = { ...blank(), ...d, needs: NEEDS.map(n => n[0]).filter(k => (d.needs || []).includes(k)) }; for (const k of ['other', 'about', 'link', 'when', 'budget', 'name', 'email', 'reply', 'phone']) t[k] = String(t[k] ?? '').trim(); if (!t.needs.includes('other')) t.other = ''; if (t.reply !== 'phone') { t.reply = 'email'; t.phone = ''; } t.agree = !!t.agree; return t; }

// What is wrong with a step's answers: a list of { field, message }, empty when nothing is. The message says what to do, not what went wrong.
export function check(step, data) { const d = tidy(data), out = [], bad = (field, message) => out.push({ field, message });
  if (step === 'need') { if (!d.needs.length) bad('needs', 'Choose at least one kind of work'); if (d.needs.includes('other')) { if (!d.other) bad('other', 'Say what the something else is'); else if (d.other.length > LIMITS.otherMax) bad('other', `Say what it is in ${LIMITS.otherMax} characters or fewer`); } }
  if (step === 'work') { const n = words(d.about); if (!n) bad('about', 'Tell us about the work'); else if (n < LIMITS.aboutMin) bad('about', `Tell us a little more: ${LIMITS.aboutMin} words or more. That is ${n}.`); else if (n > LIMITS.aboutMax) bad('about', `Keep it to ${LIMITS.aboutMax} words. That is ${n}.`); if (d.link && !isLink(d.link)) bad('link', 'Enter a web address like example.com, or leave this empty'); }
  if (step === 'when') { if (!label(WHEN, d.when)) bad('when', 'Choose when you need it'); if (!label(BUDGET, d.budget)) bad('budget', 'Choose a budget, or Not sure yet'); }
  if (step === 'you') { if (!d.name) bad('name', 'Enter your name'); else if (d.name.length > LIMITS.nameMax) bad('name', `Enter a name of ${LIMITS.nameMax} characters or fewer`); if (!d.email) bad('email', 'Enter your email address'); else if (!isEmail(d.email)) bad('email', 'Enter an email address like name@example.com'); if (d.reply === 'phone') { if (!d.phone) bad('phone', 'Enter a phone number'); else if (digits(d.phone) < 7 || /[^\d\s()+.-]/.test(d.phone)) bad('phone', 'Enter a phone number, like 020 7946 0000'); } }
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
export const count = text => { const n = words(text); return n === 0 ? `Aim for ${LIMITS.aboutMin} words or more.` : n < LIMITS.aboutMin ? `${n} ${n === 1 ? 'word' : 'words'}. ${LIMITS.aboutMin - n} more to go.` : n > LIMITS.aboutMax ? `${n} words. That is ${n - LIMITS.aboutMax} too many.` : `${n} words.`; };
