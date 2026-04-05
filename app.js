import { estateItems } from "./data/estate.js";

const state = {
  status: "all",
  query: "",
};

const statusRank = {
  live: 0,
  "in-progress": 1,
  "coming-soon": 2,
};

const typeRank = {
  website: 0,
  hub: 1,
  tool: 2,
  game: 3,
};

const groupTargets = {
  websites: document.querySelector("#websites-list"),
  hubs: document.querySelector("#hubs-list"),
  tools: document.querySelector("#tools-list"),
  games: document.querySelector("#games-list"),
};

const groupSections = {
  websites: document.querySelector("#websites"),
  hubs: document.querySelector("#hubs"),
  tools: document.querySelector("#tools"),
  games: document.querySelector("#games"),
};

const featuredTarget = document.querySelector("#featured-items");
const resultsLabel = document.querySelector("#results-summary");
const searchInput = document.querySelector("#search-input");
const statusControls = document.querySelector("#filter-controls");

const metricTargets = {
  total: document.querySelector('[data-metric="total"]'),
  live: document.querySelector('[data-metric="live"]'),
  building: document.querySelector('[data-metric="building"]'),
  groups: document.querySelector('[data-metric="groups"]'),
};

const featuredItems = estateItems
  .filter((item) => item.featured)
  .sort((a, b) => (a.featureOrder ?? 99) - (b.featureOrder ?? 99));

function normalize(value) {
  return String(value ?? "").toLowerCase().trim();
}

function statusLabel(value) {
  return value === "in-progress" ? "In build" : value.replace(/-/g, " ");
}

function formatMetric(value) {
  return String(value).padStart(2, "0");
}

function sortDirectoryItems(a, b) {
  const statusDelta = (statusRank[a.status] ?? 99) - (statusRank[b.status] ?? 99);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  const typeDelta = (typeRank[a.type] ?? 99) - (typeRank[b.type] ?? 99);
  if (typeDelta !== 0) {
    return typeDelta;
  }

  return a.name.localeCompare(b.name);
}

function entryMatches(entry) {
  const query = normalize(state.query);
  const statusOk = state.status === "all" || entry.status === state.status;
  const haystack = normalize(
    [entry.name, entry.blurb, entry.family, entry.type, entry.group, ...entry.tags].join(" ")
  );
  const queryOk = !query || haystack.includes(query);

  return statusOk && queryOk;
}

function actionLabel(item) {
  if (!item.url) {
    return "In development";
  }

  return item.status === "live" ? "Open" : "View";
}

function createAction(item) {
  if (!item.url) {
    return `<span class="card-link is-disabled">${actionLabel(item)}</span>`;
  }

  return `<a class="card-link" href="${item.url}" target="_blank" rel="noreferrer">${actionLabel(item)}</a>`;
}

function createFeatureMedia(item) {
  if (!item.media?.src) {
    return "";
  }

  return `
    <div class="feature-media">
      <img
        src="${item.media.src}"
        alt="${item.media.alt ?? ""}"
        loading="lazy"
        decoding="async"
      />
    </div>
  `;
}

function createCardMarkup(item, variant = "directory") {
  const cardClass = variant === "feature" ? "feature-card" : "directory-card";
  const clickableAttr = item.url ? `data-url="${item.url}" data-clickable="true"` : `data-clickable="false"`;
  const media = variant === "feature" ? createFeatureMedia(item) : "";

  return `
    <article class="${cardClass}" ${clickableAttr}>
      ${media}
      <div class="card-top">
        <span class="card-type">${item.type}</span>
        <span class="card-status" data-status="${item.status}">${statusLabel(item.status)}</span>
      </div>
      <div class="card-body">
        <h3>${item.name}</h3>
        <p>${item.blurb}</p>
      </div>
      <div class="card-bottom">
        <span class="card-family">${item.family}</span>
        ${createAction(item)}
      </div>
    </article>
  `;
}

function createEmptyMarkup(label) {
  return `<article class="entry-empty">${label}</article>`;
}

function renderFeatured() {
  featuredTarget.innerHTML = featuredItems.length
    ? featuredItems.map((item) => createCardMarkup(item, "feature")).join("")
    : createEmptyMarkup("No selected work available");
}

function renderGroup(group) {
  const target = groupTargets[group];
  const section = groupSections[group];
  const items = estateItems
    .filter((item) => item.group === group && entryMatches(item))
    .sort(sortDirectoryItems);

  target.innerHTML = items.length
    ? items.map((item) => createCardMarkup(item)).join("")
    : createEmptyMarkup("No entries match this filter");

  section.classList.toggle("is-hidden", items.length === 0);
}

function setMetricCounts() {
  const groups = new Set(estateItems.map((item) => item.group));

  metricTargets.total.textContent = formatMetric(estateItems.length);
  metricTargets.live.textContent = formatMetric(
    estateItems.filter((item) => item.status === "live").length
  );
  metricTargets.building.textContent = formatMetric(
    estateItems.filter((item) => item.status === "in-progress").length
  );
  metricTargets.groups.textContent = formatMetric(groups.size);
}

function updateResultSummary() {
  const count = estateItems.filter(entryMatches).length;
  const label = count === 1 ? "entry" : "entries";

  resultsLabel.textContent = `${count} ${label} shown`;
}

function attachCardClicks() {
  document.querySelectorAll("[data-clickable='true']").forEach((card) => {
    if (card.dataset.bound === "true") {
      return;
    }

    card.dataset.bound = "true";

    card.addEventListener("click", (event) => {
      if (event.target.closest("a")) {
        return;
      }

      window.open(card.dataset.url, "_blank", "noopener");
    });
  });
}

function renderDirectory() {
  renderGroup("websites");
  renderGroup("hubs");
  renderGroup("tools");
  renderGroup("games");
  updateResultSummary();
  attachCardClicks();
}

function initControls() {
  if (statusControls) {
    statusControls.addEventListener("click", (event) => {
      const button = event.target.closest(".filter-button");
      if (!button) {
        return;
      }

      state.status = button.dataset.filter;

      document
        .querySelectorAll(".filter-button")
        .forEach((node) => node.classList.toggle("is-active", node === button));

      renderDirectory();
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      state.query = event.target.value;
      renderDirectory();
    });
  }
}

setMetricCounts();
renderFeatured();
renderDirectory();
initControls();
attachCardClicks();
