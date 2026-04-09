import { estateItems } from "./data/estate.js";
import { initCursor } from "./cursor.js";

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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function getItemsFor(groups) {
  return estateItems.filter((item) => groups.includes(item.group)).sort(sortItems);
}

function actionLabel(item) {
  if (!item.url) {
    return item.status === "coming-soon" ? "Coming later" : "In progress";
  }

  return item.status === "live" ? "Open site" : "Preview";
}

function createAction(item) {
  const label = escapeHtml(actionLabel(item));
  if (!item.url) {
    return `<span class="card-link is-disabled">${label}</span>`;
  }

  return `<span class="card-link" aria-hidden="true">${label}</span>`;
}

function createOverlayLink(item) {
  if (!item.url) {
    return "";
  }

  return `
    <a
      class="card-overlay-link"
      href="${escapeHtml(item.url)}"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open ${escapeHtml(item.name)}"
    ></a>
  `;
}

function createCardMarkup(item) {
  return `
    <article class="showcase-card" data-group="${escapeHtml(item.group)}">
      <div class="card-media">
        <img
          src="${escapeHtml(item.media.src)}"
          alt="${escapeHtml(item.media.alt ?? "")}"
          width="1600"
          height="900"
          loading="lazy"
          decoding="async"
          style="object-position: ${escapeHtml(item.media.position ?? "50% 50%")}"
        />
      </div>

      <div class="card-meta">
        <span class="card-type">${escapeHtml(item.type)}</span>
        <span class="card-status" data-status="${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
      </div>

      <div class="card-body">
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.blurb)}</p>
      </div>

      <div class="card-footer">
        <span class="card-family">${escapeHtml(item.family)}</span>
        ${createAction(item)}
      </div>

      ${createOverlayLink(item)}
    </article>
  `;
}

function renderSection(target, items, emptyLabel) {
  target.innerHTML = items.length
    ? items.map(createCardMarkup).join("")
    : `<article class="entry-empty">${escapeHtml(emptyLabel)}</article>`;
}

function setCounts(websites, tools, games) {
  countTargets.websites.textContent = formatCount(websites.length);
  countTargets.tools.textContent = formatCount(tools.length);
  countTargets.games.textContent = formatCount(games.length);
}

const websiteItems = getItemsFor(["websites", "hubs"]);
const toolItems = getItemsFor(["tools"]);
const gameItems = getItemsFor(["games"]);

renderSection(sectionTargets.websites, websiteItems, "Websites coming soon");
renderSection(sectionTargets.tools, toolItems, "Tools coming soon");
renderSection(sectionTargets.games, gameItems, "Games coming soon");
setCounts(websiteItems, toolItems, gameItems);

if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
  initCursor();
}
