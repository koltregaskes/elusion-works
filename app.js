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

const editorialTargets = {
  section: document.querySelector("#editorial"),
  link: document.querySelector("#editorial-link"),
  meta: document.querySelector("#editorial-meta"),
  summary: document.querySelector("#editorial-summary"),
  queue: document.querySelector("#editorial-queue"),
  sites: document.querySelector("#editorial-sites"),
};

const statusRank = {
  live: 0,
  "in-progress": 1,
  "coming-soon": 2,
};

const editorialStatusPriority = {
  hold: 0,
  needs_changes: 1,
  draft_unreviewed: 2,
  draft_in_review: 3,
  approved_ready: 4,
  published_unreviewed: 5,
  published: 6,
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

function editorialStatusLabel(value) {
  const labels = {
    draft_unreviewed: "Awaiting review",
    draft_in_review: "In review",
    approved_ready: "Approved",
    needs_changes: "Changes requested",
    hold: "Hold",
    published: "Published",
    published_unreviewed: "Published unreviewed",
  };

  return labels[value] ?? value.replace(/_/g, " ");
}

function formatReviewDate(value) {
  if (!value) {
    return "No editor activity yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const featuredClass = item.featured ? " is-featured" : "";

  return `
    <article class="showcase-card${featuredClass}" data-group="${item.group}" ${clickableAttr}>
      <div class="card-media">
      <img
        src="${item.media.src}"
        alt="${item.media.alt ?? ""}"
        width="1600"
        height="900"
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

function createMetricMarkup(metric) {
  return `
    <article class="editorial-metric metric-tone-${metric.tone}">
      <span class="eyebrow">${metric.kicker}</span>
      <strong>${formatCount(metric.value)}</strong>
      <h4>${metric.label}</h4>
      <p>${metric.copy}</p>
    </article>
  `;
}

function checklistHighlights(article) {
  return Object.entries(article.checklist ?? {})
    .filter(([, entry]) => entry?.status && entry.status !== "pass")
    .slice(0, 4);
}

function flattenQueue(sites) {
  return sites
    .flatMap((site) =>
      site.articles.map((article) => ({
        ...article,
        site_name: site.site_name,
        site_id: site.site_id,
        live_url: site.live_url,
        auto_publish_on_approval: site.auto_publish_on_approval,
      })),
    )
    .filter((article) => !["published", "published_unreviewed"].includes(article.status))
    .sort((a, b) => {
      const priorityDelta =
        (editorialStatusPriority[a.status] ?? 99) - (editorialStatusPriority[b.status] ?? 99);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return (b.date ?? "").localeCompare(a.date ?? "");
    });
}

function createQueueMarkup(article) {
  const feedbackLabel =
    article.review?.feedback_count > 0
      ? `${article.review.feedback_count} feedback item${article.review.feedback_count === 1 ? "" : "s"}`
      : article.next_action;

  const checks = checklistHighlights(article)
    .map(
      ([key, entry]) => `
        <span class="check-pill check-pill-status-${entry.status}">
          ${escapeHtml(key.replaceAll("_", " "))}: ${escapeHtml(entry.status)}
        </span>
      `,
    )
    .join("");

  return `
    <article class="queue-item">
      <div class="queue-topline">
        <span class="queue-site">${escapeHtml(article.site_name)}</span>
        <span class="review-pill review-pill-status-${article.status}">${escapeHtml(editorialStatusLabel(article.status))}</span>
      </div>

      <div>
        <h4>${escapeHtml(article.title)}</h4>
        <p>${escapeHtml(feedbackLabel)}</p>
      </div>

      <div class="queue-meta">
        <span class="queue-path">${escapeHtml(article.relative_path)}</span>
        <span class="site-stat">${escapeHtml(article.date ?? "Undated")}</span>
      </div>

      <div class="queue-checks">
        ${checks || '<span class="check-pill check-pill-status-pending">No checklist detail yet</span>'}
      </div>
    </article>
  `;
}

function createSiteReviewMarkup(site) {
  const latestAction = site.stats.last_reviewed_at
    ? `Last editor action ${formatReviewDate(site.stats.last_reviewed_at)}`
    : "No reviews recorded yet";

  return `
    <article class="site-review-card">
      <div class="site-review-text">
        <div class="site-review-topline">
          <span class="queue-site">${escapeHtml(site.site_name)}</span>
          <span class="review-pill review-pill-status-${site.auto_publish_on_approval ? "approved_ready" : "published_unreviewed"}">
            ${site.auto_publish_on_approval ? "Auto publish on yay" : "Manual publish after yay"}
          </span>
        </div>
        <h4>${escapeHtml(site.site_name)}</h4>
        <p>${escapeHtml(latestAction)}</p>
        ${
          site.live_url
            ? `<a class="site-review-link" href="${site.live_url}" target="_blank" rel="noreferrer">Open site</a>`
            : ""
        }
      </div>

      <div class="site-review-stats">
        <span class="site-stat">${formatCount(site.stats.article_count)} articles</span>
        <span class="site-stat">${formatCount(site.stats.pending_review_count)} waiting</span>
        <span class="site-stat">${formatCount(site.stats.approved_count)} approved</span>
        <span class="site-stat">${formatCount(site.stats.needs_changes_count)} changes</span>
        <span class="site-stat">${formatCount(site.stats.reviewed_count)} reviewed</span>
      </div>
    </article>
  `;
}

function renderSection(target, items, emptyLabel) {
  target.innerHTML = items.length
    ? items.map(createCardMarkup).join("")
    : `<article class="entry-empty">${emptyLabel}</article>`;
}

function renderEditorial(payload) {
  editorialTargets.section?.removeAttribute("hidden");
  editorialTargets.link?.removeAttribute("hidden");

  const metrics = [
    {
      kicker: "Queue",
      value: payload.summary.pending_review_count,
      label: "Awaiting editor",
      copy: "Drafts or source articles that still need the manager's first pass.",
      tone: "pending",
    },
    {
      kicker: "Approved",
      value: payload.summary.approved_count,
      label: "Ready to move",
      copy: "Articles that have cleared the gate and can publish or await automation.",
      tone: "approved",
    },
    {
      kicker: "Needs work",
      value: payload.summary.needs_changes_count + payload.summary.hold_count,
      label: "Returned or held",
      copy: "Pieces that need changes, image work, or human escalation.",
      tone: "needs",
    },
    {
      kicker: "Archive",
      value: payload.summary.published_count,
      label: "Published pieces",
      copy: "Live articles already across the estate.",
      tone: "published",
    },
  ];

  editorialTargets.summary.innerHTML = metrics.map(createMetricMarkup).join("");

  const queue = flattenQueue(payload.sites).slice(0, 8);
  editorialTargets.queue.innerHTML = queue.length
    ? queue.map(createQueueMarkup).join("")
    : '<article class="queue-item"><p class="queue-empty">Nothing is waiting for review right now. The board is quiet.</p></article>';

  editorialTargets.sites.innerHTML = payload.sites.map(createSiteReviewMarkup).join("");
  editorialTargets.meta.innerHTML = `
    <span class="editorial-chip">${formatCount(payload.summary.site_count)} sites tracked</span>
    <span class="editorial-chip">${formatCount(payload.summary.reviewed_count)} reviewed</span>
    <span class="editorial-chip">Updated ${escapeHtml(formatReviewDate(payload.generated_at))}</span>
  `;
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

async function loadEditorialHub() {
  if (
    !editorialTargets.section ||
    !editorialTargets.link ||
    !editorialTargets.summary ||
    !editorialTargets.queue ||
    !editorialTargets.sites
  ) {
    return;
  }

  const url = new URL(window.location.href);
  const editorialEnabled = url.searchParams.get("editorial") === "1";
  if (!editorialEnabled) {
    return;
  }

  try {
    const response = await fetch("./data/editorial-hub.json", { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    renderEditorial(payload);
    window.attachCursorHovers?.();
  } catch (error) {
    console.warn("Editorial hub unavailable", error);
  }
}

const websiteItems = getWebsiteItems();
const toolItems = getToolItems();
const gameItems = getGameItems();

renderSection(sectionTargets.websites, websiteItems, "Websites coming soon");
renderSection(sectionTargets.tools, toolItems, "Tools coming soon");
renderSection(sectionTargets.games, gameItems, "Games coming soon");
setCounts(websiteItems, toolItems, gameItems);
attachCardClicks();
loadEditorialHub();

if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
  initCursor();
}
