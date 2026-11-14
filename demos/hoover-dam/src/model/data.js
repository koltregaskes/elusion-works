// Reference values for Hoover Dam and Lake Mead.
// Figures are rounded from U.S. Bureau of Reclamation published facts.
// Elevations are feet above mean sea level. The live model in hydro.js is a
// teaching simplification built on top of these numbers, not an operations tool.

export const ELEV = {
  foundation: 505.6,     // crest minus structural height
  crest: 1232,           // top of dam (roadway)
  fullPool: 1229,        // commonly cited full pool
  drumTop: 1221.4,       // top of raised drum gates
  spillCrest: 1205.4,    // fixed spillway crest (drum gates lowered)
  recordHigh: 1225.85,   // July 1983
  recordLow: 1040.8,     // July 2022 (approx.)
  minPower: 950,         // approximate minimum power pool
  deadPool: 895,         // no water can leave by gravity below this
  tailwater: 645,        // Lake Mohave headwater below the dam (varies ~630-647)
  riverbed: 640,         // original Colorado River bed at the site (approx.)
};

export const MARKERS = [
  { elev: ELEV.crest, label: 'Top of dam', tone: 'danger' },
  { elev: ELEV.fullPool, label: 'Full pool', tone: 'water', hideInRail: true },
  { elev: ELEV.recordHigh, label: '1983 record high', tone: 'muted', hideInRail: true },
  { elev: ELEV.drumTop, label: 'Drum gates raised', tone: 'muted', hideInRail: true },
  { elev: ELEV.spillCrest, label: 'Spillway crest', tone: 'muted' },
  { elev: ELEV.recordLow, label: '2022 record low', tone: 'warn' },
  { elev: ELEV.minPower, label: 'Minimum power pool', tone: 'warn' },
  { elev: ELEV.deadPool, label: 'Dead pool', tone: 'danger' },
];

export const SPECS = [
  { k: 'Type', v: 'Concrete arch-gravity' },
  { k: 'Structural height', ft: 726.4, unit: 'len' },
  { k: 'Crest length', ft: 1244, unit: 'len' },
  { k: 'Crest thickness', ft: 45, unit: 'len' },
  { k: 'Base thickness', ft: 660, unit: 'len' },
  { k: 'Concrete in dam', v: '3.25 million yd³ (2.48 million m³)' },
  { k: 'Concrete, whole project', v: '4.36 million yd³ (3.33 million m³)' },
  { k: 'Mass of dam', v: '≈ 6.6 million short tons' },
  { k: 'Reservoir', v: 'Lake Mead' },
  { k: 'Capacity at full pool', v: '≈ 26.1 million acre-ft (≈ 32.2 km³)' },
  { k: 'Lake length when full', v: '≈ 110 miles (177 km)' },
  { k: 'Main generating units', v: '17 Francis turbines' },
  { k: 'Nameplate capacity', v: '≈ 2,080 MW' },
  { k: 'Spillway capacity', v: 'Designed for ≈ 400,000 ft³/s (both sides); safe limit today ≈ 135,000 ft³/s per side' },
  { k: 'Built', v: '1931 to 1936 (dedicated 30 Sep 1935)' },
  { k: 'Builder', v: 'Six Companies, Inc. for the Bureau of Reclamation' },
  { k: 'Workforce', v: 'Average ≈ 3,500, peak 5,218 (June 1934)' },
  { k: 'Original cost', v: '$49 million for the dam (1930s dollars)' },
];

