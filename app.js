import { estateItems } from "./data/estate.js";

const sectionTargets = {
  websites: document.querySelector("#websites-grid"),
  tools: document.querySelector("#tools-grid"),
  games: document.querySelector("#games-grid"),
};

const countTargets = {
  websites: document.querySelector('[data-count="websites"]'),
  tools: document.querySelector('[data-count="tools"]'),
  games: document.querySelector('[data-count="games"]'),
};

const statusRank = {
  live: 0,
  "in-progress": 1,
  "coming-soon": 2,
};

function formatCount(value) {
  return String(value).padStart(2, "0");
}

function statusLabel(value) {
  return value === "in-progress" ? "In build" : value.replace(/-/g, " ");
}

function sortItems(a, b) {
  const orderDelta = (a.sectionOrder ?? 99) - (b.sectionOrder ?? 99);
  if (orderDelta !== 0) {
    return orderDelta;
  }

  const statusDelta = (statusRank[a.status] ?? 99) - (statusRank[b.status] ?? 99);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  return a.name.localeCompare(b.name);
}

function getWebsiteItems() {
  return estateItems
    .filter((item) => item.group === "websites" || item.group === "hubs")
    .sort(sortItems);
}

function getToolItems() {
  return estateItems
    .filter((item) => item.group === "tools")
    .sort(sortItems);
}

function getGameItems() {
  return estateItems
    .filter((item) => item.group === "games")
    .sort(sortItems);
}

function actionLabel(item) {
  if (!item.url) {
    return item.status === "coming-soon" ? "Coming later" : "In progress";
  }

  return item.status === "live" ? "Open site" : "Preview";
}

function createAction(item) {
  if (!item.url) {
    return `<span class="card-link is-disabled">${actionLabel(item)}</span>`;
  }

  return `<a class="card-link" href="${item.url}" target="_blank" rel="noreferrer">${actionLabel(item)}</a>`;
}

function createCardMarkup(item) {
  const clickableAttr = item.url ? `data-url="${item.url}" data-clickable="true"` : `data-clickable="false"`;

  return `
    <article class="showcase-card" data-group="${item.group}" ${clickableAttr}>
      <div class="card-media">
      <img
        src="${item.media.src}"
        alt="${item.media.alt ?? ""}"
        loading="lazy"
        decoding="async"
        style="object-position: ${item.media.position ?? "50% 50%"}"
      />
      </div>

      <div class="card-meta">
        <span class="card-type">${item.type}</span>
        <span class="card-status" data-status="${item.status}">${statusLabel(item.status)}</span>
      </div>

      <div class="card-body">
        <h3>${item.name}</h3>
        <p>${item.blurb}</p>
      </div>

      <div class="card-footer">
        <span class="card-family">${item.family}</span>
        ${createAction(item)}
      </div>
    </article>
  `;
}

function renderSection(target, items, emptyLabel) {
  target.innerHTML = items.length
    ? items.map(createCardMarkup).join("")
    : `<article class="entry-empty">${emptyLabel}</article>`;
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

function setCounts(websites, tools, games) {
  countTargets.websites.textContent = formatCount(websites.length);
  countTargets.tools.textContent = formatCount(tools.length);
  countTargets.games.textContent = formatCount(games.length);
}

const websiteItems = getWebsiteItems();
const toolItems = getToolItems();
const gameItems = getGameItems();

renderSection(sectionTargets.websites, websiteItems, "Websites coming soon");
renderSection(sectionTargets.tools, toolItems, "Tools coming soon");
renderSection(sectionTargets.games, gameItems, "Games coming soon");
setCounts(websiteItems, toolItems, gameItems);
attachCardClicks();
