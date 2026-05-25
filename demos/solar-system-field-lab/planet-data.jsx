/* Solar System Field Lab — shared planet data */
/* eslint-disable */

const PLANETS = [
  {
    key:'mercury', name:'Mercury', order:1,
    color:0x9c8a76, cssColor:'#a8957f',
    palette: ['#7b6a55', '#a8957f', '#d6c2a1', '#3a2f24'],  // bands for procedural texture
    glow: 'rgba(255,170,120,0.25)',
    family:'terrestrial',
    realAU:0.387, diamKm:4879, periodDays:88.0, gravityG:0.38, dayHours:1408, axialDeg:0.034, moonCount:0,
    epithet:'The Swift One',
    blurb:'Closest to the sun. A scorched iron ball with almost no atmosphere — and a year shorter than its day.',
    facts:[
      ["Surface temp", "−170 °C → 430 °C", "biggest day/night swing in the system"],
      ["Atmosphere",   "Trace · helium, sodium", "essentially none"],
      ["Composition",  "70% metallic core", "biggest core-to-mass ratio of any planet"],
      ["Discovery",    "Known since antiquity", "Mercurius — Roman messenger god"],
    ],
    twocol: {
      left:"Mercury is small, fast and lopsided. It races around the sun in just 88 days, but turns on its axis so slowly that a single Mercury day lasts about 176 Earth days — meaning the sun rises, sets, and sometimes appears to reverse direction in the sky thanks to its eccentric orbit. Its iron core fills roughly 70% of its mass, giving it a magnetic field stronger than its size suggests.",
      right:"Most of the planet is a heavily cratered, airless grey. The largest scar — the Caloris Basin — is about 1,550 km wide, the aftermath of an asteroid impact that nearly broke the world. Without a real atmosphere to trap heat, Mercury swings from 430 °C in direct sun to −170 °C on the night side. Frozen water hides in permanently shadowed craters near the poles.",
      pull:"Hot enough to melt lead by day. Cold enough to host frost by night.",
    },
    comparison:{ ratio: 0.38, label: 'Mercury vs Earth · diameter', note: 'Mercury is only slightly larger than our moon.' },
    moons:[]
  },
  {
    key:'venus', name:'Venus', order:2,
    color:0xe6c075, cssColor:'#e6c075',
    palette: ['#a07842', '#d6a45a', '#f1cc7a', '#5b4220'],
    glow: 'rgba(255,200,120,0.32)',
    family:'terrestrial',
    realAU:0.723, diamKm:12104, periodDays:224.7, gravityG:0.904, dayHours:5832, axialDeg:177.4, moonCount:0,
    epithet:"Earth's evil twin",
    blurb:"Hot enough to melt lead. Suffocating CO₂ atmosphere. Rotates backwards.",
    facts:[
      ["Surface temp", "462 °C", "hotter than Mercury, hottest in system"],
      ["Atmosphere",   "96.5% CO₂", "92× Earth's pressure"],
      ["Rotation",     "Retrograde", "spins backwards — sun rises in the west"],
      ["Cloud comp",   "Sulphuric acid",  "permanent thick deck"],
    ],
    twocol: {
      left:"Venus is the closest in size to Earth but the furthest in temperament. Its atmosphere is almost pure carbon dioxide, 92 times denser than ours, and it traps so much heat that the surface sits at a uniform 462 °C — hotter than Mercury despite being further out. Thick clouds of sulphuric acid float 50 km above the ground, perpetually overcast.",
      right:"What makes Venus eerily strange is its rotation: it spins backwards, so slowly that one Venusian day (243 Earth days) is longer than its year (225). Looking up from the surface, the sun would crawl across the sky from west to east. Probably the legacy of an ancient collision that flipped it on its axis.",
      pull:"A day on Venus is longer than its year.",
    },
    comparison:{ ratio: 0.95, label: 'Venus vs Earth · diameter', note: 'Venus is the closest planet in size to Earth.' },
    moons:[]
  },
  {
    key:'earth', name:'Earth', order:3,
    color:0x4a7bb6, cssColor:'#4a7bb6',
    palette: ['#2a4d7a', '#4a7bb6', '#86b8e0', '#1d5132'],  // mix of blue + green
    glow: 'rgba(110,160,235,0.4)',
    family:'terrestrial', accent:true,
    realAU:1.000, diamKm:12742, periodDays:365.25, gravityG:1.000, dayHours:24, axialDeg:23.44, moonCount:1,
    epithet:'The Blue Marble',
    blurb:'The control specimen. One sun, one moon, oceans, oxygen, you reading this.',
    facts:[
      ["Surface temp", "−89 → 58 °C", "average 15 °C"],
      ["Atmosphere",   "78% N₂ · 21% O₂", "the only known oxygen-rich atmosphere"],
      ["Surface",      "71% water", "the only known liquid water on the surface"],
      ["Moons",        "1 · Luna", "stabilises our axial tilt"],
    ],
    twocol: {
      left:"Earth sits in a narrow ribbon around the sun where water can exist as liquid — neither boiled off nor frozen solid. The right size to keep an atmosphere, the right composition to make oceans, and a magnetic field strong enough to deflect the solar wind. So far, the only place we've confirmed life.",
      right:"What makes Earth genuinely unusual isn't water, or atmosphere, or even life — it's the moon. Our single moon is enormous relative to its host planet (about a quarter of Earth's diameter), and it stabilises the planet's axial tilt at a steady 23.4° — without it, the climate would swing wildly over geological time. Nowhere else in the system has this exact configuration.",
      pull:"The only place we've checked where the surface is, mostly, alive.",
    },
    comparison:{ ratio: 1.0, label: 'Earth · the yardstick', note: 'All other planet sizes are described against Earth.' },
    moons:[
      { name:'The Moon', diamKm:3474, distKm:384400, period:'27.3 d', blurb:'Stabilises our axial tilt and drives the tides. Probably the result of a Mars-sized object hitting early Earth.' },
    ]
  },
  {
    key:'mars', name:'Mars', order:4,
    color:0xc15a3b, cssColor:'#c15a3b',
    palette: ['#7a2c1a', '#c15a3b', '#e08862', '#3a1a0e'],
    glow: 'rgba(220,110,80,0.28)',
    family:'terrestrial',
    realAU:1.524, diamKm:6779, periodDays:687.0, gravityG:0.379, dayHours:24.6, axialDeg:25.19, moonCount:2,
    epithet:'The Red Planet',
    blurb:'Cold, dusty, rust-coloured. Home to the biggest volcano and the deepest canyon in the system.',
    facts:[
      ["Surface temp", "−143 → 35 °C", "average −63 °C"],
      ["Atmosphere",   "95% CO₂, very thin", "less than 1% of Earth's"],
      ["Topography",   "Olympus Mons · 21 km tall", "2.5× the height of Everest"],
      ["Moons",        "Phobos & Deimos", "lumpy captured asteroids"],
    ],
    twocol:{
      left:"Mars is the small, cold cousin: half Earth's diameter, a thirtieth of its atmospheric pressure, and a permanent rust-orange thanks to iron oxide dust covering nearly everything. A Martian day (a sol) is 24 hours 39 minutes — uncannily close to Earth's — but a Martian year stretches to 687 days, with seasons twice as long.",
      right:"It is also where the solar system's superlatives live. Olympus Mons is the largest known volcano, rising 21 km from base to summit — three times Everest. Valles Marineris is a canyon so vast it would stretch across the continental United States. Beneath the dust, frozen water hides in the polar caps and in shallow subsurface ice across much of the planet.",
      pull:"The next-door planet, with the biggest mountain and the deepest canyon.",
    },
    comparison:{ ratio: 0.53, label: 'Mars vs Earth · diameter', note: 'Mars is just over half Earth\'s diameter.' },
    moons:[
      { name:'Phobos', diamKm:22, distKm:9377, period:'7.7 h', blurb:'Orbits so close it crosses the Martian sky three times a day, and is slowly spiralling in.' },
      { name:'Deimos', diamKm:12, distKm:23460, period:'30.3 h', blurb:'A tiny, dim lump of rock — probably a captured asteroid.' },
    ]
  },
  {
    key:'jupiter', name:'Jupiter', order:5,
    color:0xd6b890, cssColor:'#d6b890',
    palette: ['#8a6038', '#c89868', '#e8c896', '#5e3a1c'],
    glow: 'rgba(230,180,130,0.35)',
    family:'gas-giant',
    realAU:5.203, diamKm:139820, periodDays:4333, gravityG:2.528, dayHours:9.93, axialDeg:3.13, moonCount:95,
    epithet:'The King',
    blurb:'A gas giant heavier than every other planet combined. Wraps a 350-year-old storm bigger than Earth.',
    facts:[
      ["Mass",         "318 × Earth", "more than all other planets combined"],
      ["Atmosphere",   "75% H₂, 24% He", "no solid surface"],
      ["Day length",   "9.93 hours", "fastest rotation in the system"],
      ["Moons",        "95 known", "Galilean four are world-sized"],
    ],
    twocol:{
      left:"Jupiter is so massive — 318 times the Earth — that it doesn't really orbit the sun; the sun and Jupiter both orbit a point just outside the sun's surface. Made almost entirely of hydrogen and helium with no solid surface to stand on, its visible bands are upper-atmosphere cloud decks of ammonia ice, churned into stripes by violent winds running in opposite directions.",
      right:"The Great Red Spot is a hurricane wider than Earth that has been spinning for at least 350 years (we noticed it in 1665; it has been shrinking since). Jupiter's gravity has shepherded the inner solar system since its formation — flicking asteroids into and out of the inner planets, and catching comets like Shoemaker-Levy 9, which tore itself apart on impact in 1994.",
      pull:"A 350-year-old hurricane the size of Earth, still going.",
    },
    comparison:{ ratio: 11.0, label: 'Jupiter vs Earth · diameter', note: 'Jupiter is wide enough to fit 1300 Earths inside.' },
    moons:[
      { name:'Io',       diamKm:3643, distKm:421700,  period:'1.77 d', blurb:'The most volcanically active body in the solar system — over 400 active volcanoes.' },
      { name:'Europa',   diamKm:3122, distKm:671100,  period:'3.55 d', blurb:'An ice shell hides a salty subsurface ocean — a top candidate for life off-Earth.' },
      { name:'Ganymede', diamKm:5268, distKm:1070000, period:'7.15 d', blurb:'The largest moon in the system. Bigger than Mercury. Has its own magnetic field.' },
      { name:'Callisto', diamKm:4821, distKm:1882700, period:'16.7 d', blurb:'The most heavily cratered surface known — a fossil of the early solar system.' },
    ]
  },
  {
    key:'saturn', name:'Saturn', order:6,
    color:0xe2c98a, cssColor:'#e2c98a',
    palette: ['#a0824a', '#d6b87a', '#eedfa8', '#6e4e22'],
    glow: 'rgba(238,223,168,0.32)',
    family:'gas-giant', rings:true,
    realAU:9.537, diamKm:116460, periodDays:10759, gravityG:1.065, dayHours:10.7, axialDeg:26.73, moonCount:146,
    epithet:'The Ringed One',
    blurb:'Wears the most famous rings in the system — a paper-thin disc of ice and rock.',
    facts:[
      ["Density",      "0.69 g/cm³", "less dense than water"],
      ["Rings",        "Span 282,000 km", "yet only ~10 m thick"],
      ["Atmosphere",   "96% H₂, 3% He", "trace ammonia, methane"],
      ["Moons",        "146 known", "Titan has its own thick atmosphere"],
    ],
    twocol:{
      left:"Saturn is the second largest planet, but the least dense — drop it into a vast enough ocean and it would float. Its rings, the system's most famous feature, are extraordinary on close inspection: a disc 282,000 km across but on average only about 10 metres thick. If you scaled Saturn down to a basketball, the rings would be a thousand times thinner than a sheet of paper.",
      right:"The rings are made almost entirely of water ice, in chunks ranging from grains of dust to boulders the size of houses, shepherded by tiny embedded moons. They're young — possibly only 100 million years old, and likely to drain into the planet in another few hundred million. We're alive at a lucky moment to see them.",
      pull:"Wide enough to stretch from Earth to the moon. Thin enough to be invisible edge-on.",
    },
    comparison:{ ratio: 9.4, label: 'Saturn vs Earth · diameter', note: 'Without its rings, Saturn is only slightly smaller than Jupiter.' },
    moons:[
      { name:'Titan',     diamKm:5150, distKm:1221870, period:'15.95 d', blurb:'The only moon with a thick atmosphere — and surface lakes of liquid methane.' },
      { name:'Enceladus', diamKm:504,  distKm:237948,  period:'1.37 d',  blurb:'Tiny, icy, and shooting plumes of saltwater into space from a hidden ocean.' },
      { name:'Mimas',     diamKm:396,  distKm:185539,  period:'22.6 h',  blurb:'Has a crater so big the moon looks like the Death Star. Probably hides an internal ocean too.' },
      { name:'Iapetus',   diamKm:1470, distKm:3560820, period:'79.3 d',  blurb:'Half-bright, half-dark — one side painted by dust from another moon.' },
    ]
  },
  {
    key:'uranus', name:'Uranus', order:7,
    color:0x8ec6cf, cssColor:'#8ec6cf',
    palette: ['#5d8f96', '#8ec6cf', '#bce0e5', '#2a4348'],
    glow: 'rgba(142,198,207,0.34)',
    family:'ice-giant',
    realAU:19.191, diamKm:50724, periodDays:30687, gravityG:0.886, dayHours:17.24, axialDeg:97.77, moonCount:27,
    epithet:'The Sideways One',
    blurb:'An ice giant rolling on its side, with a methane-blue colour and faint rings.',
    facts:[
      ["Axial tilt",   "97.8°", "rolls on its side"],
      ["Composition",  "Ice giant", "water, ammonia, methane mantle"],
      ["Surface temp", "−224 °C", "coldest planetary atmosphere"],
      ["Moons",        "27 known", "named after Shakespeare characters"],
    ],
    twocol:{
      left:"Uranus is the system's odd one out. Where every other planet spins more-or-less upright, Uranus has been knocked over: its axis tilts 97.8° from the ecliptic, so it effectively rolls along its orbital path. The likely cause is an enormous impact early in its history that tipped the entire world over.",
      right:"This sideways rotation gives Uranus the strangest seasons in the solar system. For 42 Earth years at a time, one pole stares directly at the sun while the other sits in total darkness. Its blue-green colour comes from methane in the atmosphere absorbing red light. It has rings — discovered only in 1977 — but they're narrow, dark, and easy to miss.",
      pull:"Tipped over so hard it rolls along its orbit.",
    },
    comparison:{ ratio: 4.0, label: 'Uranus vs Earth · diameter', note: 'Uranus is roughly four Earths wide.' },
    moons:[
      { name:'Titania',  diamKm:1577, distKm:436300, period:'8.71 d', blurb:'The largest Uranian moon. Half rock, half ice, with vast canyons.' },
      { name:'Oberon',   diamKm:1523, distKm:583500, period:'13.46 d', blurb:'Heavily cratered and mysteriously dark in patches.' },
      { name:'Miranda',  diamKm:472,  distKm:129390, period:'1.41 d',  blurb:'A patchwork of jumbled terrains — looks like it was shattered and reassembled.' },
    ]
  },
  {
    key:'neptune', name:'Neptune', order:8,
    color:0x3e64b0, cssColor:'#3e64b0',
    palette: ['#1f3e7d', '#3e64b0', '#7a9bda', '#0e2046'],
    glow: 'rgba(80,120,210,0.36)',
    family:'ice-giant',
    realAU:30.069, diamKm:49244, periodDays:60190, gravityG:1.137, dayHours:16.11, axialDeg:28.32, moonCount:14,
    epithet:'The Wind Planet',
    blurb:'Wind-haunted ice giant. The farthest you can walk a model of with a packed lunch.',
    facts:[
      ["Discovery",    "1846 · by mathematics", "predicted before it was seen"],
      ["Winds",        "Up to 2,100 km/h", "fastest in the solar system"],
      ["Sunlight",     "0.1% of Earth's", "noon there ≈ deep dusk here"],
      ["Moons",        "14 known", "Triton orbits backwards"],
    ],
    twocol:{
      left:"Neptune is so far out that sunlight is just 0.1% of what reaches Earth — noon on Neptune would feel like a deep summer dusk back home. Despite the cold and the dim light, it has the most violent weather of any planet: winds in its upper atmosphere reach 2,100 km/h, faster than the speed of sound at sea level. The Voyager 2 flyby in 1989 spotted a Great Dark Spot the size of Earth; it had vanished by the time the Hubble looked five years later.",
      right:"Neptune was discovered in 1846 not by looking, but by maths. Astronomers noticed Uranus wasn't orbiting quite where it should and predicted the existence of an outer planet pulling on it. Le Verrier sent his calculations to Berlin; the observatory found Neptune the same night, within a degree of where he said it would be.",
      pull:"Found with a pencil and paper, decades before anyone saw it.",
    },
    comparison:{ ratio: 3.86, label: 'Neptune vs Earth · diameter', note: 'Neptune is the smallest gas/ice giant.' },
    moons:[
      { name:'Triton', diamKm:2710, distKm:354759, period:'5.88 d (retrograde)', blurb:'The only large moon that orbits its planet backwards — probably a captured Kuiper Belt object.' },
      { name:'Nereid', diamKm:340,  distKm:5513400, period:'360 d', blurb:'A small, irregular moon on a wildly elongated orbit.' },
    ]
  },
];