// Scene hotspots. Positions are filled in by the scene builders (they know the geometry).
export const HOTSPOTS = [
  {
    id: 'dam', n: 1, title: 'The arch-gravity dam', kicker: 'Structure',
    view: 'downstream',
    body: 'A curved wall of concrete 726 ft high that does two jobs at once. Its arch shape pushes the lake\'s load sideways into the canyon walls, and its sheer weight resists the rest like a gravity dam. It is only 45 ft thick at the top but 660 ft thick at the base, because water pressure grows with depth.',
    facts: [['Height', '726.4 ft / 221.4 m'], ['Crest length', '1,244 ft / 379 m'], ['Concrete', '3.25 million yd³'], ['Mass', '≈ 6.6 million tons']],
  },
  {
    id: 'towers', n: 2, title: 'Intake towers', kicker: 'Water in',
    view: 'towers',
    body: 'Four 395 ft towers stand in the lake, two against each canyon wall. Water enters through screened openings at two levels and drops through cylinder gates into the penstock tunnels. The towers are Art Deco architecture by Gordon Kaufmann, and two of them carry clocks: one on Nevada time, one on Arizona time.',
    facts: [['Towers', '4 (2 per side)'], ['Height', '395 ft / 120 m'], ['Gates', 'Cylinder gates, 2 levels'], ['Clocks', 'Pacific + Mountain time']],
  },
  {
    id: 'penstocks', n: 3, title: 'Penstocks', kicker: 'Pressure pipes',
    view: 'xray',
    body: 'Steel pipes 30 ft across carry water from the towers, through tunnels in the canyon rock, down to the turbines. The plates were too big to move by rail, so a fabrication plant was built beside the dam and each section was X-rayed and stress-relieved on site. At the bottom the water is under roughly 250 psi.',
    facts: [['Diameter', '30 ft / 9.1 m'], ['Plate', 'up to 2¾ in thick'], ['Pipe', 'nearly 3 miles, 8½ to 30 ft'], ['Built', 'on site by Babcock & Wilcox']],
  },
  {
    id: 'powerhouse', n: 4, title: 'Powerplant', kicker: 'Water to wire',
    view: 'powerhouse',
    body: 'A U-shaped powerhouse wraps the base of the dam, one wing on the Nevada side and one on the Arizona side. Seventeen main Francis turbines drive generators that spin at 180 rpm to make 60 Hz electricity, sent mostly to Southern California, Arizona and Nevada.',
    facts: [['Main units', '17 (A1-A9, N1-N8)'], ['Capacity', '≈ 2,080 MW'], ['Generator speed', '180 rpm, 60 Hz'], ['Typical year', '≈ 4 billion kWh']],
  },
  {
    id: 'spillways', n: 5, title: 'Spillways', kicker: 'Flood safety',
    view: 'spillway',
    body: 'A side-channel spillway sits on each rim upstream of the dam. Four steel drum gates, each 100 ft long and 16 ft high, can be raised to hold more water or lowered to spill. Overflow plunges into a 50 ft tunnel and leaves far downstream, so flood water never pours over the dam itself. They have run in earnest only in 1941 and 1983.',
    facts: [['Gates per side', '4 × (100 × 16 ft)'], ['Crest', '1,205.4 ft'], ['Design capacity', '≈ 400,000 ft³/s'], ['Used', '1941, 1983']],
  },
  {
    id: 'tunnels', n: 6, title: 'Diversion tunnels', kicker: 'Construction',
    view: 'xray',
    body: 'Before a single bucket of concrete, the whole Colorado River had to be moved. Crews blasted four tunnels 56 ft across through the canyon walls, two per side, about 16,000 ft in total. The river went through them from November 1932. Afterwards the inner tunnels were plugged and fed penstocks; the outer ones became spillway tunnels.',
    facts: [['Tunnels', '4 (2 per side)'], ['Bored', '56 ft, lined to 50 ft'], ['Total length', '≈ 16,000 ft'], ['River diverted', 'Nov 1932']],
  },
  {
    id: 'lake', n: 7, title: 'Lake Mead', kicker: 'Storage',
    view: 'upstream',
    body: 'The largest reservoir in the United States by capacity when full: about 26 million acre-feet, roughly two years of the Colorado River\'s average flow. The white "bathtub ring" on the rocks is mineral staining left where water used to stand. Click the lake to make waves; they reflect off the dam and canyon walls.',
    facts: [['Full pool', '1,229 ft'], ['Capacity', '≈ 26.1 million acre-ft'], ['Length when full', '≈ 110 miles'], ['Record low', '≈ 1,040 ft (2022)']],
  },
  {
    id: 'tailrace', n: 8, title: 'Tailrace and the river', kicker: 'Water out',
    view: 'downstream',
    body: 'Spent water leaves the turbines through draft tubes and boils up into the river below. Because it comes from deep in Lake Mead it is cold and clear, around 55 °F, and it flows straight into Lake Mohave behind Davis Dam. That downstream water level sets the "tail" of the head the turbines use.',
    facts: [['Tailwater', '≈ 645 ft (Lake Mohave)'], ['Water temp', '≈ 55 °F / 13 °C'], ['Next dam', 'Davis Dam'], ['Release', 'turbines + spillways']],
  },
  {
    id: 'bridge', n: 9, title: 'Memorial Bridge', kicker: 'Landmark',
    view: 'bridge',
    body: 'The Mike O\'Callaghan–Pat Tillman Memorial Bridge opened in 2010 to take US 93 traffic off the dam crest. Its concrete arch spans 1,060 ft and the deck sits about 890 ft above the river, roughly 1,500 ft downstream of the dam.',
    facts: [['Opened', 'October 2010'], ['Total length', '1,900 ft'], ['Arch span', '1,060 ft'], ['Height', '≈ 890 ft above river']],
  },
  {
    id: 'crest', n: 10, title: 'Crest and the state line', kicker: 'On top',
    view: 'crest',
    body: 'The crest is a road 45 ft wide that crosses from Nevada into Arizona. Near the Nevada end stand Oskar Hansen\'s 30 ft bronze Winged Figures of the Republic over a terrazzo star chart that fixes the dedication date by the positions of the stars. Elevators drop more than 500 ft inside the dam to the powerplant.',
    facts: [['Roadway', '45 ft wide'], ['States', 'Nevada | Arizona'], ['Sculpture', 'Winged Figures, 30 ft'], ['Sculptor', 'Oskar J. W. Hansen']],
  },
];

