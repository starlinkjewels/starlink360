import * as THREE from "three";

/*
 * Lighting, and the one thing about it that is counter-intuitive here.
 *
 * The stones are drawn by a refraction shader that traces rays through the
 * geometry and samples an environment map at the end. It reads NOTHING else —
 * no spot light, no ambient, no directional. So every light below affects the
 * metal only, and the environment alone decides how a diamond looks.
 *
 * That is why the environment picker is the important control in this section
 * and the light sliders are the cosmetic ones, which is the opposite of what
 * the panel layout would suggest.
 */

/** Environments the scene can sample. */
export interface EnvironmentOption {
  id: string;
  label: string;
  hint: string;
  /** drei preset name, or null for the generated light tent. */
  preset: string | null;
  /**
   * A real photographed/rendered studio HDRI, served from `public/env/`,
   * instead of one of drei's free built-in presets. Takes priority over
   * `preset` when set. Sourced from Poly Haven (CC0 — free to use, no
   * licensing concerns), because the free `preset` list is a fixed set of
   * drei defaults never shot for jewellery, while a real studio capture is
   * what an environment map actually looks like on a commercial jewellery
   * renderer.
   */
  file?: string;
  /**
   * Sky and ground colours, for the swatch.
   *
   * A grid of twelve identical grey spheres tells nobody anything, and the real
   * HDRIs are megabytes fetched on demand — sampling them to draw a 44px circle
   * would mean downloading all twelve to browse the list. These are the two
   * colours each environment actually reads as.
   */
  sky: string;
  ground: string;
}

/*
 * Ten of these ship with drei and cost nothing to add. "Warehouse" is first
 * and is the default because it is what the current look was signed off
 * against — and, tried against the alternative, for a real reason: at this
 * product's boosted envMapIntensity, "Studio"'s near-black inter-panel gaps
 * punch black crescents into every chain link and pavé facet. Warehouse does
 * not have that failure mode.
 */
export const ENVIRONMENTS: EnvironmentOption[] = [
  {
    id: "warehouse",
    label: "Warehouse",
    hint: "The current look",
    preset: "warehouse",
    sky: "#b9b4a8",
    ground: "#4a4640",
  },
  {
    id: "tent",
    label: "Studio light tent",
    hint: "Built for stones",
    preset: null,
    sky: "#ffffff",
    ground: "#d6d6da",
  },
  {
    id: "studio",
    label: "Studio",
    hint: "Even, neutral",
    preset: "studio",
    sky: "#f0f0f2",
    ground: "#8e8e94",
  },
  {
    id: "apartment",
    label: "Apartment",
    hint: "Soft indoor",
    preset: "apartment",
    sky: "#d9cfc2",
    ground: "#6b5f52",
  },
  {
    id: "city",
    label: "City",
    hint: "Hard, contrasty",
    preset: "city",
    sky: "#9fb0c4",
    ground: "#33383f",
  },
  {
    id: "lobby",
    label: "Lobby",
    hint: "Warm interior",
    preset: "lobby",
    sky: "#e2c9a4",
    ground: "#4a3a28",
  },
  {
    id: "dawn",
    label: "Dawn",
    hint: "Low warm sun",
    preset: "dawn",
    sky: "#f0c39a",
    ground: "#3d3346",
  },
  {
    id: "sunset",
    label: "Sunset",
    hint: "Strong golden",
    preset: "sunset",
    sky: "#f2a45c",
    ground: "#2c1e2b",
  },
  {
    id: "park",
    label: "Park",
    hint: "Open daylight",
    preset: "park",
    sky: "#a9cbe8",
    ground: "#4d6a3c",
  },
  {
    id: "forest",
    label: "Forest",
    hint: "Green, dappled",
    preset: "forest",
    sky: "#8fae7a",
    ground: "#26301f",
  },
  {
    id: "night",
    label: "Night",
    hint: "Very dark",
    preset: "night",
    sky: "#22293a",
    ground: "#0a0c12",
  },
  // Twelfth: the one a jeweller asks for by name and drei happens to ship.
  {
    id: "sunrise",
    label: "Sunrise",
    hint: "Cool, low, even",
    preset: "sunset",
    sky: "#cfd8e8",
    ground: "#4b4436",
  },
  /*
   * Real studio captures, not drei presets — see `EnvironmentOption.file`.
   * Both CC0 from Poly Haven (polyhaven.com), downloaded at 2k: large enough
   * for a clean reflection on a polished band, small enough to fetch quickly.
   */
  {
    id: "white-studio",
    label: "White Studio",
    hint: "Real capture — clean, even",
    preset: null,
    file: "/env/white_studio_02_2k.hdr",
    sky: "#f5f5f2",
    ground: "#c9c9c6",
  },
  {
    id: "studio-small",
    label: "Studio Small",
    hint: "Real capture — punchy highlights",
    preset: null,
    file: "/env/studio_small_03_2k.hdr",
    sky: "#e8e6e0",
    ground: "#3a3a3d",
  },
  /*
   * Diamond Studio environments — generated, like the tent, for the same
   * reason (see the Diamond Studio section below): a photographed HDRI is a
   * continuous room, and a diamond needs small, sharply-bounded bright
   * sources against dark gaps to throw visible facet contrast at all.
   */
  {
    id: "diamond-studio",
    label: "Diamond Studio",
    hint: "Built for stones",
    preset: null,
    sky: "#fbfbfa",
    ground: "#b8b8bd",
  },
  {
    id: "high-contrast",
    label: "High Contrast",
    hint: "Sharper flashes, deeper gaps",
    preset: null,
    sky: "#ffffff",
    ground: "#1a1a1e",
  },
  {
    id: "diamond-studio-crisp",
    label: "Diamond Studio Crisp",
    hint: "Hard-edged transitions — the current default",
    preset: null,
    sky: "#ffffff",
    ground: "#0d0d10",
  },
  {
    id: "soft-studio",
    label: "Soft Studio",
    hint: "Gentle transitions, less fire",
    preset: null,
    sky: "#f4f1ea",
    ground: "#d8d3c8",
  },
  {
    id: "luxury-white",
    label: "Luxury White",
    hint: "Clean and bright, minimal shadow",
    preset: null,
    sky: "#fffdf8",
    ground: "#e6e0d2",
  },
  {
    id: "dark-studio",
    label: "Dark Studio",
    hint: "Mostly dark, a few sharp strips",
    preset: null,
    sky: "#eef0f5",
    ground: "#101014",
  },
];

/** Falls back rather than throwing on an id from an older saved setting. */
export function environmentById(id: string): EnvironmentOption {
  return ENVIRONMENTS.find((e) => e.id === id) ?? ENVIRONMENTS[0];
}