// orbital scene radii per mode (scene units)
const COMPRESSED_R = [1.0, 1.8, 2.6, 3.4, 4.6, 5.6, 6.5, 7.4];
const LOG_R = (() => {
  const vals = PLANETS.map(p => Math.log10(p.realAU + 0.4));
  const min = Math.min(...vals), max = Math.max(...vals);
  return vals.map(v => 1.0 + ((v - min) / (max - min)) * 6.4);
})();

const MODES = {
  compressed: {
    label: 'Compressed',
    note: 'Equal lanes. Easy to teach with — but a lie about distance.',
    radiusFor: (i) => COMPRESSED_R[i],
    sunSize: 0.34,
    camDist: 11,
    camElev: 0.50,
  },
  log: {
    label: 'Logarithmic',
    note: 'log₁₀(AU). Inner planets still visible, outer ones still on screen.',
    radiusFor: (i) => LOG_R[i],
    sunSize: 0.32,
    camDist: 11,
    camElev: 0.50,
  },
  honest: {
    label: 'Honest AU',
    note: 'Real distances. The inner four huddle the sun; Neptune lives in the cheap seats. (Sizes still nudged for legibility.)',
    radiusFor: (i) => PLANETS[i].realAU * 0.6,
    sunSize: 0.10,
    camDist: 26,
    camElev: 0.32,
  },
};