// Construction timeline. `t` is a decimal year. `build` drives the 3D construction view.
export const TIMELINE = [
  { t: 1928.95, date: 'Dec 1928', title: 'Boulder Canyon Project Act', body: 'Congress authorises the dam, an all-American canal and the sale of power to repay the cost.' },
  { t: 1931.25, date: 'Apr 1931', title: 'Work begins', body: 'Six Companies, Inc. wins the contract at $48.9 million. Boulder City is built from scratch to house workers in the desert.' },
  { t: 1931.4, date: 'May 1931', title: 'Diversion tunnels started', body: 'Four tunnels, 56 ft across, are blasted through the canyon walls, two on each side. Work runs around the clock in heat above 120 °F.' },
  { t: 1932.87, date: 'Nov 1932', title: 'River diverted', body: 'An upstream cofferdam turns the Colorado into the tunnels. The riverbed is dug out down to bedrock, more than 100 ft below the old bed in places.' },
  { t: 1933.43, date: 'Jun 1933', title: 'First concrete', body: 'Concrete is poured into interlocking columns in 5 ft lifts. Cooling pipes laid in each lift carry river water, then refrigerated water, to pull out the heat of curing.' },
  { t: 1934.45, date: 'Jun 1934', title: 'Peak workforce', body: '5,218 people on the job. High scalers dangle on ropes to trim loose rock from the walls with jackhammers and dynamite.' },
  { t: 1935.08, date: 'Feb 1935', title: 'Lake Mead begins to fill', body: 'Diversion tunnel gates close. The lake starts rising behind the still-unfinished dam.' },
  { t: 1935.41, date: 'May 1935', title: 'Last concrete in the dam', body: 'About 3.25 million cubic yards placed in under two years, two years ahead of schedule.' },
  { t: 1935.75, date: 'Sep 1935', title: 'Dedication', body: 'President Franklin D. Roosevelt dedicates the dam on 30 September 1935.' },
  { t: 1936.8, date: 'Oct 1936', title: 'First power', body: 'The first generators come online and power begins flowing to Los Angeles over a 266-mile line.' },
];

export const HISTORY = [
  // Approximate levels for teaching, rounded. See Reclamation for official records.
  [1935.1, 700], [1936, 960], [1937, 1050], [1938, 1120], [1939, 1150], [1940, 1170], [1941.5, 1220],
  [1945, 1170], [1950, 1150], [1953, 1110], [1956.3, 1083], [1958, 1170], [1962, 1170], [1965, 1088],
  [1970, 1150], [1975, 1165], [1979, 1190], [1983.55, 1225.85], [1987, 1210], [1991, 1180], [1995, 1195],
  [1999, 1213], [2002, 1150], [2005, 1082], [2008, 1105], [2010.9, 1082], [2012, 1120], [2014.5, 1080],
  [2016.5, 1072], [2018, 1078], [2020, 1085], [2021.6, 1068], [2022.56, 1040.8], [2023.5, 1065], [2024.5, 1060],
];

export const HISTORY_NOTES = [
  { t: 1941.5, label: 'First full spill' },
  { t: 1956.3, label: '1956 low' },
  { t: 1983.55, label: '1983 flood' },
  { t: 2022.56, label: '2022 record low' },
];

