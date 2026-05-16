const fallbackFeed = {
  stats: { sites: 8, tools: 4, games: 2 },
  ticker: [
    {
      kind: "BUILDING",
      text: "Creative Radar - permission-first directory v0.2",
      tag: "ON THE BENCH",
      href: "/creative-radar/",
      timestamp: "2026-05-16T09:00:00Z",
    },
  ],
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
const root = document.documentElement;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normaliseHref(href) {
  if (!href) return "#";
  return href;
}

function isExternalHref(href) {
  return /^https?:\/\//i.test(href);
}

function applyTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  localStorage.setItem("ew-theme", next);

  const button = document.querySelector("[data-theme-toggle]");
  const icon = button?.querySelector(".ew-theme-toggle-icon");
  const label = button?.querySelector(".ew-theme-toggle-label");
  const themeColour = document.querySelector('meta[name="theme-color"]');

  if (button) {
    button.setAttribute("aria-pressed", String(next === "light"));
  }
  if (icon) icon.textContent = "";
  if (label) label.textContent = next === "light" ? "Light" : "Dark";
  if (themeColour) themeColour.setAttribute("content", next === "light" ? "#f7f3ec" : "#030305");
}

function setupThemeToggle() {
  const saved = localStorage.getItem("ew-theme");
  applyTheme(saved === "light" ? "light" : "dark");

  const button = document.querySelector("[data-theme-toggle]");
  if (!button) return;

  button.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";

    if (!document.startViewTransition || reducedMotion.matches) {
      applyTheme(next);
      return;
    }

    const rect = button.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = Math.hypot(
      Math.max(cx, window.innerWidth - cx),
      Math.max(cy, window.innerHeight - cy),
    );

    const transition = document.startViewTransition(() => applyTheme(next));
    transition.ready.then(() => {
      root.animate(
        [
          { clipPath: `circle(0 at ${cx}px ${cy}px)` },
          { clipPath: `circle(${radius}px at ${cx}px ${cy}px)` },
        ],
        {
          duration: 700,
          easing: "cubic-bezier(.2,.7,.2,1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    });
  });
}

function setupSplitHeading() {
  const heading = document.querySelector("[data-split-heading]");
  if (!heading) return;

  const nodes = Array.from(heading.childNodes);
  heading.textContent = "";
  heading.classList.add("ew-split");

  let charIndex = 0;

  const appendWord = (word, isEmphasis) => {
    if (!word) return;
    if (/^\s+$/.test(word)) {
      const space = document.createElement("span");
      space.className = "ew-split-space";
      space.textContent = " ";
      heading.append(space);
      return;
    }

    const wordSpan = document.createElement("span");
    wordSpan.className = `ew-split-word${isEmphasis ? " ew-split-em" : ""}`;

    for (const char of Array.from(word)) {
      const charSpan = document.createElement("span");
      charSpan.className = "ew-split-char";
      charSpan.style.setProperty("--ci", String(charIndex));
      charSpan.textContent = char;
      wordSpan.append(charSpan);
      charIndex += 1;
    }

    heading.append(wordSpan);
  };

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      String(node.textContent).split(/(\s+)/).forEach((part) => appendWord(part, false));
    } else if (node instanceof HTMLElement && node.tagName.toLowerCase() === "em") {
      String(node.textContent).split(/(\s+)/).forEach((part) => appendWord(part, true));
    }
  }
}

