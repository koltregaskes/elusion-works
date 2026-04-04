import { estateItems } from "./data/estate.js";

const lists = {
  featured: document.querySelector("#featured-items"),
  websites: document.querySelector("#websites-list"),
  tools: document.querySelector("#tools-list"),
  games: document.querySelector("#games-list"),
};

const controls = document.querySelector("#filter-controls");
const sections = document.querySelectorAll(".catalogue-section");

let activeFilter = "all";

function titleCase(value) {
  return value.replace(/-/g, " ");
}

function actionLabel(item) {
  if (!item.url) {
    return "In development";
  }

  if (item.status === "live") {
    return item.type === "tool" ? "Open tool" : "Visit site";
  }

  return "View progress";
}

function cardTemplate(item) {
  const tags = item.tags.map((tag) => `<li>${tag}</li>`).join("");
  const link = item.url
    ? `<a class="entry-link" href="${item.url}" target="_blank" rel="noreferrer">${actionLabel(item)}</a>`
    : `<span class="entry-link is-disabled">${actionLabel(item)}</span>`;
  const clickableAttrs = item.url
    ? `data-clickable="true" onclick="window.open('${item.url}', '_blank', 'noopener')"`
    : `data-clickable="false"`;

  return `
    <article class="entry-card" data-status="${item.status}" ${clickableAttrs}>
      <div class="entry-card-header">
        <span class="entry-type">${item.type}</span>
        <span class="entry-status" data-status="${item.status}">${titleCase(item.status)}</span>
      </div>
      <div class="entry-card-body">
        <h3>${item.name}</h3>
        <p>${item.blurb}</p>
      </div>
      <ul class="tag-list">${tags}</ul>
      <div class="entry-card-footer">${link}</div>
    </article>
  `;
}

function renderSection(target, items) {
  target.innerHTML = items.map(cardTemplate).join("");
}

function filterItems(items) {
  return activeFilter === "all" ? items : items.filter((item) => item.status === activeFilter);
}

function renderAll() {
  renderSection(lists.featured, filterItems(estateItems.filter((item) => item.featured)));
  renderSection(lists.websites, filterItems(estateItems.filter((item) => item.group === "websites")));
  renderSection(lists.tools, filterItems(estateItems.filter((item) => item.group === "tools")));
  renderSection(lists.games, filterItems(estateItems.filter((item) => item.group === "games")));

  sections.forEach((section) => {
    const grid = section.querySelector(".catalogue-grid");
    section.classList.toggle("is-hidden", grid.children.length === 0);
  });
}

controls.addEventListener("click", (event) => {
  const button = event.target.closest(".filter-button");
  if (!button) {
    return;
  }

  activeFilter = button.dataset.filter;
  document
    .querySelectorAll(".filter-button")
    .forEach((node) => node.classList.toggle("is-active", node === button));
  renderAll();
});

renderAll();