export const SCENARIOS = {
  normal: { label: 'Ordinary day', lake: 1065, inflow: 11000, units: 9, gate: 0.7, drum: 'raised', hour: 11, speed: 1, note: 'A typical mid-lake day: Glen Canyon Dam upstream releases about 11,000 ft³/s and nine units are carrying load.' },
  peak: { label: 'Summer peak', lake: 1065, inflow: 13000, units: 17, gate: 0.95, drum: 'raised', hour: 17.5, speed: 1, note: 'Late afternoon in July. Air conditioners across the Southwest pull hard and every unit is near full gate. Hoover is a peaking plant: it ramps fast when demand spikes.' },
  flood: { label: '1983 flood', lake: 1218, inflow: 70000, units: 17, gate: 1, drum: 'raised', hour: 13, speed: 8, note: 'A huge snowmelt year. Glen Canyon Dam upstream is releasing far more than usual and Lake Mead is near the drum gates. Watch the level rise. Lower the drum gates or the lake will reach the crest.' },
  drought: { label: '2022 drought', lake: 1041, inflow: 7000, units: 8, gate: 0.75, drum: 'raised', hour: 15, speed: 4, note: 'July 2022, the lowest the lake had been since it first filled. Less head means each unit makes less power from the same water.' },
  dead: { label: 'Dead-pool what-if', lake: 920, inflow: 6000, units: 4, gate: 0.6, drum: 'raised', hour: 10, speed: 6, note: 'A hypothetical. Below about 950 ft the turbines cannot run safely, and at 895 ft (dead pool) no water can leave the dam by gravity at all.' },
};

export const QUIZ = [
  {
    q: 'Why is the dam curved upstream, toward the lake?',
    a: ['It looks better from the bridge', 'The arch pushes the water load into the canyon walls', 'It makes the lake hold more water', 'It was the only way the concrete would set'],
    c: 1, why: 'An arch turns sideways water pressure into compression along its length, carried into the rock abutments. Concrete is very strong in compression.',
  },
  {
    q: 'Why is the dam 45 ft thick at the top but 660 ft at the base?',
    a: ['To fit the road on top', 'Water pressure increases with depth', 'The base had to hold up the powerplant', 'Concrete shrinks as it rises'],
    c: 1, why: 'Hydrostatic pressure is p = ρgh. At 500 ft down it is over 200 psi, so the section has to thicken the deeper it goes.',
  },
  {
    q: 'The lake drops 150 ft. What happens to power from the same flow of water?',
    a: ['Nothing changes', 'It rises, because flow speeds up', 'It falls, roughly in proportion to head', 'The generators reverse'],
    c: 2, why: 'Power is P = η ρ g Q H. Less head H means less energy in every cubic foot. Try it with the lake slider.',
  },
  {
    q: 'What was the main problem with pouring the dam in one continuous block?',
    a: ['The concrete would have taken over a century to cool and would crack', 'The trucks could not reach the middle', 'It would have floated', 'Cement was too expensive'],
    c: 0, why: 'Curing concrete generates heat. A block that size would have taken more than a century to cool and cracked as it shrank. Columns with embedded cooling pipes solved it.',
  },
  {
    q: 'Where does flood water go when the spillways run?',
    a: ['Over the top of the dam', 'Into the turbines', 'Into tunnels through the canyon walls, around the dam', 'It is pumped into Las Vegas'],
    c: 2, why: 'Each side-channel spillway drops into a 50 ft tunnel (a converted diversion tunnel) that rejoins the river downstream.',
  },
  {
    q: 'A generator spins at 180 rpm to make 60 Hz power. How many magnetic poles does its rotor need?',
    a: ['4', '12', '40', '180'],
    c: 2, why: 'f = poles × rpm / 120, so poles = 120 × 60 / 180 = 40.',
  },
  {
    q: 'What is "dead pool"?',
    a: ['The level where the lake is legally closed to boats', 'The level below which no water can leave the dam by gravity', 'The bottom of the lake', 'The level at which the spillways open'],
    c: 1, why: 'Dead pool is about 895 ft at Hoover, the level of the lowest outlets. Power stops well before that, around 950 ft.',
  },
  {
    q: 'What is the white band on the canyon walls above the water?',
    a: ['Salt from Las Vegas', 'Paint from construction', 'Mineral deposits where the lake used to stand', 'Bird droppings'],
    c: 2, why: 'Dissolved minerals, mostly calcium carbonate, coated the rock while it was under water. The ring shows how far the lake has fallen.',
  },
];

// Unit helpers
export const FT = 0.3048;
export const CFS_TO_CMS = 0.0283168;