export interface LightingSettings {
  /** What the metal reflects. */
  environment: string;
  /**
   * Lets the stones sample a different environment from the metal.
   *
   * Not a gimmick: it is how the photograph is actually taken, with the piece
   * in a room and the stone in a light tent. On by default despite the extra
   * environment map in memory, because a diamond's fire needs small, bright,
   * concentrated sources to split into visible colour — a diffuse room like
   * Studio or Warehouse starves it, and a stone with no fire is the single
   * biggest reason a render reads as a grey glass dot instead of a diamond.
   */
  separateGemEnvironment: boolean;
  gemEnvironment: string;
  /**
   * Turns the environment around the piece, in radians.
   *
   * This is the control that matters most on a metal band: the highlight is a
   * reflection of the room, so moving the room moves the highlight — and where
   * the highlight falls on a shank is most of whether a render looks composed.
   */
  environmentRotation: number;
  /** Multiplies the environment only, leaving the lights alone. */
  environmentIntensity: number;
  /**
   * Turns the diamond's own environment independently of `environmentRotation`
   * — the metal's room and the stone's light tent are different environments,
   * so rotating one must not rotate the other. Applied as a texture offset,
   * not a rebake: which facets catch a bright strip changes with this, which
   * is the whole point of scintillation on a turntable.
   */
  diamondEnvironmentRotation: number;
  /**
   * Multiplies the sampled diamond environment. A live shader uniform (see
   * `diamondEnvIntensity.ts`), never a rebake — separate from
   * `environmentIntensity` because that one drives the metal's room, and the
   * refraction shader reads nothing the metal reads.
   */
  diamondEnvironmentIntensity: number;
  /**
   * Lets stones reflect the actual scene — the metal setting and any other
   * stones — in addition to the baked studio backdrop, via a CubeCamera
   * capture (see `DiamondSceneCapture.tsx`). Off falls back to the pure
   * static bake, which is cheaper and was the whole render until this existed.
   */
  diamondDynamicReflections: boolean;
  /**
   * Overall brightness, applied by the renderer's tone mapping.
   *
   * The only level left here. Individual light intensities moved to `lights.ts`
   * when the rig became a list, and the ground shadow moved to `shadows.ts`
   * when it gained a real shadow camera — the fields for both stayed behind for
   * a while, driving nothing, which meant four sliders in the panel that moved
   * and changed no pixel. Deleted rather than deprecated, so that cannot recur.
   */
  exposure: number;
}

/**
 * The photographic combination, not the legacy one — except `environment`.
 *
 * `separateGemEnvironment` used to be off specifically so this file could
 * never be the thing that changed a signed-off render. That reasoning stopped
 * holding once the problem was the default itself: a first look — a dealer's
 * demo — is the default, not a preset someone has to already know to reach.
 * On, it is what lets a diamond throw real fire instead of sitting there as a
 * sparkle-free grey dot.
 *
 * `environment` was tried at "studio" for the same reason and reverted: at
 * this product's `envMapIntensity` (materials.ts boosts it well past 1 for
 * the polished/lacquered look), drei's studio HDRI has near-black gaps
 * between its panels that a chain's concave link interiors and a pavé
 * bezel's facets catch directly — every link went from warm gold to gold
 * with a black crescent punched into it. That reads as a lighting bug, which
 * is worse than the problem this whole change exists to fix. Warehouse does
 * not have that failure mode and is what the original look was built on, so
 * it stays.
 *
 * `environmentRotation` and `environmentIntensity` are the untouched original
 * values — rotating or dimming the room is a per-piece framing choice, not
 * part of "does this look photographed at all".
 */
export const DEFAULT_LIGHTING: LightingSettings = {
  environment: "warehouse",
  separateGemEnvironment: true,
  // The tent proved the concept; the Diamond Studio family below is the
  // tuned successor. That earlier soft-studio-over-diamond-studio call was
  // made while the dynamic reflection capture (below) was still reflecting
  // the metal's true gold colour into every stone — against that wash,
  // diamond-studio's tighter feather and hotter panels read as busier and
  // more fragmented than the target. With the capture now colour-neutral
  // (see `neutralized` in diamondSceneCapture.ts), that wash is gone and the
  // comparison changes: high-contrast's darker facet floor is what actually
  // matches the market reference's black/white checkering — Phase 18 tested
  // all five side by side against it. Tent stays as a legacy/debug option.
  gemEnvironment: "diamond-studio-crisp",
  // Zero and one: the environment exactly as it was before these existed.
  environmentRotation: 0,
  environmentIntensity: 1,
  exposure: 1.4,
  diamondEnvironmentRotation: 0,
  // Recommended starting point for the new uniform — see diamondEnvIntensity.ts.
  diamondEnvironmentIntensity: 1.2,
  /*
   * On by default as of the Phase 7 lifecycle pass — see
   * docs/diamond-calibration/FINAL_REPORT.md's Phase 7 addendum for the full
   * before/after. It used to be off because enabling it guaranteed a SECOND
   * full material rebuild shortly after the first on every load: the capture
   * resolves one effect-tick after the initial static-env materials are
   * already built, so envMap changes shape (equirect -> cube) and every
   * stone recompiles again, and that back-to-back compile burst had taken
   * down the WebGL context before. The actual root cause turned out to be
   * upstream of the diamond shader entirely — a theme-flash-prevention
   * script setting `data-theme` before hydration, which is now marked with
   * `suppressHydrationWarning` on `<html>` in `__root.tsx` instead of
   * silently forcing React to discard and rebuild the whole client tree —
   * plus two smaller, still-worthwhile coalescing fixes (`useStableRecord`,
   * and this file's own material rebuild debounce in `GemRefraction.tsx`).
   * 20/20 fresh loads now survive with this on; see the report for the full
   * methodology.
   */
  diamondDynamicReflections: true,
};

/* ────────────────────────────────────────────────────────────────────────────
 * The light tent
 *
 * A diamond is a picture of whatever its rays land on, so pointing it at a
 * warehouse renders brown brick. This is the room a jeweller actually shoots
 * in: large white panels above and to the sides, a reflector below, dark gaps
 * between them. The gaps matter as much as the panels — a facet that sees a gap
 * goes dark, one that sees a panel goes white, and that alternation across the
 * crown is what reads as a diamond.
 *
 * Built by hand rather than rendered, for a specific reason: drei's refraction
 * shader samples with `equirectUv(rayDirection)`, so it wants a plain
 * equirectangular map. Baking the tent with PMREMGenerator produces a CubeUV
 * atlas instead, every ray lands in an arbitrary texel of a packed mip grid,
 * and the stones vanish. PMREM is for prefiltering rough reflections anyway;
 * a diamond is perfectly specular and needs none of it.
 * ──────────────────────────────────────────────────────────────────────────── */

interface Panel {
  size: [number, number];
  position: [number, number, number];
  /** Above 1 is brighter than white — the map is half-float, so it holds. */
  intensity: number;
}

/** Distance of the tent walls. A direction map records angle only, so it scales away. */
const R = 10;

