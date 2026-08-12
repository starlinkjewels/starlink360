/*
 * The surface the piece stands on.
 *
 * Two styles, and the difference between them is not cosmetic — it is roughly
 * a factor of two in frame time.
 *
 * A matte ground is one more plane: a single draw, effectively free.
 *
 * A mirror is `gl.render(scene, virtualCamera)` into an off-screen buffer every
 * frame, followed by blur passes. That means the whole scene drawn twice, and
 * the most expensive thing in our scene by a wide margin is the stones, whose
 * shader traces rays through a BVH per pixel. So the mirror does not add a
 * little cost, it roughly doubles the hardest part of the render.
 *
 * Hence: off by default, matte first, and the mirror's resolution capped by
 * what the device is. Nothing here changes the current look until it is asked
 * for.
 */

export type GroundStyle = "matte" | "mirror";

/**
 * Whether the ground is a surface or just something for shadows to land on.
 *
 * Transparent is not "off". It is the cyclorama trick: an invisible plane that
 * still receives the shadow, so a piece can float on a gradient backdrop with
 * a real shadow under it. Turning the ground off entirely loses the shadow too,
 * which is the reason a plain on/off was not enough.
 */
export type GroundKind = "standard" | "transparent";

export type GroundShape = "square" | "circle";

export interface GroundSettings {
  enabled: boolean;
  kind: GroundKind;
  shape: GroundShape;
  style: GroundStyle;
  color: string;
  roughness: number;
  /** Footprint as a multiple of the piece's own, so it scales with any model. */
  sizeScale: number;

  /*
   * Explicit dimensions, in world units. Null means "derive it from the piece",
   * which is what the blank field in the panel writes — a jeweller sizing a
   * plinth wants a number, and everyone else wants it to just fit.
   */
  width: number | null;
  length: number | null;
  radius: number | null;
  segments: number | null;

  /* ── the reflector ──
   *
   * Twelve parameters, and they are not interchangeable: `resolution` is the
   * one that costs, the blur pair is free, and the four depth values decide
   * whether the reflection fades with distance or lies flat like a decal.
   */
  /** Reflection buffer size. This is the expensive dial. */
  resolution: number;
  blurX: number;
  blurY: number;
  /** How much the blurred and sharp reflections are mixed. */
  mixBlur: number;
  /** How strongly the reflection shows through the ground colour. */
  mixStrength: number;
  /** Contrast applied to the reflection alone. */
  mixContrast: number;
  /** 0 is no reflection at all, 1 is a perfect mirror. */
  mirror: number;
  /** Depth-based fade: how fast the reflection falls off with distance. */
  depthScale: number;
  minDepthThreshold: number;
  maxDepthThreshold: number;
  depthToBlurRatioBias: number;
  /** Ripple in the reflection, for a surface that is not perfectly flat. */
  distortion: number;
}

/** Off, so the viewer looks exactly as it did before this section existed. */
export const DEFAULT_GROUND: GroundSettings = {
  enabled: false,
  kind: "standard",
  shape: "square",
  style: "matte",
  color: "#0e0d12",
  roughness: 0.4,
  sizeScale: 12,
  // Auto by default: the plane fits the piece until someone says otherwise.
  width: null,
  length: null,
  radius: null,
  segments: null,

  /*
   * The reflector's defaults are the values the mirror already rendered with,
   * transcribed, plus drei's own defaults for the parameters that were never
   * exposed. Nothing here changes an existing render.
   */
  resolution: 1024,
  blurX: 320,
  blurY: 320,
  mixBlur: 1,
  mixStrength: 1.1,
  mixContrast: 1,
  mirror: 0,
  depthScale: 0,
  minDepthThreshold: 0.9,
  maxDepthThreshold: 1,
  depthToBlurRatioBias: 0.25,
  distortion: 0,
};

export const GROUND_PRESETS = [
  { label: "Charcoal", hex: "#0e0d12" },
  { label: "Black", hex: "#000000" },
  { label: "Slate", hex: "#2a2a30" },
  { label: "White", hex: "#f4f4f6" },
  { label: "Ivory", hex: "#efe8dc" },
  { label: "Champagne", hex: "#d8bb8a" },
];

/** Reflection buffer sizes, smallest first. */
export const REFLECTION_RESOLUTIONS = [256, 512, 1024, 2048] as const;

/**
 * Largest reflection buffer this device should be offered.
 *
 * A coarse pointer means a touch screen, which in this product means a phone —
 * 60% of the traffic. The cap is deliberately low there: a second full scene
 * render at 2048 alongside BVH-traced stones is not a slow frame, it is a
 * dropped one, and on a long video export it is a killed tab.
 *
 * This caps the *offer*, not the setting. A value saved on a desktop and opened
 * on a phone is clamped by `clampResolution` rather than silently honoured.
 */
