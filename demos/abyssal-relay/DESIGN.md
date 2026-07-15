---
version: "1.0"
name: Abyssal Relay
description: Cinematic hadal signal observatory with a scroll-driven descent, live signal field, frequency tuner, generated media, and a narrative reveal.

colors:
  ink: "#050706"
  ink-soft: "#0b1211"
  bone: "#edf1e9"
  signal: "#58f2e4"
  copper: "#ca7b4a"
  coral: "#f04f3d"

typography:
  display:
    fontFamily: "Bodoni Moda"
    role: "Cinematic titles and narrative statements"
  mono:
    fontFamily: "IBM Plex Mono"
    role: "Body copy, controls, telemetry, and labels"

performance:
  totalInitialMediaTarget: "< 1 MB"
  scriptTarget: "< 20 KB gzip"
  runtime: "Static HTML, CSS, and JavaScript"
---

# Abyssal Relay Design System

## Visual thesis

An editorial science-fiction field report submerged inside a physically plausible hadal trench: black mineral space, cold bioluminescence, worn copper instrumentation, and one violent coral chapter break.

## Content plan

1. **Hero:** establish the expedition through a full-bleed cinematic loop and a brand-first title.
2. **Descent:** turn page scroll into depth, submersible movement, bathymetric change, and four story beats.
3. **Tuner:** give the visitor one tactile task: find 47.20 kHz and recover the transmission.
4. **Revelation:** reveal the object and the central story turn.
5. **Finale:** offer a replay and a route back to the wider demo library.

## Interaction thesis

- Scroll is depth: a sticky four-screen descent drives the metre counter, bathymetric field, light beam, chapter copy, and submersible position.
- Tuning is discovery: a real range input degrades and resolves a canvas waveform around the target frequency.
- Motion is atmospheric, not decorative: drifting particles, sonar pulses, video camera movement, and a responsive cursor all support the underwater setting.

## Media provenance

- The master hadal trench frame was generated for this page in the connected Runway workspace.
- The connected workspace reached its generation limit before image-to-video animation completed.
- `abyssal-relay-loop.mp4`, the poster, and thumbnail were therefore derived locally from the generated master, with live non-repeating motion layered in browser canvas.
- No third-party logos, characters, footage, or game IP are used.

## Accessibility and fallback

- Semantic headings, labels, outputs, focus rings, and a skip link remain available without animation.
- `prefers-reduced-motion` replaces video with the poster and collapses transition duration.
- Signal audio is opt-in and generated locally with the Web Audio API; the experience starts muted.
- The frequency tuner is a native range input and remains keyboard accessible.

## Do and do not

- Use one large narrative gesture per section.
- Keep labels short, technical, and materially tied to the expedition.
- Preserve the black / bone / cyan / copper / coral material contrast.
- Do not add cards, dashboard tiles, marketing stats, faux testimonials, or implementation commentary to the page.
- Do not turn the object or signal into fantasy magic; the visual language is science-fiction instrumentation.