async function loadFeed() {
  try {
    const response = await fetch("data/feed.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`Feed request failed: ${response.status}`);
    const payload = await response.json();
    return {
      stats: payload.stats ?? fallbackFeed.stats,
      ticker: Array.isArray(payload.ticker) && payload.ticker.length ? payload.ticker : fallbackFeed.ticker,
    };
  } catch (error) {
    console.warn("Elusion Works feed fallback used.", error);
    return fallbackFeed;
  }
}

function renderTicker(lines) {
  const ticker = document.querySelector("[data-ticker]");
  const windowEl = document.querySelector("[data-ticker-window]");
  const tagEl = document.querySelector("[data-ticker-tag]");
  const progressEl = document.querySelector("[data-ticker-progress]");
  const miniTrack = document.querySelector("[data-mini-marquee]");
  if (!ticker || !windowEl || !tagEl || !progressEl) return;

  const sorted = [...lines]
    .sort((a, b) => Date.parse(b.timestamp ?? "") - Date.parse(a.timestamp ?? ""))
    .slice(0, 6);

  windowEl.innerHTML = sorted
    .map((line, index) => `
      <div class="ew-ticker-line" data-ticker-line="${index}">
        <span class="ew-mono ew-ticker-kicker">${escapeHtml(line.kind)}</span>
        <span class="ew-ticker-text">${escapeHtml(line.text)}</span>
      </div>
    `)
    .join("");

  progressEl.innerHTML = sorted.map((_, index) => `<span data-ticker-dot="${index}"></span>`).join("");

  if (miniTrack) {
    const doubled = [...sorted, ...sorted];
    miniTrack.innerHTML = doubled
      .map((line) => `
        <span class="ew-mini-marquee-item">
          <span class="ew-live-dot" aria-hidden="true"></span>
          <span class="ew-mono">${escapeHtml(line.kind)}</span>
          <span>${escapeHtml(line.text)}</span>
          <span class="ew-marquee-sep" aria-hidden="true">::</span>
        </span>
      `)
      .join("");
  }

  let current = 0;
  let paused = false;

  function show(index) {
    current = index % sorted.length;
    const active = sorted[current];
    const lineEls = windowEl.querySelectorAll("[data-ticker-line]");
    const dotEls = progressEl.querySelectorAll("[data-ticker-dot]");

    lineEls.forEach((lineEl, lineIndex) => {
      const offset = lineIndex < current ? "-110%" : "110%";
      lineEl.style.transform = lineIndex === current ? "translateY(0%)" : `translateY(${offset})`;
      lineEl.style.opacity = lineIndex === current ? "1" : "0";
    });

    dotEls.forEach((dotEl, dotIndex) => {
      dotEl.classList.toggle("on", dotIndex === current);
    });

    tagEl.textContent = active.tag ?? "Studio";
    tagEl.setAttribute("href", normaliseHref(active.href));
    if (isExternalHref(active.href ?? "")) {
      tagEl.setAttribute("target", "_blank");
      tagEl.setAttribute("rel", "noopener noreferrer");
    } else {
      tagEl.removeAttribute("target");
      tagEl.removeAttribute("rel");
    }
  }

  show(0);

  if (!reducedMotion.matches && sorted.length > 1) {
    ticker.addEventListener("mouseenter", () => { paused = true; });
    ticker.addEventListener("mouseleave", () => { paused = false; });
    ticker.addEventListener("focusin", () => { paused = true; });
    ticker.addEventListener("focusout", () => { paused = false; });

    window.setInterval(() => {
      if (!paused) show(current + 1);
    }, 3200);
  }
}

function setupCountUps(stats) {
  const counters = document.querySelectorAll("[data-count-to]");
  const values = [stats.sites, stats.tools, stats.games].filter((value) => Number.isFinite(Number(value)));

  counters.forEach((counter, index) => {
    const fallback = Number(counter.getAttribute("data-count-to") ?? "0");
    const target = Number(values[index] ?? fallback);
    counter.setAttribute("data-count-to", String(target));

    const run = () => {
      if (reducedMotion.matches) {
        counter.textContent = String(target);
        return;
      }

      const start = performance.now();
      const duration = 1100;
      const tick = (time) => {
        const progress = Math.min(1, (time - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        counter.textContent = String(Math.round(target * eased));
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    if ("IntersectionObserver" in window) {
      let started = false;
      const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting && !started) {
          started = true;
          run();
          observer.disconnect();
        }
      }, { threshold: 0.35 });
      observer.observe(counter);
    } else {
      run();
    }
  });
}

function setupPointerEffects() {
  if (reducedMotion.matches || !finePointer.matches) return;

  let raf = 0;
  let mx = 0.5;
  let my = 0.5;
  let tx = 0.5;
  let ty = 0.5;

  const tick = () => {
    mx += (tx - mx) * 0.18;
    my += (ty - my) * 0.18;
    root.style.setProperty("--mx", `${(mx * 100).toFixed(2)}%`);
    root.style.setProperty("--my", `${(my * 100).toFixed(2)}%`);
    root.style.setProperty("--cursor-x", `${Math.round(tx * window.innerWidth)}px`);
    root.style.setProperty("--cursor-y", `${Math.round(ty * window.innerHeight)}px`);

    if (Math.abs(tx - mx) > 0.001 || Math.abs(ty - my) > 0.001) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = 0;
    }
  };

  window.addEventListener("pointermove", (event) => {
    tx = event.clientX / window.innerWidth;
    ty = event.clientY / window.innerHeight;
    if (!raf) raf = requestAnimationFrame(tick);
  }, { passive: true });
}

function setupScrollProgress() {
  let raf = 0;
  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight || 1;
    const progress = Math.min(1, Math.max(0, window.scrollY / max));
    root.style.setProperty("--scroll", progress.toFixed(4));
    root.style.setProperty("--scrolly", `${window.scrollY}px`);
    raf = 0;
  };

  update();
  window.addEventListener("scroll", () => {
    if (!raf) raf = requestAnimationFrame(update);
  }, { passive: true });
  window.addEventListener("resize", update);
}

