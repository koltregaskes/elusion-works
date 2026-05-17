const AU_KM = 149_597_870.7;
const EARTH_DIAMETER_KM = 12_742;
const SUN_DIAMETER_KM = 1_392_700;
const NEPTUNE_AU = 30.0699;

const PLANETS = [
  {
    id: "mercury",
    name: "Mercury",
    order: 1,
    family: "Terrestrial",
    type: "Terrestrial planet",
    meanRadiusKm: 2439.4,
    massE24Kg: 0.330103,
    densityGcm3: 5.4289,
    rotationDays: 58.6462,
    orbitalYears: 0.2408467,
    gravityMS2: 3.70,
    escapeKmS: 4.25,
    au: 0.38709927,
    moonsNote: "0 known moons",
    tagline: "The smallest planet and the closest planet to the Sun.",
    fact: "Mercury has no substantial atmosphere, so day-night temperatures swing dramatically.",
    keywords: "smallest closest rocky cratered inner terrestrial",
    gradient: "radial-gradient(circle at 35% 28%, #f2dfc5 0 8%, #9b907e 34%, #54515a 67%, #292d38 100%)",
    glow: "rgba(242, 223, 197, 0.23)",
    canvasColour: "#c9b9a0"
  },
  {
    id: "venus",
    name: "Venus",
    order: 2,
    family: "Terrestrial",
    type: "Terrestrial planet",
    meanRadiusKm: 6051.8,
    massE24Kg: 4.86731,
    densityGcm3: 5.243,
    rotationDays: -243.018,
    orbitalYears: 0.61519726,
    gravityMS2: 8.87,
    escapeKmS: 10.36,
    au: 0.72333566,
    moonsNote: "0 known moons",
    tagline: "A cloud-wrapped rocky planet with a slow retrograde rotation.",
    fact: "Venus is hotter than Mercury because its thick atmosphere traps heat extremely effectively.",
    keywords: "hottest cloudy retrograde greenhouse rocky inner terrestrial",
    gradient: "radial-gradient(circle at 32% 24%, #fff1b8 0 8%, #e5b36c 32%, #a85f39 68%, #42251f 100%)",
    glow: "rgba(255, 224, 138, 0.28)",
    canvasColour: "#e0a65e"
  },
  {
    id: "earth",
    name: "Earth",
    order: 3,
    family: "Terrestrial",
    type: "Terrestrial planet",
    meanRadiusKm: 6371.0084,
    massE24Kg: 5.97217,
    densityGcm3: 5.5134,
    rotationDays: 0.99726968,
    orbitalYears: 1.0000174,
    gravityMS2: 9.80,
    escapeKmS: 11.19,
    au: 1.00000261,
    moonsNote: "1 Moon",
    tagline: "Our home planet, the only world known to support life.",
    fact: "Earth has liquid surface water, a protective atmosphere and a large Moon.",
    keywords: "home life water moon rocky inner terrestrial blue",
    gradient: "radial-gradient(circle at 34% 26%, #e8fbff 0 7%, #4bb1ff 28%, #1e8f65 45%, #173a85 78%, #081838 100%)",
    glow: "rgba(90, 189, 255, 0.32)",
    canvasColour: "#58b8ff"
  },
  {
    id: "mars",
    name: "Mars",
    order: 4,
    family: "Terrestrial",
    type: "Terrestrial planet",
    meanRadiusKm: 3389.50,
    massE24Kg: 0.641691,
    densityGcm3: 3.9340,
    rotationDays: 1.02595676,
    orbitalYears: 1.8808476,
    gravityMS2: 3.71,
    escapeKmS: 5.03,
    au: 1.52371034,
    moonsNote: "2 small moons",
    tagline: "A cold desert world with giant volcanoes, canyons and polar ice.",
    fact: "Mars has a day length similar to Earth’s but a year almost twice as long.",
    keywords: "red planet cold desert phobos deimos rocky inner terrestrial",
    gradient: "radial-gradient(circle at 34% 26%, #ffd1a5 0 7%, #d16a43 34%, #813b31 72%, #2e181c 100%)",
    glow: "rgba(255, 130, 86, 0.26)",
    canvasColour: "#d16a43"
  },
  {
    id: "jupiter",
    name: "Jupiter",
    order: 5,
    family: "Gas giant",
    type: "Gas giant",
    meanRadiusKm: 69911,
    massE24Kg: 1898.125,
    densityGcm3: 1.3262,
    rotationDays: 0.41354,
    orbitalYears: 11.862615,
    gravityMS2: 24.79,
    escapeKmS: 60.20,
    au: 5.20288700,
    moonsNote: "Many moons; count changes as discoveries are confirmed",
    tagline: "The largest planet, a banded giant with powerful storms.",
    fact: "Jupiter is so large that more than 1,000 Earths could fit inside it if it were hollow.",
    keywords: "largest gas giant storm great red spot bands outer",
    gradient: "linear-gradient(180deg, #f5d7a1 0 12%, #a96b48 12% 22%, #f1c98e 22% 35%, #6f4034 35% 49%, #e9c58d 49% 62%, #9c6547 62% 77%, #f5dfb0 77% 100%)",
    glow: "rgba(245, 199, 142, 0.30)",
    canvasColour: "#d9a56f"
  },
  {
    id: "saturn",
    name: "Saturn",
    order: 6,
    family: "Gas giant",
    type: "Gas giant",
    meanRadiusKm: 58232,
    massE24Kg: 568.317,
    densityGcm3: 0.6871,
    rotationDays: 0.44401,
    orbitalYears: 29.447498,
    gravityMS2: 10.44,
    escapeKmS: 36.09,
    au: 9.53667594,
    moonsNote: "Many moons; count changes as discoveries are confirmed",
    tagline: "A gas giant famous for its bright, complex ring system.",
    fact: "All four giant planets have rings, but Saturn’s are by far the most dramatic.",
    keywords: "rings gas giant low density outer",
    gradient: "radial-gradient(circle at 35% 24%, #fff4bf 0 8%, #e4c17d 36%, #a97946 72%, #3b2a22 100%)",
    glow: "rgba(255, 224, 138, 0.34)",
    canvasColour: "#e2bf7a",
    rings: true
  },
  {
    id: "uranus",
    name: "Uranus",
    order: 7,
    family: "Ice giant",
    type: "Ice giant",
    meanRadiusKm: 25362,
    massE24Kg: 86.8099,
    densityGcm3: 1.270,
    rotationDays: -0.71833,
    orbitalYears: 84.016846,
    gravityMS2: 8.87,
    escapeKmS: 21.38,
    au: 19.18916464,
    moonsNote: "Many moons; count changes as discoveries are confirmed",
    tagline: "An ice giant that rotates on its side compared with most planets.",
    fact: "Uranus is usually described as rotating sideways because its axis is extremely tilted.",
    keywords: "ice giant tilted sideways retrograde outer cyan",
    gradient: "radial-gradient(circle at 32% 24%, #e8ffff 0 8%, #93f0ed 34%, #4aa6be 72%, #163f61 100%)",
    glow: "rgba(147, 240, 237, 0.31)",
    canvasColour: "#86dfe7"
  },
  {
    id: "neptune",
    name: "Neptune",
    order: 8,
    family: "Ice giant",
    type: "Ice giant",
    meanRadiusKm: 24622,
    massE24Kg: 102.409,
    densityGcm3: 1.638,
    rotationDays: 0.67125,
    orbitalYears: 164.79132,
    gravityMS2: 11.15,
    escapeKmS: 23.56,
    au: 30.06992276,
    moonsNote: "Many moons; count changes as discoveries are confirmed",
    tagline: "A deep-blue ice giant and the farthest of the eight planets.",
    fact: "Neptune takes about 165 Earth years to complete one orbit around the Sun.",
    keywords: "farthest blue ice giant windy outer triton",
    gradient: "radial-gradient(circle at 32% 24%, #b8d7ff 0 8%, #3e78ff 34%, #173aa9 72%, #081641 100%)",
    glow: "rgba(62, 120, 255, 0.34)",
    canvasColour: "#3e78ff"
  }
];

