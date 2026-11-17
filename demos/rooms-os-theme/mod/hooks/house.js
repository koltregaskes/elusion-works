// The Rooms OS house look, as data: the colours it is made from and the drawing behind the conversation.
// Plain JavaScript with no imports, so the mod, its tests and the preview page all read the same file.

// The colours. makeColors (in make-colors.js) turns these few into the whole theme.
// Night is the house style: charcoal ground, white ink, one green. Day is the same idea in a drawing office: cool blueprint paper, near-black ink.
// Success is a lime, well round the wheel from the accent, so that keywords and strings in code are told apart.
// Words must read at 4.5 to 1 everywhere, even where the design system's own colours fall short of that. So three things are set by hand:
// - danger and pro: the shade a button turns on hover (stop 400) is a little darker than the button, not lighter, so the white words on it still read;
// - the git state colours (added, removed and so on): darker by day and, for removed and closed, lighter by night, so they read on every surface and on their own tint.
export const DEFINITION = {
  label: 'Rooms OS',
  roles: { accent: '#3fe08a', danger: { seed: '#ff6b5e', stops: { 400: '#cb2100' } }, success: '#b0ce3b', warning: '#f0b23a', pro: { seed: '#a58cff', stops: { 400: '#7140f0' } } },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#111315',
        'surface-1': '#15181a',
        'surface-2': '#191c1f',
        'surface-3': '#1d2124',
        'text-primary': '#f4f5f3',
        'text-secondary': '#cfd4d7',
        'text-muted': '#a9b1b6',
      },
    },
    git: { removed: '#ff7893', closed: '#ff7c75' },
  },
  light: {
    gray: {
      anchors: {
        'surface-0': '#f0f4f6',
        'surface-1': '#f6f8fa',
        'surface-2': '#fcfdfe',
        'text-primary': '#14171a',
        'text-secondary': '#3c4347',
        'text-muted': '#586166',
      },
    },
    git: { added: '#146828', removed: '#a91a45', modified: '#6a5916', merged: '#654c9a', closed: '#a82620', conflicting: '#8d4613', draft: '#5b5b5b' },
  },
};

// The scene: squared paper across the whole ground, and a small floor plan pinned to the top right-hand corner whose rooms light up one after another.
// The plan keeps to that corner at every window shape, a phone held upright included, so it is never behind the middle of the page or the message box.
// Its colours are a mid grey and a green that show on charcoal and on paper alike, so the scene does not need to be told which half of the day it is.
// PLAN: where the plan sits in a square of 1000 pinned to the top right, and how much it is scaled. Each room is [x, y, width, height] in the plan's own units.
export const PLAN = { x: 745, y: 16, scale: 0.8, width: 300, height: 210 };
export const ROOMS = [[0, 0, 110, 90], [110, 0, 90, 90], [200, 0, 100, 120], [200, 120, 100, 90], [80, 90, 120, 120], [0, 90, 80, 120]]; // clockwise from the top left
export const LIT = [0, 1, 2, 3, 4, 5]; // every room takes a turn, in that order
export const TURN = 9; // seconds each room has before the next begins
export const GLOW = 0.22; // how strongly a lit room shows
// Walls, drawn once each and broken where there is a door. Then the doors: a leaf standing open and the quarter circle it swings through.
const walls = 'M0 0H300V210H150M125 210H0V0 M110 0V30M110 55V90 M200 0V60M200 85V150M200 175V210 M0 90H30M55 90H130M155 90H200 M80 90V140M80 165V210 M200 120H235M260 120H300';
const doors = 'M110 30h25a25 25 0 0 1 -25 25 M200 60h-25a25 25 0 0 0 25 25 M200 150h25a25 25 0 0 1 -25 25 M30 90v25a25 25 0 0 0 25 -25 M130 90v-25a25 25 0 0 1 25 25 M80 140h25a25 25 0 0 1 -25 25 M235 120v25a25 25 0 0 0 25 -25 M125 210v-25a25 25 0 0 1 25 25';

export const SCENE = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">',
  '<style>',
  '.wall { fill: none; stroke: #8f989d; stroke-opacity: .55; stroke-width: 1.3; }',
  '.door { fill: none; stroke: #8f989d; stroke-opacity: .38; stroke-width: 1; }',
  '.dot { fill: #8f989d; fill-opacity: .24; }',
  // A lamp's resting brightness is on the lamp itself, not in this rule, so that with the animation taken out the first room stays lit.
  '.lamp { fill: #2fbf7c; animation: turn ' + LIT.length * TURN + 's linear infinite; }',
  `@keyframes turn { 0% { opacity: 0; } 5% { opacity: ${GLOW}; } 14% { opacity: ${GLOW}; } 22% { opacity: 0; } 100% { opacity: 0; } }`,
  '</style>',
  '<defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><circle class="dot" cx="20" cy="20" r="1"/></pattern></defs>',
  '<!-- squared paper, cropped to fit -->',
  '<svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" width="100%" height="100%"><rect width="1600" height="1000" fill="url(#grid)"/></svg>',
  '<!-- the floor plan, pinned to the top right corner -->',
  '<svg viewBox="0 0 1000 1000" preserveAspectRatio="xMaxYMin meet" width="100%" height="100%">',
  `<g transform="translate(${PLAN.x} ${PLAN.y}) scale(${PLAN.scale})">`,
  ...LIT.map((room, turn) => { const [x, y, w, h] = ROOMS[room]; return `<rect class="lamp" x="${x}" y="${y}" width="${w}" height="${h}" opacity="${turn === 0 ? GLOW : 0}" style="animation-delay: ${turn * TURN}s"/>`; }),
  `<path class="wall" vector-effect="non-scaling-stroke" d="${walls}"/>`,
  `<path class="door" vector-effect="non-scaling-stroke" d="${doors}"/>`,
  '</g></svg>',
  '</svg>',
].join('');

export const SCENE_ALT = 'Squared paper, with a small floor plan of six rooms in the top right-hand corner. The rooms light up green one after another.';
