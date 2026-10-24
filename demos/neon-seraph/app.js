const districts = {
  stack: {
    code: "District 09 / brownout",
    title: "Stack 09",
    copy:
      "Worker housing has become a vertical maze of emergency shrines, dead lifts, and drone nests. Keep the lantern relays alive while hostile debt collectors climb from below.",
    threat: "Choir debt squads",
    reward: "Overclocked dash core",
    weather: "Acid rain / low ceiling"
  },
  saint: {
    code: "District 14 / false dawn",
    title: "Saint Circuit",
    copy:
      "Luxury worship servers are still burning inside a cathedral data mall. Every sermon is a trap, every stained-glass advert is watching you.",
    threat: "Sanctified sentries",
    reward: "Prayer-lattice shield",
    weather: "Amber fog / static halos"
  },
  glass: {
    code: "District 22 / market panic",
    title: "Glass Market",
    copy:
      "The black market moved onto transparent rooftops after street power failed. Fight across brittle bridges while auctions continue underneath your boots.",
    threat: "Auctioneers and snipers",
    reward: "Mirror decoy drone",
    weather: "Crosswind / neon hail"
  },
  yard: {
    code: "District 31 / flood lock",
    title: "Leviathan Yard",
    copy:
      "Cargo lifts have become arenas around a drowned reactor. The machines below the water still answer to a corporation that no longer exists.",
    threat: "Dock mechs",
    reward: "Tidebreaker rail lance",
    weather: "Steam surge / blackout tides"
  }
};

const factions = {
  choir: {
    type: "Religious debt syndicate",
    title: "Vesper Choir",
    copy:
      "A lending cult that turns unpaid balances into battlefield hymns. Their agents arrive with gold respirators, choir drones, and contracts printed on human skin."
  },
  grid: {
    type: "Private utility empire",
    title: "KuroGrid",
    copy:
      "The company that owns the dark. KuroGrid field operators can weaponise substations, sell power by the second, and erase a district by marking it non-compliant."
  },
  null: {
    type: "Civilian sabotage cell",
    title: "Civic Null",
    copy:
      "A leaderless movement of tunnel medics, bootleg electricians, and former civic AIs. They need your help, but they will burn your rig if you look corporate."
  }
};

const loadouts = [
  {
    title: "Halo Cutter",
    copy: "Short-range crescent blade that stores kinetic charge on perfect dodges."
  },
  {
    title: "Choirbreaker",
    copy: "A burst rail pistol that interrupts drones, shield chants, and boss-phase ritual locks."
  },
  {
    title: "Moth Swarm",
    copy: "Three utility drones that mark cover, lift stunned enemies, and project temporary decoys."
  },
  {
    title: "Blackout Mantle",
    copy: "A defensive cloak that turns every light failure into a stealth window and every reboot into a counterattack."
  }
];

const breaches = {
  blink: {
    name: "Wing Blink",
    copy:
      "Vault two cover lanes, pass through the searchlight cone, and land behind the debt captain before the blackout pulse returns vision to the room.",
    risk: "High entry, fast kill",
    window: "3.2 seconds of darkness",
    reward: "Captain keycard"
  },
  drone: {
    name: "Drone Choir",
    copy:
      "Send the moth drone above the gantry first. It blinds the elite, opens the service shutter, and turns the room into a clean crossfire.",
    risk: "Low exposure, loud exit",
    window: "6.8 seconds of jammed optics",
    reward: "Turret ownership"
  },
  overload: {
    name: "Grid Overload",
    copy:
      "Punch the relay core and kill every light at once. The room goes blind, but the floor becomes live wire until the Seraph rig vents heat.",
    risk: "Area damage, heat spike",
    window: "4.5 seconds before reboot",
    reward: "Blackout finisher"
  }
};

