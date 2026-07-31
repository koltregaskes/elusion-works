/**
 * Ashfall — heads-up display.
 *
 * Binds to the DOM contract in index.html (see the `data-*` hooks) and drives it with
 * transforms, opacity, CSS custom properties and one small canvas. It never creates
 * top-level structure, never writes a stylesheet, and never queries the DOM inside
 * `update()` — every reference is cached in the factory.
 *
 * Design rules obeyed here:
 *  - Zero steady-state allocation. Every string that goes into `style` is quantised and
 *    pulled from a cache, so a frame where nothing changed does no work and allocates
 *    nothing at all.
 *  - Layout is never read after the one-off probe pass. Everything animates through
 *    `opacity`, the independent `translate`/`scale`/`rotate` properties (which *compose*
 *    with whatever `transform` styles.css applies, rather than fighting it) and custom
 *    properties.
 *  - Every colour comes from `world/art.js`. Nothing is hard-coded.
 *  - Every cross-module read is optional-chained; main.js substitutes inert stubs.
 *
 * ---------------------------------------------------------------------------
 * CSS CONTRACT — the custom properties and classes this module writes.
 * styles.css may consume any of these; nothing here *requires* it to, because each
 * dynamic value also has a self-sufficient fallback applied on the first visible frame.
 *
 *   on [data-hud]        --hud-primary --hud-dim --hud-accent --hud-danger
 *                        --hud-friendly --hud-blood --hud-ch-colour
 *                        --health (0..1)  --damage (0..1)  --ads (0..1)
 *                        --streak (integer)
 *                        attribute data-mode = menu|playing|paused|dead
 *                        classes is-menu / is-playing / is-paused / is-dead / is-low-health
 *   on [data-crosshair]  --ch-gap (px, half the arm gap)  --ch-spread (0..1)
 *                        --ch-flare (0..1)  --ch-tint (0..1)
 *                        classes is-ads / is-hit / is-kill / is-firing
 *   on [data-hitmarker]  --hm-scale (0..2)  classes is-hit / is-kill / is-head
 *   on [data-weapon]     classes is-low / is-empty / is-reloading
 *   on [data-health]     classes is-regen / is-critical
 *
 * Child elements this module creates inside documented containers:
 *   [data-killfeed]      li.kf-row  > span.kf-src, span.kf-mark, span.kf-tgt
 *   [data-xp]            div.xp-pop > span.xp-amt, span.xp-tag
 *   [data-damage-dirs]   div.dmg-arc
 *   [data-ammo-pips]     i.pip
 *   [data-compass-track] span.ct-tick (.is-cardinal, .is-minor)
 *                        span.ct-marker (.is-primary) > i.ct-pip + span.ct-label
 *
 * `.ct-marker.is-primary` is the nearest objective and is presentation-only. Anything the
 * stylesheet hangs off it must not change the label's *metrics*: the marker collision pass
 * measures each label once and then never reads layout again, so a rule that widens the
 * primary marker would silently invalidate that measurement. Colour, shadow and opacity are
 * safe; font-size, weight, tracking and padding are not.
 * ---------------------------------------------------------------------------
 */

import * as THREE from '../../vendor/three.module.js';
import { PALETTE, ZONES, MAP, CAMERA } from '../world/art.js';

/* ========================================================================== */
/* Small maths and colour helpers                                             */
/* ========================================================================== */

const TAU = Math.PI * 2;
const RAD2DEG = 180 / Math.PI;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);

/** Frame-rate independent approach, per ARCHITECTURE §1. Never a raw `* dt` lerp. */
const approach = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

