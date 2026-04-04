import { estateItems } from "./data/estate.js";

const state = {
  status: "all",
  query: "",
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

const searchInput = document.querySelector("#search-input");
const statusControls = document.querySelector("#filter-controls");
const resultsLabel = document.querySelector("#results-summary");
const featuredTarget = document.querySelector("#featured-items");

const metricTargets = {
  total: document.querySelector('[data-metric="total"]'),
  live: document.querySelector('[data-metric="live"]'),
  building: document.querySelector('[data-metric="building"]'),
  groups: document.querySelector('[data-metric="groups"]'),
};

function normalize(value) {
  return String(value ?? "").toLowerCase().trim();
}

function entryMatches(entry) {
  const query = normalize(state.query);
  const text = normalize(
    [entry.name, entry.blurb, entry.family, entry.type, entry.group, ...entry.tags].join(" ")
  );

  const statusOk = state.status === "all" || entry.status === state.status;
  const queryOk = query.length === 0 || text.includes(query);

  return statusOk && queryOk;
}

function statusLabel(value) {
  return value.replace(/-/g, " ");
}

function formatMetric(value) {
  return String(value).padStart(2, "0");
}

function actionLabel(item) {
  if (!item.url) {
    return "Still in build";
  }

  return item.status === "live" ? "Open live" : "View progress";
}

function createEntryMarkup(item) {
  const tags = item.tags.map((tag) => `<li>${tag}</li>`).join("");
  const link = item.url
    ? `<a class="entry-link" href="${item.url}" target="_blank" rel="noreferrer">${actionLabel(item)}</a>`
    : `<span class="entry-link is-disabled">${actionLabel(item)}</span>`;
  const cardAttrs = item.url
    ? `data-clickable="true" data-url="${item.url}"`
    : `data-clickable="false"`;

  return `
    <article class="entry-card" ${cardAttrs}>
      <div class="entry-card-header">
        <span class="entry-type">${item.type}</span>
        <span class="entry-status" data-status="${item.status}">${statusLabel(item.status)}</span>
      </div>
      <div class="entry-title-row">
        <h3>${item.name}</h3>
        <span class="entry-family">${item.family}</span>
      </div>
      <p>${item.blurb}</p>
      <ul class="tag-list">${tags}</ul>
      <div class="entry-card-footer">${link}</div>
      <span class="entry-glow" aria-hidden="true"></span>
    </article>
  `;
}

function createEmptyMarkup(label) {
  return `<article class="entry-empty">${label}</article>`;
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

function renderGroup(group) {
  const items = estateItems.filter((item) => item.group === group && entryMatches(item));
  const target = groupTargets[group];
  const section = groupSections[group];

  target.innerHTML = items.length
    ? items.map(createEntryMarkup).join("")
    : createEmptyMarkup("No entries match this filter");
  section.classList.toggle("is-hidden", items.length === 0);
}

function renderFeatured() {
  const featured = estateItems.filter((item) => item.featured && entryMatches(item));
  featuredTarget.innerHTML = featured.length
    ? featured.map(createEntryMarkup).join("")
    : createEmptyMarkup("No featured surfaces match right now");
}

function updateResultSummary() {
  const count = estateItems.filter(entryMatches).length;
  resultsLabel.textContent =
    state.query || state.status !== "all"
      ? `${count} matching entries`
      : `${estateItems.length} total entries`;
}

function render() {
  setMetricCounts();
  renderFeatured();
  renderGroup("websites");
  renderGroup("hubs");
  renderGroup("tools");
  renderGroup("games");
  updateResultSummary();
  attachCardBehaviors();
}

function attachCardBehaviors() {
  document.querySelectorAll(".entry-card").forEach((card) => {
    const url = card.dataset.url;

    if (url) {
      card.addEventListener("click", (event) => {
        if (event.target.closest("a")) {
          return;
        }

        window.open(url, "_blank", "noopener");
      });
    }

    card.addEventListener("mousemove", (event) => {
      const rect = card.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      card.style.setProperty("--mx", `${x}px`);
      card.style.setProperty("--my", `${y}px`);
    });
  });
}

statusControls.addEventListener("click", (event) => {
  const button = event.target.closest(".filter-button");
  if (!button) {
    return;
  }

  state.status = button.dataset.filter;
  document
    .querySelectorAll(".filter-button")
    .forEach((node) => node.classList.toggle("is-active", node === button));
  render();
});

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

render();