/**
 * Deterministic PRNG (mulberry32) — a procedural studio needs many panels
 * with organic size/intensity variation, but the bake must stay
 * byte-reproducible across restarts (this session's whole verification
 * discipline depends on it), so `Math.random()` is not an option.
 */
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A dense procedural array of small softbox-style panels spread across the
 * hemisphere, standing in for what a real gemstone photography studio
 * actually looks like — dozens to hundreds of small diffusion panels, not a
 * handful of hand-placed rectangles.
 *
 * Why this exists: the original ~14-panel `PANELS` array (plus this
 * session's own hand-aimed additions in `CRISP_PANELS`) was diagnosed as a
 * structural ceiling, not a tuning problem. A brilliant-cut stone has
 * 60-90 real facet planes (measured directly — see the facet-count check
 * elsewhere in this session's history), each with its own unique normal.
 * For each of those 60-90 facets to read as a genuinely distinct tone, the
 * environment they sample needs comparable RICHNESS — many different
 * directions carrying many different values. A smooth 1-D shell plus a
 * dozen large rectangles cannot supply that: many facets necessarily land
 * on the same shell plateau or miss every panel and fall back to the same
 * shell value, which is what read as "flat, CGI, edges blend together" no
 * matter how the shell curve or panel feather were tuned afterward.
 *
 * Points are laid out with a Fibonacci sphere (even angular coverage, no
 * clustering) restricted to a hemisphere-ish band biased toward "above and
 * in front of the stone", matching how a real gem-photography lightbox is
 * built (mostly overhead/frontal diffusion, some rear rim light, nothing
 * from directly below). Size and intensity are randomized per panel within
 * a range wide enough to avoid a mechanical, perfectly-regular grid — real
 * softbox arrays aren't perfectly uniform either.
 *
 * Intensity range tuned empirically, in the actual running app, against
 * the same 8-bit luminance-bucket readout used throughout this session
 * (dark <90, medium 90-180, light-gray 180-225, brightish 225-245, flash
 * 245-255, all over the diamond's sampled oval). The first version
 * (2.5-11.5 per panel) put ~80% of the stone in brightish+flash combined —
 * more real light SOURCES than the old sparse array, but still converging
 * almost everywhere to a narrow near-ceiling band, the same "flat" failure
 * mode in a new shape. Lowering intensity alone (down to 0.5-3) barely
 * moved that combined figure — it just reshuffled how much sat in
 * "brightish" vs "flash", not whether the STONE overall skewed bright.
 * Tuning the post-panel knee (threshold, strength) similarly barely moved
 * it: everything downstream of the panels was already saturating a wide
 * band of ACES's own flat, high-input region, so pre-ACES knee tuning had
 * little left to work with. The lever that actually worked was here —
 * this range — combined with cutting the CRISP_PANELS-wide intensity
 * multiplier (see the config below) roughly in third: together they pulled
 * enough of the mass down that light-gray grew from ~5% to 25% and
 * brightish dropped from ~80% to 56%, which is what finally read as
 * genuinely varied/faceted in the actual screenshot instead of a bright
 * mass with texture only at its edges.
 *
 * Lowered again, 0.5-3 -> 0.3-1.8, in a later "too plain white" pass —
 * see `diamondOptics.ts`'s `envResponseExponent` doc for the full
 * before/after numbers and the other half of this same fix (that
 * exponent, and the shell floor below, both moved together with this).
 *
 * A ~12% "standout" boost was added after that same pass, once the stone
 * read as correctly gray-dominant but with "sparkling white still
 * missing" — a separate, disjoint bright population (`buildSparkleArray`,
 * intensity 15-30 against this array's 0.3-1.8) was tried once already
 * for a similar complaint and reverted: a full order-of-magnitude jump
 * with nothing in between read as an artificial, pasted-on highlight
 * rather than a real one. This time the boost is folded into the SAME
 * distribution instead of a second population — ~12% of panels roll an
 * extended range (0.3-6.0, a ~3.3x ceiling increase, not ~17x) rather
 * than a hard-separated population. Measured result: flash-white grew
 * (8.6% -> 12.1%) while genuine medium gray also grew (18.8% -> 23.1%)
 * and the generic "brightish" middle shrank (34.1% -> 27.4%) — fewer
 * facets sitting in a same-toned mush, more landing at either a real gray
 * or a real, distinct flash. Confirmed in the actual screenshot: several
 * facets visibly pop without reading as pasted on, at both camera
 * angles. Darkest pixel and fire prevalence both stayed within the
 * ranges already established as safe.
 */
function buildStudioArray(count: number, seed: number): Panel[] {
  const rng = mulberry32(seed);
  const panels: Panel[] = [];
  for (let i = 0; i < count; i++) {
    // y from 1 (straight up) down to -0.5 (a bit below the horizon, but
    // never straight down, where the dedicated bounce card already lives).
    const y = 1 - (i / (count - 1)) * 1.5;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = Math.PI * (3 - Math.sqrt(5)) * i;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    const len = Math.hypot(x, y, z) || 1;
    const size = 2.5 + rng() * 3.5;
    // ~12% of panels get a genuine standout boost (up to ~4x the normal
    // ceiling) instead of a separate, disjoint "sparkle" population — see
    // this function's own doc for why a disjoint population (tried once,
    // reverted) read as artificial. Sampling the boost roll BEFORE the
    // base intensity roll keeps every other panel's own value identical
    // to what it would have been without this mechanism, so the boost is
    // additive, not a redraw of the whole distribution.
    const isStandout = rng() < 0.12;
    const intensity = isStandout ? 0.3 + rng() * 5.7 : 0.3 + rng() * 1.5;
    panels.push({
      size: [size, size],
      position: [(x / len) * R, (y / len) * R, (z / len) * R],
      intensity,
    });
  }
  return panels;
}

const PANELS: Panel[] = [
  // Key: overhead softbox, slightly forward.
  { size: [16, 16], position: [0, R, 2], intensity: 7 },
  // Front pair — the big white flashes the crown throws back at the camera.
  { size: [10, 14], position: [-R * 0.85, R * 0.5, R * 0.5], intensity: 4.5 },
  { size: [10, 14], position: [R * 0.85, R * 0.5, R * 0.5], intensity: 4.5 },
  // Rear rim pair. Light entering from behind leaves through the crown after
  // bouncing off the pavilion — this is where the fire comes from.
  { size: [9, 9], position: [-R * 0.7, R * 0.2, -R * 0.8], intensity: 3 },
  { size: [9, 9], position: [R * 0.7, R * 0.2, -R * 0.8], intensity: 3 },
  // Bounce card below, as on a real bench. Weak: a bright floor fills the
  // pavilion and flattens it.
  { size: [12, 12], position: [0, -R * 0.9, 1], intensity: 1.1 },
  // Small hard sources. A broad panel cannot make a pinpoint; these are the
  // individual sparkles that catch as the piece turns.
  { size: [1.6, 1.6], position: [-R * 0.35, R * 0.75, R * 0.6], intensity: 26 },
  { size: [1.4, 1.4], position: [R * 0.5, R * 0.6, R * 0.55], intensity: 22 },
  { size: [1.2, 1.2], position: [R * 0.25, -R * 0.3, R * 0.85], intensity: 14 },
  { size: [1.2, 1.2], position: [-R * 0.6, R * 0.1, -R * 0.6], intensity: 16 },
];

/**
 * The tent fabric behind the panels, as linear radiance by elevation.
 *
 * `t` runs 0 straight up to 1 straight down. The floor is dark grey and never
 * black: measured over 200k directions, a black floor put 10.3% of them below
 * 90/255 once tone-mapped, and a facet at 65 beside one at 254 reads as a hole.
 * These values leave nothing below 90 while the bright half is untouched.
 */
const SHELL_STOPS: [number, number][] = [
  [0, 1.0],
  [0.34, 0.82],
  [0.52, 0.3],
  [0.68, 0.22],
  [1, 0.12],
];

const SHELL_GAIN = 0.85;

/** Generalized so every Diamond Studio variant shares this rather than a copy each. */
function shellRadiance(y: number, stops: [number, number][], gain: number): number {
  const t = Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI;
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, v0] = stops[i];
    const [t1, v1] = stops[i + 1];
    if (t >= t0 && t <= t1) {
      const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      return (v0 + (v1 - v0) * k) * gain;
    }
  }
  return stops[stops.length - 1][1] * gain;
}

/**
 * A panel resolved to a plane and its in-plane axes.
 *
 * Every field is scalar. The bake tests about five million rays, and returning
 * `[x, y, z]` tuples from vector helpers allocated an array per test — most of
 * the bake time, which matters when it runs on a phone during load.
 */
interface Frame {
  nx: number;
  ny: number;
  nz: number;
  d: number;
  px: number;
  py: number;
  pz: number;
  ux: number;
  uy: number;
  uz: number;
  vx: number;
  vy: number;
  vz: number;
  intensity: number;
}

/** Generalized so every Diamond Studio variant resolves its own panel layout the same way. */
function buildFrames(panels: Panel[]): Frame[] {
  return panels.map((panel) => {
    const [px, py, pz] = panel.position;
    const len = Math.hypot(px, py, pz);
    const nx = px / len;
    const ny = py / len;
    const nz = pz / len;

    // up x normal; degenerate only directly overhead, where any axis will do.
    let ax = -nz;
    let az = nx;
    const axLen = Math.hypot(ax, az);
    if (axLen < 1e-6) {
      ax = 1;
      az = 0;
    } else {
      ax /= axLen;
      az /= axLen;
    }

    const bx = ny * az;
    const by = nz * ax - nx * az;
    const bz = -ny * ax;

    const hw = panel.size[0] / 2;
    const hh = panel.size[1] / 2;
    return {
      nx,
      ny,
      nz,
      d: px * nx + py * ny + pz * nz,
      px,
      py,
      pz,
      ux: ax / hw,
      uy: 0,
      uz: az / hw,
      vx: bx / hh,
      vy: by / hh,
      vz: bz / hh,
      intensity: panel.intensity,
    };
  });
}

const FRAMES: Frame[] = buildFrames(PANELS);

/** Softens panel edges, so a hotspot is not a hard-aliased rectangle. */
const FEATHER = 0.12;

/**
 * What a ray leaving the stone lands on, as linear radiance.
 *
 * Generalized so every Diamond Studio variant shares one raycaster instead of
 * a copy each — `frames`, `shellStops`/`shellGain` and `feather` are what a
 * config below actually varies.
 */
/*
 * `spokeCount`/`spokeStrength` (default 0 — exact no-op, every existing
 * preset is bit-for-bit unaffected): `shellRadiance` depends on elevation
 * (`y`) alone, so the shell background is perfectly rotationally symmetric
 * — two directions at the same elevation but different compass heading get
 * an IDENTICAL shell value. Since the shell (not the handful of small
 * panels) is what most sampled directions actually land on, that makes the
 * shell's own elevation falloff the dominant large-scale pattern: a smooth
 * top-to-bottom gradient, not the radial, alternating wedge-of-bright/
 * wedge-of-dark pattern a real brilliant-cut photograph shows. This
 * modulates the shell (only the shell — panels are already azimuthally
 * varied by their own placement) by a cosine wave in azimuth, so the
 * background itself alternates as you sweep around the stone instead of
 * only as you sweep up and down it.
 */
function studioRadiance(
  dx: number,
  dy: number,
  dz: number,
  frames: Frame[],
  shellStops: [number, number][],
  shellGain: number,
  feather: number,
  spokeCount = 0,
  spokeStrength = 0,
): number {
  let nearest = Infinity;
  let weight = 0;
  let intensity = 0;

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const facing = dx * f.nx + dy * f.ny + dz * f.nz;
    if (facing > -1e-9 && facing < 1e-9) continue;
    const t = f.d / facing;
    if (t <= 1e-6 || t >= nearest) continue;

    const rx = dx * t - f.px;
    const ry = dy * t - f.py;
    const rz = dz * t - f.pz;
    const u = Math.abs(rx * f.ux + ry * f.uy + rz * f.uz);
    const v = Math.abs(rx * f.vx + ry * f.vy + rz * f.vz);
    const edge = u > v ? u : v;
    if (edge >= 1) continue;

    nearest = t;
    weight = edge <= 1 - feather ? 1 : (1 - edge) / feather;
    intensity = f.intensity;
  }

  let shell = shellRadiance(dy, shellStops, shellGain);
  if (spokeStrength > 0) {
    const azimuth = Math.atan2(dz, dx);
    shell *= Math.max(0, 1 + spokeStrength * Math.cos(azimuth * spokeCount));
  }
  return shell * (1 - weight) + intensity * weight;
}