const DWARF_PLANETS = [
  {
    name: "Ceres",
    region: "Asteroid belt",
    au: 2.77,
    diameterKm: 940,
    year: "4.6 Earth years",
    note: "The only dwarf planet inside the inner Solar System region, orbiting in the asteroid belt.",
    gradient: "radial-gradient(circle at 35% 25%, #f2f0dc, #9a9382 50%, #4f4c51 100%)",
    glow: "rgba(220,210,190,0.24)"
  },
  {
    name: "Pluto",
    region: "Kuiper Belt",
    au: 39.5,
    diameterKm: 2377,
    year: "248 Earth years",
    note: "A complex icy world visited by New Horizons, now correctly shown here as a dwarf planet.",
    gradient: "radial-gradient(circle at 35% 25%, #f5d3b0, #b97058 55%, #3b2834 100%)",
    glow: "rgba(245,170,130,0.26)"
  },
  {
    name: "Haumea",
    region: "Kuiper Belt",
    au: 43.1,
    diameterKm: 1632,
    year: "~285 Earth years",
    note: "A fast-spinning elongated dwarf planet. Approximate size language is safest for learners.",
    gradient: "radial-gradient(circle at 35% 25%, #f8fbff, #a2c8e8 55%, #3d4f73 100%)",
    glow: "rgba(180,210,255,0.24)"
  },
  {
    name: "Makemake",
    region: "Kuiper Belt",
    au: 45.8,
    diameterKm: 1430,
    year: "~306 Earth years",
    note: "A distant icy dwarf planet beyond Neptune, officially named by the IAU.",
    gradient: "radial-gradient(circle at 35% 25%, #fff0dc, #d08255 55%, #41222b 100%)",
    glow: "rgba(255,170,110,0.26)"
  },
  {
    name: "Eris",
    region: "Scattered disk",
    au: 67.9,
    diameterKm: 2326,
    year: "~559 Earth years",
    note: "A distant dwarf planet whose discovery helped drive the modern planet-definition debate.",
    gradient: "radial-gradient(circle at 35% 25%, #ffffff, #c2d7ff 55%, #41537d 100%)",
    glow: "rgba(205,225,255,0.28)"
  }
];

