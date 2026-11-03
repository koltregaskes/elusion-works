// The eight planets. Bulk and orbital numbers are rounded NASA Planetary Fact Sheet values
// (nssdc.gsfc.nasa.gov/planetary/factsheet). Interior radii are published model estimates,
// not measurements, except where seismology exists (Earth; Mars from InSight). Moon counts are
// NASA/JPL confirmed totals as of August 2026. Each planet's `layers` run centre -> surface.

export const EARTH = { mass: 5.97, radius: 6371, gravity: 9.81, dayH: 24.0, yearD: 365.25 };

export const PLANETS = [
  {
    id: 'mercury', no: 1, name: 'Mercury', symbol: '☿', code: 'SOL-01', kind: 'Rocky planet',
    tagline: 'A huge iron core with a thin rocky skin',
    origin: 'Roman messenger of the gods, for its speed across the sky',
    discovered: 'Known since antiquity',
    phys: { mass: 0.330, eqR: 2440.5, polR: 2438.3, meanR: 2439.7, density: 5429, gravity: 3.7, escape: 4.3, rotH: 1407.6, dayH: 4222.6, tilt: 0.034, albedo: 0.142, tMean: 167, tMin: -173, tMax: 427, pressure: 0, field: 'Weak global dipole · about 1% of Earth\'s' },
    orbit: { a: 57.9, peri: 46.0, aph: 69.8, periodD: 88.0, v: 47.4, inc: 7.0, ecc: 0.206, synodicD: 115.9 },
    moons: 0, rings: false,
    atmo: { note: 'Exosphere only: atoms knocked off the surface by sunlight and the solar wind.', gases: [['O₂', 42], ['Na', 29], ['H₂', 22], ['He', 6], ['K', 0.5]], pressure: 'Under 0.000000000000005 bar' },
    layers: [
      { name: 'Inner core', r0: 0, r1: 1000, state: 'Solid', comp: 'Iron-nickel (modelled)', color: '#f4e3b0' },
      { name: 'Outer core', r0: 1000, r1: 2020, state: 'Liquid', comp: 'Molten iron alloy · drives the field', color: '#e89a4a' },
      { name: 'Mantle', r0: 2020, r1: 2405, state: 'Solid', comp: 'Silicate rock · ~400 km', color: '#8a6f5c' },
      { name: 'Crust', r0: 2405, r1: 2440, state: 'Solid', comp: 'Silicate · ~35 km', color: '#5d5752' },
    ],
    layersNote: 'MESSENGER gravity data put the core at about 85% of the radius. The solid inner core size is a model estimate.',
    moonList: [],
    ringList: [],
    features: [
      { name: 'Caloris Basin', value: '1,550 km impact basin', lat: 30.5, lon: 170, note: 'One of the largest impact basins in the Solar System; the shock raised hills on the far side.' },
      { name: 'Enterprise Rupes', value: '~1,000 km scarp', lat: -36, lon: 75, note: 'Cliffs up to 3 km high: wrinkles from the whole planet shrinking as its core cooled.' },
      { name: 'Polar ice', value: 'In shadowed craters', lat: 86, lon: 0, note: 'Water ice survives in crater floors near the poles that sunlight never reaches.' },
    ],
    facts: ['Spins 3 times for every 2 orbits: one day (sunrise to sunrise) lasts 176 Earth days.', 'Swings from about −173 °C at night to 427 °C by day: the widest range of any planet.', 'Smallest planet, but its iron core is so large that it is the second-densest after Earth.'],
    missions: [['Mariner 10', '1974–75', 'Three flybys; mapped 45% of the surface'], ['MESSENGER', '2011–15', 'First orbiter; found polar ice'], ['BepiColombo', '2026–', 'ESA/JAXA; enters orbit 21 Nov 2026']],
    surface: { kind: 0, c1: '#8f8a84', c2: '#5c5753', c3: '#b9b2a8', atm: '#000000', atmK: 0 },
  },
  {
    id: 'venus', no: 2, name: 'Venus', symbol: '♀', code: 'SOL-02', kind: 'Rocky planet',
    tagline: 'A runaway greenhouse under acid clouds',
    origin: 'Roman goddess of love and beauty',
    discovered: 'Known since antiquity',
    phys: { mass: 4.87, eqR: 6051.8, polR: 6051.8, meanR: 6051.8, density: 5243, gravity: 8.9, escape: 10.4, rotH: -5832.5, dayH: 2802.0, tilt: 177.4, albedo: 0.689, tMean: 464, tMin: 462, tMax: 467, pressure: 92, field: 'None · an induced magnetosphere from the solar wind' },
    orbit: { a: 108.2, peri: 107.5, aph: 108.9, periodD: 224.7, v: 35.0, inc: 3.4, ecc: 0.007, synodicD: 583.9 },
    moons: 0, rings: false,
    atmo: { note: 'Thick carbon dioxide with sulphuric acid clouds from about 45 to 70 km up.', gases: [['CO₂', 96.5], ['N₂', 3.5], ['SO₂', 0.015], ['Ar', 0.007], ['H₂O', 0.002]], pressure: '92 bar · like 900 m under the sea' },
    layers: [
      { name: 'Core', r0: 0, r1: 3000, state: 'Unknown', comp: 'Iron-nickel · solid or partly molten', color: '#f0c070' },
      { name: 'Mantle', r0: 3000, r1: 6022, state: 'Solid', comp: 'Hot silicate rock', color: '#b06a3a' },
      { name: 'Crust', r0: 6022, r1: 6052, state: 'Solid', comp: 'Basalt · ~30 km', color: '#6e5a48' },
    ],
    layersNote: 'No seismic data: the layers are scaled from Earth, which has nearly the same size and density.',
    moonList: [],
    ringList: [],
    features: [
      { name: 'Maxwell Montes', value: '11 km high', lat: 65.2, lon: 3.3, note: 'The highest mountains on Venus, mapped by radar through the clouds.' },
      { name: 'Aphrodite Terra', value: 'Continent-sized highland', lat: -5, lon: 105, note: 'A highland about the size of Africa, along the equator.' },
      { name: 'Cloud deck', value: '45–70 km up', lat: -30, lon: 220, note: 'Sulphuric acid clouds race round the planet in about four days.' },
    ],
    facts: ['Spins backwards, and so slowly that its day (243 Earth days) is longer than its year (225).', 'Hotter than Mercury despite being twice as far from the Sun: 464 °C everywhere, day and night.', 'Venera 7 made the first landing on another planet here in 1970.'],
    missions: [['Venera 7', '1970', 'First soft landing on another planet'], ['Magellan', '1990–94', 'Radar-mapped 98% of the surface'], ['Venus Express', '2006–14', 'ESA orbiter'], ['Akatsuki', '2015–24', 'JAXA climate orbiter']],
    surface: { kind: 1, c1: '#e9d3a2', c2: '#c9a86a', c3: '#f6ead0', atm: '#f2d79e', atmK: 0.9 },
  },
  {
    id: 'earth', no: 3, name: 'Earth', symbol: '⊕', code: 'SOL-03', kind: 'Rocky planet',
    tagline: 'Liquid water, plate tectonics and a magnetic shield',
    origin: 'Old English and Germanic words for ground',
    discovered: 'Home',
    phys: { mass: 5.97, eqR: 6378.1, polR: 6356.8, meanR: 6371.0, density: 5514, gravity: 9.8, escape: 11.2, rotH: 23.934, dayH: 24.0, tilt: 23.44, albedo: 0.434, tMean: 15, tMin: -89, tMax: 57, pressure: 1.014, field: 'Global dipole · 25–65 µT at the surface' },
    orbit: { a: 149.6, peri: 147.1, aph: 152.1, periodD: 365.25, v: 29.8, inc: 0.0, ecc: 0.017, synodicD: null },
    moons: 1, rings: false,
    atmo: { note: 'Nitrogen and oxygen, plus variable water vapour (about 1% near the surface).', gases: [['N₂', 78.08], ['O₂', 20.95], ['Ar', 0.93], ['CO₂', 0.042]], pressure: '1.014 bar at sea level' },
    layers: [
      { name: 'Inner core', r0: 0, r1: 1221, state: 'Solid', comp: 'Iron-nickel · ~5,200 °C', color: '#fff0b8' },
      { name: 'Outer core', r0: 1221, r1: 3480, state: 'Liquid', comp: 'Molten iron-nickel · the geodynamo', color: '#ffb347' },
      { name: 'Lower mantle', r0: 3480, r1: 5711, state: 'Solid', comp: 'Silicate · flows over millions of years', color: '#e0632d' },
      { name: 'Upper mantle', r0: 5711, r1: 6336, state: 'Solid / partly molten', comp: 'Peridotite · includes the asthenosphere', color: '#a63c22' },
      { name: 'Crust', r0: 6336, r1: 6371, state: 'Solid', comp: '5–70 km · basalt and granite', color: '#5a4636' },
    ],
    layersNote: 'Measured: seismic waves from earthquakes map every boundary. Crust shown at its ~35 km average.',
    moonList: [{ name: 'Moon', r: 1737.4, periodD: 27.32, a: 384400, note: 'Locked face-on; drifting away 3.8 cm a year' }],
    ringList: [],
    features: [
      { name: 'Mount Everest', value: '8,849 m', lat: 27.99, lon: 86.93, note: 'Highest point above sea level.' },
      { name: 'Challenger Deep', value: '10,935 m deep', lat: 11.35, lon: 142.2, note: 'Deepest known point, in the Mariana Trench.' },
      { name: 'Pacific Ocean', value: '~165M km²', lat: 0, lon: -150, note: 'Oceans cover about 71% of the surface.' },
    ],
    facts: ['The densest planet: 5.51 g/cm³.', 'The only planet known to have plate tectonics and liquid water on the surface today.', 'Its magnetic field deflects the solar wind and makes the aurorae.'],
    missions: [['Sputnik 1', '1957', 'First artificial satellite'], ['ISS', '1998–', 'Crewed continuously since 2000'], ['Landsat', '1972–', 'Longest continuous record of the land surface']],
    surface: { kind: 2, c1: '#1f4f8a', c2: '#3f7a3a', c3: '#c8b07a', atm: '#6fb0ff', atmK: 1 },
  },
  {
    id: 'mars', no: 4, name: 'Mars', symbol: '♂', code: 'SOL-04', kind: 'Rocky planet',
    tagline: 'Frozen deserts, giant volcanoes and a molten core',
    origin: 'Roman god of war, for its blood-red colour',
    discovered: 'Known since antiquity',
    phys: { mass: 0.642, eqR: 3396.2, polR: 3376.2, meanR: 3389.5, density: 3934, gravity: 3.7, escape: 5.0, rotH: 24.623, dayH: 24.66, tilt: 25.19, albedo: 0.170, tMean: -65, tMin: -140, tMax: 20, pressure: 0.006, field: 'No global field · magnetised patches in the old crust' },
    orbit: { a: 228.0, peri: 206.7, aph: 249.3, periodD: 687.0, v: 24.1, inc: 1.8, ecc: 0.094, synodicD: 779.9 },
    moons: 2, rings: false,
    atmo: { note: 'Thin carbon dioxide; a quarter of it freezes onto the winter pole each year.', gases: [['CO₂', 95.3], ['N₂', 2.6], ['Ar', 1.9], ['O₂', 0.17], ['CO', 0.07]], pressure: '0.006 bar · under 1% of Earth\'s' },
    layers: [
      { name: 'Core', r0: 0, r1: 1650, state: 'Liquid', comp: 'Iron with sulphur and light elements', color: '#ffc06a' },
      { name: 'Molten layer', r0: 1650, r1: 1800, state: 'Liquid', comp: 'Molten silicate shell (proposed 2023)', color: '#ff7a3a' },
      { name: 'Mantle', r0: 1800, r1: 3340, state: 'Solid', comp: 'Iron-rich silicate rock', color: '#a5482a' },
      { name: 'Crust', r0: 3340, r1: 3390, state: 'Solid', comp: 'Basalt · ~24–72 km', color: '#6e3a28' },
    ],
    layersNote: 'From InSight seismology (2018–22). Later analyses suggest a smaller core wrapped in a molten silicate layer.',
    moonList: [{ name: 'Phobos', r: 11.1, periodD: 0.319, a: 9376, note: 'Spiralling inward; will break up in ~50 Myr' }, { name: 'Deimos', r: 6.2, periodD: 1.263, a: 23463, note: 'Tiny, smooth and slowly receding' }],
    ringList: [],
    features: [
      { name: 'Olympus Mons', value: '~22 km high · 600 km wide', lat: 18.65, lon: -133.8, note: 'The largest volcano known in the Solar System.' },
      { name: 'Valles Marineris', value: '4,000 km long · 7 km deep', lat: -13.9, lon: -59.2, note: 'A rift canyon system that would span the United States.' },
      { name: 'North polar cap', value: 'Water ice + CO₂ frost', lat: 88, lon: 0, note: 'About 1,000 km across in summer, layered over millions of years.' },
    ],
    facts: ['Its red comes from iron oxide dust: Mars is literally rusty.', 'Global dust storms can hide the whole surface for weeks.', 'Seven rovers and landers have worked here; Curiosity and Perseverance still drive.'],
    missions: [['Mariner 4', '1965', 'First close-up photos'], ['Viking 1 & 2', '1976', 'First successful landers'], ['Curiosity', '2012–', 'Gale Crater rover'], ['Perseverance', '2021–', 'Caching samples; flew Ingenuity'], ['Tianwen-1', '2021–', 'Chinese orbiter and Zhurong rover']],
    surface: { kind: 3, c1: '#c1592c', c2: '#7a3420', c3: '#e3a070', atm: '#e8a070', atmK: 0.45 },
  },
  {
    id: 'jupiter', no: 5, name: 'Jupiter', symbol: '♃', code: 'SOL-05', kind: 'Gas giant',
    tagline: 'More than twice the mass of every other planet combined',
    origin: 'King of the Roman gods',
    discovered: 'Known since antiquity',
    phys: { mass: 1898, eqR: 71492, polR: 66854, meanR: 69911, density: 1326, gravity: 23.1, escape: 59.5, rotH: 9.925, dayH: 9.926, tilt: 3.13, albedo: 0.538, tMean: -110, tMin: -145, tMax: null, pressure: null, field: 'Strongest of any planet · ~20,000× Earth\'s magnetic moment' },
    orbit: { a: 778.5, peri: 740.6, aph: 816.4, periodD: 4331, v: 13.1, inc: 1.3, ecc: 0.049, synodicD: 398.9 },
    moons: 115, rings: true,
    atmo: { note: 'No surface. Temperature quoted at the 1-bar level; clouds of ammonia, ammonium hydrosulphide and water.', gases: [['H₂', 89.8], ['He', 10.2], ['CH₄', 0.3], ['NH₃', 0.026]], pressure: 'No surface · 1 bar reference level' },
    layers: [
      { name: 'Dilute core', r0: 0, r1: 28000, state: 'Fluid', comp: 'Rock and ice dissolved into hydrogen (Juno)', color: '#f2d39b' },
      { name: 'Metallic hydrogen', r0: 28000, r1: 57000, state: 'Liquid metal', comp: 'Hydrogen squeezed into a conductor · the dynamo', color: '#8fa8cf' },
      { name: 'Molecular envelope', r0: 57000, r1: 69911, state: 'Gas to liquid', comp: 'H₂ and He · cloud decks on top', color: '#c9a77d' },
    ],
    layersNote: 'Juno\'s gravity data show a large "dilute" core, not a compact rocky ball. Boundaries are gradual, not sharp.',
    moonList: [
      { name: 'Ganymede', r: 2634.1, periodD: 7.155, a: 1070412, note: 'Largest moon in the Solar System; has its own magnetic field' },
      { name: 'Callisto', r: 2410.3, periodD: 16.689, a: 1882709, note: 'Most heavily cratered surface known' },
      { name: 'Io', r: 1821.6, periodD: 1.769, a: 421700, note: 'Over 400 active volcanoes' },
      { name: 'Europa', r: 1560.8, periodD: 3.551, a: 671034, note: 'Salt-water ocean under the ice' },
      { name: 'Amalthea', r: 83.5, periodD: 0.498, a: 181366, note: 'Red, potato-shaped inner moon' },
    ],
    ringList: [{ name: 'Halo', r0: 92000, r1: 122500, k: 0.15 }, { name: 'Main ring', r0: 122500, r1: 129000, k: 0.5 }, { name: 'Gossamer', r0: 129000, r1: 226000, k: 0.08 }],
    features: [
      { name: 'Great Red Spot', value: '~16,000 km wide', lat: -22, lon: 60, note: 'A storm bigger than Earth, watched since at least 1831 and slowly shrinking.' },
      { name: 'Belts and zones', value: 'Winds to 540 km/h', lat: 12, lon: 160, note: 'Dark belts sink, pale zones rise; jets alternate direction between them.' },
      { name: 'Polar cyclones', value: '8 around 1 (north)', lat: 84, lon: 0, note: 'Juno found geometric clusters of cyclones at both poles.' },
    ],
    facts: ['A day lasts under 10 hours, the shortest of any planet, which flattens it by 6.5%.', 'Over 1,300 Earths would fit inside.', 'Gives off about 1.6× as much heat as it receives from the Sun.'],
    missions: [['Pioneer 10', '1973', 'First flyby'], ['Voyager 1 & 2', '1979', 'Found the rings and Io\'s volcanoes'], ['Galileo', '1995–2003', 'First orbiter; dropped a probe in'], ['Juno', '2016–', 'Polar orbiter mapping the interior'], ['Europa Clipper', 'arrives 2030', 'NASA'], ['JUICE', 'arrives 2031', 'ESA']],
    surface: { kind: 4, c1: '#e8d6b4', c2: '#b4865a', c3: '#8a5a3c', atm: '#e8d0a8', atmK: 0.5, bands: 9, spot: 1 },
  },
  {
    id: 'saturn', no: 6, name: 'Saturn', symbol: '♄', code: 'SOL-06', kind: 'Gas giant',
    tagline: 'Rings 280,000 km wide and about 10 m thick',
    origin: 'Roman god of agriculture and wealth',
    discovered: 'Known since antiquity',
    phys: { mass: 568, eqR: 60268, polR: 54364, meanR: 58232, density: 687, gravity: 9.0, escape: 35.5, rotH: 10.656, dayH: 10.656, tilt: 26.73, albedo: 0.499, tMean: -140, tMin: -185, tMax: null, pressure: null, field: 'Global · axis within 0.01° of the spin axis' },
    orbit: { a: 1432.0, peri: 1357.6, aph: 1506.5, periodD: 10747, v: 9.7, inc: 2.5, ecc: 0.052, synodicD: 378.1 },
    moons: 293, rings: true,
    atmo: { note: 'No surface. Paler than Jupiter because a high haze hides the ammonia clouds.', gases: [['H₂', 96.3], ['He', 3.25], ['CH₄', 0.45], ['NH₃', 0.0125]], pressure: 'No surface · 1 bar reference level' },
    layers: [
      { name: 'Core', r0: 0, r1: 12000, state: 'Fluid', comp: 'Rock and ice, smeared outward', color: '#e9d7a7' },
      { name: 'Metallic hydrogen', r0: 12000, r1: 30000, state: 'Liquid metal', comp: 'Conducting hydrogen · the dynamo', color: '#9fb2cf' },
      { name: 'Molecular envelope', r0: 30000, r1: 58232, state: 'Gas to liquid', comp: 'H₂ and He · helium rain falls inward', color: '#d8bf8f' },
    ],
    layersNote: 'Ring seismology (waves in the C ring) suggests heavy elements are mixed out to about 60% of the radius.',
    moonList: [
      { name: 'Titan', r: 2574.7, periodD: 15.945, a: 1221870, note: 'Thick nitrogen air, methane lakes and rain' },
      { name: 'Rhea', r: 763.8, periodD: 4.518, a: 527108, note: 'Second-largest, icy and cratered' },
      { name: 'Iapetus', r: 734.5, periodD: 79.33, a: 3560820, note: 'One side dark, one side bright' },
      { name: 'Dione', r: 561.4, periodD: 2.737, a: 377396, note: 'Ice cliffs hundreds of metres high' },
      { name: 'Tethys', r: 531.1, periodD: 1.888, a: 294619, note: 'Odysseus crater spans 2/5 of it' },
      { name: 'Enceladus', r: 252.1, periodD: 1.370, a: 237948, note: 'Geysers from an ocean feed the E ring' },
      { name: 'Mimas', r: 198.2, periodD: 0.942, a: 185539, note: 'Herschel crater; a young hidden ocean' },
    ],
    ringList: [
      { name: 'D', r0: 66900, r1: 74510, k: 0.05 }, { name: 'C', r0: 74658, r1: 92000, k: 0.35 }, { name: 'B', r0: 92000, r1: 117580, k: 0.95 },
      { name: 'Cassini Division', r0: 117580, r1: 122170, k: 0.08, gap: true }, { name: 'A', r0: 122170, r1: 136775, k: 0.7 },
      { name: 'F', r0: 140100, r1: 140300, k: 0.6 },
    ],
    features: [
      { name: 'North polar hexagon', value: '~29,000 km across', lat: 78, lon: 0, note: 'A six-sided jet stream; each side is longer than Earth is wide.' },
      { name: 'Great White Spots', value: 'Every ~30 years', lat: 40, lon: 120, note: 'Huge storms erupt roughly once per Saturn year; the last in 2010–11.' },
      { name: 'Ring shadow', value: 'On the cloud tops', lat: -12, lon: 200, note: 'The rings cast shadows that move with the seasons.' },
    ],
    facts: ['Less dense than water: 0.69 g/cm³.', 'Titan, its largest moon, is bigger than Mercury.', 'The rings are mostly water ice, and may be only a few hundred million years old.'],
    missions: [['Pioneer 11', '1979', 'First flyby'], ['Voyager 1 & 2', '1980–81', 'Ring and moon close-ups'], ['Cassini–Huygens', '2004–17', 'Orbiter; Huygens landed on Titan in 2005'], ['Dragonfly', 'launch 2028', 'Rotorcraft for Titan']],
    surface: { kind: 4, c1: '#efe0b8', c2: '#cfb27e', c3: '#a98a5e', atm: '#f0dcae', atmK: 0.45, bands: 7, spot: 0, hex: 1 },
  },
  {
    id: 'uranus', no: 7, name: 'Uranus', symbol: '⛢', code: 'SOL-07', kind: 'Ice giant',
    tagline: 'Knocked on its side: 42-year days at the poles',
    origin: 'Greek god of the sky, father of Cronus (Saturn)',
    discovered: '13 March 1781 · William Herschel',
    phys: { mass: 86.8, eqR: 25559, polR: 24973, meanR: 25362, density: 1270, gravity: 8.7, escape: 21.3, rotH: -17.24, dayH: 17.24, tilt: 97.77, albedo: 0.488, tMean: -195, tMin: -224, tMax: null, pressure: null, field: 'Tilted 59° from the spin axis and offset from the centre' },
    orbit: { a: 2867.0, peri: 2732.7, aph: 3001.4, periodD: 30589, v: 6.8, inc: 0.8, ecc: 0.047, synodicD: 369.7 },
    moons: 29, rings: true,
    atmo: { note: 'Methane absorbs red light, which is why it looks cyan. Coldest planetary air measured: 49 K.', gases: [['H₂', 82.5], ['He', 15.2], ['CH₄', 2.3]], pressure: 'No surface · 1 bar reference level' },
    layers: [
      { name: 'Rocky core', r0: 0, r1: 5000, state: 'Solid?', comp: 'Silicates and iron · ~0.5 Earth masses', color: '#c9b49a' },
      { name: 'Icy mantle', r0: 5000, r1: 20000, state: 'Hot fluid', comp: 'Water, ammonia, methane "ices" · conducting', color: '#3b9fc0' },
      { name: 'Envelope', r0: 20000, r1: 25362, state: 'Gas', comp: 'H₂, He and methane', color: '#9fe0ea' },
    ],
    layersNote: 'Only one spacecraft has visited. Layer sizes come from gravity and shape models and are uncertain.',
    moonList: [
      { name: 'Titania', r: 788.4, periodD: 8.706, a: 435910, note: 'Largest; canyons up to 1,500 km long' },
      { name: 'Oberon', r: 761.4, periodD: 13.46, a: 583520, note: 'Old, dark, heavily cratered' },
      { name: 'Umbriel', r: 584.7, periodD: 4.144, a: 266000, note: 'Darkest of the big five' },
      { name: 'Ariel', r: 578.9, periodD: 2.520, a: 191020, note: 'Youngest surface, bright valleys' },
      { name: 'Miranda', r: 235.8, periodD: 1.413, a: 129390, note: 'Verona Rupes, a 20 km cliff' },
    ],
    ringList: [{ name: '6, 5, 4', r0: 41837, r1: 42571, k: 0.25 }, { name: 'α β', r0: 44718, r1: 45661, k: 0.35 }, { name: 'η γ δ', r0: 47175, r1: 48300, k: 0.35 }, { name: 'ε', r0: 51149 - 40, r1: 51149 + 40, k: 0.9 }],
    features: [
      { name: 'Sunward pole', value: '42 years of daylight', lat: 80, lon: 0, note: 'Each pole gets about 42 years of sun, then 42 of darkness.' },
      { name: 'Polar collar', value: 'Bright haze band', lat: 55, lon: 120, note: 'A bright band of haze rings the pole facing the Sun.' },
      { name: 'Ring plane', value: '13 known rings', lat: 0, lon: 220, note: 'Narrow, dark rings, found in 1977 when they dimmed a star.' },
    ],
    facts: ['Tilted 98°, so it rolls round the Sun on its side.', 'The first planet found with a telescope.', 'Radiates almost no internal heat, unlike the other giants.'],
    missions: [['Voyager 2', 'Jan 1986', 'The only visit: 10 new moons, 2 new rings']],
    surface: { kind: 5, c1: '#a6e3ea', c2: '#7fcbd8', c3: '#d4f3f6', atm: '#b8f0f6', atmK: 0.8, bands: 3 },
  },
  {
    id: 'neptune', no: 8, name: 'Neptune', symbol: '♆', code: 'SOL-08', kind: 'Ice giant',
    tagline: 'Found by mathematics, swept by the fastest winds',
    origin: 'Roman god of the sea',
    discovered: '23 September 1846 · Johann Galle, from Urbain Le Verrier\'s prediction',
    phys: { mass: 102, eqR: 24764, polR: 24341, meanR: 24622, density: 1638, gravity: 11.0, escape: 23.5, rotH: 16.11, dayH: 16.11, tilt: 28.32, albedo: 0.442, tMean: -200, tMin: -218, tMax: null, pressure: null, field: 'Tilted 47° from the spin axis and offset from the centre' },
    orbit: { a: 4515.0, peri: 4471.1, aph: 4558.9, periodD: 59800, v: 5.4, inc: 1.8, ecc: 0.010, synodicD: 367.5 },
    moons: 16, rings: true,
    atmo: { note: 'Deeper blue than Uranus. Winds reach about 2,100 km/h, the fastest measured on any planet.', gases: [['H₂', 80], ['He', 19], ['CH₄', 1.5]], pressure: 'No surface · 1 bar reference level' },
    layers: [
      { name: 'Rocky core', r0: 0, r1: 6000, state: 'Solid?', comp: 'Silicates and iron · ~1 Earth mass', color: '#c7ae92' },
      { name: 'Icy mantle', r0: 6000, r1: 21000, state: 'Hot fluid', comp: 'Water, ammonia, methane · may rain diamonds', color: '#2a6fc4' },
      { name: 'Envelope', r0: 21000, r1: 24622, state: 'Gas', comp: 'H₂, He and methane', color: '#6aa6f0' },
    ],
    layersNote: 'Visited once. Like Uranus, the boundaries are model estimates.',
    moonList: [
      { name: 'Triton', r: 1353.4, periodD: -5.877, a: 354759, note: 'Orbits backwards; nitrogen geysers; a captured world' },
      { name: 'Proteus', r: 210, periodD: 1.122, a: 117647, note: 'Nearly as big as a body can be without rounding' },
      { name: 'Nereid', r: 170, periodD: 360.13, a: 5513818, note: 'Very eccentric 360-day orbit' },
    ],
    ringList: [{ name: 'Galle', r0: 41000, r1: 43000, k: 0.12 }, { name: 'Le Verrier', r0: 53150, r1: 53250, k: 0.4 }, { name: 'Lassell', r0: 53200, r1: 57200, k: 0.08 }, { name: 'Adams', r0: 62900, r1: 62960, k: 0.5 }],
    features: [
      { name: 'Great Dark Spot', value: 'Seen 1989 · gone by 1994', lat: -20, lon: 60, note: 'An Earth-sized storm Voyager 2 photographed; Hubble found it had vanished.' },
      { name: 'Scooter', value: 'Bright fast cloud', lat: -42, lon: 200, note: 'A white methane cloud that lapped the dark spot every few days.' },
      { name: 'Adams ring arcs', value: 'Liberté, Égalité, Fraternité', lat: 0, lon: 300, note: 'Clumps in the outer ring, held by the moon Galatea.' },
    ],
    facts: ['Predicted by maths before anyone saw it: Le Verrier worked out where it had to be.', 'One orbit takes 165 years; it finished its first lap since discovery in 2011.', 'Gives off 2.6× as much heat as it gets from the Sun.'],
    missions: [['Voyager 2', 'Aug 1989', 'The only visit: Triton\'s geysers, the dark spot, rings']],
    surface: { kind: 5, c1: '#3b6fd6', c2: '#26479e', c3: '#9cc4ff', atm: '#5d8fff', atmK: 0.85, bands: 5, spot: 1 },
  },
];