function setupMagnetics() {
  if (reducedMotion.matches || !finePointer.matches) return;

  const elements = Array.from(document.querySelectorAll(".ew-magnet"));
  if (!elements.length) return;

  let raf = 0;

  window.addEventListener("pointermove", (event) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = event.clientX - cx;
        const dy = event.clientY - cy;
        const distance = Math.hypot(dx, dy);
        const range = 140;

        if (distance < range) {
          const force = (1 - distance / range) * 0.35;
          element.style.setProperty("--magnet-x", `${(dx * force).toFixed(1)}px`);
          element.style.setProperty("--magnet-y", `${(dy * force).toFixed(1)}px`);
        } else {
          element.style.setProperty("--magnet-x", "0px");
          element.style.setProperty("--magnet-y", "0px");
        }
      }
    });
  }, { passive: true });
}

function setupPlateTilt() {
  if (reducedMotion.matches || !finePointer.matches) return;

  document.querySelectorAll(".ew-plate").forEach((plate) => {
    let raf = 0;

    plate.addEventListener("pointermove", (event) => {
      const rect = plate.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;

      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        plate.style.setProperty("--rx", `${(-y * 8).toFixed(2)}deg`);
        plate.style.setProperty("--ry", `${(x * 10).toFixed(2)}deg`);
        plate.style.setProperty("--px", `${(x * 14).toFixed(1)}px`);
        plate.style.setProperty("--py", `${(y * 14).toFixed(1)}px`);
        plate.style.setProperty("--gx", `${((x + 0.5) * 100).toFixed(1)}%`);
        plate.style.setProperty("--gy", `${((y + 0.5) * 100).toFixed(1)}%`);
      });
    }, { passive: true });

    plate.addEventListener("pointerleave", () => {
      cancelAnimationFrame(raf);
      plate.style.setProperty("--rx", "0deg");
      plate.style.setProperty("--ry", "0deg");
      plate.style.setProperty("--px", "0px");
      plate.style.setProperty("--py", "0px");
      plate.style.setProperty("--gx", "50%");
      plate.style.setProperty("--gy", "50%");
    });
  });
}

async function boot() {
  setupThemeToggle();
  setupSplitHeading();
  setupPointerEffects();
  setupScrollProgress();
  setupMagnetics();
  setupPlateTilt();

  const feed = await loadFeed();
  renderTicker(feed.ticker);
  setupCountUps(feed.stats);
}

boot();