/**
 * The tent, unchanged from before this file grew the Diamond Studio variants
 * below. Exported for measurement — see `scripts/test-lighting.mjs`.
 */
export function tentRadiance(dx: number, dy: number, dz: number): number {
  return studioRadiance(dx, dy, dz, FRAMES, SHELL_STOPS, SHELL_GAIN, FEATHER);
}

/*
 * Map size. Both powers of two so mipmaps generate, and small enough that the
 * whole thing is about a megabyte — this is built on the client, including on
 * the phones that are most of the traffic. One texel spans about 0.7 degrees,
 * so even the small hard sources are a dozen texels across.
 */
const WIDTH = 512;
const HEIGHT = 256;
/** Samples per texel per axis. Panels have hard edges; this stops them stepping. */
const SUPERSAMPLE = 2;

/**
 * Bakes a studio config into an equirectangular half-float map.
 *
 * Half-float rather than float: WebGL2 filters half-float natively, while
 * linear filtering of full float needs an extension not every phone has. It
 * also holds values far above 1, which is the point — a highlight clamped to
 * white tone-maps to flat grey instead of a spark.
 *
 * Generalized from the tent's own bake so every Diamond Studio variant shares
 * it rather than a copy each; `createLightTent` below is now a one-line call
 * into this with the tent's own unchanged frames/shell/feather.
 */