/** Shortest signed angular difference in degrees, result in (-180, 180]. */
function wrap180(d) {
  d = d % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

/** Parse '#rrggbb' or 'rgba(r,g,b,a)' into a packed [r,g,b] triple. Init only. */
function parseColour(input) {
  const out = [232, 228, 220];
  if (typeof input !== 'string') return out;
  const s = input.trim();
  if (s.charCodeAt(0) === 35 /* # */) {
    const hex = s.length === 4
      ? s[1] + s[1] + s[2] + s[2] + s[3] + s[3]
      : s.slice(1, 7);
    const n = parseInt(hex, 16);
    if (!Number.isNaN(n)) {
      out[0] = (n >> 16) & 255;
      out[1] = (n >> 8) & 255;
      out[2] = n & 255;
    }
    return out;
  }
  const m = s.match(/-?\d*\.?\d+/g);
  if (m && m.length >= 3) {
    out[0] = clamp(parseFloat(m[0]) | 0, 0, 255);
    out[1] = clamp(parseFloat(m[1]) | 0, 0, 255);
    out[2] = clamp(parseFloat(m[2]) | 0, 0, 255);
  }
  return out;
}

/** Mix two colours in sRGB space and return a css string. Init only, never per frame. */
function mixColour(a, b, t) {
  const ca = parseColour(a);
  const cb = parseColour(b);
  const r = Math.round(lerp(ca[0], cb[0], t));
  const g = Math.round(lerp(ca[1], cb[1], t));
  const bl = Math.round(lerp(ca[2], cb[2], t));
  return `rgb(${r},${g},${bl})`;
}

function rgbaOf(colour, alpha) {
  const c = parseColour(colour);
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

/** Rec.709 relative luminance of a packed triple, 0..1 in display codes. */
function lumaOf(c) {
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
}

/**
 * Re-level a palette colour to a target display luminance, keeping its hue and its channel
 * ratios. The minimap ramp is *specified* in luminance because luminance is what the
 * quarter-second glance actually resolves; the hues still come from art.js, only the level
 * moves. Init only — never called per frame.
 */
function atLuma(colour, target) {
  const c = parseColour(colour);
  const l = lumaOf(c);
  const k = l > 0.004 ? target / l : 0;
  return `rgb(${clamp(Math.round(c[0] * k), 0, 255)},${clamp(Math.round(c[1] * k), 0, 255)},${clamp(Math.round(c[2] * k), 0, 255)})`;
}

/** Build an N-step ramp of css colour strings between two colours. Init only. */
function buildRamp(from, to, steps) {
  const arr = new Array(steps);
  for (let i = 0; i < steps; i++) arr[i] = mixColour(from, to, steps === 1 ? 0 : i / (steps - 1));
  return arr;
}

/* ========================================================================== */
/* String caches — the whole point is that a steady frame allocates nothing.  */
/* ========================================================================== */

/** '0.00' .. '1.00', indexed by hundredths. Used for every opacity and 0..1 property. */
const ALPHA_STR = new Array(101);
for (let i = 0; i <= 100; i++) ALPHA_STR[i] = (i / 100).toFixed(2);

/** '0.00' .. '3.00', indexed by hundredths. Used for scale punches. */
const SCALE_STR = new Array(301);
for (let i = 0; i <= 300; i++) SCALE_STR[i] = (i / 100).toFixed(2);

/** '<n> 1' for scaleX-only writes on bars, indexed by hundredths. */
const SCALEX_STR = new Array(101);
for (let i = 0; i <= 100; i++) SCALEX_STR[i] = `${(i / 100).toFixed(3)} 1`;

/** '0px' .. '199.5px' in half-pixel steps — the crosshair gap and small offsets. */
const HALFPX_STR = new Array(400);
function halfPx(k) {
  const i = k < 0 ? 0 : k > 399 ? 399 : k | 0;
  let s = HALFPX_STR[i];
  if (s === undefined) {
    s = `${i / 2}px`;
    HALFPX_STR[i] = s;
  }
  return s;
}

/** '-180deg' .. '180deg'. */
const DEG_STR = new Array(361);
function degStr(d) {
  let i = Math.round(d) + 180;
  if (i < 0) i = 0;
  else if (i > 360) i = 360;
  let s = DEG_STR[i];
  if (s === undefined) {
    s = `${i - 180}deg`;
    DEG_STR[i] = s;
  }
  return s;
}

/** Integers 0..1023 as strings, for ammo, health and score readouts. */
const INT_STR = new Array(1024);
function intStr(n) {
  const i = n | 0;
  if (i < 0 || i > 1023) return String(i);
  let s = INT_STR[i];
  if (s === undefined) {
    s = String(i);
    INT_STR[i] = s;
  }
  return s;
}

/**
 * 'Npx 0' translate strings, -1024..1024. The range has to cover the compass strip, whose
 * ticks sit up to three full turns of yaw away from the needle.
 */
const TX_OFFSET = 1024;
const TX_STR = new Array(TX_OFFSET * 2 + 1);
function txStr(pxValue) {
  let i = Math.round(pxValue) + TX_OFFSET;
  if (i < 0) i = 0;
  else if (i > TX_OFFSET * 2) i = TX_OFFSET * 2;
  let s = TX_STR[i];
  if (s === undefined) {
    s = `${i - TX_OFFSET}px 0`;
    TX_STR[i] = s;
  }
  return s;
}

const TY_STR = new Array(513);
function tyStr(pxValue) {
  let i = Math.round(pxValue) + 256;
  if (i < 0) i = 0;
  else if (i > 512) i = 512;
  let s = TY_STR[i];
  if (s === undefined) {
    s = `0 ${i - 256}px`;
    TY_STR[i] = s;
  }
  return s;
}

/* ========================================================================== */
/* Module-scope scratch — nothing below allocates per frame                   */
/* ========================================================================== */

/** The only per-frame vector this module needs. Allocated once, reused forever. */
const _fwd = new THREE.Vector3();

/* Tuning. Comments explain the why, per ARCHITECTURE §6. */
const HUD = {
  /** Arms never quite touch the dot, so the reticle stays readable at zero spread. */
  crosshairBaseGap: 3.4,
  /** Extra gap in px punched in per shot, decaying. Sells the rate of fire. */
  crosshairFlarePx: 7.0,
  crosshairFlareDecay: 9.0,
  crosshairMaxGap: 84,
  hitmarkerLife: 0.36,
  killmarkerLife: 0.58,
  killfeedRows: 5,
  killfeedLife: 6.0,
  killfeedFade: 0.7,
  xpPops: 8,
  xpLife: 1.5,
  xpRise: 26,
  damageArcs: 6,
  damageArcLife: 1.6,
  calloutLife: 2.2,
  compassPxPerDeg: 2.45,
  /* --- Objective markers on the compass strip -----------------------------
   * Placing a marker purely by bearing is correct and unreadable. From much of the yard, The
   * Depot and The Yard are barely 20° apart — 54 px on the strip, against labels that measure
   * 58 and 65 px — so the two ran straight through each other and the compass read
   * "THE DEPOTTHE YARD" in one weight and one colour. The numbers below are the budget the
   * collision pass is allowed to spend fixing that.
   */
  markerFontPx: 8,
  markerTrackEm: 0.14,
  /**
   * Clear space demanded between two label boxes. Measured off the delivered frames, the strip
   * renders at about 6.4 px per character, so 8 px is a hair over one character of air — the
   * least that reads as a gap rather than as a wide letter-space, and with the pip marking the
   * start of the second label that is enough to break the run.
   */
  markerGapPx: 8,
  /**
   * Hard ceiling on how far a marker may be slid off its true bearing. 11 px is 4.5° at
   * 2.45 px/deg — under the width of the needle's own tick, so the marker still points at the
   * thing it names. Past that the pass stops lying about the bearing and starts fading
   * instead, because a marker that is 20° wrong is worse than no marker.
   */
  markerMaxNudgePx: 11,
  /**
   * Residual overlap, after nudging, over which the lower-priority label fades to nothing.
   * Residual is measured against the demanded gap, so a residual of `markerGapPx` is the point
   * where the two label boxes actually touch and anything beyond it is glyphs crossing glyphs.
   * 16 px puts the junior at a third of its level by the time the boxes touch and at zero
   * before a single letter can overlap another — the pair collapses to one marker rather than
   * ever printing the run this pass exists to prevent.
   */
  markerFadeSpanPx: 16,
  /** Resting opacity of a marker that is not the nearest objective. */
  markerJuniorAlpha: 0.62,
  /**
   * Share of a nudge paid by the higher-priority marker of a pair; the junior yields the rest.
   * Does not apply to the nearest objective, which yields nothing and always sits on its true
   * bearing.
   */
  markerSeniorYield: 0.25,
  minimapHz: 20,
  minimapRange: 42, // metres from the player to the edge of the disc
  blipLife: 1.5,
  debugHz: 5,
  /** Fallback health regeneration; see `regen` below for why the HUD owns it. */
  regenDelay: 4.5,
  regenRate: 24,
};

/**
 * Approximate rendered width of an objective label, in px, without touching layout.
 *
 * The collision pass needs a width before the probe pass has run (and if the real measurement
 * ever comes back zero, e.g. the strip is display:none at that instant), so it needs a number
 * it can derive from the string alone. The tracking is added per character because
 * letter-spacing appends after every glyph, including the last, and the pip plus its margin
 * are a flat 7 px.
 *
 * 0.58em is the deliberately *pessimistic* advance: a genuinely condensed face runs about
 * 0.45em for upper-case Latin, but ARCHITECTURE's webfont exception means the strip may well
 * be set in whatever generic sans the platform has, and the delivered frames measure 0.62em
 * for exactly that reason. Overestimating costs a few px of extra separation; underestimating
 * lets two labels touch, which is the defect this whole pass exists to remove.
 *
 * `measureZoneMarkers` replaces it with the truth as soon as the HUD is on screen.
 */
function estimateMarkerWidth(text) {
  const n = typeof text === 'string' ? text.length : 0;
  return n * HUD.markerFontPx * (0.58 + HUD.markerTrackEm) + 7;
}

/* ========================================================================== */
/* Factory                                                                    */
/* ========================================================================== */

export function createHUD(game) {
  const doc = document;
  const q = (sel, root) => {
    try {
      return (root || doc).querySelector(sel) || null;
    } catch {
      return null;
    }
  };

  /* --- Element cache ---------------------------------------------------- */

  const el = {
    hud: q('[data-hud]'),
    vignette: q('[data-damage-vignette]'),
    lowHealth: q('[data-lowhealth]'),
    flash: q('[data-flash]'),
    dirs: q('[data-damage-dirs]'),

    crosshair: q('[data-crosshair]'),
    hitmarker: q('[data-hitmarker]'),
    interact: q('[data-interact]'),

    compass: q('[data-compass]'),
    compassTrack: q('[data-compass-track]'),

    health: q('[data-health]'),
    healthFill: q('[data-health-fill]'),
    healthValue: q('[data-health-value]'),
    stance: q('[data-stance]'),

    weapon: q('[data-weapon]'),
    weaponName: q('[data-weapon-name]'),
    ammoMag: q('[data-ammo-mag]'),
    ammoReserve: q('[data-ammo-reserve]'),
    ammoPips: q('[data-ammo-pips]'),
    reloadPrompt: q('[data-reload-prompt]'),
    reloadBar: q('[data-reload-bar]'),

    minimap: q('[data-minimap]'),
    minimapCanvas: q('[data-minimap-canvas]'),
    zone: q('[data-zone]'),

    score: q('[data-score]'),
    kills: q('[data-kills]'),
    streak: q('[data-streak]'),

    killfeed: q('[data-killfeed]'),
    callout: q('[data-callout]'),
    xp: q('[data-xp]'),
    debug: q('[data-debug]'),
  };

  const chArms = el.crosshair
    ? [q('.ch-t', el.crosshair), q('.ch-r', el.crosshair), q('.ch-b', el.crosshair), q('.ch-l', el.crosshair)]
    : [null, null, null, null];
  const chDot = el.crosshair ? q('.ch-dot', el.crosshair) : null;
  const hmSpans = el.hitmarker ? Array.prototype.slice.call(el.hitmarker.children, 0, 4) : [];
  const reloadFill = el.reloadBar ? el.reloadBar.querySelector('i') : null;

  /* --- Palette ---------------------------------------------------------- */

  const settings = readSettings();
  let crosshairColour = typeof settings.crosshairColour === 'string' ? settings.crosshairColour : PALETTE.hudPrimary;

  const COL = {
    primary: PALETTE.hudPrimary,
    dim: PALETTE.hudDim,
    accent: PALETTE.hudAccent,
    danger: PALETTE.hudDanger,
    friendly: PALETTE.hudFriendly,
    blood: PALETTE.blood,
    shadow: PALETTE.moonlessShadow,
    concreteLit: PALETTE.concreteLit,
    concreteShadow: PALETTE.concreteShadow,
    gravel: PALETTE.gravel,
    muzzle: PALETTE.muzzleCore,
  };

  /* ---------------------------------------------------------------------- *
   * Minimap palette.
   *
   * The previous disc failed the glance test: ground, structure and edges all landed inside
   * a ~50-code luminance band, so the whole map read as one mid-grey field of noise with no
   * shape in it. A minimap has to resolve in the quarter-second a player gives it, which
   * means separation in *luminance*, not in hue.
   *
   * So the ramp is authored as three luminance steps with real distance between them —
   * ground 12%, building mass 35%, wall lip 50%. That is a 2.9x step and then a 1.4x step,
   * spanning ~100 codes instead of 35. The hues are still art.js's (cool shadow for the
   * ground, shadowed concrete for the mass, lit concrete for the lip); `atLuma` only rebases
   * the level.
   *
   * Everything static is therefore capped at 50%, which deliberately leaves the top of the
   * range empty for the two things that must win the glance: the player arrow (near display
   * white, ~90%) and the enemy blips (fully saturated danger red with a hot core at ~75%).
   * Those two are also the only saturated marks on the disc — the field sits under 0.1
   * saturation, the blips at 0.66 — so they separate by hue as well as by level.
   *
   * All of these are built once. `drawMinimap` never calls a colour helper.
   * ---------------------------------------------------------------------- */

  const MAP_COL = {
    /* Outside the baked footprint. Below the ground step, so off-map reads as void. */
    voidFill: atLuma(COL.shadow, 0.055),
    ground: atLuma(COL.shadow, 0.12),
    building: atLuma(COL.concreteShadow, 0.35),
    wall: atLuma(COL.concreteLit, 0.5),
    /* Half-range ring. Thin and dim: it must not lift the field it sits on. */
    ring: rgbaOf(COL.primary, 0.15),
    /* View cone. Tinted friendly rather than neutral, and much weaker than the old 0.26
       primary wash, which alone lifted half the disc by ~40 codes and ate the ramp. */
    coneIn: rgbaOf(COL.friendly, 0.19),
    coneOut: rgbaOf(COL.friendly, 0.0),
    arrowFill: COL.primary,
    arrowKey: rgbaOf(COL.shadow, 0.95),
    /* Saturated rim on the arrow. The white core owns the top of the luminance range but is
       nearly achromatic, so the rim is what makes the arrow the most saturated mark too. */
    arrowRim: COL.friendly,
    arrowGlowIn: rgbaOf(COL.friendly, 0.42),
    arrowGlowOut: rgbaOf(COL.friendly, 0.0),
    blipStroke: rgbaOf(COL.shadow, 0.95),
    north: rgbaOf(COL.accent, 0.95),
  };

  /* Blip body: danger, driven up to the top of what a saturated red can reach, so it stays
     the most saturated mark on the disc rather than being desaturated into legibility. */
  const BLIP_BODY = atLuma(COL.danger, 0.62);
  /* Hot core, so the blip's peak clears the wall step by a wide margin. */
  const BLIP_CORE = mixColour(BLIP_BODY, COL.muzzle, 0.55);

  /* Health bar ramp: primary at full, accent through the middle, danger when critical.
     17 steps is finer than the eye can follow at 60 fps and costs nothing at runtime. */
  const HEALTH_RAMP = new Array(17);
  for (let i = 0; i < 17; i++) {
    const t = i / 16;
    HEALTH_RAMP[i] = t > 0.5
      ? mixColour(COL.accent, COL.primary, (t - 0.5) * 2)
      : mixColour(COL.danger, COL.accent, t * 2);
  }
  const REGEN_COLOUR = mixColour(COL.friendly, COL.primary, 0.45);

  /* Crosshair tint ramps, rebuilt whenever the player changes the crosshair colour. */
  let CH_HIT_RAMP = buildRamp(crosshairColour, COL.accent, 9);
  let CH_KILL_RAMP = buildRamp(crosshairColour, COL.danger, 9);

  /* Blips fade out over their life, but never below 0.55 alpha while they are alive — a blip
     that has faded into the field is worse than no blip at all. */
  const BLIP_RAMP = new Array(13);
  const BLIP_CORE_RAMP = new Array(13);
  for (let i = 0; i < 13; i++) {
    const a = (0.55 + 0.45 * (i / 12)).toFixed(3);
    BLIP_RAMP[i] = rgbaOf(BLIP_BODY, a);
    BLIP_CORE_RAMP[i] = rgbaOf(BLIP_CORE, a);
  }
  const ARC_COLOUR = rgbaOf(COL.danger, 0.9);

  /* --- State ------------------------------------------------------------ */

  let mode = 'menu';
  let shown = true;
  let disposed = false;
  let probed = false;
  let viewH = window.innerHeight || 1080;
  let viewW = window.innerWidth || 1920;

  const s = {
    // crosshair
    flare: 0,
    tint: 0,
    tintKind: 0, // 0 hit, 1 kill
    firing: 0,
    // hitmarker
    hmT: 0,
    hmKind: 0, // 0 none, 1 hit, 2 kill
    hmHead: false,
    // damage
    dmgFlash: 0,
    regenT: 0,
    lastHealth: game?.state?.health ?? 100,
    regenPulse: 0,
    heartbeat: 0,
    // reload
    reloadActive: false,
    reloadT: 0,
    reloadDur: 2.1,
    reloadPhase: 0, // 0 start, 1 magout, 2 magin, 3 end
    reloadHold: 0,
    // callout
    calloutT: 0,
    // timers
    mapAccum: 999,
    debugAccum: 999,
    slowAccum: 999,
    fpsSmooth: 60,
    dtSmooth: 16.7,
  };

  /* Cached last-written values. A frame that changes nothing writes nothing. */
  const w = {
    chGap: -1,
    chSpread: -1,
    chFlare: -1,
    chTint: -1,
    chColour: '',
    chAlpha: -1,
    chAds: false,
    chHit: false,
    chKill: false,
    chFiring: false,
    hmAlpha: -1,
    hmScale: -1,
    hmClass: -1,
    hmHead: false,
    healthScale: -1,
    healthColour: '',
    healthValue: -1,
    healthVar: -1,
    vignette: -1,
    lowHealth: -1,
    flash: -1,
    stance: '',
    weaponName: '',
    ammoMag: -1,
    ammoReserve: -1,
    pipCount: -1,
    pipFilled: -1,
    pipColour: '',
    lowAmmo: false,
    emptyAmmo: false,
    reloadingCls: false,
    reloadShown: false,
    reloadFill: -1,
    promptShown: false,
    promptAlpha: -1,
    score: -1,
    kills: -1,
    streakVal: -1,
    streakShown: false,
    zone: '',
    compass: -1,
    damageVar: -1,
    adsVar: -1,
    reloadColour: '',
    hudAlpha: -1,
    modeAttr: '',
    lowHealthCls: false,
    regenCls: false,
    criticalCls: false,
    calloutAlpha: -1,
    calloutScale: -1,
  };

  /* --- Static custom properties ----------------------------------------- */

  if (el.hud) {
    const st = el.hud.style;
    st.setProperty('--hud-primary', COL.primary);
    st.setProperty('--hud-dim', COL.dim);
    st.setProperty('--hud-accent', COL.accent);
    st.setProperty('--hud-danger', COL.danger);
    st.setProperty('--hud-friendly', COL.friendly);
    st.setProperty('--hud-blood', COL.blood);
    st.setProperty('--hud-ch-colour', crosshairColour);
  }

  /* ====================================================================== */
  /* Built children                                                         */
  /* ====================================================================== */

  /* --- Ammo pips -------------------------------------------------------- */

  const MAX_PIPS = 40;
  const pips = [];
  if (el.ammoPips) {
    for (let i = 0; i < MAX_PIPS; i++) {
      const pip = doc.createElement('i');
      pip.className = 'pip';
      const ps = pip.style;
      ps.display = 'none';
      ps.width = '3px';
      ps.height = '9px';
      ps.borderRadius = '1px';
      ps.marginRight = '2px';
      ps.background = COL.primary;
      ps.opacity = ALPHA_STR[16];
      el.ammoPips.appendChild(pip);
      pips.push(pip);
    }
    // Flex would be styles.css's call; inline-block flows correctly with or without it.
    el.ammoPips.style.lineHeight = '0';
  }

  /* --- Kill feed rows --------------------------------------------------- */

  const kfRows = [];
  if (el.killfeed) {
    for (let i = 0; i < HUD.killfeedRows; i++) {
      const li = doc.createElement('li');
      li.className = 'kf-row';
      const src = doc.createElement('span');
      src.className = 'kf-src';
      const mark = doc.createElement('span');
      mark.className = 'kf-mark';
      const tgt = doc.createElement('span');
      tgt.className = 'kf-tgt';
      src.style.color = COL.friendly;
      mark.style.color = COL.accent;
      mark.style.padding = '0 0.45em';
      tgt.style.color = COL.danger;
      li.appendChild(src);
      li.appendChild(mark);
      li.appendChild(tgt);
      li.style.display = 'none';
      li.style.opacity = ALPHA_STR[0];
      li.style.listStyle = 'none';
      li.style.whiteSpace = 'nowrap';
      el.killfeed.appendChild(li);
      kfRows.push({ node: li, src, mark, tgt, t: -1, alpha: -1, tx: -999 });
    }
    el.killfeed.style.listStyle = 'none';
  }

  /* --- XP pops ---------------------------------------------------------- */

  const xpPops = [];
  if (el.xp) {
    for (let i = 0; i < HUD.xpPops; i++) {
      const div = doc.createElement('div');
      div.className = 'xp-pop';
      const amt = doc.createElement('span');
      amt.className = 'xp-amt';
      amt.style.color = COL.accent;
      amt.style.fontWeight = '700';
      const tag = doc.createElement('span');
      tag.className = 'xp-tag';
      tag.style.color = COL.dim;
      tag.style.paddingLeft = '0.5em';
      div.appendChild(amt);
      div.appendChild(tag);
      div.style.display = 'none';
      div.style.opacity = ALPHA_STR[0];
      div.style.whiteSpace = 'nowrap';
      el.xp.appendChild(div);
      xpPops.push({ node: div, amt, tag, t: -1, alpha: -1, ty: -999 });
    }
  }

  /* --- Directional damage arcs ------------------------------------------ */

  const arcs = [];
  if (el.dirs) {
    // The container must be a full-screen positioning context for the arcs to orbit the
    // crosshair. If styles.css has not made it one, do it here — geometry only.
    const dirPos = safeComputed(el.dirs, 'position');
    if (!dirPos || dirPos === 'static') {
      el.dirs.style.position = 'fixed';
      el.dirs.style.inset = '0';
      el.dirs.style.pointerEvents = 'none';
    }
    for (let i = 0; i < HUD.damageArcs; i++) {
      const a = doc.createElement('div');
      a.className = 'dmg-arc';
      const as = a.style;
      as.position = 'absolute';
      as.left = '50%';
      as.top = '50%';
      as.width = '0';
      as.height = '0';
      as.display = 'none';
      as.pointerEvents = 'none';
      // The visible wedge: a thick arc segment sitting 84 px out from the centre. Built from
      // a border so it needs no images and no CSS from the sibling agent.
      const blade = doc.createElement('span');
      const bs = blade.style;
      bs.position = 'absolute';
      bs.left = '-52px';
      bs.top = '-96px';
      bs.width = '104px';
      bs.height = '20px';
      bs.borderRadius = '52px 52px 0 0';
      bs.borderTop = `4px solid ${ARC_COLOUR}`;
      bs.borderLeft = '4px solid transparent';
      bs.borderRight = '4px solid transparent';
      bs.filter = 'drop-shadow(0 0 5px rgba(0,0,0,0.65))';
      a.appendChild(blade);
      el.dirs.appendChild(a);
      arcs.push({ node: a, x: 0, z: 1, t: -1, amount: 0, alpha: -1, rot: -999 });
    }
  }

  /* --- Compass ticks ---------------------------------------------------- */

  const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const zoneMarkers = [];
  if (el.compassTrack) {
    const trackPos = safeComputed(el.compassTrack, 'position');
    if (!trackPos || trackPos === 'static') el.compassTrack.style.position = 'relative';
    el.compassTrack.style.willChange = 'transform';

    // Three replicas (-360, 0, +360) so the strip is continuous through any yaw without
    // ever repositioning a tick. Built once, exactly as the brief requires.
    for (let rep = -1; rep <= 1; rep++) {
      for (let i = 0; i < 8; i++) {
        const headingDeg = i * 45;
        const xDeg = headingDeg + rep * 360;
        const tick = doc.createElement('span');
        const cardinal = i % 2 === 0;
        tick.className = cardinal ? 'ct-tick is-cardinal' : 'ct-tick is-minor';
        tick.textContent = CARDINALS[i];
        const ts = tick.style;
        ts.position = 'absolute';
        ts.left = '50%';
        ts.top = '50%';
        ts.transform = 'translate(-50%,-50%)';
        // Built once, so a direct string is fine here; the caches exist for per-frame writes.
        ts.translate = `${(xDeg * HUD.compassPxPerDeg).toFixed(1)}px 0`;
        ts.color = cardinal ? COL.primary : COL.dim;
        ts.fontSize = cardinal ? '12px' : '10px';
        ts.letterSpacing = '0.08em';
        ts.opacity = cardinal ? ALPHA_STR[100] : ALPHA_STR[62];
        ts.pointerEvents = 'none';
        el.compassTrack.appendChild(tick);
      }
    }

    // Objective markers: one per named zone, bearing recomputed at 10 Hz and then put through
    // the collision pass in `updateZoneMarkers`, which is what stops two zones on close
    // bearings fusing into a single unreadable run of type.
    const zoneKeys = Object.keys(ZONES || {});
    for (let i = 0; i < zoneKeys.length; i++) {
      const z = ZONES[zoneKeys[i]];
      if (!z || !z.centre) continue;
      const m = doc.createElement('span');
      m.className = 'ct-marker';
      const ms = m.style;
      ms.position = 'absolute';
      ms.left = '50%';
      ms.top = '50%';
      ms.transform = 'translate(-50%,-50%)';
      ms.marginTop = '13px';
      ms.color = COL.accent;
      ms.fontSize = `${HUD.markerFontPx}px`;
      ms.letterSpacing = `${HUD.markerTrackEm}em`;
      ms.opacity = ALPHA_STR[70];
      ms.pointerEvents = 'none';
      ms.whiteSpace = 'nowrap';

      // Every label opens with a pip. Separation is the collision pass's job, but the pass
      // can only buy a few pixels before it starts lying about the bearing, and at 7 px of
      // gap two runs of tracked upper-case still want to read as one word. A mark that is
      // *not a letter* in front of each label is what makes the boundary unambiguous.
      // It is a box rather than a bullet glyph on purpose: ARCHITECTURE's one webfont
      // exception means the HUD has to survive the condensed fallback stack, and none of
      // those faces can be promised to carry U+2022. A rotated square needs no font at all,
      // and it echoes the minimap's blip so the two readouts share a language.
      const pip = doc.createElement('i');
      pip.className = 'ct-pip';
      const ps2 = pip.style;
      ps2.display = 'inline-block';
      ps2.width = '3px';
      ps2.height = '3px';
      ps2.marginRight = '4px';
      ps2.verticalAlign = 'middle';
      ps2.background = COL.accent;
      ps2.rotate = '45deg';
      ps2.boxShadow = '0 0 3px rgba(0,0,0,0.9)';

      const label = doc.createElement('span');
      label.className = 'ct-label';
      label.textContent = String(z.label || zoneKeys[i]).toUpperCase();

      m.appendChild(pip);
      m.appendChild(label);
      el.compassTrack.appendChild(m);
      zoneMarkers.push({
        node: m,
        pip,
        cx: z.centre[0],
        cz: z.centre[2],
        tx: -999,
        /** Measured once by `measureZoneMarkers`; estimated until then. */
        w: estimateMarkerWidth(label.textContent),
        alpha: -1,
        colour: '',
        primary: null,
      });
    }
  }

  /* Collision-pass scratch. Sized to the marker count at build and never reallocated, so the
     10 Hz pass below allocates nothing. `markX` is in px from the needle, not track space. */
  const markCount = zoneMarkers.length;
  const markX = new Float64Array(markCount || 1);
  const markTrue = new Float64Array(markCount || 1);
  const markD2 = new Float64Array(markCount || 1);
  const markRank = new Int32Array(markCount || 1);
  const markFade = new Float64Array(markCount || 1);
  const markOrder = new Int32Array(markCount || 1);

  /**
   * Read each marker's rendered width. This is a layout read, so it is only ever called from
   * the probe pass and from the font-loading callback below — never from `update`. The labels
   * are static text, so one measurement holds for the life of the session; the only thing that
   * can move it is a webfont arriving late and changing the metrics out from under the
   * condensed fallback, which is exactly what `document.fonts.ready` tells us about.
   */
  function measureZoneMarkers() {
    for (let i = 0; i < zoneMarkers.length; i++) {
      const m = zoneMarkers[i];
      let px = 0;
      try {
        px = m.node.offsetWidth || 0;
      } catch {
        px = 0;
      }
      // A zero here means the strip is not laid out yet; keep the estimate rather than
      // collapsing every marker to width 0 and disabling the collision pass entirely.
      if (px > 4) m.w = px;
    }
  }

  try {
    if (doc.fonts && doc.fonts.ready && typeof doc.fonts.ready.then === 'function') {
      doc.fonts.ready
        .then(() => {
          if (!disposed && probed) measureZoneMarkers();
        })
        .catch(() => {});
    }
  } catch {
    /* No CSS Font Loading API: the probe measurement stands. */
  }

  /* ====================================================================== */
  /* Minimap                                                                */
  /* ====================================================================== */

  const map = {
    ctx: null,
    w: 360,
    h: 360,
    base: null, // baked navGrid
    baseW: 0,
    baseH: 0,
    pxPerCell: 4,
    cell: 1,
    ox: 0, // world origin x of the bake
    oz: 0,
    ready: false,
    /* Built on the first draw from the canvas geometry, which never changes, and reused. */
    coneGrad: null,
    arrowGrad: null,
  };

  if (el.minimapCanvas && el.minimapCanvas.getContext) {
    try {
      map.ctx = el.minimapCanvas.getContext('2d', { alpha: true });
      map.w = el.minimapCanvas.width || 360;
      map.h = el.minimapCanvas.height || 360;
      if (map.ctx) map.ctx.imageSmoothingEnabled = true;
    } catch {
      map.ctx = null;
    }
  }

  bakeMinimap();

  /**
   * Bake the static navigation grid once into an offscreen canvas. Per frame we only blit a
   * sub-rectangle of it, which keeps the minimap at a handful of canvas ops rather than tens
   * of thousands of fillRects.
   */
  function bakeMinimap() {
    if (!map.ctx) return;
    const grid = game?.level?.navGrid || null;
    try {
      if (grid && grid.walkable && grid.w > 1 && grid.h > 1) {
        const gw = grid.w | 0;
        const gh = grid.h | 0;
        map.cell = grid.cell || 1;
        const o = grid.origin;
        map.ox = o ? (o.x !== undefined ? o.x : (Array.isArray(o) ? o[0] : 0)) : 0;
        map.oz = o ? (o.z !== undefined ? o.z : (Array.isArray(o) ? o[2] : 0)) : 0;
        // Keep the bake under ~1000 px on its long edge; 2..6 px per cell reads cleanly.
        map.pxPerCell = clamp(Math.floor(1000 / Math.max(gw, gh)), 2, 6);

        const bake = doc.createElement('canvas');
        bake.width = map.baseW = gw * map.pxPerCell;
        bake.height = map.baseH = gh * map.pxPerCell;
        const bc = bake.getContext('2d');
        if (!bc) return;

        const p = map.pxPerCell;
        const walk = grid.walkable;

        // Every pass below is opaque. The old bake stacked three translucent fills over a
        // 0.72 plate, which is exactly how ground, floor and edge all ended up inside one
        // 50-code band — each layer was diluted by whatever it sat on. Opaque fills mean the
        // three steps land where they were authored.

        // 1. Ground — the darkest step, and the bulk of an open yard.
        bc.fillStyle = MAP_COL.ground;
        bc.fillRect(0, 0, bake.width, bake.height);

        // 2. Building mass — every blocked cell. Run-length per row, so a 110x90 grid costs a
        //    few hundred fills rather than ten thousand.
        bc.fillStyle = MAP_COL.building;
        for (let y = 0; y < gh; y++) {
          const row = y * gw;
          let runStart = -1;
          for (let x = 0; x <= gw; x++) {
            const solid = x < gw && !walk[row + x];
            if (solid && runStart < 0) runStart = x;
            else if (!solid && runStart >= 0) {
              bc.fillRect(runStart * p, y * p, (x - runStart) * p, p);
              runStart = -1;
            }
          }
        }

        // 3. Wall lip — a blocked cell with at least one open neighbour, i.e. the face a
        //    player can actually walk up to. This is what turns a mass into a silhouette:
        //    big blocks keep a mid-grey interior and get a bright rim, while thin walls and
        //    container rows light up along their whole length.
        bc.fillStyle = MAP_COL.wall;
        for (let y = 0; y < gh; y++) {
          const row = y * gw;
          for (let x = 0; x < gw; x++) {
            if (walk[row + x]) continue;
            const l = x > 0 ? walk[row + x - 1] : 0;
            const r = x < gw - 1 ? walk[row + x + 1] : 0;
            const u = y > 0 ? walk[row - gw + x] : 0;
            const d = y < gh - 1 ? walk[row + gw + x] : 0;
            if (!(l || r || u || d)) continue;
            bc.fillRect(x * p, y * p, p, p);
          }
        }

        map.base = bake;
        map.ready = true;
      } else {
        // No grid (level stub, or the level module failed): fall back to the map footprint
        // from art.js so the minimap still frames the space instead of going blank.
        const mw = MAP.width;
        const md = MAP.depth;
        map.cell = 1;
        map.pxPerCell = 6;
        map.ox = -mw * 0.5;
        map.oz = -md * 0.5;
        const bake = doc.createElement('canvas');
        bake.width = map.baseW = Math.ceil(mw * map.pxPerCell);
        bake.height = map.baseH = Math.ceil(md * map.pxPerCell);
        const bc = bake.getContext('2d');
        if (!bc) return;
        // Same three-step ramp as the real bake: ground field, and the map boundary drawn at
        // the wall step so the footprint still reads as an enclosed space.
        bc.fillStyle = MAP_COL.ground;
        bc.fillRect(0, 0, bake.width, bake.height);
        bc.strokeStyle = MAP_COL.wall;
        bc.lineWidth = 3;
        bc.strokeRect(1.5, 1.5, bake.width - 3, bake.height - 3);
        map.base = bake;
        map.ready = true;
      }
    } catch {
      map.ready = false;
    }
  }

  /** Enemy blip bookkeeping — a blip lights for 1.5 s after that soldier fires. */
  const MAX_BLIPS = 64;
  const blipT = new Float32Array(MAX_BLIPS);
  const prevFireTimer = new Float32Array(MAX_BLIPS);
  for (let i = 0; i < MAX_BLIPS; i++) prevFireTimer[i] = -1;

  /* ====================================================================== */
  /* Events                                                                 */
  /* ====================================================================== */

  const unsubs = [];
  function on(name, fn) {
    const off = game?.events?.on?.(name, fn);
    if (typeof off === 'function') unsubs.push(off);
    else unsubs.push(() => game?.events?.off?.(name, fn));
  }

  function onShot() {
    s.flare = 1;
    s.firing = 0.12;
  }

  function onHit(p) {
    // Payloads are ring-buffered by ballistics: read scalars, never retain the object.
    const head = !!(p && p.headshot);
    s.hmT = HUD.hitmarkerLife;
    s.hmKind = 1;
    s.hmHead = head;
    s.tint = 1;
    s.tintKind = 0;
  }

  function onKill(p) {
    const head = !!(p && p.headshot);
    s.hmT = HUD.killmarkerLife;
    s.hmKind = 2;
    s.hmHead = head;
    s.tint = 1;
    s.tintKind = 1;

    const enemy = p && p.enemy ? p.enemy : null;
    pushKillRow(enemyName(enemy), head, weaponLabel(p && p.weapon));
    pushXP(head ? 150 : 100, head ? 'HEADSHOT' : 'ELIMINATED');

    const streak = game?.state?.streak || 0;
    if (streak >= 2) {
      const label = STREAK_CALLOUTS[streak];
      if (label) pushCallout(label, 'good');
      else if (streak % 5 === 0) pushCallout(`STREAK ${streak}`, 'good');
    }
  }

  function onDamage(p) {
    const amount = p && typeof p.amount === 'number' ? p.amount : 12;
    s.dmgFlash = Math.min(1, s.dmgFlash + clamp(amount / 45, 0.18, 0.8));
    s.regenT = 0;
    const dir = p && p.dir ? p.dir : game?.state?.lastDamageDir;
    pushArc(dir, amount);
  }

  function onReload(p) {
    const phase = p && p.phase;
    if (phase === 'start') {
      s.reloadActive = true;
      s.reloadT = 0;
      s.reloadPhase = 0;
      // Durations mirror the keyframe clips in player/weapon.js (2.10 s tactical, 2.72 s
      // empty) scaled per weapon, so the bar tracks the animation without reaching into it.
      const scale = (p && p.weapon && p.weapon.reloadScale) || 1;
      s.reloadDur = (p && p.empty ? 2.72 : 2.1) * scale;
      s.reloadHold = 0;
    } else if (phase === 'magout') {
      s.reloadPhase = 1;
    } else if (phase === 'magin') {
      s.reloadPhase = 2;
    } else if (phase === 'end') {
      s.reloadPhase = 3;
      s.reloadHold = 0.18;
    }
  }

  function onExplosion() {
    s.dmgFlash = Math.min(1, s.dmgFlash + 0.35);
  }

  on('shot', onShot);
  on('hit', onHit);
  on('kill', onKill);
  on('damage', onDamage);
  on('reload', onReload);
  on('explosion', onExplosion);

  /* F3 debug toggle. Own listener rather than polling input edges, because main.js clears
     edge state at the top of the frame and the HUD updates at the bottom of it. */
  let debugOpen = !!game?.debug;
  const onKeyDown = (ev) => {
    if (ev.code !== 'F3' || ev.repeat) return;
    ev.preventDefault();
    debugOpen = !debugOpen;
    if (el.debug) el.debug.hidden = !debugOpen;
    s.debugAccum = 999;
  };
  window.addEventListener('keydown', onKeyDown);

  const onResize = () => {
    viewH = window.innerHeight || viewH;
    viewW = window.innerWidth || viewW;
  };
  window.addEventListener('resize', onResize, { passive: true });

  if (el.debug) el.debug.hidden = !debugOpen;

  /* ====================================================================== */
  /* Kill feed / XP / callouts / arcs                                       */
  /* ====================================================================== */

  const STREAK_CALLOUTS = {
    2: 'DOUBLE',
    3: 'TRIPLE THREAT',
    5: 'ON A ROLL',
    7: 'DOMINATING',
    10: 'UNSTOPPABLE',
  };

  function enemyName(enemy) {
    if (!enemy) return 'HOSTILE';
    if (typeof enemy.callsign === 'string') return enemy.callsign;
    const idx = typeof enemy.index === 'number' ? enemy.index + 1 : 0;
    const kind = enemy.archetype && enemy.archetype.id ? String(enemy.archetype.id).toUpperCase() : 'HOSTILE';
    return idx > 0 ? `${kind} ${idx < 10 ? '0' : ''}${idx}` : kind;
  }

  function weaponLabel(def) {
    if (def && typeof def.name === 'string') return def.name;
    const cur = game?.weapon?.current;
    return cur && cur.name ? cur.name : 'KIA';
  }

  function pushKillRow(target, headshot, weaponName) {
    if (!kfRows.length || !el.killfeed) return;
    let row = null;
    for (let i = 0; i < kfRows.length; i++) {
      if (kfRows[i].t < 0) {
        row = kfRows[i];
        break;
      }
    }
    if (!row) {
      // At the cap: recycle the oldest.
      let oldest = kfRows[0];
      for (let i = 1; i < kfRows.length; i++) if (kfRows[i].t > oldest.t) oldest = kfRows[i];
      row = oldest;
    }
    row.t = 0;
    row.alpha = -1;
    row.tx = -999;
    row.src.textContent = 'YOU';
    row.mark.textContent = headshot ? `${weaponName} ⌃` : weaponName;
    row.mark.style.color = headshot ? COL.accent : COL.dim;
    row.tgt.textContent = target;
    row.node.style.display = '';
    // Newest at the bottom of the list; a five-element move, only on a kill.
    el.killfeed.appendChild(row.node);
  }

  function pushXP(amount, tag) {
    if (!xpPops.length) return;
    let pop = null;
    for (let i = 0; i < xpPops.length; i++) {
      if (xpPops[i].t < 0) {
        pop = xpPops[i];
        break;
      }
    }
    if (!pop) {
      let oldest = xpPops[0];
      for (let i = 1; i < xpPops.length; i++) if (xpPops[i].t > oldest.t) oldest = xpPops[i];
      pop = oldest;
    }
    pop.t = 0;
    pop.alpha = -1;
    pop.ty = -999;
    pop.amt.textContent = `+${intStr(amount)}`;
    pop.tag.textContent = tag;
    pop.node.style.display = '';
    if (el.xp) el.xp.appendChild(pop.node);
  }

  function pushCallout(text, kind) {
    if (!el.callout) return;
    el.callout.textContent = text;
    el.callout.className = `callout is-${kind || 'info'}`;
    el.callout.style.color =
      kind === 'danger' ? COL.danger : kind === 'good' ? COL.accent : COL.primary;
    s.calloutT = HUD.calloutLife;
    w.calloutAlpha = -1;
  }

  function pushArc(dir, amount) {
    if (!arcs.length) return;
    let arc = null;
    for (let i = 0; i < arcs.length; i++) {
      if (arcs[i].t < 0) {
        arc = arcs[i];
        break;
      }
    }
    if (!arc) {
      let oldest = arcs[0];
      for (let i = 1; i < arcs.length; i++) if (arcs[i].t > oldest.t) oldest = arcs[i];
      arc = oldest;
    }
    // Store the world-space bearing the round came *from*, so the arc stays anchored to the
    // shooter while the player turns to face it.
    let dx = 0;
    let dz = 1;
    if (dir && typeof dir.x === 'number') {
      dx = -dir.x;
      dz = -dir.z;
    }
    const len = Math.hypot(dx, dz);
    if (len > 1e-5) {
      dx /= len;
      dz /= len;
    } else {
      dx = 0;
      dz = 1;
    }
    arc.x = dx;
    arc.z = dz;
    arc.t = 0;
    arc.amount = clamp(amount / 40, 0.35, 1);
    arc.alpha = -1;
    arc.rot = -999;
    arc.node.style.display = '';
  }

  /* ====================================================================== */
  /* One-off probe and fallbacks                                            */
  /* ====================================================================== */

  function safeComputed(node, prop) {
    if (!node) return '';
    try {
      return window.getComputedStyle(node)[prop] || '';
    } catch {
      return '';
    }
  }

  /** True when styles.css already reacts to `--ch-gap`, in which case we stay out of its way. */
  let cssDrivesArms = false;

  /**
   * Run once, on the first frame the HUD is actually visible. Reads layout exactly here and
   * nowhere else. Anything the stylesheet left unstyled gets a self-sufficient fallback so
   * the HUD is never invisible, whatever the sibling agent shipped.
   */
  function probe() {
    probed = true;
    const arm = chArms[0];

    // Does the stylesheet position the arms from --ch-gap already?
    if (el.crosshair && arm) {
      try {
        el.crosshair.style.setProperty('--ch-gap', '0px');
        const a = `${safeComputed(arm, 'transform')}|${safeComputed(arm, 'translate')}|${safeComputed(arm, 'top')}|${safeComputed(arm, 'left')}|${safeComputed(arm, 'marginTop')}`;
        el.crosshair.style.setProperty('--ch-gap', '40px');
        const b = `${safeComputed(arm, 'transform')}|${safeComputed(arm, 'translate')}|${safeComputed(arm, 'top')}|${safeComputed(arm, 'left')}|${safeComputed(arm, 'marginTop')}`;
        cssDrivesArms = a !== b;
      } catch {
        cssDrivesArms = false;
      }
    }

    // Crosshair geometry fallback.
    if (el.crosshair && arm && arm.offsetWidth === 0 && arm.offsetHeight === 0) {
      const cpos = safeComputed(el.crosshair, 'position');
      if (!cpos || cpos === 'static') el.crosshair.style.position = 'relative';
      for (let i = 0; i < 4; i++) {
        const a = chArms[i];
        if (!a) continue;
        const st = a.style;
        st.position = 'absolute';
        st.left = '50%';
        st.top = '50%';
        st.transform = 'translate(-50%,-50%)';
        st.borderRadius = '1px';
        const vertical = i === 0 || i === 2;
        st.width = vertical ? '2px' : '9px';
        st.height = vertical ? '9px' : '2px';
        st.background = crosshairColour;
        st.boxShadow = '0 0 3px rgba(0,0,0,0.85)';
      }
      if (chDot) {
        const ds = chDot.style;
        ds.position = 'absolute';
        ds.left = '50%';
        ds.top = '50%';
        ds.width = '2px';
        ds.height = '2px';
        ds.marginLeft = '-1px';
        ds.marginTop = '-1px';
        ds.borderRadius = '50%';
        ds.background = crosshairColour;
        ds.boxShadow = '0 0 3px rgba(0,0,0,0.85)';
      }
    }

    // Arm offsets are driven entirely by --ch-gap through the independent `translate`
    // property, which composes with any `transform` the stylesheet applies.
    if (!cssDrivesArms) {
      if (chArms[0]) chArms[0].style.translate = '0 calc(var(--ch-gap, 4px) * -1)';
      if (chArms[1]) chArms[1].style.translate = 'var(--ch-gap, 4px) 0';
      if (chArms[2]) chArms[2].style.translate = '0 var(--ch-gap, 4px)';
      if (chArms[3]) chArms[3].style.translate = 'calc(var(--ch-gap, 4px) * -1) 0';
    }

    // Hitmarker geometry fallback: four ticks at the diagonals form the classic marker, and
    // hiding the lower pair turns it into a headshot chevron.
    if (el.hitmarker && hmSpans.length === 4 && hmSpans[0].offsetWidth === 0 && hmSpans[0].offsetHeight === 0) {
      const hpos = safeComputed(el.hitmarker, 'position');
      if (!hpos || hpos === 'static') el.hitmarker.style.position = 'absolute';
      if (!hpos || hpos === 'static') {
        el.hitmarker.style.left = '50%';
        el.hitmarker.style.top = '50%';
        el.hitmarker.style.width = '0';
        el.hitmarker.style.height = '0';
      }
      for (let i = 0; i < 4; i++) {
        const sp = hmSpans[i];
        const st = sp.style;
        st.position = 'absolute';
        st.left = '0';
        st.top = '0';
        st.width = '2px';
        st.height = '9px';
        st.borderRadius = '1px';
        st.background = COL.primary;
        st.boxShadow = '0 0 4px rgba(0,0,0,0.9)';
        st.transform = `translate(-50%,-50%) rotate(${45 + i * 90}deg) translateY(-9px)`;
      }
    }

    // Health bar fill and reload fill: scale from the left edge.
    if (el.healthFill) {
      el.healthFill.style.transformOrigin = 'left center';
      el.healthFill.style.display = 'block';
      if (el.healthFill.offsetWidth === 0) {
        el.healthFill.style.width = '100%';
        el.healthFill.style.height = '100%';
        el.healthFill.style.background = COL.primary;
      }
    }
    if (reloadFill) {
      reloadFill.style.transformOrigin = 'left center';
      reloadFill.style.display = 'block';
      if (reloadFill.offsetWidth === 0) {
        reloadFill.style.width = '100%';
        reloadFill.style.height = '3px';
        reloadFill.style.background = COL.accent;
      }
    }

    // Full-screen state layers. Only filled in when the stylesheet left them transparent,
    // because a blood vignette that never appears is worse than one drawn from art.js.
    fallbackLayer(
      el.vignette,
      `radial-gradient(ellipse at center, rgba(0,0,0,0) 34%, ${rgbaOf(COL.blood, 0.55)} 78%, ${rgbaOf(COL.blood, 0.92)} 100%)`
    );
    fallbackLayer(
      el.lowHealth,
      `radial-gradient(ellipse at center, rgba(0,0,0,0) 46%, ${rgbaOf(COL.danger, 0.42)} 100%)`
    );
    fallbackLayer(el.flash, rgbaOf(COL.blood, 0.85));

    // The one place the objective labels are measured. Everything the collision pass does
    // afterwards runs off these numbers, so it never reads layout again.
    measureZoneMarkers();

    if (map.ctx && el.minimapCanvas && el.minimapCanvas.offsetWidth === 0) {
      el.minimapCanvas.style.width = '150px';
      el.minimapCanvas.style.height = '150px';
      el.minimapCanvas.style.display = 'block';
      el.minimapCanvas.style.borderRadius = '50%';
    }
  }

  function fallbackLayer(node, background) {
    if (!node) return;
    const st = node.style;
    const bgImage = safeComputed(node, 'backgroundImage');
    const bgColour = safeComputed(node, 'backgroundColor');
    const transparent = (!bgImage || bgImage === 'none') && (!bgColour || bgColour === 'rgba(0, 0, 0, 0)' || bgColour === 'transparent');
    if (!transparent) return;
    const pos = safeComputed(node, 'position');
    if (!pos || pos === 'static') {
      st.position = 'fixed';
      st.inset = '0';
      st.pointerEvents = 'none';
    }
    st.background = background;
  }

  /* ====================================================================== */
  /* Write helpers — every one is a no-op when the quantised value is stable */
  /* ====================================================================== */

  function setOpacity(node, key, value) {
    if (!node) return;
    const qv = Math.round(clamp01(value) * 100);
    if (w[key] === qv) return;
    w[key] = qv;
    node.style.opacity = ALPHA_STR[qv];
  }

  function setVar01(node, name, key, value) {
    if (!node) return;
    const qv = Math.round(clamp01(value) * 100);
    if (w[key] === qv) return;
    w[key] = qv;
    node.style.setProperty(name, ALPHA_STR[qv]);
  }

  function setText(node, key, value) {
    if (!node) return;
    if (w[key] === value) return;
    w[key] = value;
    node.textContent = value;
  }

  function setInt(node, key, value) {
    if (!node) return;
    const v = value | 0;
    if (w[key] === v) return;
    w[key] = v;
    node.textContent = intStr(v);
  }

  function setClass(node, key, cls, want) {
    if (!node) return;
    if (w[key] === want) return;
    w[key] = want;
    node.classList.toggle(cls, want);
  }

  function setHidden(node, key, hide) {
    if (!node) return;
    if (w[key] === !hide) return;
    w[key] = !hide;
    node.hidden = hide;
  }

  function setScaleX(node, key, value) {
    if (!node) return;
    const qv = Math.round(clamp01(value) * 100);
    if (w[key] === qv) return;
    w[key] = qv;
    node.style.scale = SCALEX_STR[qv];
  }

  /* ====================================================================== */
  /* Per-frame sections                                                     */
  /* ====================================================================== */

  function updateCrosshair(dt, weapon) {
    if (!el.crosshair) return;

    s.flare = Math.max(0, s.flare - dt * HUD.crosshairFlareDecay);
    s.firing = Math.max(0, s.firing - dt);
    s.tint = Math.max(0, s.tint - dt * 3.4);

    const spread = weapon && typeof weapon.spread === 'number' ? weapon.spread : 0.03;
    const adsP = weapon && typeof weapon.adsProgress === 'number' ? clamp01(weapon.adsProgress) : 0;

    // Project the real cone half-angle onto the screen: this is the honest reticle, so the
    // gap means something instead of being decorative.
    const fov = (game?.camera?.fov || CAMERA.fov) * (Math.PI / 180);
    const tanHalf = Math.tan(fov * 0.5) || 0.767;
    const projected = (Math.tan(spread) / tanHalf) * (viewH * 0.5);
    const gap = clamp(
      HUD.crosshairBaseGap + projected + s.flare * HUD.crosshairFlarePx,
      HUD.crosshairBaseGap,
      HUD.crosshairMaxGap
    );

    const qGap = Math.round(gap * 2);
    if (w.chGap !== qGap) {
      w.chGap = qGap;
      el.crosshair.style.setProperty('--ch-gap', halfPx(qGap));
    }

    setVar01(el.crosshair, '--ch-spread', 'chSpread', projected / 44);
    setVar01(el.crosshair, '--ch-flare', 'chFlare', s.flare);
    setVar01(el.crosshair, '--ch-tint', 'chTint', s.tint);

    // ADS hides the reticle: the sight takes over. Curve it so it goes quickly at the end.
    const alpha = mode === 'playing' ? (1 - smoothstep(clamp01(adsP * 1.08))) : 0;
    setOpacity(el.crosshair, 'chAlpha', alpha);

    setClass(el.crosshair, 'chAds', 'is-ads', adsP > 0.5);
    setClass(el.crosshair, 'chHit', 'is-hit', s.tint > 0.05 && s.tintKind === 0);
    setClass(el.crosshair, 'chKill', 'is-kill', s.tint > 0.05 && s.tintKind === 1);
    setClass(el.crosshair, 'chFiring', 'is-firing', s.firing > 0);

    // Tint the arms directly so the feedback lands even if the stylesheet ignores --ch-tint.
    const ramp = s.tintKind === 1 ? CH_KILL_RAMP : CH_HIT_RAMP;
    const colour = ramp[clamp(Math.round(s.tint * 8), 0, 8)];
    if (colour !== w.chColour) {
      w.chColour = colour;
      for (let i = 0; i < 4; i++) if (chArms[i]) chArms[i].style.backgroundColor = colour;
      if (chDot) chDot.style.backgroundColor = colour;
    }
  }

  function updateHitmarker(dt) {
    if (!el.hitmarker) return;
    if (s.hmT > 0) s.hmT = Math.max(0, s.hmT - dt);

    const life = s.hmKind === 2 ? HUD.killmarkerLife : HUD.hitmarkerLife;
    const t = s.hmT > 0 ? 1 - s.hmT / life : 1; // 0 at the strike, 1 when spent
    const active = s.hmT > 0;

    // Punch out fast, settle back, fade in the last third. Reads as impact, not as a tween.
    const punch = active ? 1.45 - 0.45 * smoothstep(clamp01(t * 2.4)) : 1;
    const alpha = active ? (t < 0.62 ? 1 : 1 - (t - 0.62) / 0.38) : 0;

    setOpacity(el.hitmarker, 'hmAlpha', alpha);

    const qs = clamp(Math.round(punch * 100), 0, 300);
    if (w.hmScale !== qs) {
      w.hmScale = qs;
      el.hitmarker.style.setProperty('--hm-scale', SCALE_STR[qs]);
      el.hitmarker.style.scale = SCALE_STR[qs];
    }

    const kindKey = active ? s.hmKind * 2 + (s.hmHead ? 1 : 0) : 0;
    if (w.hmClass !== kindKey) {
      w.hmClass = kindKey;
      const cl = el.hitmarker.classList;
      cl.toggle('is-hit', active && s.hmKind === 1);
      cl.toggle('is-kill', active && s.hmKind === 2);
      cl.toggle('is-head', active && s.hmHead);
      const colour = s.hmKind === 2 ? COL.danger : s.hmHead ? COL.accent : COL.primary;
      for (let i = 0; i < hmSpans.length; i++) {
        hmSpans[i].style.backgroundColor = colour;
        // Headshot: drop the lower pair so the marker reads as a chevron. `visibility`
        // never touches layout.
        hmSpans[i].style.visibility = active && s.hmHead && i >= 2 ? 'hidden' : '';
      }
    }
  }

  function updateHealth(dt, state) {
    const maxHealth = state?.maxHealth || 100;
    const health = clamp(state?.health ?? 100, 0, maxHealth);
    const frac = maxHealth > 0 ? health / maxHealth : 0;

    // --- Fallback regeneration ------------------------------------------------
    // No sibling module owns health recovery, and an FPS where damage is permanent is not a
    // demo. The HUD claims it only if nothing else has, and stands down the moment another
    // module starts moving health upwards on its own.
    if (state && regenOwned && mode === 'playing' && health > 0 && health < maxHealth) {
      if (health > s.lastHealth + 0.001) {
        // Somebody else is healing the player: hand the job back.
        regenOwned = false;
      } else {
        s.regenT += dt;
        if (s.regenT > HUD.regenDelay) {
          state.health = Math.min(maxHealth, health + HUD.regenRate * dt);
          s.regenPulse = 1;
        }
      }
    } else if (health >= maxHealth) {
      s.regenT = 0;
    }
    const regenerating = state ? state.health > s.lastHealth + 0.0005 : false;
    s.regenPulse = regenerating ? 1 : Math.max(0, s.regenPulse - dt * 2.2);
    s.lastHealth = state ? state.health : health;

    // --- Bar ------------------------------------------------------------------
    setScaleX(el.healthFill, 'healthScale', frac);
    setInt(el.healthValue, 'healthValue', Math.ceil(health));

    const rampColour = s.regenPulse > 0.35 ? REGEN_COLOUR : HEALTH_RAMP[clamp(Math.round(frac * 16), 0, 16)];
    if (el.healthFill && rampColour !== w.healthColour) {
      w.healthColour = rampColour;
      el.healthFill.style.backgroundColor = rampColour;
    }

    setClass(el.health, 'regenCls', 'is-regen', s.regenPulse > 0.35);
    setClass(el.health, 'criticalCls', 'is-critical', frac < 0.35);
    setVar01(el.hud, '--health', 'healthVar', frac);
    setClass(el.hud, 'lowHealthCls', 'is-low-health', frac < 0.35);

    // --- Blood vignette -------------------------------------------------------
    s.dmgFlash = Math.max(0, s.dmgFlash - dt * 2.6);
    const hitFlash = clamp01(state?.hitFlash || 0);
    // Intensity is driven by (1 - health/max) exactly as briefed, with the fresh-damage
    // flash riding on top so a hit still registers at full health.
    const vig = clamp01((1 - frac) * 0.85 + hitFlash * 0.35);
    const shownVig = mode === 'dead' ? 1 : mode === 'playing' ? vig : vig * 0.5;
    setOpacity(el.vignette, 'vignette', shownVig);
    setVar01(el.hud, '--damage', 'damageVar', shownVig);

    // --- Low-health heartbeat -------------------------------------------------
    if (frac < 0.35 && mode === 'playing' && health > 0) {
      // Two-beat cardiac rhythm; the rate climbs as health falls.
      const rate = lerp(1.05, 2.15, 1 - frac / 0.35);
      s.heartbeat += dt * rate;
      const ph = s.heartbeat % 1;
      const beat = Math.exp(-ph * 14) + 0.62 * Math.exp(-((ph - 0.28) * (ph - 0.28)) * 260);
      setOpacity(el.lowHealth, 'lowHealth', clamp01(beat * (1 - frac / 0.35) * 0.9));
    } else {
      setOpacity(el.lowHealth, 'lowHealth', 0);
    }

    // --- Damage flash ---------------------------------------------------------
    setOpacity(el.flash, 'flash', s.dmgFlash * 0.5);
  }

  function updateDamageArcs(dt) {
    if (!arcs.length) return;
    const cam = game?.camera;
    if (!cam) return;
    cam.getWorldDirection(_fwd);
    const fx = _fwd.x;
    const fz = _fwd.z;
    const len = Math.hypot(fx, fz) || 1;
    const nfx = fx / len;
    const nfz = fz / len;
    // Screen right in the ground plane, for a Y-up camera: cross(forward, up).
    const rx = -nfz;
    const rz = nfx;

    for (let i = 0; i < arcs.length; i++) {
      const a = arcs[i];
      if (a.t < 0) continue;
      a.t += dt;
      if (a.t >= HUD.damageArcLife) {
        a.t = -1;
        a.node.style.display = 'none';
        a.alpha = -1;
        continue;
      }
      const k = a.t / HUD.damageArcLife;
      // Hard on, slow off — the shape of a real hit indicator.
      const alpha = clamp01((1 - k) * (1 - k) * (0.55 + 0.45 * a.amount) * (k < 0.06 ? k / 0.06 : 1));
      const qa = Math.round(alpha * 100);
      if (a.alpha !== qa) {
        a.alpha = qa;
        a.node.style.opacity = ALPHA_STR[qa];
      }
      const ang = Math.atan2(a.x * rx + a.z * rz, a.x * nfx + a.z * nfz) * RAD2DEG;
      const qr = Math.round(ang);
      if (a.rot !== qr) {
        a.rot = qr;
        a.node.style.rotate = degStr(qr);
      }
    }
  }

  function updateAmmo(weapon) {
    const cur = weapon?.current || null;
    const name = cur && cur.name ? String(cur.name) : '—';
    setText(el.weaponName, 'weaponName', name);

    const magSize = cur && cur.magSize ? cur.magSize : 30;
    const ammo = clamp(weapon?.ammo ?? 0, 0, 999);
    const reserve = clamp(weapon?.reserve ?? 0, 0, 999);

    setInt(el.ammoMag, 'ammoMag', ammo);
    setInt(el.ammoReserve, 'ammoReserve', reserve);

    const frac = magSize > 0 ? ammo / magSize : 0;
    const low = frac < 0.3;
    const empty = ammo <= 0;

    setClass(el.weapon, 'lowAmmo', 'is-low', low && !empty);
    setClass(el.weapon, 'emptyAmmo', 'is-empty', empty);

    const magColour = empty ? COL.danger : low ? COL.accent : COL.primary;
    if (magColour !== w.pipColour) {
      w.pipColour = magColour;
      if (el.ammoMag) el.ammoMag.style.color = magColour;
      for (let i = 0; i < pips.length; i++) pips[i].style.background = magColour;
    }

    // --- Pip strip ------------------------------------------------------------
    if (pips.length) {
      const count = Math.min(MAX_PIPS, magSize);
      if (w.pipCount !== count) {
        for (let i = 0; i < MAX_PIPS; i++) pips[i].style.display = i < count ? 'inline-block' : 'none';
        w.pipCount = count;
        w.pipFilled = -1;
      }
      const filled = Math.min(count, ammo);
      if (w.pipFilled !== filled) {
        for (let i = 0; i < count; i++) pips[i].style.opacity = i < filled ? ALPHA_STR[100] : ALPHA_STR[14];
        w.pipFilled = filled;
      }
    }

    // --- Reload prompt --------------------------------------------------------
    const reloading = !!weapon?.reloading;
    const wantPrompt = mode === 'playing' && !reloading && reserve > 0 && (empty || frac <= 0.2);
    setHidden(el.reloadPrompt, 'promptShown', !wantPrompt);
    if (wantPrompt && el.reloadPrompt) {
      // A slow pulse; urgent when the magazine is dry.
      const pulse = 0.62 + 0.38 * Math.sin((game?.clock?.time || 0) * (empty ? 9 : 4.5));
      setOpacity(el.reloadPrompt, 'promptAlpha', pulse);
    }
    setClass(el.weapon, 'reloadingCls', 'is-reloading', reloading);
  }

  function updateReloadBar(dt) {
    if (!el.reloadBar) return;
    if (!s.reloadActive) {
      setHidden(el.reloadBar, 'reloadShown', true);
      return;
    }
    s.reloadT += dt;
    if (s.reloadPhase === 3) {
      s.reloadHold -= dt;
      if (s.reloadHold <= 0) {
        s.reloadActive = false;
        setHidden(el.reloadBar, 'reloadShown', true);
        return;
      }
    } else if (s.reloadT > s.reloadDur * 1.8) {
      // The clip was cancelled (sprint, weapon switch) and no 'end' arrived.
      s.reloadActive = false;
      setHidden(el.reloadBar, 'reloadShown', true);
      return;
    }
    setHidden(el.reloadBar, 'reloadShown', false);
    const p = s.reloadPhase === 3 ? 1 : clamp01(s.reloadT / Math.max(0.2, s.reloadDur));
    setScaleX(reloadFill, 'reloadFill', p);
    if (reloadFill) {
      // The bar turns accent the moment the fresh magazine seats, so the player can see the
      // point at which the rounds are actually theirs.
      const colour = s.reloadPhase >= 2 ? COL.accent : COL.friendly;
      if (colour !== w.reloadColour) {
        w.reloadColour = colour;
        reloadFill.style.backgroundColor = colour;
      }
    }
  }

  function updateFeed(dt) {
    for (let i = 0; i < kfRows.length; i++) {
      const r = kfRows[i];
      if (r.t < 0) continue;
      r.t += dt;
      if (r.t >= HUD.killfeedLife) {
        r.t = -1;
        r.node.style.display = 'none';
        continue;
      }
      const inT = clamp01(r.t / 0.16);
      const outT = clamp01((HUD.killfeedLife - r.t) / HUD.killfeedFade);
      const alpha = smoothstep(inT) * smoothstep(outT);
      const qa = Math.round(alpha * 100);
      if (r.alpha !== qa) {
        r.alpha = qa;
        r.node.style.opacity = ALPHA_STR[qa];
      }
      const tx = (1 - smoothstep(inT)) * 14;
      const qt = Math.round(tx);
      if (r.tx !== qt) {
        r.tx = qt;
        r.node.style.translate = txStr(qt);
      }
    }

    for (let i = 0; i < xpPops.length; i++) {
      const p = xpPops[i];
      if (p.t < 0) continue;
      p.t += dt;
      if (p.t >= HUD.xpLife) {
        p.t = -1;
        p.node.style.display = 'none';
        continue;
      }
      const k = p.t / HUD.xpLife;
      const alpha = k < 0.1 ? k / 0.1 : 1 - smoothstep(clamp01((k - 0.45) / 0.55));
      const qa = Math.round(clamp01(alpha) * 100);
      if (p.alpha !== qa) {
        p.alpha = qa;
        p.node.style.opacity = ALPHA_STR[qa];
      }
      const ty = -smoothstep(clamp01(k * 1.15)) * HUD.xpRise;
      const qt = Math.round(ty);
      if (p.ty !== qt) {
        p.ty = qt;
        p.node.style.translate = tyStr(qt);
      }
    }

    if (el.callout) {
      if (s.calloutT > 0) {
        s.calloutT -= dt;
        const k = 1 - s.calloutT / HUD.calloutLife;
        const alpha = k < 0.08 ? k / 0.08 : 1 - smoothstep(clamp01((k - 0.62) / 0.38));
        setOpacity(el.callout, 'calloutAlpha', alpha);
        const sc = 1.16 - 0.16 * smoothstep(clamp01(k * 4.5));
        const qs = clamp(Math.round(sc * 100), 0, 300);
        if (w.calloutScale !== qs) {
          w.calloutScale = qs;
          el.callout.style.scale = SCALE_STR[qs];
        }
      } else {
        setOpacity(el.callout, 'calloutAlpha', 0);
      }
    }
  }

  function updateCompass(headingDeg) {
    if (!el.compassTrack) return;
    // One transform on the track moves the whole strip, as briefed.
    const qh = Math.round(headingDeg * 2);
    if (w.compass !== qh) {
      w.compass = qh;
      el.compassTrack.style.translate = txStr(-(qh / 2) * HUD.compassPxPerDeg);
    }
  }

  /**
   * Objective markers, positioned by bearing and then de-collided.
   *
   * Bearing alone is not enough. The Yard and The Depot are only a few degrees apart from most
   * of the west side of the map, and two labels placed independently at 2.45 px/deg landed
   * inside each other: the strip rendered "THE DEPOTTHE YARD", same weight, same accent
   * colour, the D of one crossing the T of the other, with nothing to tell a reader where one
   * label stopped. A compass that cannot be read at a glance is not a compass.
   *
   * So after positioning, the markers are sorted by screen x and swept as a chain. Priority is
   * distance to the player — the objective you are closest to is the one you are acting on, so
   * it wins every contest — and each overlapping pair is resolved with three tools in order of
   * how much they cost the reader:
   *
   *  1. Nudge. Slide the pair apart to the minimum gap, the junior yielding the ground and the
   *     nearest objective yielding none of it. Capped at `markerMaxNudgePx` against the true
   *     bearing, so no marker is ever bent past 4.5°.
   *  2. Fade. Whatever overlap survives the nudge fades the junior marker out over
   *     `markerFadeSpanPx`. Dead-on bearings therefore collapse the pair to one marker rather
   *     than printing two labels through each other.
   *  3. Rank. The nearest objective is accent at full strength, the rest are dim and quieter,
   *     so even a pair that clears the gap separates by colour and level as well as by space.
   *
   * Every step is a continuous function of bearing, which matters at 10 Hz: nothing pops as the
   * player turns, and when two markers cross each other they are fully faded at the crossing.
   *
   * Widths come from `measureZoneMarkers`; this function never touches layout, never allocates,
   * and writes only when a quantised value actually moved.
   */
  function updateZoneMarkers(headingDeg) {
    const n = zoneMarkers.length;
    if (!n) return;
    const px = game?.player?.eye?.x ?? game?.camera?.position?.x ?? 0;
    const pz = game?.player?.eye?.z ?? game?.camera?.position?.z ?? 0;

    for (let i = 0; i < n; i++) {
      const m = zoneMarkers[i];
      const dx = m.cx - px;
      const dz = m.cz - pz;
      const bearing = Math.atan2(dx, -dz) * RAD2DEG;
      // Relative to the needle. The track itself carries the heading, so this is exactly the
      // marker's offset from the centre of the strip, which is the space collisions live in.
      markTrue[i] = wrap180(bearing - headingDeg) * HUD.compassPxPerDeg;
      markX[i] = markTrue[i];
      markD2[i] = dx * dx + dz * dz;
      markFade[i] = 0;
      markOrder[i] = i;
    }

    // Priority: nearest zone is rank 0. n is the zone count (three), so the O(n^2) rank is
    // cheaper than any sort and, unlike a sort, is stable against equal distances by index.
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let j = 0; j < n; j++) {
        if (markD2[j] < markD2[i] || (markD2[j] === markD2[i] && j < i)) r++;
      }
      markRank[i] = r;
    }

    // Left-to-right order. Insertion sort over the index array: in place, allocation-free, and
    // near-free on an already-sorted list, which is what it sees on all but a few frames.
    for (let i = 1; i < n; i++) {
      const v = markOrder[i];
      const key = markX[v];
      let j = i - 1;
      while (j >= 0 && markX[markOrder[j]] > key) {
        markOrder[j + 1] = markOrder[j];
        j--;
      }
      markOrder[j + 1] = v;
    }

    // 1. Nudge. Two relaxation sweeps: one pass fixes an isolated pair, and the second settles
    //    the case where opening a pair pushes one of them into a third marker.
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 1; k < n; k++) {
        const a = markOrder[k - 1];
        const b = markOrder[k];
        const need = (zoneMarkers[a].w + zoneMarkers[b].w) * 0.5 + HUD.markerGapPx;
        const over = need - (markX[b] - markX[a]);
        if (over <= 0) continue;
        const nudge = over < HUD.markerMaxNudgePx ? over : HUD.markerMaxNudgePx;
        // The junior gives way. The nearest objective is a special case and yields *nothing*:
        // it is the one the player is acting on, so its bearing stays exactly true, and since
        // it is also the marker the eye is locked to it is the one whose sideways jump would
        // be most obvious when two markers cross and the resolution flips sides.
        const aYield =
          markRank[a] === 0 ? 0
            : markRank[b] === 0 ? 1
              : markRank[a] > markRank[b] ? 1 - HUD.markerSeniorYield : HUD.markerSeniorYield;
        markX[a] -= nudge * aYield;
        markX[b] += nudge * (1 - aYield);
      }
    }

    // The cap has to hold against the *true* bearing, not per sweep: two sweeps of an 11 px
    // budget would otherwise compound into a 22 px lie. Clamping here rather than inside the
    // sweep also keeps the nudge continuous — a marker that hits the rail simply stops, and
    // whatever overlap that leaves is handed to the fade below.
    for (let i = 0; i < n; i++) {
      const lo = markTrue[i] - HUD.markerMaxNudgePx;
      const hi = markTrue[i] + HUD.markerMaxNudgePx;
      markX[i] = markX[i] < lo ? lo : markX[i] > hi ? hi : markX[i];
    }

    // 2. Fade, measured on the final geometry so it reflects what the nudge could not fix.
    for (let k = 1; k < n; k++) {
      const a = markOrder[k - 1];
      const b = markOrder[k];
      const need = (zoneMarkers[a].w + zoneMarkers[b].w) * 0.5 + HUD.markerGapPx;
      const over = need - (markX[b] - markX[a]);
      if (over <= 0) continue;
      const junior = markRank[a] > markRank[b] ? a : b;
      const f = clamp01(over / HUD.markerFadeSpanPx);
      if (f > markFade[junior]) markFade[junior] = f;
    }

    // 3. Write. Back into track space, where the strip's own translation is undone.
    const base = headingDeg * HUD.compassPxPerDeg;
    for (let i = 0; i < n; i++) {
      const m = zoneMarkers[i];
      const qx = Math.round(base + markX[i]);
      if (m.tx !== qx) {
        m.tx = qx;
        m.node.style.translate = txStr(qx);
      }

      const primary = markRank[i] === 0;
      const alpha = (primary ? 1 : HUD.markerJuniorAlpha) * (1 - markFade[i]);
      const qa = Math.round(clamp01(alpha) * 100);
      if (m.alpha !== qa) {
        m.alpha = qa;
        m.node.style.opacity = ALPHA_STR[qa];
      }

      // Colour and level only. Nothing here may change the label's width, or the measured
      // widths the pass above runs on would stop describing what is on screen.
      // Hazard accent for the objective you are closest to, bone white for the rest: two
      // solid colours a hue apart, so a pair that only just clears the gap still separates.
      // `COL.dim` is deliberately not used here — it carries its own 0.55 alpha, which would
      // compound with the junior's opacity and put the label under the scrim.
      const colour = primary ? COL.accent : COL.primary;
      if (m.colour !== colour) {
        m.colour = colour;
        m.node.style.color = colour;
        m.pip.style.background = colour;
      }
      if (m.primary !== primary) {
        m.primary = primary;
        m.node.classList.toggle('is-primary', primary);
      }
    }
  }

  function updateBlips(dt) {
    const enemies = game?.ai?.enemies;
    if (!enemies) return;
    const n = Math.min(enemies.length, MAX_BLIPS);
    for (let i = 0; i < n; i++) {
      const e = enemies[i];
      if (blipT[i] > 0) blipT[i] = Math.max(0, blipT[i] - dt);
      if (!e || !e.active || e.dead) {
        prevFireTimer[i] = -1;
        continue;
      }
      // A soldier's fire timer is reset upwards the instant a round leaves the barrel; a
      // rise is therefore a muzzle flash, which is the only thing that reveals him.
      const ft = typeof e.fireTimer === 'number' ? e.fireTimer : 0;
      if (ft > prevFireTimer[i] + 1e-4) blipT[i] = HUD.blipLife;
      prevFireTimer[i] = ft;
    }
  }

  function drawMinimap(headingRad) {
    const ctx = map.ctx;
    if (!ctx) return;
    const W = map.w;
    const H = map.h;
    const cx = W * 0.5;
    const cy = H * 0.5;
    const R = Math.min(W, H) * 0.5 - 2;

    const px = game?.player?.eye?.x ?? game?.camera?.position?.x ?? 0;
    const pz = game?.player?.eye?.z ?? game?.camera?.position?.z ?? 0;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();

    // Void plate — only ever visible outside the baked footprint, and darker than the ground
    // step so leaving the map reads as leaving the map. Opaque, so nothing behind the canvas
    // can wash the ramp out.
    ctx.fillStyle = MAP_COL.voidFill;
    ctx.fillRect(0, 0, W, H);

    // Baked navigation grid, blitted from the offscreen bake — a single drawImage.
    if (map.ready && map.base) {
      const pxPerMetre = map.pxPerCell / map.cell;
      const halfSrc = HUD.minimapRange * pxPerMetre;
      const sx = (px - map.ox) * pxPerMetre - halfSrc;
      const sy = (pz - map.oz) * pxPerMetre - halfSrc;
      ctx.drawImage(map.base, sx, sy, halfSrc * 2, halfSrc * 2, 0, 0, W, H);
    }

    const scale = (R * 2) / (HUD.minimapRange * 2); // px per metre on the disc

    // Range ring at half the view radius, so distance is readable.
    ctx.strokeStyle = MAP_COL.ring;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.5, 0, TAU);
    ctx.stroke();

    // View cone: the camera's real horizontal FOV, so what you see is what is lit.
    const aspect = viewW / Math.max(1, viewH);
    const vFov = (game?.camera?.fov || CAMERA.fov) * (Math.PI / 180);
    const hFov = 2 * Math.atan(Math.tan(vFov * 0.5) * aspect);
    const coneR = R * 0.92;
    // The two gradients depend only on the canvas geometry, so they are built on the first
    // draw and reused. Rebuilding them per draw was the one real allocation left in here.
    if (!map.coneGrad) {
      const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, coneR);
      g.addColorStop(0, MAP_COL.coneIn);
      g.addColorStop(1, MAP_COL.coneOut);
      map.coneGrad = g;
      const ag = ctx.createRadialGradient(cx, cy, 0, cx, cy, 17);
      ag.addColorStop(0, MAP_COL.arrowGlowIn);
      ag.addColorStop(1, MAP_COL.arrowGlowOut);
      map.arrowGrad = ag;
    }
    ctx.fillStyle = map.coneGrad;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    // Canvas angles run clockwise from +X; north is up, so subtract a quarter turn.
    ctx.arc(cx, cy, coneR, headingRad - hFov * 0.5 - Math.PI * 0.5, headingRad + hFov * 0.5 - Math.PI * 0.5);
    ctx.closePath();
    ctx.fill();

    // Enemy blips: only while the muzzle flash is fresh.
    const enemies = game?.ai?.enemies;
    if (enemies) {
      const n = Math.min(enemies.length, MAX_BLIPS);
      for (let i = 0; i < n; i++) {
        const t = blipT[i];
        if (t <= 0) continue;
        const e = enemies[i];
        if (!e || !e.position) continue;
        let dx = (e.position.x - px) * scale;
        let dy = (e.position.z - pz) * scale;
        const d = Math.hypot(dx, dy);
        const edge = d > R - 8;
        if (edge && d > 0.001) {
          const k = (R - 8) / d;
          dx *= k;
          dy *= k;
        }
        const a = clamp(Math.round((t / HUD.blipLife) * 12), 0, 12);
        const bx = cx + dx;
        const by = cy + dy;
        // Dark keyline first, so the blip separates from the wall step wherever it lands.
        ctx.strokeStyle = MAP_COL.blipStroke;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.fillStyle = BLIP_RAMP[a];
        ctx.beginPath();
        if (edge) {
          // Off-map contacts collapse to a small pointer on the rim.
          const ang = Math.atan2(dy, dx);
          ctx.moveTo(bx + Math.cos(ang) * 6, by + Math.sin(ang) * 6);
          ctx.lineTo(bx + Math.cos(ang + 2.4) * 6, by + Math.sin(ang + 2.4) * 6);
          ctx.lineTo(bx + Math.cos(ang - 2.4) * 6, by + Math.sin(ang - 2.4) * 6);
          ctx.closePath();
          ctx.stroke();
          ctx.fill();
        } else {
          ctx.moveTo(bx, by - 6.5);
          ctx.lineTo(bx + 6.5, by);
          ctx.lineTo(bx, by + 6.5);
          ctx.lineTo(bx - 6.5, by);
          ctx.closePath();
          ctx.stroke();
          ctx.fill();
          // Hot core. This is what puts the blip's peak clear of every static step.
          ctx.fillStyle = BLIP_CORE_RAMP[a];
          ctx.beginPath();
          ctx.moveTo(bx, by - 3);
          ctx.lineTo(bx + 3, by);
          ctx.lineTo(bx, by + 3);
          ctx.lineTo(bx - 3, by);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // Player arrow. Brightest mark on the disc by a clear margin — near display white against
    // a field whose top step is 50% — sitting on a cool halo that separates it from the cone.
    ctx.fillStyle = map.arrowGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, 17, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(headingRad);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 8.5);
    ctx.lineTo(0, 4.5);
    ctx.lineTo(-7, 8.5);
    ctx.closePath();
    // Dark keyline outermost, so the arrow still separates when it is standing on a wall lip.
    ctx.strokeStyle = MAP_COL.arrowKey;
    ctx.lineWidth = 4.5;
    ctx.stroke();
    // Saturated rim, then the near-white core.
    ctx.strokeStyle = MAP_COL.arrowRim;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = MAP_COL.arrowFill;
    ctx.fill();
    ctx.restore();

    ctx.restore(); // clip

    // North tick on the rim, outside the clip so it always reads.
    ctx.fillStyle = MAP_COL.north;
    ctx.beginPath();
    ctx.moveTo(cx, cy - R + 1);
    ctx.lineTo(cx - 4, cy - R + 9);
    ctx.lineTo(cx + 4, cy - R + 9);
    ctx.closePath();
    ctx.fill();
  }

  function updateZoneLabel() {
    if (!el.zone) return;
    const px = game?.player?.eye?.x ?? game?.camera?.position?.x ?? 0;
    const pz = game?.player?.eye?.z ?? game?.camera?.position?.z ?? 0;
    let best = '';
    let bestScore = Infinity;
    for (const key in ZONES) {
      const z = ZONES[key];
      if (!z || !z.centre) continue;
      const dx = px - z.centre[0];
      const dz = pz - z.centre[2];
      const d = Math.hypot(dx, dz);
      const score = d - (z.radius || 20);
      if (score < bestScore) {
        bestScore = score;
        best = z.label || key;
      }
    }
    const label = (bestScore <= 0 ? best : best ? `${best} — OUTER` : 'FREIGHT YARD 14').toUpperCase();
    setText(el.zone, 'zone', label);
  }

  function updateDebug(dt) {
    if (!el.debug || !debugOpen) return;
    const stats = game?.engine?.stats;
    const p = game?.player?.eye || game?.camera?.position;
    const fps = s.fpsSmooth;
    const lines =
      `FPS      ${fps.toFixed(1)}  (${s.dtSmooth.toFixed(2)} ms)\n` +
      `DRAWS    ${stats ? stats.drawCalls : '—'}   TRIS ${stats ? formatTris(stats.triangles) : '—'}\n` +
      `PROGRAMS ${stats && stats.programs !== undefined ? stats.programs : '—'}\n` +
      `QUALITY  ${game?.quality || '—'}   MODE ${mode}\n` +
      `POS      ${p ? `${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}` : '—'}\n` +
      `YAW      ${((game?.player?.yaw || 0) * RAD2DEG).toFixed(0)}°  PITCH ${((game?.player?.pitch || 0) * RAD2DEG).toFixed(0)}°\n` +
      `HEALTH   ${Math.ceil(game?.state?.health ?? 0)}/${game?.state?.maxHealth ?? 0}   STREAK ${game?.state?.streak ?? 0}\n` +
      `AMMO     ${game?.weapon?.ammo ?? 0}/${game?.weapon?.reserve ?? 0}   SPREAD ${(game?.weapon?.spread ?? 0).toFixed(4)}\n` +
      `HOSTILES ${game?.ai?.alive ?? 0}/${game?.ai?.enemies?.length ?? 0}` +
      (game?.failures?.length ? `\nFAILED   ${game.failures.length} module(s)` : '');
    el.debug.textContent = lines;
  }

  function formatTris(n) {
    if (!n) return '0';
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return String(n);
  }

  /* ====================================================================== */
  /* Main update                                                            */
  /* ====================================================================== */

  let regenOwned = true;
  let lastStateMode = game?.state?.mode || 'menu';
  if (game && game.state) {
    if (game.state.regenOwner && game.state.regenOwner !== 'hud') regenOwned = false;
    else game.state.regenOwner = 'hud';
  }

  function update(dt, g) {
    if (disposed) return;
    const ctxGame = g || game;
    const state = ctxGame?.state;

    // Follow `game.state.mode`, but only on the frame it actually changes: menu.js is
    // entitled to call `setMode` directly, and re-asserting the state every frame would
    // stamp on it.
    const wanted = state?.mode;
    if (wanted && wanted !== lastStateMode) {
      lastStateMode = wanted;
      if (wanted !== mode) setMode(wanted);
    }

    if (!probed && (mode === 'playing' || ctxGame?.capture)) probe();

    const weapon = ctxGame?.weapon;

    // Smoothed frame stats for the debug panel; exponential so it never jitters.
    s.fpsSmooth = approach(s.fpsSmooth, ctxGame?.clock?.fps || (dt > 0 ? 1 / dt : 60), 3, dt);
    s.dtSmooth = approach(s.dtSmooth, dt * 1000, 3, dt);

    updateCrosshair(dt, weapon);
    updateHitmarker(dt);
    updateHealth(dt, state);
    updateDamageArcs(dt);
    updateAmmo(weapon);
    updateReloadBar(dt);
    updateFeed(dt);
    updateBlips(dt);

    // Heading straight from the camera basis, so it is right even if the player stub is inert.
    let headingRad = 0;
    if (ctxGame?.camera) {
      ctxGame.camera.getWorldDirection(_fwd);
      headingRad = Math.atan2(_fwd.x, -_fwd.z);
    } else if (ctxGame?.player) {
      headingRad = -(ctxGame.player.yaw || 0);
    }
    const headingDeg = headingRad * RAD2DEG;
    updateCompass(headingDeg);

    setInt(el.score, 'score', state?.score || 0);
    setInt(el.kills, 'kills', state?.kills || 0);

    const streak = state?.streak || 0;
    if (w.streakVal !== streak) {
      w.streakVal = streak;
      if (el.streak) {
        if (streak >= 2) el.streak.textContent = `STREAK ×${intStr(streak)}`;
        el.hud?.style.setProperty('--streak', intStr(streak));
      }
      setHidden(el.streak, 'streakShown', streak < 2);
    }

    setText(el.stance, 'stance', String(ctxGame?.player?.stance || (ctxGame?.player?.crouched ? 'CROUCH' : 'STAND')));

    setVar01(el.hud, '--ads', 'adsVar', weapon && typeof weapon.adsProgress === 'number' ? weapon.adsProgress : 0);

    // --- Low-frequency work -------------------------------------------------
    s.slowAccum += dt;
    if (s.slowAccum >= 0.1) {
      s.slowAccum = 0;
      updateZoneMarkers(headingDeg);
      updateZoneLabel();
    }

    s.mapAccum += dt;
    if (s.mapAccum >= 1 / HUD.minimapHz) {
      s.mapAccum = 0;
      if (mode === 'playing' || mode === 'paused' || ctxGame?.capture) drawMinimap(headingRad);
    }

    s.debugAccum += dt;
    if (debugOpen && s.debugAccum >= 1 / HUD.debugHz) {
      s.debugAccum = 0;
      updateDebug(dt);
    }
  }

  /* ====================================================================== */
  /* Public API                                                             */
  /* ====================================================================== */

  const MODE_ALPHA = { menu: 0, playing: 1, paused: 0.32, dead: 0.22 };

  function applyVisibility() {
    if (!el.hud) return;
    const hidden = doc.body.classList.contains('hide-hud');
    const a = hidden || !shown ? 0 : MODE_ALPHA[mode] !== undefined ? MODE_ALPHA[mode] : 1;
    setOpacity(el.hud, 'hudAlpha', a);
    el.hud.style.pointerEvents = 'none';
    el.hud.setAttribute('aria-hidden', a > 0.01 ? 'false' : 'true');
  }

  function setMode(next) {
    const m = next === 'playing' || next === 'paused' || next === 'dead' ? next : 'menu';
    if (m === mode && w.modeAttr === m) return;
    mode = m;
    if (el.hud) {
      if (w.modeAttr !== m) {
        w.modeAttr = m;
        el.hud.setAttribute('data-mode', m);
        const cl = el.hud.classList;
        cl.toggle('is-menu', m === 'menu');
        cl.toggle('is-playing', m === 'playing');
        cl.toggle('is-paused', m === 'paused');
        cl.toggle('is-dead', m === 'dead');
      }
    }
    if (m === 'dead') {
      s.hmT = 0;
      s.calloutT = 0;
    }
    if (m === 'menu') {
      // Clear transient state so a fresh deployment starts clean.
      for (let i = 0; i < kfRows.length; i++) {
        kfRows[i].t = -1;
        kfRows[i].node.style.display = 'none';
      }
      for (let i = 0; i < arcs.length; i++) {
        arcs[i].t = -1;
        arcs[i].node.style.display = 'none';
      }
      for (let i = 0; i < xpPops.length; i++) {
        xpPops[i].t = -1;
        xpPops[i].node.style.display = 'none';
      }
      s.dmgFlash = 0;
      s.regenT = 0;
    }
    applyVisibility();
  }

  function show() {
    shown = true;
    applyVisibility();
  }

  function hide() {
    shown = false;
    applyVisibility();
  }

  /** `kind` is one of 'info' | 'good' | 'warn' | 'danger'. */
  function notify(text, kind) {
    if (typeof text !== 'string' || !text) return;
    pushCallout(text.toUpperCase(), kind === 'warn' ? 'danger' : kind || 'info');
  }

  function setCrosshairColour(colour) {
    if (typeof colour !== 'string' || !colour) return;
    crosshairColour = colour;
    CH_HIT_RAMP = buildRamp(crosshairColour, COL.accent, 9);
    CH_KILL_RAMP = buildRamp(crosshairColour, COL.danger, 9);
    w.chColour = '';
    el.hud?.style.setProperty('--hud-ch-colour', colour);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (let i = 0; i < unsubs.length; i++) {
      try {
        unsubs[i]();
      } catch {
        /* emitter already gone */
      }
    }
    unsubs.length = 0;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', onResize);
    map.base = null;
    map.ctx = null;
  }

  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem('ashfall.settings') || '{}') || {};
    } catch {
      return {};
    }
  }

  /* Seed the initial state so nothing flashes on the first frame. */
  setMode(game?.state?.mode || 'menu');
  updateZoneLabel();
  if (el.reloadPrompt) el.reloadPrompt.hidden = true;
  if (el.reloadBar) el.reloadBar.hidden = true;
  if (el.streak) el.streak.hidden = true;
  if (el.hitmarker) el.hitmarker.style.opacity = ALPHA_STR[0];
  if (el.vignette) el.vignette.style.opacity = ALPHA_STR[0];
  if (el.lowHealth) el.lowHealth.style.opacity = ALPHA_STR[0];
  if (el.flash) el.flash.style.opacity = ALPHA_STR[0];
  if (el.callout) el.callout.style.opacity = ALPHA_STR[0];

  const hud = {
    update,
    show,
    hide,
    setMode,
    notify,
    setCrosshairColour,
    dispose,
    /** Read-only handles the menu and the capture harness occasionally want. */
    elements: el,
    get mode() {
      return mode;
    },
    /** Lets level.js finish late (or a wave respawn) and still get a correct minimap. */
    rebuildMinimap: bakeMinimap,
  };

  return hud;
}

export default createHUD;
