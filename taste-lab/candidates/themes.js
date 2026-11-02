/*
 * Visual themes shared by the dashboard and infographic generators.
 * A candidate is one layout crossed with one theme, so these tokens are the
 * only thing that changes between two candidates that share a layout.
 * Each theme is a complete, self-consistent system: palette, type, shape, depth.
 */
(function () {
  const THEMES = {
    swiss: {
      name: "Swiss",
      tags: { palette: "mono + red", mode: "light", type: "grotesk", shape: "square", depth: "flat rules" },
      fonts: "family=Schibsted+Grotesk:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500",
      vars: {
        "--bg": "#ffffff", "--surface": "#ffffff", "--raised": "#f4f4f2", "--ink": "#111111",
        "--muted": "#6a6a6a", "--faint": "#a3a3a3", "--line": "#e2e2e0", "--accent": "#e2231a",
        "--accent-ink": "#ffffff", "--s1": "#111111", "--s2": "#e2231a", "--s3": "#b9b9b6",
        "--ok": "#111111", "--fail": "#e2231a", "--silent": "#b9b9b6",
        "--display": "'Schibsted Grotesk', 'Helvetica Neue', Arial, sans-serif",
        "--body": "'Schibsted Grotesk', 'Helvetica Neue', Arial, sans-serif",
        "--mono": "'IBM Plex Mono', ui-monospace, Menlo, monospace",
        "--radius": "0px", "--panel-border": "1px solid var(--line)", "--panel-shadow": "none",
        "--display-weight": "800", "--display-tracking": "-0.035em", "--label-case": "uppercase",
        "--label-tracking": "0.08em", "--gap": "0px", "--pad": "22px", "--panel-bg": "var(--surface)"
      }
    },
    graphite: {
      name: "Graphite",
      tags: { palette: "cool blue on charcoal", mode: "dark", type: "geometric sans", shape: "rounded", depth: "layered surfaces" },
      fonts: "family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500",
      vars: {
        "--bg": "#0d0f12", "--surface": "#15181d", "--raised": "#1c2026", "--ink": "#e9ebee",
        "--muted": "#8c939d", "--faint": "#565d68", "--line": "#252a31", "--accent": "#7aa7ff",
        "--accent-ink": "#0d0f12", "--s1": "#7aa7ff", "--s2": "#f0727b", "--s3": "#e0b45a",
        "--ok": "#7aa7ff", "--fail": "#f0727b", "--silent": "#e0b45a",
        "--display": "'Geist', 'Segoe UI', system-ui, sans-serif",
        "--body": "'Geist', 'Segoe UI', system-ui, sans-serif",
        "--mono": "'Geist Mono', ui-monospace, Menlo, monospace",
        "--radius": "12px", "--panel-border": "1px solid var(--line)", "--panel-shadow": "0 1px 0 rgba(255,255,255,0.03) inset",
        "--display-weight": "600", "--display-tracking": "-0.02em", "--label-case": "none",
        "--label-tracking": "0", "--gap": "12px", "--pad": "20px", "--panel-bg": "var(--surface)"
      }
    },
    field: {
      name: "Field Notes",
      tags: { palette: "sage, forest + rust", mode: "light", type: "serif + sans", shape: "soft", depth: "paper" },
      fonts: "family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500",
      vars: {
        "--bg": "#e9ece5", "--surface": "#fbfbf7", "--raised": "#f1f3ec", "--ink": "#1c231f",
        "--muted": "#5c665e", "--faint": "#98a298", "--line": "#d3d9cf", "--accent": "#2c5a4c",
        "--accent-ink": "#fbfbf7", "--s1": "#2c5a4c", "--s2": "#b8543a", "--s3": "#c6a35a",
        "--ok": "#2c5a4c", "--fail": "#b8543a", "--silent": "#c6a35a",
        "--display": "'Newsreader', Georgia, 'Times New Roman', serif",
        "--body": "'Public Sans', 'Segoe UI', system-ui, sans-serif",
        "--mono": "'IBM Plex Mono', ui-monospace, Menlo, monospace",
        "--radius": "6px", "--panel-border": "1px solid var(--line)", "--panel-shadow": "0 1px 2px rgba(28,35,31,0.05)",
        "--display-weight": "500", "--display-tracking": "-0.01em", "--label-case": "uppercase",
        "--label-tracking": "0.1em", "--gap": "14px", "--pad": "22px", "--panel-bg": "var(--surface)"
      }
    },
    signal: {
      name: "Signal",
      tags: { palette: "amber + cyan on navy", mode: "dark", type: "condensed sans", shape: "sharp", depth: "instrument panel" },
      fonts: "family=IBM+Plex+Sans+Condensed:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500",
      vars: {
        "--bg": "#0a1424", "--surface": "#0f1d33", "--raised": "#142641", "--ink": "#eef3fb",
        "--muted": "#8ba1c0", "--faint": "#4f6584", "--line": "#1c3050", "--accent": "#ffb020",
        "--accent-ink": "#0a1424", "--s1": "#4cc3ff", "--s2": "#ff5a5f", "--s3": "#ffb020",
        "--ok": "#4cc3ff", "--fail": "#ff5a5f", "--silent": "#ffb020",
        "--display": "'IBM Plex Sans Condensed', 'Arial Narrow', sans-serif",
        "--body": "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
        "--mono": "'IBM Plex Mono', ui-monospace, Menlo, monospace",
        "--radius": "2px", "--panel-border": "1px solid var(--line)", "--panel-shadow": "none",
        "--display-weight": "600", "--display-tracking": "0", "--label-case": "uppercase",
        "--label-tracking": "0.14em", "--gap": "8px", "--pad": "18px", "--panel-bg": "var(--surface)"
      }
    }
  };

  function applyTheme(key) {
    const t = THEMES[key] || THEMES.swiss;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
    root.dataset.theme = key;
    root.style.colorScheme = t.tags.mode === "dark" ? "dark" : "light";
    let link = document.getElementById("theme-fonts");
    const href = "https://fonts.googleapis.com/css2?" + t.fonts + "&display=swap";
    if (!link) {
      link = document.createElement("link");
      link.id = "theme-fonts";
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    if (link.href !== href) link.href = href;
    return t;
  }

  /* Read "#layout-theme" from the URL hash. */
  function readHash(defaultLayout, defaultTheme) {
    const raw = (location.hash || "").replace(/^#/, "");
    const [layout, theme] = raw.split("-");
    return { layout: layout || defaultLayout, theme: THEMES[theme] ? theme : defaultTheme };
  }

  /* Small deterministic RNG so every render of a candidate shows the same data. */
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  window.TL = { THEMES, applyTheme, readHash, rng };
})();
