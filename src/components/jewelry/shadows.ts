/*
 * Shadows.
 *
 * Two mechanisms, because they are genuinely different things and a jeweller
 * wants one or the other depending on the shot:
 *
 *  - CONTACT is the soft dark pool under the piece. It is not a real shadow —
 *    it is a blurred render of the silhouette from directly below — and it is
 *    what every render of this product has used so far. It is cheap, it always
 *    looks reasonable, and it cannot show the SHAPE of anything.
 *
 *  - DIRECTIONAL is a real shadow camera: the scene rendered from the light's
 *    point of view into a depth map. It casts the actual outline of a shank
 *    across the ground and through the gallery, which is what makes a render
 *    look photographed rather than composited.
 *
 * Contact stays the default deliberately. Switching the mechanism changes every
 * existing render, and quietly restyling work a client has already approved is
 * not a change to make on the user's behalf — it is one click away instead.
 */

export type ShadowMode = "contact" | "directional";

export interface ShadowSettings {
  enabled: boolean;
  mode: ShadowMode;

  /* ── contact ── */
  opacity: number;
  blur: number;
  /** Footprint relative to the piece. */
  spread: number;

  /* ── directional ── */
  /**
   * How much of the scene the shadow camera covers, relative to the piece.
   * Too small and the shadow is clipped to a square; too large and the same
   * depth map is stretched over more area, so the shadow goes soft and blocky.
   */
  size: number;
  /** Spot shadow focus: concentrates the map near the subject. */
  focus: number;
  /** Soft-shadow samples. Cost is linear in this. */
  samples: number;
  mapWidth: number;
  mapHeight: number;
  near: number;
  far: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Pulls the shadow off the surface, to stop acne. */
  bias: number;
  /** Softens the edge in texel units. */
  radius: number;
}

export const DEFAULT_SHADOWS: ShadowSettings = {
  enabled: true,
  mode: "contact",

  // Transcribed from DEFAULT_LIGHTING, which is where these lived before.
  opacity: 0.42,
  blur: 2.6,
  spread: 6,

  size: 4,
  focus: 1,
  samples: 8,
  mapWidth: 1024,
  mapHeight: 1024,
  near: 0.5,
  far: 40,
  left: -5,
  right: 5,
  top: 5,
  bottom: -5,
  bias: -0.0005,
  radius: 2,
};

/** Powers of two only — a non-power-of-two shadow map silently fails to mip. */
export const SHADOW_MAP_SIZES = [512, 1024, 2048, 4096] as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Snaps to the nearest supported map size, so a typed value cannot break it. */
export function clampMapSize(n: number): number {
  let best = SHADOW_MAP_SIZES[0] as number;
  for (const s of SHADOW_MAP_SIZES) {
    if (Math.abs(s - n) < Math.abs(best - n)) best = s;
  }
  return best;
}

/**
 * Brings a settings object into a range that renders.
 *
 * `near >= far` is the one that matters: it does not error, it produces a depth
 * map with no usable range and the shadow simply vanishes — which reads as the
 * feature being broken rather than as a bad number.
 */
export function clampShadows(s: ShadowSettings): ShadowSettings {
  const near = clamp(s.near, 0.01, 1000);
  return {
    ...s,
    opacity: clamp(s.opacity, 0, 1),
    blur: clamp(s.blur, 0, 20),
    spread: clamp(s.spread, 0.5, 40),
    size: clamp(s.size, 0.5, 40),
    focus: clamp(s.focus, 0.1, 10),
    samples: Math.round(clamp(s.samples, 1, 64)),
    mapWidth: clampMapSize(s.mapWidth),
    mapHeight: clampMapSize(s.mapHeight),
    near,
    // Always strictly beyond near, whatever was typed.
    far: Math.max(clamp(s.far, 0.02, 5000), near + 0.01),
    left: clamp(s.left, -500, 0),
    right: clamp(s.right, 0, 500),
    top: clamp(s.top, 0, 500),
    bottom: clamp(s.bottom, -500, 0),
    bias: clamp(s.bias, -0.01, 0.01),
    radius: clamp(s.radius, 0, 25),
  };
}

/**
 * The shadow camera frustum, scaled to the piece.
 *
 * The stored left/right/top/bottom are in the piece's own units, which are
 * normalised to a unit sphere on load — so they are multiplied by the radius
 * here rather than being absolute numbers a user would have to re-tune for
 * every ring.
 */
export function shadowFrustum(
  s: ShadowSettings,
  radius: number,
): { left: number; right: number; top: number; bottom: number; near: number; far: number } {
  const r = Math.max(radius, 1e-3) * s.size;
  return {
    left: s.left * r * 0.25,
    right: s.right * r * 0.25,
    top: s.top * r * 0.25,
    bottom: s.bottom * r * 0.25,
    near: s.near * Math.max(radius, 1e-3),
    far: s.far * Math.max(radius, 1e-3),
  };
}

/**
 * Texels per unit of covered ground — the number that actually decides whether
 * a shadow looks sharp, rather than the map size on its own.
 */
export function shadowDensity(s: ShadowSettings, radius: number): number {
  const f = shadowFrustum(s, radius);
  const width = Math.max(f.right - f.left, 1e-6);
  return s.mapWidth / width;
}

/** Told before it is rendered, not discovered afterwards on a slow device. */
export function shadowWarning(s: ShadowSettings, radius = 1): string | null {
  if (!s.enabled || s.mode !== "directional") return null;

  const texels = s.mapWidth * s.mapHeight;
  if (texels >= 4096 * 4096) {
    return "A 4096 map is 64 MB of depth buffer and a full extra render of the piece each frame. Expect a slideshow without a dedicated GPU.";
  }
  if (shadowDensity(s, radius) < 40) {
    return "The shadow camera covers far more ground than the piece, so the map is stretched and the shadow will look blocky. Reduce Size.";
  }
  if (s.samples > 16) {
    return "Above about 16 samples the edge stops getting visibly softer and only gets slower.";
  }
  return null;
}