const isoRoute = [
  {
    x: -12,
    z: 5,
    zone: "Stack 09 / blackout rain",
    title: "Lantern relay breach",
    copy:
      "Seraph crosses the worker-stack roofline, slips debt squad sight cones, and opens the east relay before the district wakes up.",
    objective: "Reach east relay",
    threat: "Debt squad two lanes out",
    color: 0xd8ff3f
  },
  {
    x: -8,
    z: 2,
    zone: "Stack 09 / lift garden",
    title: "Dead elevator cut-through",
    copy:
      "The route drops through a stalled lift garden where emergency lanterns turn every bridge into a silhouette trap.",
    objective: "Cross lift garden",
    threat: "Choir drones scanning",
    color: 0x1fffd7
  },
  {
    x: -3,
    z: -2,
    zone: "Saint Gate / false dawn",
    title: "Open killbox sprint",
    copy:
      "The city opens into a corporate prayer court: no walls, too many marksmen, and a relay core pulsing under the altar.",
    objective: "Break the relay core",
    threat: "Snipers in false-light",
    color: 0xffb000
  },
  {
    x: 3,
    z: -4,
    zone: "Saint Gate / debt altar",
    title: "Drone choir reversal",
    copy:
      "Seraph sends the moth drone through the altar lattice, turning hostile optics into a moving window of darkness.",
    objective: "Reverse the drones",
    threat: "Elite captain locking aim",
    color: 0xff3e9e
  },
  {
    x: 7,
    z: -1,
    zone: "Blackwood / signal forest",
    title: "Forest signal hunt",
    copy:
      "Beyond the city skin, black trees grow around crashed satellites. Every branch is a cable, every red optic is awake.",
    objective: "Find the crash beacon",
    threat: "Red optics in the canopy",
    color: 0x1fffd7
  },
  {
    x: 11,
    z: 2,
    zone: "Blackwood / drowned shrine",
    title: "Silent wing breach",
    copy:
      "The rig folds flat and the city noise dies away. Seraph moves under the canopy while the enemy listens for power draw.",
    objective: "Stay under the canopy",
    threat: "Hunter mechs patrolling",
    color: 0xd8ff3f
  },
  {
    x: 15,
    z: -2,
    zone: "Relay Exit / false dawn",
    title: "Grid overload exit",
    copy:
      "The final relay comes alive and the whole district flashes white. The route burns behind Seraph as the blackout spreads.",
    objective: "Exit before reboot",
    threat: "Grid reboot imminent",
    color: 0xff4f32
  }
];

const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let loadoutIndex = 0;

