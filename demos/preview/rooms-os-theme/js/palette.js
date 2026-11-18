// The Rooms OS house theme: what the preview page shows, worked out from the same two files the mod ships.
// Nothing here touches the page, so the figures it prints can be checked in Node.
import { DEFINITION, SCENE } from '../mod/hooks/house.js';
import { makeColors } from '../mod/hooks/make-colors.js';

export const { theme, problems } = makeColors(DEFINITION);
export const MODES = ['dark', 'light'];
export const MODE_NAME = { dark: 'Night', light: 'Day' };
export const ROLES = [['accent', 'Accent', 'links, buttons, keywords in code'], ['success', 'Success', 'things that worked, strings in code'], ['warning', 'Warning', 'things to check, variables in code'], ['danger', 'Danger', 'things that failed, names in code'], ['pro', 'Pro', 'paid features, numbers in code']];

// How well one colour reads on another, as WCAG works it out: from 1 (the same) to 21 (black on white).
const lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const light = hex => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin((n >> 16) / 255) + 0.7152 * lin(((n >> 8) & 255) / 255) + 0.0722 * lin((n & 255) / 255); };
export const contrast = (a, b) => { const x = light(a), y = light(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export const ratio = (a, b) => (Math.floor(contrast(a, b) * 10) / 10).toFixed(1); // cut short, so a printed 4.5 is never really 4.46

// A role is given as a colour, or as { seed, stops } where some shades are set by hand. Either way it starts from one seed colour.
export const seedOf = role => (typeof role === 'string' ? role : role.seed);

// One mode's colours, by the job each does in the specimen.
// Surfaces and ink are the look's own anchors. Fills and the ink on them are what makeColors worked out.
// For coloured words the apps choose their own shade of each role; the specimen takes the first worked-out shade that reads at 4.5 to 1 on the page.
export function colours(mode) {
  const a = DEFINITION[mode].gray.anchors, t = theme.inputs[mode], page = a['surface-0'];
  const out = { page, card: a['surface-1'], panel: a['surface-2'], menu: a['surface-3'] ?? a['surface-2'], ink: a['text-primary'], ink2: a['text-secondary'] ?? a['text-primary'], ink3: a['text-muted'] ?? a['text-secondary'] ?? a['text-primary'] };
  const order = mode === 'dark' ? [250, 300, 200, 100, 50] : [600, 700, 800, 850];
  for (const [id] of ROLES) { out[id + 'Seed'] = seedOf((DEFINITION[mode].roles ?? DEFINITION.roles)[id]); out[id + 'Fill'] = t[`role-${id}-fill`]; out[id + 'On'] = t[`role-${id}-on`];
    const shade = order.map(n => t[`role-${id}-${n}`]).find(c => c && contrast(c, page) >= 4.5 && contrast(c, out.card) >= 4.5 && contrast(c, out.panel) >= 4.5); if (!shade) throw new Error(`no shade of ${id} reads on the ${mode} page`); out[id + 'Text'] = shade; }
  return out;
}

// The notes makeColors leaves, sorted by mode. A line that starts "Desktop won't paint" would mean the apps refuse the theme.
export const notes = { refused: problems.filter(p => p.startsWith("Desktop won't paint")), dark: problems.filter(p => / in dark mode/.test(p)), light: problems.filter(p => / in light mode/.test(p)) };

// The scene as the preview shows it. The apps take the animation out for anyone who asks for less motion, so the preview can do the same.
export const scene = { moving: SCENE, still: SCENE.replace(/ animation: turn [^;]+;/, '').replace(/ style="animation-delay: [^"]+"/g, '') };
export const asImage = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