const QUIZ = [
  {
    question: "Which planet is closest to the Sun?",
    options: ["Venus", "Mercury", "Earth", "Mars"],
    answer: "Mercury",
    explanation: "Mercury is the first planet from the Sun. Venus is second."
  },
  {
    question: "Which planets are the ice giants?",
    options: ["Jupiter and Saturn", "Mercury and Venus", "Uranus and Neptune", "Earth and Mars"],
    answer: "Uranus and Neptune",
    explanation: "Uranus and Neptune are usually grouped as ice giants; Jupiter and Saturn are gas giants."
  },
  {
    question: "Why is Pluto listed separately from the eight planets here?",
    options: ["It disappeared", "It is a moon", "It is classified as a dwarf planet", "It orbits Earth"],
    answer: "It is classified as a dwarf planet",
    explanation: "The IAU classification keeps Pluto as a Solar System object, but not one of the eight planets."
  },
  {
    question: "Which planet has the longest year among the eight planets?",
    options: ["Saturn", "Uranus", "Neptune", "Jupiter"],
    answer: "Neptune",
    explanation: "Neptune takes about 165 Earth years to orbit the Sun."
  },
  {
    question: "What happens when you view the orbits using the AU distance ratio mode?",
    options: ["Inner planets spread far apart", "All planets become the same size", "Inner planets bunch near the Sun", "The Sun vanishes"],
    answer: "Inner planets bunch near the Sun",
    explanation: "Real orbital distances are so large that the inner planets appear very close together compared with the outer planets."
  }
];

const els = {};
let selectedPlanet = PLANETS[2];
let showLabels = true;
let isPaused = false;
let animationSpeed = 1.35;
let distanceMode = "compressed";
let quizIndex = 0;
let quizScore = 0;
let quizAnswered = false;
let canvasState = {
  ctx: null,
  width: 0,
  height: 0,
  dpr: 1,
  lastTs: 0,
  angle: 0,
  planetPositions: []
};

function qs(selector) {
  return document.querySelector(selector);
}