function bakeStudioTexture(
  frames: Frame[],
  shellStops: [number, number][],
  shellGain: number,
  feather: number,
  spokeCount = 0,
  spokeStrength = 0,
  coolShadowTint = 0,
): THREE.Texture {
  const data = new Uint16Array(WIDTH * HEIGHT * 4);
  const step = 1 / SUPERSAMPLE;
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  /*
   * Inverse of the shader's `equirectUv`:
   *   u = atan2(z, x) / 2pi + 0.5
   *   v = asin(y) / pi + 0.5
   * DataTexture is not flipped, so row 0 is v = 0 — straight down.
   *
   * Latitude depends only on the row and longitude only on the column, so both
   * are tabulated once per line. Evaluating them per sample meant six million
   * sin/cos calls, which was nearly the whole cost of the bake.
   */
  const sinLat = new Float64Array(HEIGHT * SUPERSAMPLE);
  const cosLat = new Float64Array(HEIGHT * SUPERSAMPLE);
  for (let y = 0; y < HEIGHT; y++) {
    for (let s = 0; s < SUPERSAMPLE; s++) {
      const lat = ((y + (s + 0.5) * step) / HEIGHT - 0.5) * Math.PI;
      sinLat[y * SUPERSAMPLE + s] = Math.sin(lat);
      cosLat[y * SUPERSAMPLE + s] = Math.cos(lat);
    }
  }

  const sinLon = new Float64Array(WIDTH * SUPERSAMPLE);
  const cosLon = new Float64Array(WIDTH * SUPERSAMPLE);
  for (let x = 0; x < WIDTH; x++) {
    for (let s = 0; s < SUPERSAMPLE; s++) {
      const lon = ((x + (s + 0.5) * step) / WIDTH - 0.5) * Math.PI * 2;
      sinLon[x * SUPERSAMPLE + s] = Math.sin(lon);
      cosLon[x * SUPERSAMPLE + s] = Math.cos(lon);
    }
  }

  const alpha = THREE.DataUtils.toHalfFloat(1);

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let total = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        const ky = y * SUPERSAMPLE + sy;
        const sLat = sinLat[ky];
        const cLat = cosLat[ky];
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const kx = x * SUPERSAMPLE + sx;
          total += studioRadiance(
            cosLon[kx] * cLat,
            sLat,
            sinLon[kx] * cLat,
            frames,
            shellStops,
            shellGain,
            feather,
            spokeCount,
            spokeStrength,
          );
        }
      }

      const raw = total / samples;
      const i = (y * WIDTH + x) * 4;
      if (coolShadowTint > 0) {
        /*
         * A small, deliberate cool tint in the DARK end only — real
         * diamond photography almost always shows a blue-slate cast in
         * shadow facets (a cool shadow reads as icy/premium; a neutral or
         * warm one reads as flat), confirmed directly against a reference
         * renderer's actual output. `coolFactor` fades to exactly 0 at
         * raw >= 1 (the shell's own values top out well below 1; only
         * panel-lit, bright directions ever reach 1+), so this can only
         * ever affect the dark/shell-dominated population — bright,
         * panel-lit facets stay exactly neutral, and the stone's genuine
         * body colour (applied separately, per-stone, downstream) is
         * untouched. Default 0 — every OTHER preset (including this same
         * function's "tent" caller) stays bit-for-bit neutral.
         */
        const coolFactor = Math.max(0, Math.min(1, 1 - raw));
        const r = raw * (1 - coolFactor * coolShadowTint);
        const g = raw * (1 - coolFactor * coolShadowTint * 0.3);
        const b = raw * (1 + coolFactor * coolShadowTint * 0.55);
        data[i] = THREE.DataUtils.toHalfFloat(r);
        data[i + 1] = THREE.DataUtils.toHalfFloat(g);
        data[i + 2] = THREE.DataUtils.toHalfFloat(b);
      } else {
        // Neutral: a diamond takes its colour from the stone, never the tent.
        const value = THREE.DataUtils.toHalfFloat(raw);
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
      }
      data[i + 3] = alpha;
    }
  }

  const texture = new THREE.DataTexture(data, WIDTH, HEIGHT, THREE.RGBAFormat, THREE.HalfFloatType);
  // Equirect, matching what the refraction shader's non-cube branch expects.
  texture.mapping = THREE.EquirectangularReflectionMapping;
  // Already linear radiance, so no colour-space conversion.
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping; // longitude wraps
  texture.wrapT = THREE.ClampToEdgeWrapping; // latitude does not
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function createLightTent(): THREE.Texture {
  return bakeStudioTexture(FRAMES, SHELL_STOPS, SHELL_GAIN, FEATHER);
}

let cached: THREE.Texture | null = null;

/**
 * The tent, baked once for the life of the page.
 *
 * It depends on nothing, so re-baking per model would repeat a quarter-second
 * of arithmetic on every upload, on the phones that are most of the traffic.
 * Never disposed, precisely because a later model would then be handed a dead
 * texture.
 */
