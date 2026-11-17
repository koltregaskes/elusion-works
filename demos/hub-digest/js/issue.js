// One issue of the digest, as plain data. This is everything an editor fills in: the template is made from it by email.js.
// This one is a sample. Every resource and figure in it is made up to show the template. Its links to resources lead to the Hub's front page, with a made-up label after the # so that each is different.
export const ISSUE = {
  sample: true,
  number: 12,
  date: '2026-11-17',
  subject: 'Four new resources, and a prompt that asks for the working',
  preheader: 'A notebook that reads your PDFs, a plain guide to evals, and the question to ask before you trust an answer.',
  lead: {
    title: 'Ask it how it knows',
    paragraphs: [
      'The most useful habit we picked up this month costs nothing. After a model gives you an answer, ask it which parts it worked out and which parts it is recalling. The answer is not always right, but it tells you where to look first.',
      'Two of this week\u2019s resources are built on that idea. The dataset shows its working for every answer, and the guide shows you how to test a model on questions of your own. The other two keep your work on your own machine.',
    ],
  },
  resources: [
    { kind: 'Tool', name: 'Lanternfile', what: 'Turns a folder of PDFs into a notebook you can question, and runs on your own machine so nothing leaves it.', goodFor: 'anyone with a pile of reports and no time.', url: 'https://theairesourcehub.com/#lanternfile' },
    { kind: 'Guide', name: 'Evals without the jargon', what: 'A forty-minute read on testing a model against your own questions, with a spreadsheet you can copy.', goodFor: 'teams about to choose between two models.', url: 'https://theairesourcehub.com/#evals-without-the-jargon' },
    { kind: 'Model', name: 'Kittiwake 2 Small', what: 'A small open model that is quick on a laptop and honest about what it does not know.', goodFor: 'drafts, summaries and anything private.', url: 'https://theairesourcehub.com/#kittiwake-2-small' },
    { kind: 'Dataset', name: 'Hard Questions, Plain Answers', what: 'Twelve hundred questions with checked answers and the working shown, for seeing whether a model reasons or guesses.', goodFor: 'people who build things on top of models.', url: 'https://theairesourcehub.com/#hard-questions' },
  ],
  numbers: [
    { figure: '214', label: 'resources on the Hub' },
    { figure: '4', label: 'added this week' },
    { figure: '31', label: 'links checked again this week' },
  ],
  reading: [
    { title: 'Why a confident answer is not a correct one', source: 'The Hub blog', minutes: 6, url: 'https://theairesourcehub.com/#confident-is-not-correct' },
    { title: 'A field guide to model names', source: 'The Hub blog', minutes: 4, url: 'https://theairesourcehub.com/#model-names' },
    { title: 'What we took off the Hub this month, and why', source: 'The Hub blog', minutes: 3, url: 'https://theairesourcehub.com/#taken-off' },
  ],
  prompt: {
    title: 'A prompt to try',
    text: 'Answer my question. Then list each claim you made, and mark it as worked out, recalled or guessed. For anything recalled or guessed, tell me how I could check it.',
    note: 'Paste it in after your own question, in any chat model.',
  },
  button: { label: 'See everything new on the Hub', url: 'https://theairesourcehub.com/#new' },
};