function cacheElements() {
  Object.assign(els, {
    navToggle: qs(".nav-toggle"),
    mainNav: qs("#mainNav"),
    orbitCanvas: qs("#orbitCanvas"),
    selectedName: qs("#selectedName"),
    selectedTagline: qs("#selectedTagline"),
    selectedStats: qs("#selectedStats"),
    selectedPlanetArt: qs("#selectedPlanetArt"),
    distanceMode: qs("#distanceMode"),
    speedRange: qs("#speedRange"),
    pauseButton: qs("#pauseButton"),
    labelButton: qs("#labelButton"),
    searchInput: qs("#searchInput"),
    typeFilter: qs("#typeFilter"),
    sortSelect: qs("#sortSelect"),
    planetGrid: qs("#planetGrid"),
    compareA: qs("#compareA"),
    compareB: qs("#compareB"),
    compareGrid: qs("#compareGrid"),
    earthSizeRange: qs("#earthSizeRange"),
    earthSizeOutput: qs("#earthSizeOutput"),
    scaledSun: qs("#scaledSun"),
    scaledPlanet: qs("#scaledPlanet"),
    scaledPlanetNote: qs("#scaledPlanetNote"),
    scaledDistance: qs("#scaledDistance"),
    scaledDistanceNote: qs("#scaledDistanceNote"),
    scaleTable: qs("#scaleTable tbody"),
    dwarfGrid: qs("#dwarfGrid"),
    quizCard: qs("#quizCard"),
    resetQuiz: qs("#resetQuiz")
  });
}

function fmt(value, digits = 0) {
  if (Number.isNaN(value) || value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits }).format(value);
}

function fmtCompact(value, unit = "") {
  const formatter = new Intl.NumberFormat("en-GB", {
    notation: value >= 100000 ? "compact" : "standard",
    maximumFractionDigits: value >= 100000 ? 1 : 1
  });
  return `${formatter.format(value)}${unit}`;
}

function diameterKm(planet) {
  return planet.meanRadiusKm * 2;
}

function signedRotationLabel(days) {
  const direction = days < 0 ? " retrograde" : "";
  const abs = Math.abs(days);
  if (abs < 1) return `${fmt(abs * 24, 1)} hours${direction}`;
  return `${fmt(abs, 2)} days${direction}`;
}

function yearLabel(years) {
  if (years < 1) return `${fmt(years * 365.25, 1)} Earth days`;
  return `${fmt(years, 2)} Earth years`;
}

function distanceLabel(au) {
  return `${fmt(au, 2)} AU`;
}

function modelLength(cm) {
  if (cm < 100) return `${fmt(cm, 1)} cm`;
  const metres = cm / 100;
  if (metres < 1000) return `${fmt(metres, 1)} m`;
  const km = metres / 1000;
  return `${fmt(km, 2)} km`;
}

function initNav() {
  if (!els.navToggle || !els.mainNav) return;
  els.navToggle.addEventListener("click", () => {
    const expanded = els.navToggle.getAttribute("aria-expanded") === "true";
    els.navToggle.setAttribute("aria-expanded", String(!expanded));
    els.mainNav.classList.toggle("is-open", !expanded);
  });
  els.mainNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      els.navToggle.setAttribute("aria-expanded", "false");
      els.mainNav.classList.remove("is-open");
    });
  });
}

function renderSelected() {
  els.selectedName.textContent = selectedPlanet.name;
  els.selectedTagline.textContent = selectedPlanet.tagline;
  els.selectedPlanetArt.style.background = selectedPlanet.gradient;
  els.selectedPlanetArt.style.boxShadow = `0 0 48px ${selectedPlanet.glow}, inset -18px -20px 34px rgba(0,0,0,0.24)`;
  els.selectedPlanetArt.classList.toggle("has-rings", Boolean(selectedPlanet.rings));
  els.selectedStats.innerHTML = [
    ["Distance", distanceLabel(selectedPlanet.au)],
    ["Diameter", `${fmt(diameterKm(selectedPlanet), 0)} km`],
    ["Year", yearLabel(selectedPlanet.orbitalYears)],
    ["Day", signedRotationLabel(selectedPlanet.rotationDays)],
    ["Gravity", `${fmt(selectedPlanet.gravityMS2, 2)} m/s²`],
    ["Family", selectedPlanet.family]
  ].map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join("");
  renderPlanetGrid();
  renderScale();
}