function setDistrict(key) {
  const district = districts[key];
  if (!district) return;

  document.querySelectorAll("[data-district]").forEach((button) => {
    const active = button.dataset.district === key;
    button.classList.toggle("district-tile--active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  document.querySelector("[data-district-code]").textContent = district.code;
  document.querySelector("[data-district-title]").textContent = district.title;
  document.querySelector("[data-district-copy]").textContent = district.copy;
  document.querySelector("[data-district-threat]").textContent = district.threat;
  document.querySelector("[data-district-reward]").textContent = district.reward;
  document.querySelector("[data-district-weather]").textContent = district.weather;
}

function setFaction(key) {
  const faction = factions[key];
  if (!faction) return;

  document.querySelectorAll("[data-faction]").forEach((button) => {
    const active = button.dataset.faction === key;
    button.classList.toggle("faction-tab--active", active);
    button.setAttribute("aria-selected", String(active));
  });

  document.querySelector("[data-faction-type]").textContent = faction.type;
  document.querySelector("[data-faction-title]").textContent = faction.title;
  document.querySelector("[data-faction-copy]").textContent = faction.copy;
}

function setLoadout(index) {
  loadoutIndex = (index + loadouts.length) % loadouts.length;
  const loadout = loadouts[loadoutIndex];
  document.querySelector("[data-loadout-title]").textContent = loadout.title;
  document.querySelector("[data-loadout-copy]").textContent = loadout.copy;
}

function setBreach(key) {
  const breach = breaches[key];
  const board = document.querySelector("[data-breach-board]");
  if (!breach || !board) return;

  board.classList.remove("breach-board--blink", "breach-board--drone", "breach-board--overload");
  board.classList.add(`breach-board--${key}`);

  document.querySelectorAll("[data-breach]").forEach((button) => {
    const active = button.dataset.breach === key;
    button.classList.toggle("ability--active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  document.querySelector("[data-breach-name]").textContent = breach.name;
  document.querySelector("[data-breach-copy]").textContent = breach.copy;
  document.querySelector("[data-breach-risk]").textContent = breach.risk;
  document.querySelector("[data-breach-window]").textContent = breach.window;
  document.querySelector("[data-breach-reward]").textContent = breach.reward;
}

function setupVideoControls() {
  const video = document.querySelector("[data-hero-video]");
  const toggle = document.querySelector("[data-video-toggle]");
  if (!video || !toggle) return;

  if (prefersReduced) {
    video.pause();
  } else {
    const playPromise = video.play();
    if (playPromise) {
      playPromise.catch(() => {
        toggle.textContent = "Play background";
      });
    }
  }

  toggle.addEventListener("click", () => {
    if (video.paused) {
      video.play();
      toggle.textContent = "Pause background";
    } else {
      video.pause();
      toggle.textContent = "Play background";
    }
  });
}

function setupMotionToggle() {
  const toggle = document.querySelector("[data-motion-toggle]");
  if (!toggle) return;
  if (prefersReduced) {
    document.body.classList.add("reduce-motion");
    toggle.setAttribute("aria-pressed", "true");
  }
  toggle.addEventListener("click", () => {
    const active = document.body.classList.toggle("reduce-motion");
    toggle.setAttribute("aria-pressed", String(active));
  });
}

function setupHeader() {
  const header = document.querySelector("[data-header]");
  if (!header) return;
  const sync = () => header.classList.toggle("is-compact", window.scrollY > 60);
  sync();
  window.addEventListener("scroll", sync, { passive: true });
}

function setupReveals() {
  const items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    items.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.16 }
  );

  items.forEach((item) => observer.observe(item));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function seededNoise(x, z) {
  const value = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function setupIsometricJourney() {
  const root = document.querySelector("[data-iso-journey]");
  const canvas = document.querySelector("[data-iso-canvas]");
  if (!root || !canvas) return;

  const zoneEl = document.querySelector("[data-iso-zone]");
  const titleEl = document.querySelector("[data-iso-title]");
  const copyEl = document.querySelector("[data-iso-copy]");
  const positionEl = document.querySelector("[data-iso-position]");
  const threatEl = document.querySelector("[data-iso-threat]");
  const pulseEl = document.querySelector("[data-iso-pulse]");
  const objectiveEl = document.querySelector("[data-iso-objective]");
  const progressEl = document.querySelector("[data-iso-progress]");
  const sceneChapters = Array.from(document.querySelectorAll("[data-iso-chapter]"));
  let lastBeat = -1;
  let latestProgress = 0;

  const getProgress = () => {
    const rect = root.getBoundingClientRect();
    const travel = Math.max(1, root.offsetHeight - window.innerHeight);
    return clamp(-rect.top / travel, 0, 1);
  };

  const updateHud = (progress) => {
    const scaled = progress * (isoRoute.length - 1);
    const beat = clamp(Math.floor(scaled + 0.001), 0, isoRoute.length - 1);
    const current = isoRoute[beat];
    const pulse = (Math.floor(progress * 28) % 4) + 1;

    if (beat !== lastBeat) {
      zoneEl.textContent = current.zone;
      titleEl.textContent = current.title;
      copyEl.textContent = current.copy;
      threatEl.textContent = current.threat;
      objectiveEl.textContent = current.objective;
      lastBeat = beat;
    }

    positionEl.textContent = `${Math.round(progress * 100)
      .toString()
      .padStart(2, "0")}%`;
    pulseEl.textContent = pulse === 4 ? "Blackout pulse: enemies blind" : `Emergency light phase ${pulse}`;
    root.style.setProperty("--iso-progress", progress.toFixed(4));
    if (progressEl) progressEl.style.width = `${progress * 100}%`;

    sceneChapters.forEach((chapter, index) => {
      const start = Number(chapter.dataset.isoChapter);
      const next = sceneChapters[index + 1] ? Number(sceneChapters[index + 1].dataset.isoChapter) : 1.01;
      chapter.classList.toggle("is-active", progress >= start && progress < next);
    });
  };

  if (!window.THREE) {
    root.classList.add("is-fallback");
    const syncFallback = () => {
      latestProgress = getProgress();
      updateHud(latestProgress);
    };
    syncFallback();
    window.addEventListener("scroll", syncFallback, { passive: true });
    window.addEventListener("resize", syncFallback);
    return;
  }

  let renderer;
  try {
    renderer = new window.THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance"
    });
  } catch (error) {
    root.classList.add("is-fallback");
    updateHud(getProgress());
    return;
  }

  const THREE = window.THREE;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03070a);
  scene.fog = new THREE.Fog(0x03070a, 26, 64);

  const camera = new THREE.OrthographicCamera(-14, 14, 9, -9, 0.1, 120);
  const cameraTarget = new THREE.Vector3();
  const cameraOffset = new THREE.Vector3(14, 13, 14);

  const ambient = new THREE.AmbientLight(0x708080, 1.05);
  const keyLight = new THREE.DirectionalLight(0xd8ff3f, 2.8);
  keyLight.position.set(-8, 16, 8);
  keyLight.castShadow = true;
  scene.add(ambient, keyLight);

  const world = new THREE.Group();
  scene.add(world);
  const loader = new THREE.TextureLoader();

  const loadSceneTexture = (src) => {
    const texture = loader.load(src);
    if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return texture;
  };

  const sceneTextures = {
    city: loadSceneTexture("assets/isometric-concepts/fixed-camera/fixed-01-city.jpg"),
    arena: loadSceneTexture("assets/isometric-concepts/fixed-camera/fixed-02-open-arena.jpg"),
    forest: loadSceneTexture("assets/isometric-concepts/fixed-camera/fixed-03-forest.jpg"),
    dock: loadSceneTexture("assets/isometric-concepts/individual/flooded-dockyard.jpg")
  };

  const materials = {
    tileCity: new THREE.MeshStandardMaterial({ color: 0x0b171c, roughness: 0.72, metalness: 0.28 }),
    tileArena: new THREE.MeshStandardMaterial({ color: 0x25160b, roughness: 0.66, metalness: 0.3 }),
    tileForest: new THREE.MeshStandardMaterial({ color: 0x06110d, roughness: 0.88, metalness: 0.16 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x05090d, roughness: 0.82, metalness: 0.25 }),
    tower: new THREE.MeshStandardMaterial({ color: 0x09151b, emissive: 0x031014, emissiveIntensity: 0.08, roughness: 0.58, metalness: 0.55 }),
    rail: new THREE.MeshStandardMaterial({ color: 0x1b2c31, roughness: 0.48, metalness: 0.76 }),
    blackGlass: new THREE.MeshStandardMaterial({ color: 0x0a1a1f, roughness: 0.22, metalness: 0.38, transparent: true, opacity: 0.72 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xffb000, emissive: 0x7a3d00, emissiveIntensity: 0.55 }),
    acid: new THREE.MeshStandardMaterial({ color: 0xd8ff3f, emissive: 0x789000, emissiveIntensity: 0.65 }),
    teal: new THREE.MeshStandardMaterial({ color: 0x1fffd7, emissive: 0x007766, emissiveIntensity: 0.55 }),
    red: new THREE.MeshStandardMaterial({ color: 0xff4f32, emissive: 0x8a1208, emissiveIntensity: 0.72 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x0a0d0b, roughness: 0.92, metalness: 0.18 }),
    canopy: new THREE.MeshStandardMaterial({ color: 0x04100c, emissive: 0x00140d, emissiveIntensity: 0.08, roughness: 0.92, metalness: 0.14 })
  };

  const tileGeometry = new THREE.BoxGeometry(1.64, 0.16, 1.64);
  for (let gx = -9; gx <= 10; gx += 1) {
    for (let gz = -5; gz <= 5; gz += 1) {
      const x = gx * 1.65;
      const z = gz * 1.65;
      const mat = x < -5 ? materials.tileCity : x < 6 ? materials.tileArena : materials.tileForest;
      const tile = new THREE.Mesh(tileGeometry, mat);
      tile.receiveShadow = true;
      tile.position.set(x, -0.1 + seededNoise(gx, gz) * 0.025, z);
      if (seededNoise(gx + 3, gz + 9) > 0.84) tile.scale.y = 1.9;
      world.add(tile);
    }
  }

  const addSceneSkin = (texture, x, z, width, depth, rotation = 0) => {
    const skin = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.86,
        depthWrite: false
      })
    );
    skin.rotation.x = -Math.PI / 2;
    skin.rotation.z = rotation;
    skin.position.set(x, 0.045, z);
    skin.renderOrder = 0;
    world.add(skin);
    return skin;
  };

  const sceneSkins = [
    addSceneSkin(sceneTextures.city, -11.5, 0.2, 12.6, 7.1, -0.02),
    addSceneSkin(sceneTextures.arena, -0.2, -2.1, 10.4, 5.85, 0.01),
    addSceneSkin(sceneTextures.forest, 9.8, 0.6, 12.2, 6.85, 0.02),
    addSceneSkin(sceneTextures.dock, 15.2, -3.9, 8.8, 4.95, -0.04)
  ];

  const addDecal = (x, z, width, depth, material, rotation = 0) => {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
    decal.rotation.x = -Math.PI / 2;
    decal.rotation.z = rotation;
    decal.position.set(x, 0.08, z);
    decal.renderOrder = 2;
    world.add(decal);
    return decal;
  };

  const decalMat = new THREE.MeshBasicMaterial({
    color: 0x1fffd7,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const warningMat = new THREE.MeshBasicMaterial({
    color: 0xff3e9e,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const signalMats = [
    new THREE.MeshBasicMaterial({ color: 0x1fffd7, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    new THREE.MeshBasicMaterial({ color: 0xd8ff3f, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    new THREE.MeshBasicMaterial({ color: 0xff3e9e, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
  ];
  const animatedSignals = [];
  for (let i = 0; i < 18; i += 1) {
    const x = -15 + seededNoise(i, 132) * 31;
    const z = -6.6 + seededNoise(i, 138) * 13.2;
    addDecal(x, z, 1.2 + seededNoise(i, 142) * 1.6, 0.08, i % 3 === 0 ? warningMat : decalMat, seededNoise(i, 146) * Math.PI);
  }

  const addBox = (x, z, width, depth, height, material, rotationY = 0, yOffset = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, height / 2 + yOffset, z);
    mesh.rotation.y = rotationY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    world.add(mesh);
    return mesh;
  };

  const addStructure = (x, z, rotation, parts) => {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotation;
    parts.forEach(({ x: partX, z: partZ, width, depth, height, material, y = 0 }) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      mesh.position.set(partX, y + height / 2, partZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    world.add(group);
    return group;
  };

  const addCable = (x1, z1, x2, z2, y, material = materials.teal) => {
    const length = Math.hypot(x2 - x1, z2 - z1);
    const cable = new THREE.Mesh(new THREE.BoxGeometry(length, 0.035, 0.035), material);
    cable.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
    cable.rotation.y = Math.atan2(z2 - z1, x2 - x1);
    world.add(cable);
    return cable;
  };

  const addSignalPlane = (x, z, width, height, material, rotation = 0, y = 2.2) => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    plane.position.set(x, y, z);
    plane.rotation.y = rotation;
    plane.renderOrder = 8;
    world.add(plane);
    animatedSignals.push(plane);
    return plane;
  };

  const addGantry = (x, z, rotation = 0, width = 3.2, height = 2.8) => addStructure(x, z, rotation, [
    { x: -width / 2, z: 0, width: 0.16, depth: 0.22, height, material: materials.rail },
    { x: width / 2, z: 0, width: 0.16, depth: 0.22, height, material: materials.rail },
    { x: 0, z: 0, width, depth: 0.12, height: 0.18, material: materials.rail, y: height },
    { x: 0, z: 0.1, width: width * 0.72, depth: 0.04, height: 0.08, material: materials.acid, y: height + 0.12 }
  ]);

  [
    [-12.6, -3.8, -0.18, 4.6, 3.8],
    [-9.1, 3.7, 0.14, 3.8, 3.2],
    [-4.2, -5.4, -0.02, 4.2, 2.7],
    [2.8, 2.6, 0.32, 4.8, 2.9],
    [8.4, -4.9, -0.18, 4.4, 3.4],
    [13.6, 2.2, 0.1, 5.2, 4.2]
  ].forEach(([x, z, rotation, width, height]) => {
    addGantry(x, z, rotation, width, height);
    addSignalPlane(x, z - 0.08, width * 0.64, height * 0.54, signalMats[Math.abs(Math.round(x)) % signalMats.length], rotation, height * 0.64);
  });

  [
    [-15.8, -6.2, -4.8, -5.3, 4.1],
    [-13.9, 5.6, -3.2, 3.4, 3.5],
    [-1.4, -7.1, 7.4, -5.7, 3.2],
    [6.4, 6.8, 15.9, 4.6, 3.7],
    [10.2, -1.8, 17.4, -3.2, 5.4]
  ].forEach(([x1, z1, x2, z2, y]) => addCable(x1, z1, x2, z2, y, seededNoise(x1, z1) > 0.5 ? materials.teal : materials.acid));

  [
    [-12.4, 6.6, 3.8, 0.22, 0.22],
    [-7.2, -6.6, 5.2, 0.24, -0.14],
    [-0.3, 5.9, 4.6, 0.2, 0.08],
    [5.4, -6.7, 5.8, 0.24, -0.18],
    [11.4, 6.5, 4.2, 0.22, 0.16]
  ].forEach(([x, z, width, depth, rotation]) => {
    addBox(x, z, width, depth, 0.24, materials.rail, rotation, 0.48);
    addBox(x, z, width * 0.74, 0.04, 0.08, materials.teal, rotation, 0.66);
  });

  for (let i = 0; i < 34; i += 1) {
    const x = -15 + seededNoise(i, 4) * 9;
    const z = -7 + seededNoise(i, 11) * 14;
    const height = 1.2 + seededNoise(i, 19) * 5.8;
    const tower = addBox(x, z, 0.8 + seededNoise(i, 23) * 0.9, 0.8 + seededNoise(i, 31) * 1.1, height, materials.tower);
    const towerWidth = tower.geometry.parameters.width;
    const towerDepth = tower.geometry.parameters.depth;
    if (seededNoise(i, 41) > 0.46) {
      const strip = addBox(x, z + 0.52, towerWidth * 0.62, 0.04, Math.max(0.32, height * 0.72), seededNoise(i, 47) > 0.5 ? materials.acid : materials.teal);
      strip.position.y = height * 0.52;
    }
    const floors = 2 + Math.floor(seededNoise(i, 181) * 4);
    for (let floor = 0; floor < floors; floor += 1) {
      const y = height * ((floor + 1) / (floors + 1));
      const glowMat = seededNoise(i + floor, 187) > 0.55 ? materials.teal : materials.acid;
      addBox(x + towerWidth / 2 + 0.018, z, 0.03, towerDepth * 0.7, 0.035, glowMat, 0, y);
      if (floor % 2 === 0) addBox(x, z - towerDepth / 2 - 0.018, towerWidth * 0.68, 0.03, 0.035, glowMat, 0, y + 0.06);
    }
    if (seededNoise(i, 193) > 0.62) {
      addBox(x, z, 0.1, 0.1, 0.7 + seededNoise(i, 197) * 0.9, seededNoise(i, 199) > 0.5 ? materials.teal : materials.acid, 0, height);
    }
  }

  for (let i = 0; i < 20; i += 1) {
    const x = -15.4 + seededNoise(i, 213) * 10.5;
    const z = -6.8 + seededNoise(i, 219) * 13.6;
    const width = 0.9 + seededNoise(i, 223) * 2.4;
    addDecal(x, z, width, 0.045, i % 4 === 0 ? warningMat : decalMat, seededNoise(i, 227) * Math.PI);
  }

  for (let i = 0; i < 10; i += 1) {
    const x = -15.8 + seededNoise(i, 153) * 10.2;
    const z = -6.4 + seededNoise(i, 159) * 12.8;
    const height = 2.4 + seededNoise(i, 163) * 3.2;
    addBox(x, z, 0.28, 0.28, height, materials.rail);
    addBox(x, z, 1.5 + seededNoise(i, 167) * 1.8, 0.08, 0.08, i % 2 ? materials.acid : materials.teal, seededNoise(i, 171) * Math.PI, height - 0.18);
    addSignalPlane(x + 0.22, z + 0.22, 0.72 + seededNoise(i, 173) * 0.82, 0.34 + seededNoise(i, 179) * 0.52, signalMats[i % signalMats.length], Math.PI / 4, height * 0.66);
  }

  const arenaRing = new THREE.Mesh(
    new THREE.TorusGeometry(4.6, 0.08, 10, 96),
    new THREE.MeshStandardMaterial({ color: 0xffb000, emissive: 0x6d3300, emissiveIntensity: 0.5 })
  );
  arenaRing.rotation.x = Math.PI / 2;
  arenaRing.position.set(0, 0.18, -2.1);
  world.add(arenaRing);

  for (let i = 0; i < 14; i += 1) {
    const angle = (Math.PI * 2 * i) / 14;
    const radius = 4.3 + seededNoise(i, 55) * 1.2;
    const x = Math.cos(angle) * radius;
    const z = -2.1 + Math.sin(angle) * radius;
    addBox(x, z, 0.28, 0.28, 1.2 + seededNoise(i, 61) * 1.6, i % 3 === 0 ? materials.red : materials.amber);
  }

  for (let i = 0; i < 42; i += 1) {
    const x = 6.5 + seededNoise(i, 71) * 11;
    const z = -7 + seededNoise(i, 79) * 14;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.05 + seededNoise(i, 83), 6), materials.trunk);
    trunk.position.set(x, 0.45, z);
    trunk.castShadow = true;
    world.add(trunk);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.58 + seededNoise(i, 89) * 0.34, 1.8 + seededNoise(i, 97) * 1.4, 7), materials.canopy);
    canopy.position.set(x, 1.5 + seededNoise(i, 103) * 0.6, z);
    canopy.rotation.y = seededNoise(i, 107) * Math.PI;
    canopy.castShadow = true;
    world.add(canopy);
    if (i % 4 === 0) {
      addBox(x + 0.18, z - 0.22, 0.035, 0.035, 1.7 + seededNoise(i, 109), materials.teal);
    }
  }

  for (let i = 0; i < 14; i += 1) {
    const x = 7.2 + seededNoise(i, 183) * 10.2;
    const z = -6.7 + seededNoise(i, 191) * 13.4;
    const height = 1.6 + seededNoise(i, 197) * 3.4;
    addBox(x, z, 0.18, 0.18, height, i % 3 === 0 ? materials.blackGlass : materials.rail);
    addSignalPlane(x, z + 0.2, 0.46 + seededNoise(i, 199) * 0.48, 0.9 + seededNoise(i, 203) * 1.2, signalMats[(i + 1) % signalMats.length], -Math.PI / 5, height * 0.72);
    if (i > 0) {
      const prevX = 7.2 + seededNoise(i - 1, 183) * 10.2;
      const prevZ = -6.7 + seededNoise(i - 1, 191) * 13.4;
      addCable(prevX, prevZ, x, z, 2.6 + seededNoise(i, 211), i % 2 ? materials.teal : materials.acid);
    }
  }

  const relay = addBox(16.2, -2.4, 1.1, 1.1, 5.8, materials.acid);
  relay.name = "relay";

  const routePoints = isoRoute.map((point) => new THREE.Vector3(point.x, 0.17, point.z));
  const routeLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(routePoints),
    new THREE.LineBasicMaterial({ color: 0xd8ff3f, transparent: true, opacity: 0.84 })
  );
  world.add(routeLine);

  isoRoute.forEach((point, index) => {
    const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 6), index === isoRoute.length - 1 ? materials.red : materials.acid);
    marker.position.set(point.x, 0.22, point.z);
    marker.rotation.y = Math.PI / 6;
    world.add(marker);
  });

  const enemies = [
    [-9.5, -1.8],
    [-4.4, -4.8],
    [1.3, 1.4],
    [4.8, -4.6],
    [9.8, 4.5],
    [13.1, -0.2]
  ].map(([x, z]) => {
    const enemy = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.05, 5), materials.red);
    enemy.position.set(x, 0.62, z);
    enemy.castShadow = true;
    world.add(enemy);
    return enemy;
  });

  [
    ["assets/isometric-concepts/fixed-camera/fixed-01-city.jpg", -13, -8],
    ["assets/isometric-concepts/fixed-camera/fixed-02-open-arena.jpg", 0, 8],
    ["assets/isometric-concepts/fixed-camera/fixed-03-forest.jpg", 13, -8]
  ].forEach(([src, x, z]) => {
    const texture = loader.load(src);
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(5.6, 3.15),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.42, side: THREE.DoubleSide })
    );
    panel.position.set(x, 3.2, z);
    panel.rotation.y = Math.PI / 4;
    world.add(panel);
  });

  const createSeraph = () => {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0b1115, roughness: 0.48, metalness: 0.72 });
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x1fffd7, emissive: 0x008c7b, emissiveIntensity: 1.2 });
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x18252a, emissive: 0x0c403c, emissiveIntensity: 0.35, metalness: 0.8, roughness: 0.35 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x05080a, roughness: 0.62, metalness: 0.65 });
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false });
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0xd8ff3f,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.82, 26), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.025;
    shadow.scale.z = 0.58;
    group.add(shadow);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.9, 0.32), bodyMat);
    body.position.y = 0.72;
    body.castShadow = true;
    group.add(body);

    const chestGlow = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.035), visorMat);
    chestGlow.position.set(0, 0.88, 0.19);
    group.add(chestGlow);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), bodyMat);
    head.position.y = 1.28;
    head.castShadow = true;
    group.add(head);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.06, 0.05), visorMat);
    visor.position.set(0, 1.3, 0.22);
    group.add(visor);

    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.56, 0.14), bootMat);
    leftLeg.position.set(-0.12, 0.28, 0.02);
    leftLeg.rotation.x = -0.12;
    leftLeg.castShadow = true;
    group.add(leftLeg);

    const rightLeg = leftLeg.clone();
    rightLeg.position.x = 0.12;
    rightLeg.rotation.x = 0.12;
    group.add(rightLeg);

    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.52, 0.12), bodyMat);
    leftArm.position.set(-0.31, 0.78, 0.03);
    leftArm.rotation.z = 0.18;
    leftArm.castShadow = true;
    group.add(leftArm);

    const rightArm = leftArm.clone();
    rightArm.position.x = 0.31;
    rightArm.rotation.z = -0.18;
    group.add(rightArm);

    const rigSpine = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.74, 0.12), wingMat);
    rigSpine.position.set(0, 0.86, -0.24);
    rigSpine.castShadow = true;
    group.add(rigSpine);

    const leftWing = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 1.08), wingMat);
    leftWing.position.set(-0.38, 0.88, -0.2);
    leftWing.rotation.z = -0.34;
    leftWing.rotation.y = 0.18;
    group.add(leftWing);

    const rightWing = leftWing.clone();
    rightWing.position.x = 0.34;
    rightWing.rotation.z = 0.28;
    rightWing.rotation.y = -0.18;
    group.add(rightWing);

    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.74), materials.acid);
    blade.position.set(0.32, 0.58, 0.28);
    blade.rotation.x = -0.35;
    group.add(blade);

    const trail = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 1.16), trailMat);
    trail.position.set(0.02, 0.18, -0.58);
    trail.rotation.x = -Math.PI / 2;
    group.add(trail);

    group.userData.wings = [leftWing, rightWing];
    group.userData.limbs = [leftLeg, rightLeg, leftArm, rightArm, trail];
    group.scale.setScalar(1.05);
    scene.add(group);
    return group;
  };

  const seraph = createSeraph();
  const rainGeometry = new THREE.BufferGeometry();
  const rainCount = 480;
  const rainPositions = new Float32Array(rainCount * 3);
  for (let i = 0; i < rainCount; i += 1) {
    rainPositions[i * 3] = -18 + seededNoise(i, 111) * 38;
    rainPositions[i * 3 + 1] = 1 + seededNoise(i, 117) * 12;
    rainPositions[i * 3 + 2] = -10 + seededNoise(i, 123) * 22;
  }
  rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
  const rain = new THREE.Points(
    rainGeometry,
    new THREE.PointsMaterial({ color: 0x1fffd7, size: 0.035, transparent: true, opacity: 0.58 })
  );
  scene.add(rain);

  const sampleRoute = (progress) => {
    const scaled = progress * (routePoints.length - 1);
    const index = clamp(Math.floor(scaled), 0, routePoints.length - 2);
    const amount = scaled - index;
    const a = routePoints[index];
    const b = routePoints[index + 1];
    return {
      x: lerp(a.x, b.x, amount),
      z: lerp(a.z, b.z, amount),
      heading: Math.atan2(b.x - a.x, b.z - a.z),
      beat: index
    };
  };

  const resize = () => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const frustum = width < 760 ? 15 : 19;
    camera.left = (-frustum * aspect) / 2;
    camera.right = (frustum * aspect) / 2;
    camera.top = frustum / 2;
    camera.bottom = -frustum / 2;
    camera.updateProjectionMatrix();
  };

  const clock = new THREE.Clock();
  const color = new THREE.Color();
  const render = () => {
    const elapsed = clock.getElapsedTime();
    latestProgress = getProgress();
    const sampled = sampleRoute(latestProgress);
    const beat = isoRoute[clamp(Math.floor(latestProgress * (isoRoute.length - 1) + 0.001), 0, isoRoute.length - 1)];

    updateHud(latestProgress);

    seraph.position.set(sampled.x, 0.28 + Math.sin(elapsed * 7) * 0.035, sampled.z);
    seraph.rotation.y += (sampled.heading - seraph.rotation.y) * 0.09;
    seraph.userData.wings.forEach((wing, index) => {
      wing.rotation.z = (index === 0 ? -0.28 : 0.28) + Math.sin(elapsed * 4.4 + index) * 0.08;
    });
    seraph.userData.limbs.forEach((limb, index) => {
      if (index < 4) {
        limb.rotation.x = (index % 2 === 0 ? -0.12 : 0.12) + Math.sin(elapsed * 8.5 + index) * 0.16;
      } else {
        limb.material.opacity = 0.34 + Math.sin(elapsed * 5.2) * 0.14;
      }
    });

    enemies.forEach((enemy, index) => {
      enemy.rotation.y += 0.018 + index * 0.002;
      enemy.position.y = 0.62 + Math.sin(elapsed * 2.1 + index) * 0.05;
    });

    animatedSignals.forEach((signal, index) => {
      signal.scale.y = 0.72 + Math.sin(elapsed * 2.4 + index * 0.7) * 0.12 + latestProgress * 0.18;
      signal.position.y += Math.sin(elapsed * 1.8 + index) * 0.0008;
    });

    const rainAttr = rain.geometry.attributes.position;
    for (let i = 0; i < rainCount; i += 1) {
      const yIndex = i * 3 + 1;
      rainAttr.array[yIndex] -= 0.045;
      if (rainAttr.array[yIndex] < 0.2) rainAttr.array[yIndex] = 12;
    }
    rainAttr.needsUpdate = true;

    color.setHex(beat.color);
    keyLight.color.lerp(color, 0.08);
    scene.fog.color.lerp(new THREE.Color(latestProgress < 0.34 ? 0x031014 : latestProgress < 0.67 ? 0x120904 : 0x03110c), 0.06);
    relay.scale.y = 1 + Math.sin(elapsed * 5 + latestProgress * 16) * 0.05;

    cameraTarget.set(sampled.x + 1.1, 0.7, sampled.z - 0.4);
    cameraOffset.set(window.innerWidth < 760 ? 10 : 14, window.innerWidth < 760 ? 12 : 13, window.innerWidth < 760 ? 10 : 14);
    camera.position.lerp(cameraTarget.clone().add(cameraOffset), 0.08);
    camera.lookAt(cameraTarget);

    renderer.render(scene, camera);
    requestAnimationFrame(render);
  };

  resize();
  updateHud(getProgress());
  window.addEventListener("resize", resize);
  render();
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-district]").forEach((button) => {
    button.addEventListener("click", () => setDistrict(button.dataset.district));
  });

  document.querySelectorAll("[data-faction]").forEach((button) => {
    button.addEventListener("click", () => setFaction(button.dataset.faction));
  });

  document.querySelectorAll("[data-breach]").forEach((button) => {
    button.addEventListener("click", () => setBreach(button.dataset.breach));
  });

  document.querySelector("[data-loadout-prev]")?.addEventListener("click", () => setLoadout(loadoutIndex - 1));
  document.querySelector("[data-loadout-next]")?.addEventListener("click", () => setLoadout(loadoutIndex + 1));

  setupHeader();
  setupMotionToggle();
  setupVideoControls();
  setupReveals();
  setupIsometricJourney();
});