// JPL "Keplerian elements for approximate positions of the major planets" (Standish),
// valid 1800–2050: a (AU), e, I, L, long. perihelion, long. node (deg) and rates per century.
export const KEPLER = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus: [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
  earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
  mars: [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  uranus: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.01262724]],
};

const D2R = Math.PI / 180;
export const AU_KM = 149597870.7;
export const GM_SUN = 1.32712440018e11; // km^3/s^2

// Heliocentric ecliptic position (AU) for a JS time in ms.
export function helio(id, ms) {
  const T = (ms / 86400000 + 2440587.5 - 2451545.0) / 36525;
  const [e0, r] = KEPLER[id];
  const a = e0[0] + r[0] * T, e = e0[1] + r[1] * T, I = (e0[2] + r[2] * T) * D2R;
  const L = e0[3] + r[3] * T, wb = e0[4] + r[4] * T, O = (e0[5] + r[5] * T) * D2R;
  const w = wb * D2R - O;
  let M = ((L - wb) % 360 + 540) % 360 - 180; M *= D2R;
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  return {
    x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    z: (sw * sI) * xp + (cw * sI) * yp,
    a, e,
  };
}

// Everything the console needs about where a planet is on a given day.
export function sky(id, ms) {
  const p = helio(id, ms), E = helio('earth', ms);
  const r = Math.hypot(p.x, p.y, p.z);
  const dx = p.x - E.x, dy = p.y - E.y, dz = p.z - E.z; const d = Math.hypot(dx, dy, dz);
  const v = Math.sqrt(GM_SUN * (2 / (r * AU_KM) - 1 / (p.a * AU_KM)));
  // elongation: angle Sun-Earth-planet; east of the Sun = evening sky
  const se = Math.hypot(E.x, E.y, E.z);
  const cosE = (-E.x * dx - E.y * dy - E.z * dz) / (se * d);
  const elong = Math.acos(Math.max(-1, Math.min(1, cosE))) / D2R;
  const cross = (-E.x) * dy - (-E.y) * dx; // z of (sun - earth) x (planet - earth)
  return { r, d, v, elong, east: cross > 0, lightMinSun: r * AU_KM / 299792.458 / 60, lightMinEarth: d * AU_KM / 299792.458 / 60, p, E };
}