function selectPlanet(planetId, shouldScroll = false) {
  const found = PLANETS.find((planet) => planet.id === planetId);
  if (!found) return;
  selectedPlanet = found;
  renderSelected();
  if (shouldScroll) {
    document.querySelector("#orbit")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderPlanetGrid() {
  const query = (els.searchInput.value || "").trim().toLowerCase();
  const family = els.typeFilter.value;
  const sort = els.sortSelect.value;

  let list = PLANETS.filter((planet) => {
    const text = `${planet.name} ${planet.family} ${planet.type} ${planet.tagline} ${planet.fact} ${planet.keywords}`.toLowerCase();
    const matchesQuery = !query || text.includes(query);
    const matchesFamily = family === "all" || planet.family === family;
    return matchesQuery && matchesFamily;
  });

  list = list.sort((a, b) => {
    if (sort === "sizeDesc") return diameterKm(b) - diameterKm(a);
    if (sort === "distanceDesc") return b.au - a.au;
    if (sort === "yearDesc") return b.orbitalYears - a.orbitalYears;
    if (sort === "gravityDesc") return b.gravityMS2 - a.gravityMS2;
    return a.order - b.order;
  });

  if (!list.length) {
    els.planetGrid.innerHTML = `<div class="empty-state">No planets match that search. Try “rings”, “ice”, “rocky” or “blue”.</div>`;
    return;
  }

  els.planetGrid.innerHTML = list.map((planet) => `
    <button class="planet-card ${planet.id === selectedPlanet.id ? "is-selected" : ""}" type="button" data-planet-id="${planet.id}" style="--planet-gradient: ${planet.gradient}; --planet-glow: ${planet.glow};">
      <span class="planet-visual ${planet.rings ? "has-rings" : ""}" aria-hidden="true"></span>
      <span class="family-tag">${planet.family}</span>
      <h3>${planet.name}</h3>
      <p>${planet.tagline}</p>
      <div class="card-facts" aria-label="${planet.name} facts">
        <span>${fmt(diameterKm(planet), 0)} km diameter</span>
        <span>${distanceLabel(planet.au)}</span>
        <span>${yearLabel(planet.orbitalYears)}</span>
        <span>${planet.moonsNote}</span>
      </div>
    </button>
  `).join("");

  els.planetGrid.querySelectorAll(".planet-card").forEach((card) => {
    card.addEventListener("click", () => selectPlanet(card.dataset.planetId, true));
  });
}

function initExplorer() {
  [els.searchInput, els.typeFilter, els.sortSelect].forEach((control) => {
    control.addEventListener("input", renderPlanetGrid);
    control.addEventListener("change", renderPlanetGrid);
  });
  renderPlanetGrid();
}

function resizeCanvas() {
  const canvas = els.orbitCanvas;
  const rect = canvas.getBoundingClientRect();
  canvasState.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvasState.width = Math.max(320, rect.width);
  canvasState.height = Math.max(360, rect.height);
  canvas.width = Math.floor(canvasState.width * canvasState.dpr);
  canvas.height = Math.floor(canvasState.height * canvasState.dpr);
  canvasState.ctx = canvas.getContext("2d");
  canvasState.ctx.setTransform(canvasState.dpr, 0, 0, canvasState.dpr, 0, 0);
}

function orbitRadiusFor(planet, index, maxRadius) {
  if (distanceMode === "honest") {
    return 18 + (planet.au / NEPTUNE_AU) * (maxRadius - 18);
  }
  if (distanceMode === "log") {
    return 30 + Math.log2(planet.au + 1) / Math.log2(NEPTUNE_AU + 1) * (maxRadius - 30);
  }
  return 42 + index * ((maxRadius - 52) / 7);
}

function planetDrawRadius(planet) {
  const min = 4;
  const max = 15;
  const sqrt = Math.sqrt(diameterKm(planet));
  const jSqrt = Math.sqrt(diameterKm(PLANETS[4]));
  return Math.max(min, Math.min(max, 3 + (sqrt / jSqrt) * 16));
}

function drawCanvas(ts = 0) {
  const ctx = canvasState.ctx;
  if (!ctx) return;
  const w = canvasState.width;
  const h = canvasState.height;
  const cx = w / 2;
  const cy = h / 2;
  const maxRadius = Math.max(130, Math.min(w, h) * 0.44);

  if (!canvasState.lastTs) canvasState.lastTs = ts;
  const dt = Math.min(64, ts - canvasState.lastTs);
  canvasState.lastTs = ts;
  if (!isPaused) canvasState.angle += dt * 0.00005 * animationSpeed;

  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxRadius * 1.2);
  bg.addColorStop(0, "rgba(120, 243, 255, 0.08)");
  bg.addColorStop(0.55, "rgba(20, 32, 70, 0.10)");
  bg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // subtle star field, deterministic enough for each frame
  ctx.save();
  ctx.globalAlpha = 0.45;
  for (let i = 0; i < 80; i++) {
    const x = (Math.sin(i * 17.23) * 0.5 + 0.5) * w;
    const y = (Math.cos(i * 11.71) * 0.5 + 0.5) * h;
    const r = (i % 5 === 0) ? 1.2 : 0.65;
    ctx.fillStyle = i % 7 === 0 ? "rgba(120,243,255,0.75)" : "rgba(255,255,255,0.68)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Sun glow
  const sunGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 70);
  sunGlow.addColorStop(0, "rgba(255, 245, 185, 1)");
  sunGlow.addColorStop(0.28, "rgba(255, 174, 72, 0.9)");
  sunGlow.addColorStop(0.65, "rgba(255, 125, 55, 0.18)");
  sunGlow.addColorStop(1, "rgba(255, 125, 55, 0)");
  ctx.fillStyle = sunGlow;
  ctx.beginPath();
  ctx.arc(cx, cy, 70, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffe083";
  ctx.beginPath();
  ctx.arc(cx, cy, 19, 0, Math.PI * 2);
  ctx.fill();

  canvasState.planetPositions = [];

  PLANETS.forEach((planet, index) => {
    const radius = orbitRadiusFor(planet, index, maxRadius);

    ctx.strokeStyle = planet.id === selectedPlanet.id ? "rgba(120,243,255,0.58)" : "rgba(160,190,255,0.16)";
    ctx.lineWidth = planet.id === selectedPlanet.id ? 1.8 : 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    const orbitalFactor = 1 / Math.sqrt(Math.max(planet.au, 0.35));
    const angle = canvasState.angle * orbitalFactor + index * 0.72;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const pr = planetDrawRadius(planet);
    canvasState.planetPositions.push({ id: planet.id, x, y, radius: pr + 8 });

    if (planet.id === selectedPlanet.id) {
      ctx.save();
      ctx.strokeStyle = "rgba(120,243,255,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, pr + 7 + Math.sin(ts * 0.004) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (planet.rings) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.35);
      ctx.strokeStyle = "rgba(255,224,131,0.68)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, pr * 2.1, pr * 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = planet.canvasColour;
    ctx.beginPath();
    ctx.arc(x, y, pr, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.beginPath();
    ctx.arc(x - pr * 0.32, y - pr * 0.32, Math.max(1.4, pr * 0.24), 0, Math.PI * 2);
    ctx.fill();

    if (showLabels) {
      ctx.font = "700 12px Inter, system-ui, sans-serif";
      ctx.fillStyle = planet.id === selectedPlanet.id ? "rgba(245,248,255,0.98)" : "rgba(210,220,245,0.76)";
      ctx.textAlign = x > cx ? "left" : "right";
      ctx.textBaseline = "middle";
      ctx.fillText(planet.name, x + (x > cx ? pr + 8 : -pr - 8), y);
    }
  });

  if (showLabels) {
    ctx.font = "800 12px Inter, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,224,131,0.9)";
    ctx.textAlign = "center";
    ctx.fillText("Sun", cx, cy + 38);
  }

  requestAnimationFrame(drawCanvas);
}

function initOrbitLab() {
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  els.distanceMode.addEventListener("change", () => {
    distanceMode = els.distanceMode.value;
  });

  els.speedRange.addEventListener("input", () => {
    animationSpeed = Number(els.speedRange.value);
  });

  els.pauseButton.addEventListener("click", () => {
    isPaused = !isPaused;
    els.pauseButton.textContent = isPaused ? "Resume motion" : "Pause motion";
  });

  els.labelButton.addEventListener("click", () => {
    showLabels = !showLabels;
    els.labelButton.textContent = showLabels ? "Hide labels" : "Show labels";
    els.labelButton.setAttribute("aria-pressed", String(showLabels));
  });

  els.orbitCanvas.addEventListener("click", (event) => {
    const rect = els.orbitCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = canvasState.planetPositions.find((pos) => Math.hypot(pos.x - x, pos.y - y) <= pos.radius);
    if (hit) selectPlanet(hit.id);
  });

  requestAnimationFrame(drawCanvas);
}

function populateCompareSelectors() {
  const options = PLANETS.map((planet) => `<option value="${planet.id}">${planet.name}</option>`).join("");
  els.compareA.innerHTML = options;
  els.compareB.innerHTML = options;
  els.compareA.value = "earth";
  els.compareB.value = "jupiter";
  els.compareA.addEventListener("change", renderCompare);
  els.compareB.addEventListener("change", renderCompare);
  renderCompare();
}

function compareValue(planet, key) {
  if (key === "diameter") return diameterKm(planet);
  if (key === "mass") return planet.massE24Kg;
  if (key === "gravity") return planet.gravityMS2;
  if (key === "year") return planet.orbitalYears;
  if (key === "rotation") return Math.abs(planet.rotationDays);
  return 0;
}

function renderCompare() {
  const a = PLANETS.find((planet) => planet.id === els.compareA.value) || PLANETS[2];
  const b = PLANETS.find((planet) => planet.id === els.compareB.value) || PLANETS[4];

  const metrics = [
    { key: "diameter", label: "Diameter", unit: "km", helper: "Equatorial/mean diameter rounded for display", digits: 0 },
    { key: "mass", label: "Mass", unit: "×10²⁴ kg", helper: "Mass in Earth-friendly scientific units", digits: 3 },
    { key: "gravity", label: "Surface gravity", unit: "m/s²", helper: "Approximate gravity at visible surface/cloud tops", digits: 2 },
    { key: "year", label: "Year length", unit: "Earth years", helper: "Orbital period around the Sun", digits: 2 },
    { key: "rotation", label: "Rotation period", unit: "Earth days", helper: "Absolute value; retrograde sign shown in planet cards", digits: 2 }
  ];

  els.compareGrid.innerHTML = metrics.map((metric) => {
    const av = compareValue(a, metric.key);
    const bv = compareValue(b, metric.key);
    const max = Math.max(av, bv, 0.0001);
    return `
      <article class="compare-metric">
        <div class="compare-label">
          <strong>${metric.label}</strong>
          <span>${metric.helper}</span>
        </div>
        <div class="compare-bars">
          ${compareBar(a.name, av, max, metric.unit, metric.digits)}
          ${compareBar(b.name, bv, max, metric.unit, metric.digits)}
        </div>
      </article>
    `;
  }).join("");
}

function compareBar(name, value, max, unit, digits) {
  const width = Math.max(4, (value / max) * 100);
  return `
    <div class="compare-bar-row">
      <span>${name}</span>
      <span class="bar-track"><span class="bar-fill" style="--bar-width: ${width}%;"></span></span>
      <strong>${fmt(value, digits)} ${unit}</strong>
    </div>
  `;
}

function renderScale() {
  const earthCm = Number(els.earthSizeRange.value);
  const cmPerKm = earthCm / EARTH_DIAMETER_KM;
  const sunCm = SUN_DIAMETER_KM * cmPerKm;
  const selectedDiameterCm = diameterKm(selectedPlanet) * cmPerKm;
  const selectedDistanceCm = selectedPlanet.au * AU_KM * cmPerKm;

  els.earthSizeOutput.value = `${fmt(earthCm, 1)} cm`;
  els.earthSizeOutput.textContent = `${fmt(earthCm, 1)} cm`;
  els.scaledSun.textContent = modelLength(sunCm);
  els.scaledPlanet.textContent = `${selectedPlanet.name}: ${modelLength(selectedDiameterCm)}`;
  els.scaledPlanetNote.textContent = `Real diameter: ${fmt(diameterKm(selectedPlanet), 0)} km.`;
  els.scaledDistance.textContent = modelLength(selectedDistanceCm);
  els.scaledDistanceNote.textContent = `${selectedPlanet.name} at ${distanceLabel(selectedPlanet.au)} from the Sun on average.`;

  els.scaleTable.innerHTML = PLANETS.map((planet) => {
    const planetDiameterCm = diameterKm(planet) * cmPerKm;
    const planetDistanceCm = planet.au * AU_KM * cmPerKm;
    return `
      <tr>
        <th scope="row">${planet.name}</th>
        <td>${modelLength(planetDiameterCm)}</td>
        <td>${modelLength(planetDistanceCm)}</td>
        <td>${fmt(planet.au * AU_KM, 0)} km</td>
      </tr>
    `;
  }).join("");
}

function initScale() {
  els.earthSizeRange.addEventListener("input", renderScale);
  renderScale();
}

function renderDwarfs() {
  els.dwarfGrid.innerHTML = DWARF_PLANETS.map((dwarf) => `
    <article class="dwarf-card" style="--dwarf-gradient: ${dwarf.gradient}; --dwarf-glow: ${dwarf.glow};">
      <small>${dwarf.region}</small>
      <h3>${dwarf.name}</h3>
      <p>${dwarf.note}</p>
      <div class="card-facts">
        <span>~${fmt(dwarf.diameterKm, 0)} km diameter</span>
        <span>${fmt(dwarf.au, 1)} AU</span>
        <span>${dwarf.year}</span>
      </div>
    </article>
  `).join("");
}

function renderQuiz() {
  const current = QUIZ[quizIndex];
  if (!current) {
    const pct = Math.round((quizScore / QUIZ.length) * 100);
    els.quizCard.innerHTML = `
      <div class="quiz-progress">Mission complete</div>
      <p class="quiz-question">Score: ${quizScore}/${QUIZ.length} (${pct}%)</p>
      <p>${pct >= 80 ? "Proper space cadet. You’ve earned the shiny helmet." : "Good start. Run it again and the Solar System will behave itself eventually."}</p>
      <div class="quiz-actions"><button class="button button-primary" type="button" id="quizRestart">Try again</button></div>
    `;
    qs("#quizRestart").addEventListener("click", resetQuiz);
    return;
  }

  quizAnswered = false;
  els.quizCard.innerHTML = `
    <div class="quiz-progress">Question ${quizIndex + 1} of ${QUIZ.length} · Score ${quizScore}</div>
    <p class="quiz-question">${current.question}</p>
    <div class="quiz-options">
      ${current.options.map((option) => `<button class="quiz-option" type="button" data-option="${option}">${option}</button>`).join("")}
    </div>
    <div class="quiz-feedback" id="quizFeedback" hidden></div>
    <div class="quiz-actions" id="quizActions" hidden>
      <button class="button button-primary" id="nextQuiz" type="button">${quizIndex === QUIZ.length - 1 ? "Show score" : "Next question"}</button>
    </div>
  `;

  els.quizCard.querySelectorAll(".quiz-option").forEach((button) => {
    button.addEventListener("click", () => answerQuiz(button.dataset.option));
  });
}

function answerQuiz(option) {
  if (quizAnswered) return;
  quizAnswered = true;
  const current = QUIZ[quizIndex];
  const correct = option === current.answer;
  if (correct) quizScore += 1;

  els.quizCard.querySelectorAll(".quiz-option").forEach((button) => {
    button.disabled = true;
    if (button.dataset.option === current.answer) button.classList.add("is-correct");
    if (button.dataset.option === option && !correct) button.classList.add("is-wrong");
  });

  const feedback = qs("#quizFeedback");
  feedback.hidden = false;
  feedback.textContent = `${correct ? "Correct." : "Not quite."} ${current.explanation}`;

  const actions = qs("#quizActions");
  actions.hidden = false;
  qs("#nextQuiz").addEventListener("click", () => {
    quizIndex += 1;
    renderQuiz();
  });
}

function resetQuiz() {
  quizIndex = 0;
  quizScore = 0;
  quizAnswered = false;
  renderQuiz();
}

function initQuiz() {
  els.resetQuiz.addEventListener("click", resetQuiz);
  renderQuiz();
}

function init() {
  cacheElements();
  initNav();
  initExplorer();
  initOrbitLab();
  populateCompareSelectors();
  initScale();
  renderDwarfs();
  initQuiz();
  renderSelected();
}

document.addEventListener("DOMContentLoaded", init);