export function maxReflectionResolution(coarsePointer: boolean): number {
  return coarsePointer ? 512 : 2048;
}

export function clampResolution(value: number, coarsePointer: boolean): number {
  const max = maxReflectionResolution(coarsePointer);
  const allowed = REFLECTION_RESOLUTIONS.filter((r) => r <= max);
  // Nearest allowed at or below the request, never above the device cap.
  return allowed.reduce((best, r) => (r <= value ? r : best), allowed[0]);
}

/**
 * Where the ground sits, and where the contact shadow sits on top of it.
 *
 * Both come from here because they are coplanar by design: the shadow has to
 * land on the surface, and two meshes at the same height z-fight into a
 * flickering mess that only appears once someone orbits. The epsilon scales
 * with the piece so it stays sub-pixel at any zoom.
 */
export function groundY(halfHeight: number, radius: number): { ground: number; shadow: number } {
  const base = -halfHeight * 1.08;
  return { ground: base - Math.max(radius, 1e-3) * 0.004, shadow: base };
}

/** Footprint of the ground plane in world units. */
export function groundSize(radiusXZ: number, sizeScale: number): number {
  return Math.max(radiusXZ, 1e-3) * sizeScale;
}

/**
 * What to warn about before someone turns the mirror on.
 *
 * Returns null when there is nothing worth saying — silence is better than a
 * permanent caution nobody reads.
 */
export function reflectionWarning(settings: GroundSettings, coarsePointer: boolean): string | null {
  if (!settings.enabled || settings.style !== "mirror") return null;
  if (coarsePointer) {
    return "A mirror draws the whole scene twice per frame. On a phone this will slow the view down and make video exports take about twice as long.";
  }
  if (settings.resolution >= 2048) {
    return "At 2048 the reflection is sharp and costs the most. Drop to 1024 if the view stutters.";
  }
  return "The reflection is rendered at a fixed size, so it stays soft in a 4K export. That reads as depth of field rather than as a fault.";
}

/**
 * The plane's actual dimensions, resolving every "auto" against the piece.
 *
 * One function decides this so the panel's placeholder text and the mesh cannot
 * disagree — a field showing "auto 24.0" while the plane is 12 wide is the kind
 * of thing that makes every other number in the panel suspect.
 *
 * A blank field is `null`, not zero. Zero is a legitimate thing to type and
 * means a plane with no size; conflating the two would make the field
 * impossible to clear.
 */
export function groundDimensions(
  settings: GroundSettings,
  radiusXZ: number,
): { width: number; length: number; radius: number; segments: number } {
  const auto = groundSize(radiusXZ, settings.sizeScale);
  return {
    width: settings.width ?? auto,
    length: settings.length ?? auto,
    radius: settings.radius ?? auto / 2,
    /*
     * Enough segments that the rim reads as a curve rather than a polygon, and
     * few enough to stay a trivial mesh. Clamped because a typed 2 is not a
     * circle and a typed 5,000 is thousands of triangles for a disc nobody
     * looks at closely.
     */
    segments: Math.round(Math.min(256, Math.max(3, settings.segments ?? 64))),
  };
}

/** Whether the reflector is actually going to be built and paid for. */
export function usesReflector(settings: GroundSettings): boolean {
  return settings.enabled && settings.style === "mirror";
}

/**
 * Reflector settings, brought into ranges the material accepts.
 *
 * `maxDepthThreshold` below `minDepthThreshold` is the one worth guarding: it
 * does not error, it inverts the depth fade so the reflection appears only
 * where it should have vanished — which looks like a shader bug rather than a
 * bad number.
 */
export function clampGround(s: GroundSettings): GroundSettings {
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const min = clamp(s.minDepthThreshold, 0, 10);
  return {
    ...s,
    roughness: clamp(s.roughness, 0, 1),
    sizeScale: clamp(s.sizeScale, 0.5, 200),
    width: s.width === null ? null : clamp(s.width, 0, 10000),
    length: s.length === null ? null : clamp(s.length, 0, 10000),
    radius: s.radius === null ? null : clamp(s.radius, 0, 10000),
    segments: s.segments === null ? null : Math.round(clamp(s.segments, 3, 256)),
    blurX: clamp(s.blurX, 0, 2000),
    blurY: clamp(s.blurY, 0, 2000),
    mixBlur: clamp(s.mixBlur, 0, 10),
    mixStrength: clamp(s.mixStrength, 0, 10),
    mixContrast: clamp(s.mixContrast, 0, 10),
    mirror: clamp(s.mirror, 0, 1),
    depthScale: clamp(s.depthScale, 0, 100),
    minDepthThreshold: min,
    maxDepthThreshold: Math.max(clamp(s.maxDepthThreshold, 0, 10), min),
    depthToBlurRatioBias: clamp(s.depthToBlurRatioBias, 0, 1),
    distortion: clamp(s.distortion, 0, 10),
  };
}
