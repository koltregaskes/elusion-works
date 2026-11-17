// The Rooms OS house look, as data: the colours it is made from and the drawing behind the conversation.
// Plain JavaScript with no imports, so the mod, its tests and the preview page all read the same file.

// The colours. makeColors (in make-colors.js) turns these few into the whole theme.
// Dark is the house style: charcoal ground, white ink, one green. Light is the same idea by daylight: drawing-office paper.
export const DEFINITION = {
  label: 'Rooms OS',
  roles: { accent: '#3fe08a', danger: '#ff6b5e', success: '#86c95a', warning: '#f0b23a', pro: '#a58cff' },
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
  },
  light: {
    gray: {
      anchors: {
        'surface-0': '#f7f8f6',
        'surface-1': '#fbfcfa',
        'surface-2': '#fefefd',
        'text-primary': '#14171a',
        'text-secondary': '#3c4347',
        'text-muted': '#586166',
      },
    },
  },
};

// The scene: a floor plan, drawn faintly across the whole ground, whose outer rooms light up one after another.
// The middle is left open, because that is where the words are, and so is the foot, where the message box is.
// Each room is [x, y, width, height] on a 1600 by 1000 sheet; the second list is the rooms that take a turn to light.
export const ROOMS = [
  [40, 40, 420, 300], [460, 40, 360, 220], [820, 40, 340, 220], [1160, 40, 400, 260],
  [40, 340, 300, 320], [1260, 300, 300, 360],
  [40, 660, 380, 300], [1200, 660, 360, 300],
];
export const LIT = [0, 3, 5, 7, 6, 4]; // round the edge, clockwise from the top left
export const TURN = 9; // seconds each room has before the next begins
export const GLOW = 0.13; // how strongly a lit room shows: faint enough to read words over
const doors = [[460, 250, 46, 0], [820, 200, 46, 1], [1160, 210, 46, 0], [340, 520, 46, 1], [1260, 480, 46, 0], [420, 760, 46, 1], [1200, 760, 46, 0]];

export const SCENE = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">',
  '<style>',
  '.wall { fill: none; stroke: #14171a; stroke-opacity: .09; stroke-width: 2; }',
  '.door { fill: none; stroke: #14171a; stroke-opacity: .07; stroke-width: 1.2; }',
  '.dot { fill: #14171a; fill-opacity: .07; }',
  // A lamp's resting brightness is on the lamp itself, not in this rule, so that with the animation taken out the first room stays lit.
  '.lamp { fill: #00a060; animation: turn ' + LIT.length * TURN + 's linear infinite; }',
  '@media (prefers-color-scheme: dark) { .wall, .door { stroke: #f4f5f3; } .wall { stroke-opacity: .08; } .door { stroke-opacity: .06; } .dot { fill: #f4f5f3; fill-opacity: .06; } .lamp { fill: #3fe08a; } }',
  `@keyframes turn { 0% { opacity: 0; } 5% { opacity: ${GLOW}; } 14% { opacity: ${GLOW}; } 22% { opacity: 0; } 100% { opacity: 0; } }`,
  '</style>',
  '<defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><circle class="dot" cx="20" cy="20" r="1"/></pattern></defs>',
  '<!-- squared paper -->',
  '<rect width="1600" height="1000" fill="url(#grid)"/>',
  '<!-- the rooms that light in turn; the first rests lit when nothing may move -->',
  ...LIT.map((room, turn) => { const [x, y, w, h] = ROOMS[room]; return `<rect class="lamp" x="${x}" y="${y}" width="${w}" height="${h}" opacity="${turn === 0 ? GLOW : 0}" style="animation-delay: ${turn * TURN}s"/>`; }),
  '<!-- walls -->',
  ...ROOMS.map(([x, y, w, h]) => `<rect class="wall" x="${x}" y="${y}" width="${w}" height="${h}"/>`),
  '<!-- doors, each a quarter turn -->',
  ...doors.map(([x, y, r, flip]) => `<path class="door" d="M${x} ${y} v${-r} a${r} ${r} 0 0 ${flip ? 0 : 1} ${flip ? -r : r} ${r} z"/>`),
  '</svg>',
].join('');

export const SCENE_ALT = 'A faint floor plan on squared paper. The rooms round its edge light up green one after another.';
