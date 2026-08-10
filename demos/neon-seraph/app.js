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

function setupVideoControls() {
  const video = document.querySelector("[data-hero-video]");
  const toggle = document.querySelector("[data-video-toggle]");
  const trailerJump = document.querySelector("[data-trailer-jump]");
  if (!video || !toggle) return;

  if (prefersReduced) {
    video.pause();
  } else {
    const playPromise = video.play();
    if (playPromise) {
      playPromise.catch(() => {
        toggle.textContent = "Play trailer";
      });
    }
  }

  toggle.addEventListener("click", () => {
    if (video.paused) {
      video.play();
      toggle.textContent = "Pause trailer";
    } else {
      video.pause();
      toggle.textContent = "Play trailer";
    }
  });

  trailerJump?.addEventListener("click", () => {
    document.querySelector("#trailer")?.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth" });
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

function setupForm() {
  const form = document.querySelector("[data-launch-form]");
  const status = document.querySelector("[data-form-status]");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    status.textContent = "Signal captured locally. Static demo: no email was sent.";
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-district]").forEach((button) => {
    button.addEventListener("click", () => setDistrict(button.dataset.district));
  });

  document.querySelectorAll("[data-faction]").forEach((button) => {
    button.addEventListener("click", () => setFaction(button.dataset.faction));
  });

  document.querySelector("[data-loadout-prev]")?.addEventListener("click", () => setLoadout(loadoutIndex - 1));
  document.querySelector("[data-loadout-next]")?.addEventListener("click", () => setLoadout(loadoutIndex + 1));

  setupHeader();
  setupMotionToggle();
  setupVideoControls();
  setupReveals();
  setupForm();
});
