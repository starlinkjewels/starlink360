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
  gemEnvironment: "tent",
  // Zero and one: the environment exactly as it was before these existed.
  environmentRotation: 0,
  environmentIntensity: 1,
  exposure: 1.4,
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

function shellRadiance(y: number): number {
  const t = Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI;
  for (let i = 0; i < SHELL_STOPS.length - 1; i++) {
    const [t0, v0] = SHELL_STOPS[i];
    const [t1, v1] = SHELL_STOPS[i + 1];
    if (t >= t0 && t <= t1) {
      const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      return (v0 + (v1 - v0) * k) * SHELL_GAIN;
    }
  }
  return SHELL_STOPS[SHELL_STOPS.length - 1][1] * SHELL_GAIN;
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

const FRAMES: Frame[] = PANELS.map((panel) => {
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

/** Softens panel edges, so a hotspot is not a hard-aliased rectangle. */
const FEATHER = 0.12;

/** What a ray leaving the stone lands on, as linear radiance. Exported for measurement. */
export function tentRadiance(dx: number, dy: number, dz: number): number {
  let nearest = Infinity;
  let weight = 0;
  let intensity = 0;

  for (let i = 0; i < FRAMES.length; i++) {
    const f = FRAMES[i];
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
    weight = edge <= 1 - FEATHER ? 1 : (1 - edge) / FEATHER;
    intensity = f.intensity;
  }

  const shell = shellRadiance(dy);
  return shell * (1 - weight) + intensity * weight;
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
 * Bakes the tent into an equirectangular half-float map.
 *
 * Half-float rather than float: WebGL2 filters half-float natively, while
 * linear filtering of full float needs an extension not every phone has. It
 * also holds values far above 1, which is the point — a highlight clamped to
 * white tone-maps to flat grey instead of a spark.
 */
export function createLightTent(): THREE.Texture {
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
          total += tentRadiance(cosLon[kx] * cLat, sLat, sinLon[kx] * cLat);
        }
      }

      const value = THREE.DataUtils.toHalfFloat(total / samples);
      const i = (y * WIDTH + x) * 4;
      // Neutral: a diamond takes its colour from the stone, never the tent.
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
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