// visual radius — consistent across modes
const planetVisualSize = (p) => Math.max(0.07, Math.pow(p.diamKm / 12742, 0.4) * 0.13);

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => t < 0.5 ? 4 * t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;

// procedural planet texture — sharper bands by family
function makePlanetTexture(palette, family) {
  const W = 512, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  // base
  ctx.fillStyle = palette[1] || '#888';
  ctx.fillRect(0, 0, W, H);

  if (family === 'gas-giant' || family === 'ice-giant') {
    // strong horizontal bands
    const bands = 14 + Math.floor(Math.random() * 6);
    for (let i = 0; i < bands; i++) {
      const y = (i / bands) * H + (Math.random() - 0.5) * 6;
      const h = (H / bands) * (0.6 + Math.random() * 0.8);
      const c1 = palette[Math.floor(Math.random() * palette.length)];
      ctx.fillStyle = c1;
      ctx.globalAlpha = 0.45 + Math.random() * 0.4;
      ctx.fillRect(0, y, W, h);
    }
    ctx.globalAlpha = 1;
    // swirly turbulence overlays
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H;
      const r = 3 + Math.random() * 22;
      ctx.globalAlpha = 0.06 + Math.random() * 0.15;
      ctx.fillStyle = palette[Math.floor(Math.random() * palette.length)];
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.3 + Math.random() * 0.4), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // terrestrial — blotches & continents
    for (let i = 0; i < 220; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H;
      const r = 5 + Math.random() * 36;
      ctx.globalAlpha = 0.12 + Math.random() * 0.25;
      ctx.fillStyle = palette[Math.floor(Math.random() * palette.length)];
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.4 + Math.random() * 0.8), Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // craters / detail
    for (let i = 0; i < 120; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H;
      const r = 1.5 + Math.random() * 5;
      ctx.globalAlpha = 0.18 + Math.random() * 0.35;
      ctx.fillStyle = Math.random() < 0.5 ? '#000' : '#fff';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSaturnRingTexture() {
  const W = 256, H = 16;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  for (let x = 0; x < W; x++) {
    const t = x / W;
    const a = 0.15 + Math.sin(t * 30) * 0.15 + (0.3 + Math.sin(t*60+1)*0.25);
    const aa = Math.max(0, Math.min(0.9, a));
    ctx.fillStyle = `rgba(226,201,138,${aa})`;
    ctx.fillRect(x, 0, 1, H);
  }
  ctx.clearRect(W*0.55, 0, 6, H);
  return new THREE.CanvasTexture(c);
}

function makeGlowTexture(rgbHex = 0xf3a14a) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  const r = (rgbHex >> 16) & 255, g = (rgbHex >> 8) & 255, b = rgbHex & 255;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0,   `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.3, `rgba(${r},${g},${b},0.55)`);
  grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// starfield texture (used for skybox sprite)
function makeStarsField(N = 2400, radius = 80) {
  const geom = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = radius * (0.8 + Math.random() * 0.4);
    const t = Math.random() * Math.PI * 2;
    const p = Math.acos(2 * Math.random() - 1);
    pos[i*3]   = r * Math.sin(p) * Math.cos(t);
    pos[i*3+1] = r * Math.sin(p) * Math.sin(t);
    pos[i*3+2] = r * Math.cos(p);
    const bright = 0.4 + Math.random() * 0.6;
    // slight blue/orange tint
    const tint = Math.random();
    if (tint < 0.15) { col[i*3]=bright*1.0; col[i*3+1]=bright*0.85; col[i*3+2]=bright*0.6; }
    else if (tint < 0.3) { col[i*3]=bright*0.7; col[i*3+1]=bright*0.85; col[i*3+2]=bright; }
    else { col[i*3]=bright; col[i*3+1]=bright; col[i*3+2]=bright; }
  }
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geom;
}

Object.assign(window, {
  PLANETS, MODES, COMPRESSED_R, LOG_R,
  planetVisualSize, easeOutCubic, easeInOutCubic,
  makePlanetTexture, makeSaturnRingTexture, makeGlowTexture, makeStarsField,
});