export function getLightTent(): THREE.Texture {
  if (!cached) cached = createLightTent();
  return cached;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Diamond Studio
 *
 * The tent proved the idea — small bright sources against dark gaps, because
 * that alternation across the crown is what reads as a diamond. These are the
 * tuned successors built for the premium diamond render pass: more and
 * brighter panels, tighter feathering, for sharper facet contrast than the
 * tent's original gentler bake — plus three deliberately different-character
 * variants (soft, luxury, dark) rather than one look with a knob.
 *
 * First pass, not signed off: derived from the tent's own proven panel
 * layout and its "never below 90/255 on screen" shell floor rather than
 * invented from nothing, but nobody has looked at these against the actual
 * reference renders yet. Expect to retune the numbers, not the architecture.
 * ──────────────────────────────────────────────────────────────────────────── */

function scalePanels(panels: Panel[], factor: number): Panel[] {
  return panels.map((p) => ({ ...p, intensity: p.intensity * factor }));
}

/*
 * `PANELS` plus extra small pinpoint sources, scoped to `diamond-studio-crisp`
 * only (every other preset still builds from `PANELS` alone) — an attempt to
 * break up a large connected dark facet mass by adding more discrete,
 * concentrated light sources for facets to catch directly, rather than the
 * shell's smooth azimuthal modulation (`spokeCount`/`spokeStrength`), which
 * was tried first and found unable to reliably target a specific screen
 * region: because a ray exits after up to `bounces` internal reflections, a
 * screen-space facet's actual sampled world-space azimuth does not map
 * predictably to its screen position, so tuning the modulation's period
 * mostly redistributes darkness elsewhere rather than breaking up the
 * intended region. Positioned to fill in azimuth/elevation combinations the
 * four existing pinpoint sources do not cover.
 */
/*
 * Superseded an entire history of hand-aimed panels (four of them, each
 * individually measured-and-verified via a HALF_FLOAT debug readback of a
 * specific dark region's actual exit-ray direction) with the procedural
 * `buildStudioArray` above. The hand-aimed approach genuinely worked, one
 * region at a time — but it does not scale: after four rounds it had only
 * covered a handful of the diamond's 60-90 real facets, each fix required
 * its own bespoke diagnostic session (including discovering that a panel
 * near a CubeCamera face seam needs ~8x the intensity of one that isn't),
 * and the aggregate result still read as "CGI" because most of the stone
 * was still sampling just the shell's smooth 1-D gradient. A dense
 * procedural array gives every facet a real chance at a distinct value
 * without hand-aiming each one individually. The bounce-card floor and rim
 * pair from the base `PANELS` are kept underneath it for the low, broad
 * fill they were built for.
 *
 * Count raised 80 -> 150 alongside `feather`'s own reduction (see that
 * field's doc in `diamond-studio-crisp` for the mechanism) — a narrower
 * feather makes each panel more like a flat block again, so more panels
 * are needed to keep the coverage a lower feather alone would shrink.
 * More panels also directly targets what the feather change was reaching
 * for: fewer facets falling through to shell-only sampling, which is what
 * was producing an internal, "milky" gradient within an otherwise-flat
 * facet. Re-balances overall brightness up somewhat (mean 203 -> 212) as
 * a side effect of the added coverage — checked and still within the
 * safe range (darkest pixel 28/255, 0% below 20/255).
 */
const CRISP_PANELS: Panel[] = [
  ...PANELS,
  ...buildStudioArray(150, 918273645),
  // The one remaining visually-dominant dark mass (a connected triangular
  // region at the stone's visual centre, per the user's own screenshot
  // comparison) was measured directly: resultant length 0.97 (tight) at
  // direction ~(-0.10, -0.45, -0.89) — nearly IDENTICAL to a neighbouring
  // BRIGHT region's own direction (-0.14, -0.46, -0.88). This is not a
  // coverage gap the way earlier dark-mass fixes were; it's a facet
  // sitting just outside an existing nearby panel's edge, made sharper by
  // this session's own narrower `feather` (0.3). One small aimed panel to
  // fill that specific gap, not another broad wash. Started at size 5,
  // intensity 4 (matching the base array's own scale) — essentially zero
  // effect (dark90 7.90% -> 7.88%, noise). Consistent with this session's
  // recurring finding that a panel needing to compete with the CubeCamera
  // capture's low resolution and the existing nearest-panel-wins hit test
  // often needs far more size/intensity than a naive "match nearby panels"
  // guess. Raised in two steps — 9/25 (dark90 -> 6.49%, one facet visibly
  // lit) then 14/30 (dark90 -> 1.75%, the mass visibly broke into several
  // separated bright/dark pieces instead of one connected block) — with
  // the actual screenshot judged at each step, not the numbers alone.
  // Darkest pixel stayed safe (35.5/255, 0% below 20/255) and fire
  // unchanged (2.29% -> 2.04%) throughout. Confirmed at a second camera
  // angle and gold/pave pixel-identical.
  { size: [14, 14], position: [-R * 0.1, -R * 0.45, -R * 0.89], intensity: 18 },
];
/*
 * Tried and reverted: `buildSparkleArray` (14 extra panels at intensity
 * 15-30, a full order of magnitude above the base array's 0.5-3). It did
 * what it was built to do — pushed the true bright-white population from
 * 0.05% to 4.22% — but the user's own reaction to the actual screenshot
 * was that it read as artificial again, right after the base
 * `buildStudioArray` rebuild had genuinely convinced them otherwise. The
 * likely cause: a hard order-of-magnitude jump between "moderate" and
 * "very bright" with nothing in between is not how a real studio's light
 * sources are actually distributed (real ones have a continuum — dim
 * fill, medium accents, a few hot ones) — and that kind of discontinuity
 * is exactly the sort of thing a human eye flags as computed rather than
 * photographed, even without consciously identifying why. Reverted rather
 * than tuned down, on the reasoning that the mechanism itself (a separate
 * bolted-on brighter layer) was the problem, not just its magnitude — a
 * future attempt at sparkle should extend `buildStudioArray`'s own
 * intensity distribution to a graduated tail instead of adding a second,
 * disjoint population.
 */

interface StudioConfig {
  frames: Frame[];
  shellStops: [number, number][];
  shellGain: number;
  feather: number;
  /** See `studioRadiance`'s own doc — both default to 0 (no azimuthal effect) when omitted. */
  spokeCount?: number;
  spokeStrength?: number;
  /** See `bakeStudioTexture`'s own doc — defaults to 0 (bit-for-bit neutral) when omitted. */
  coolShadowTint?: number;
}

/*
 * Every config below was checked with `.tmp-jewelry/check-diamond-studio.mjs`
 * (built from `tentRadiance`'s own screen-space method in
 * `scripts/test-lighting.mjs`, at this product's actual exposure × the new
 * diamond-environment-intensity default of 1.2) rather than picked purely by
 * feel — ACES' shoulder compresses contrast at high input levels, so a
 * config that reads as good spread in raw linear values can still wash out to
 * near-uniform white on screen once tone-mapped. Nothing here goes below
 * 90/255 — see the tent's own SHELL_STOPS comment for why that floor matters
 * — but each is otherwise tuned toward its own name rather than sharing one
 * shell.
 */
/*
 * "diamond-studio-crisp" answers a different question than any of the
 * configs below. Every one of them tunes WHERE the shell's brightness sits
 * at each elevation; none of them touch HOW it gets there between those
 * points — `shellRadiance` always linearly interpolates across the full gap
 * between two stops, and every panel blends across `feather` (5% of its
 * half-width, even in `high-contrast`) before reaching full intensity.
 *
 * A prior investigation (this file's own diamond-optics tuning history)
 * found a genuine, single-pixel-resolution smooth gradient across one flat
 * facet in the shipped render — not a shader bug, but a real consequence of
 * a perspective ray sweeping across a facet sampling a *continuously
 * varying* point of this environment. Every shader-side fix attempted since
 * worked on a value that was already smooth by the time it reached the
 * shader; none touched the one place upstream where that smoothness
 * actually originates: this bake. This config does.
 */
const DIAMOND_STUDIO_CONFIGS: Record<string, StudioConfig> = {
  // Reuses high-contrast's own shell/panel SHAPE — same 5 elevation stops,
  // same relative panel layout — with two changes: a 2%-wide transition
  // ramp at each shell boundary instead of the full 14-34% gap (a flat
  // plateau in between, not a gradual ramp across the whole gap), and
  // panels scaled 2.6x / a lower shell floor (0.055 vs 0.12) for more
  // overall contrast headroom to work with once the transitions are sharp.
  //
  // Chosen by rendering the real running app and comparing against
  // `market-reference.png` at each step, not by formula — a 2%→8% width
  // sweep, then a panel-scale/floor sweep at 2%, checked at every step
  // against: (a) a full raw-texel scan of this exact bake for genuine
  // neutrality (0 non-neutral texels out of 131,072 — this data is
  // colourless, full stop), (b) HALF_FLOAT/8-bit readback at 6 known
  // facets confirming R≈G≈B and the correct bright>mid>dark ordering
  // preserved, (c) a darkest-pixel scan of the rendered image, and (d) a
  // second, independent camera angle.
  //
  // An apparent colour artifact was measured during development at the
  // very first (2%-width, unscaled) attempt and initially misdiagnosed as
  // dispersion amplification. It wasn't: this id was missing from
  // `ENVIRONMENTS`, so `environmentById` (which `Model.tsx` actually
  // resolves `gemChoice` against) was silently falling back to
  // `ENVIRONMENTS[0]`, a real photographed warehouse HDRI — the "colour"
  // was that HDRI's own real content, never this shell. Fixed by adding
  // the matching `ENVIRONMENTS` entry above.
  //
  // A follow-up pass then pushed panel scale to 2.6/3.0 and the floor down
  // to 0.045-0.055 (documented in an earlier revision of this comment) —
  // that produced real, measured facet separation but read as too
  // graphic/high-contrast: the darkest facets became near-black
  // triangles, and the shell's own bright stops (1.0/0.5, untouched at
  // that point) still left a broad, nearly uniform white response across
  // the crown. Two changes fixed both at once, informed by an important
  // fact confirmed via HALF_FLOAT readback: the brightest few facets (a
  // stone's real specular highlights) sample the small HARD PANELS
  // directly and were already pinned at 244-245/255 regardless of any
  // panel-scale change tried — ACES's shoulder is flat enough there that
  // no reasonable peak adjustment moves them. The broad white area is a
  // SEPARATE population — facets sampling the shell's own bright zone, not
  // a panel directly — so it responds to the shell's top values, not panel
  // scale. Fix: (1) raised the shell's dark-end stops back up (0.156 /
  // 0.108 / 0.066, roughly +20% over the pushed values, still meaningfully
  // below `high-contrast`'s own 0.202/0.158/0.12) so the darkest facets
  // read as dark crystalline planes, not black holes — confirmed darkest
  // pixel 70/255, 0 pixels below 40/255; (2) lowered the shell's own top
  // stops (1.0→0.85, 0.5→0.4, previously untouched) so the SHELL-driven
  // "broad white" population is measurably dimmer (a known medium facet
  // dropped 234→230, a known edge facet 145→137) while the PANEL-driven
  // hottest highlights are untouched by construction (B1/B2 stayed at
  // 244/245 through every candidate in this pass) — brilliance stays
  // concentrated at genuine facet highlights instead of smeared across the
  // whole crown. Bright>mid>dark ordering re-verified preserved throughout.
  "diamond-studio-crisp": {
    // Lowered 2.21 -> 0.8 alongside `buildStudioArray`'s own intensity
    // range — see that function's doc for the full before/after numbers.
    // 2.21 was calibrated for the OLD ~14-panel array (a handful of large,
    // hand-placed sources needing real punch to read at all); with ~80
    // procedural panels now covering the hemisphere, the combined light
    // reaching any given facet is far higher by default, so the same
    // per-panel scale that once looked right now saturates the whole
    // stone. 0.8 is not a universal constant — it is calibrated
    // specifically to this panel count/intensity range and would need
    // re-tuning again if either changes materially.
    frames: buildFrames(scalePanels(CRISP_PANELS, 0.8)),
    // Replaced a FLAT-PLATEAU stop list (few distinct values, each held flat
    // across a wide elevation range, e.g. 0.85 unchanged for the top 32%)
    // with a continuously varying gradient (no two adjacent stops share a
    // value). The plateau version was a direct, measured cause of a
    // "looks CGI, facet edges blend together" complaint: dozens of
    // genuinely different facets sampling elevations within the same flat
    // band got BIT-IDENTICAL shell brightness, so their shared edges had
    // zero tonal contrast even though the geometry itself was correctly
    // faceted. This first gradient version (top value still 0.85) measured
    // a real but modest gain (light-gray population 7.5% -> 13.35%). The
    // top value was then lowered further, 0.85 -> 0.55, after the SAME
    // complaint persisted at full scale in the actual screenshot — the
    // shell was still bright enough by default that "background" and
    // "highlight" barely read as different. Lowering it further, to 0.4,
    // was tried and reverted: light-gray dropped instead of rising (a too-
    // steep drop skips past the light-gray band into medium/dark directly),
    // so 0.55 stands as the better balance. See the `feather` comment right
    // below for the other, larger half of this same fix, and
    // `diamondOptics.ts`'s `kneeStrength` doc for a related, earlier pass.
    //
    // Bottom four stops raised again (0.2/0.18/0.16/0.15 -> 0.24/0.23/
    // 0.22/0.22) after `envResponseExponent` went 1.2 -> 1.8 to match a
    // user-supplied reference (see that field's own doc). Raising the
    // exponent doesn't just widen separation for facets that catch real
    // panel light — it also crushes the shell's OWN floor further, since
    // pow(x, 1.8) shrinks a small x more than pow(x, 1.2) does (0.15^1.8 is
    // roughly a third of 0.15^1.2). A facet unlucky enough, on some
    // rotation, to catch no panel at all and fall back to the shell's
    // lowest band was landing near pure black (measured darkest pixel:
    // 20/255 even at the STANDARD camera angle, not just a rare rotation)
    // — read by the user as "ugly," not "real dark facet." This is the
    // same "some facets are legitimately unlit, but must never go all the
    // way to zero" problem this shell has carried since its very first
    // version; the fix is the same kind — raise the floor specifically,
    // leave the rest of the curve (and the exponent that made the real
    // contrast gain) alone. Kept the small remaining slope (0.24 -> 0.22)
    // rather than a hard flat floor, per this file's own established
    // lesson that flat plateaus are themselves a source of "facets read
    // identical" complaints.
    //
    // Raised again (mid/bottom stops ~0.32-0.4 -> ~0.36-0.4) alongside
    // `envResponseExponent`'s next jump, 1.8 -> 2.5 (see that field's own
    // doc in `diamondOptics.ts` for the "too plain white" complaint this
    // was answering) — same mechanism as the paragraph above: a higher
    // exponent crushes the floor further (darkest pixel measured at
    // 4.9/255, 1.18% of the stone below 20/255, before this raise).
    // Raised in three small steps, checking the actual darkest pixel each
    // time, until it cleared 20/255 (21.7/255, 0% below 20/255) rather
    // than guessing one large jump.
    shellStops: [
      [0, 0.55],
      [0.15, 0.5],
      [0.3, 0.44],
      [0.42, 0.4],
      [0.5, 0.38],
      [0.58, 0.36],
      [0.66, 0.36],
      [0.74, 0.37],
      [0.82, 0.365],
      [0.9, 0.36],
      [1, 0.36],
    ],
    shellGain: 0.85,
    // Raised 0.015 -> 0.6 — the single biggest fix in this pass. `feather`
    // controls how a PANEL's own intensity falls off across its own
    // footprint (`studioRadiance`'s `weight` calc): at 0.015, a panel was a
    // flat, perfectly uniform block of maximum intensity across ~98.5% of
    // its radius, with almost no internal gradient — the opposite of how a
    // real specular highlight actually looks (a bright core fading
    // gradually outward). With four aimed panels now sized 5-10 units each
    // to survive the dynamic capture's resolution (see the panel comments
    // below), those flat blocks were blanketing large areas of the stone at
    // near-identical maximum brightness, which is what a "flat/CGI, cuts
    // and edges blend together" complaint turned out to mean in practice —
    // NOT an antialiasing or geometry problem. Lowering the shell's own
    // brightness ceiling alone (tried first: 0.85 -> 0.55 -> 0.4 at the top
    // elevation) moved the flash-white population from bright-white-40%+
    // barely at all (stuck at ~43% across every shell attempt), proving the
    // flash population was being driven entirely by the panels, not the
    // shell. Raising feather to 0.6 instead — so panels fade gradually
    // across 60% of their own radius instead of ~1.5% — dropped the
    // flash-white population from 43% to 34%, grew the light-gray (12.4%)
    // and medium (26.3%) bands substantially, and read as dramatically more
    // sculpted/faceted in the actual screenshot, especially in the lower
    // body which had previously been close to one flat white shape. Fire
    // unchanged (2.39% -> 2.55%, noise), dark90 unchanged, gold/pave
    // pixel-identical, confirmed at a second camera angle.
    //
    // Lowered again, 0.6 -> 0.3, after a "foggy, lacks clarity/purity"
    // complaint traced to something different from either fix above: a
    // horizontal pixel scanline across a facet showed genuinely sharp,
    // single-pixel jumps AT edges (ruling out anti-aliasing/blur), but
    // smooth multi-pixel gradients WITHIN individual flat facets — because
    // a facet sampling the shell's smoothly-varying background (rather
    // than a discrete panel) legitimately gets a continuously-varying
    // value across its own screen-space extent, which reads as a soft,
    // "milky" quality next to a facet that reads one flat, crisp tone. A
    // narrower feather makes each panel's OWN contribution closer to a
    // flat block again — a partial reversion of the fix above — so this
    // was paired with more panels (see `CRISP_PANELS`) rather than shipped
    // alone, so fewer facets fall through to shell-only sampling in the
    // first place instead of undoing the earlier gain.
    feather: 0.3,
    // `spokeCount`/`spokeStrength` — see `studioRadiance`'s own doc for the
    // mechanism. Added because side-by-side comparison against the real
    // running app showed a structural problem no amount of elevation-only
    // tuning above could fix: the render read as a two-tone split (one
    // large connected dark mass, one large connected bright mass) instead
    // of the reference's radial, alternating wedge pattern — because the
    // shell (which dominates most sampled directions) varies only with
    // elevation, never compass heading, so it cannot produce azimuthal
    // variety by itself. 6/0.55 was reached by direct comparison against
    // `market-reference.png` at each step, not by formula: (8, 0.4) and
    // (12, 0.7) were tried first and both broke up the bright mass
    // visibly, but a full-grid darkest-pixel scan showed (12, 0.7) pushing
    // 1,636 sampled points below 40/255 (versus 0 at (8, 0.4)) — real
    // black-triangle risk, rejected. (4, 0.5) and this (6, 0.55) both stay
    // safe (darkest pixel 31-35/255, 0 points below 20/255) while showing
    // a clearly bigger break in the bright mass than (8, 0.4) did; 6/0.55
    // was the more visible of the two at the production camera and was
    // confirmed to still hold up — coherent, not painted or flattened — at
    // a second, independent camera angle.
    //
    // A genuine, separate risk was checked and ruled out: this stone's
    // fixed dispersion (`aberrationStrength`) already produces real,
    // pre-existing colour on a small fraction of facets — a full-grid scan
    // of the UNMODIFIED shell found 2.7% of sampled points already above a
    // 40/255 channel-spread threshold, something none of the previous
    // phases' narrow 6-point fire checks had ever surfaced. The same scan
    // against this spoke pattern found 2.6-3.0% across every candidate
    // tried — no measurable increase in fire prevalence, just ordinary
    // variance in exactly which few pixels hit the local maximum.
    //
    // Dark-end shell stops raised 0.156/0.108/0.066 -> 0.22/0.18/0.15 and
    // spokeStrength lowered 0.55 -> 0.35 in a later gray/black-balance pass:
    // side-by-side against the running app showed large near-black wedges
    // (dark90 = % of the diamond's sampled oval below luminance 90/255) at
    // 23.65% in the shipped baseline. A spokeStrength-only sweep (0.55 ->
    // 0.45 -> 0.35) barely moved that number, confirming the dark mass was
    // coming from the shell floor, not the spoke term; 0.35 was kept as a
    // small, non-zero reduction per instruction rather than driven further,
    // since it wasn't the active lever. The floor was then swept in small
    // steps — 0.17/0.125/0.09, 0.18/0.135/0.10 barely moved it either — the
    // effective lever turned out to be the *lowest* elevation band
    // (0.68-1, straight down), not the 0.34-0.5 mid band (confirmed by a
    // no-op test raising that mid band to 0.55). 0.20/0.16/0.13 dropped
    // dark90 to 8.72%; 0.22/0.18/0.15 (shipped) to 0.98% — still a small
    // amount of genuine dark-gray facet, not zero — while one step further
    // (0.26/0.22/0.19) reached exactly 0%, judged to be starting to erase
    // the "controlled dark facet" depth the reference photo still shows, so
    // it was rejected in favour of 0.22/0.18/0.15. Bright-facet population
    // (>240/255) stayed flat at ~41.7-41.9% throughout every candidate in
    // this pass — the fix works by lifting the floor under existing dark
    // facets, not by growing the bright area into a flat white mass.
    spokeCount: 6,
    spokeStrength: 0.35,
    // A user-supplied competitor screenshot (a live oval-solitaire ring
    // configurator, captured and inspected directly) showed its dark/
    // pavilion facets carrying a distinct cool blue-slate cast rather than
    // neutral gray — a well-known diamond-photography cue (a cool shadow
    // reads as icy/premium; neutral or warm reads as flat). See
    // `bakeStudioTexture`'s own doc for the mechanism — fades to exactly 0
    // at raw >= 1, so it can only reach the shell-dominated dark
    // population, never a panel-lit bright facet or the stone's own body
    // colour.
    coolShadowTint: 0.12,
  },
  // Sharper and brighter than the tent, with a lower shell floor and tighter
  // feathering for more clearly separated bright/dark facets.
  "diamond-studio": {
    frames: buildFrames(scalePanels(PANELS, 1.3)),
    shellStops: [
      [0, 1.0],
      [0.34, 0.7],
      [0.52, 0.22],
      [0.68, 0.14],
      [1, 0.09],
    ],
    shellGain: 0.85,
    feather: 0.08,
  },
  // Brighter hard sources and the tightest feather here, for a clearly
  // separated bright/dark alternation — but not as extreme a floor as this
  // once was. Phase 19 swept the floor at 0.07/0.12/0.18/0.25, composer off,
  // against the market reference, holding panel scale and feather fixed:
  // 0.12 was the clear winner, visibly whiter and cleaner while still
  // keeping a real dark facet region for contrast; 0.07 read as more gray
  // than the reference's mostly-white body, and 0.18+ started washing that
  // dark region out toward uniform brightness before it even got there. The
  // other three shell stops are the same curve re-interpolated between the
  // unchanged 0.6 transition and the new floor, not picked independently.
  // (Phase 19 also tested reducing the four small hard sources below, alone
  // and combined with boosting/widening the front panels — reverted, since
  // it moved pixel statistics on the diamond crop by less than noise.)
  "high-contrast": {
    frames: buildFrames(scalePanels(PANELS, 1.7)),
    shellStops: [
      [0, 1.0],
      [0.34, 0.6],
      [0.52, 0.202],
      [0.68, 0.158],
      [1, 0.12],
    ],
    shellGain: 0.85,
    feather: 0.05,
  },
  // Dimmer panels, a wider feather, and a shell that stays mid-bright rather
  // than climbing to near-white — visible facet contrast, but gentler than
  // diamond-studio's, and no near-uniform wash-out once tone-mapped.
  "soft-studio": {
    frames: buildFrames(scalePanels(PANELS, 0.75)),
    shellStops: [
      [0, 1.0],
      [0.34, 0.62],
      [0.52, 0.32],
      [0.68, 0.24],
      [1, 0.18],
    ],
    shellGain: 0.85,
    feather: 0.22,
  },
  // Mostly bright with only a shallow dip toward the floor — a handful of
  // panels still present for sparkle, but the shell itself rarely reads as a
  // true gap.
  "luxury-white": {
    frames: buildFrames(scalePanels(PANELS, 0.85)),
    shellStops: [
      [0, 1.0],
      [0.34, 0.72],
      [0.52, 0.4],
      [0.68, 0.28],
      [1, 0.19],
    ],
    shellGain: 0.9,
    feather: 0.18,
  },
  // The opposite of luxury-white: a dark shell with a few sharp bright
  // strips. The floor stops at 0.07 — darker is the point of this one, but
  // not so dark a facet reads as a hole.
  "dark-studio": {
    frames: buildFrames(scalePanels(PANELS, 1.8)),
    shellStops: [
      [0, 0.45],
      [0.34, 0.24],
      [0.52, 0.13],
      [0.68, 0.09],
      [1, 0.07],
    ],
    shellGain: 0.85,
    feather: 0.06,
  },
};

const studioCache = new Map<string, THREE.Texture>();

/**
 * A named Diamond Studio environment, baked once and cached — same reasoning
 * as `getLightTent`. Returns null for any id that isn't one of these, which
 * the caller treats as "not a generated Diamond Studio id" (a drei preset or
 * real HDRI instead).
 */
export function getDiamondStudioEnvironment(id: string): THREE.Texture | null {
  const config = DIAMOND_STUDIO_CONFIGS[id];
  if (!config) return null;
  let texture = studioCache.get(id);
  if (!texture) {
    texture = bakeStudioTexture(
      config.frames,
      config.shellStops,
      config.shellGain,
      config.feather,
      config.spokeCount,
      config.spokeStrength,
      config.coolShadowTint,
    );
    studioCache.set(id, texture);
  }
  return texture;
}
