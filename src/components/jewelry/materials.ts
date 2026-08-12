import * as THREE from "three";
import type { Finish } from "@/data/finishes";

export function createMetalMaterial(finish: Finish) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(finish.color),
    metalness: 1.0,
    roughness: finish.roughness,
    envMapIntensity: 2.8,
    clearcoat: 0.18,
    clearcoatRoughness: 0.06,
    reflectivity: 1.0,
  });
}

/**
 * How much Fresnel whitening a stone of this colour can take.
 *
 * The refraction shader ends on `mix(color, vec3(1.0), fresnel)` — the stone's
 * colour is blended toward PURE WHITE by the Fresnel term, so at full strength
 * every facet that is not square-on to the camera renders white whatever colour
 * it was given. On a colourless diamond that is exactly right and it is what
 * makes the piece sparkle. On a pave stone painted ruby it is the bug that had
 * a stone come out half coloured and half white, because a small stone shows
 * the camera mostly grazing angles.
 *
 * So it scales with how coloured the stone is. A colourless stone keeps the
 * full effect and looks exactly as it did; the more colour a stone is given,
 * the more of that colour survives to the rim. Not zero even at full
 * saturation — a gem with no white in it reads as plastic.
 *
 * Chroma rather than HSL saturation. A champagne diamond is 0xf7f2ea, which
 * HSL calls 45% saturated purely because it sits near the top of the lightness
 * range — scaling by that would halve the sparkle on a stone the eye reads as
 * white. Chroma calls it 5%, which is what it looks like.
 *
 * Read in sRGB explicitly: three stores colours linearly when colour management
 * is on, and the ratio of linear components is not the ratio the eye sees.
 */
export function gemFresnel(color: string, full = 1): number {
  return full * (1 - gemChroma(color) * 0.9);
}

/**
 * How coloured a stone is, from 0 (colourless) to 1 (fully saturated).
 *
 * Chroma rather than HSL saturation. A champagne diamond is 0xf7f2ea, which HSL
 * calls 45% saturated purely for sitting near the top of the lightness range;
 * chroma calls it 5%, which is what the eye sees. Read in sRGB explicitly,
 * because three stores colours linearly when colour management is on and the
 * ratio of linear components is not the ratio we perceive.
 */
export function gemChroma(color: string): number {
  const rgb = new THREE.Color(color).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  return max <= 0 ? 0 : (max - min) / max;
}

/**
 * The tint to hand the refraction shader for a chosen stone colour.
 *
 * The shader does `diffuseColor.rgb *= envSample` against an HDR environment
 * whose values run well above 1, then tone-maps. A swatch colour used directly
 * is a per-channel ATTENUATION of that: sapphire's 0.12/0.25/0.56 scales all
 * three channels down, the bright facets still clip to white after tone
 * mapping, and only the dim ones keep any hue. The stone comes out white with a
 * few coloured patches — which is what "half the diamond is coloured" was.
 *
 * Normalising to a peak of 1 fixes it without touching the shader. The hue and
 * the ratios between channels are exactly preserved; what changes is that the
 * strongest channel passes the environment through at full strength instead of
 * dimming it, so the stone reads as its colour across every facet rather than
 * only where the environment happens to be dark.
 *
 * White is already normalised, so a colourless diamond is returned untouched.
 */
export function gemTint(color: string): string {
  const c = new THREE.Color(color);
  const rgb = c.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  // Black is never a real stone, and dividing by it is worse than leaving it.
  if (max <= 0.001 || max >= 0.999) return color;
  return new THREE.Color()
    .setRGB(rgb.r / max, rgb.g / max, rgb.b / max, THREE.SRGBColorSpace)
    .getHexString(THREE.SRGBColorSpace)
    .replace(/^/, "#");
}

export function createGemMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#ffffff"),
    metalness: 0,
    roughness: 0.01,
    transmission: 1.0,
    ior: 2.42,
    thickness: 0.55,
    envMapIntensity: 4.2,
    specularIntensity: 1.8,
    specularColor: new THREE.Color("#ffffff"),
    attenuationColor: new THREE.Color("#fefefe"),
    attenuationDistance: 1.6,
    transparent: true,
    side: THREE.DoubleSide,
  });
}

/** Sharp, flat-shaded facets so the stone sparkles like a real brilliant. */
export function facetGeometry(geometry: THREE.BufferGeometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.computeVertexNormals();
  return g;
}
