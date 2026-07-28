import * as THREE from "three";
import type { Finish } from "@/data/finishes";

export function createMetalMaterial(finish: Finish) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(finish.color),
    metalness: 1.0,
    roughness: finish.roughness,
    // Near-physical. The old 2.8 over-brightened every reflection toward white,
    // which flattens a metal: the highlights clip and the shading gradient that
    // describes the form disappears. A little above 1 keeps some drama.
    envMapIntensity: 1.25,
    clearcoat: 0.18,
    clearcoatRoughness: 0.06,
    reflectivity: 1.0,
  });
}

/* ── Diamond, not glass ───────────────────────────────────────────────────
 *
 * What separates the two to the eye is *fire* — the rainbow flashes thrown
 * off the facets. Window glass disperses about 0.008; diamond disperses
 * 0.044, roughly five times more, and that is the entire visual signature.
 * Without it a stone reads as a polished lump of glass no matter how clean
 * the refraction is.
 */

/** Refractive index of diamond. Glass is ~1.5, cubic zirconia ~2.15. */
export const DIAMOND_IOR = 2.417;

/**
 * three splits the refracted ray into three wavelengths at `ior ± halfSpread`,
 * where `halfSpread = (ior - 1) * 0.025 * dispersion`.
 *
 * Physically diamond corresponds to roughly 0.6 here, but that renders far too
 * subtly: three refracts once, whereas a real stone bounces light internally
 * many times and compounds the spread on every bounce. Exaggerating gets back
 * to what the eye expects from a diamond. Lower this toward 1 for a cooler,
 * more restrained stone; raise it for more rainbow.
 */
export const DIAMOND_DISPERSION = 3.6;

/**
 * @param thickness Depth of the stone **in scene units**, measured from its own
 *   geometry. This has to track the real stone: it drives how far a ray travels
 *   inside the volume, so a fixed value makes small stones look like thick
 *   blobs of glass. LP043's stones are 1.8mm deep in a 182mm piece — about
 *   0.015 units — where the old hardcoded 0.55 was some 36x too deep.
 */
export function createGemMaterial(thickness: number) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#ffffff"),
    metalness: 0,
    // Polished to a mirror finish; any roughness blurs the facet flashes away.
    roughness: 0.02,
    transmission: 1.0,
    ior: DIAMOND_IOR,
    dispersion: DIAMOND_DISPERSION,
    thickness: Math.max(thickness, 1e-4),
    // A colourless stone absorbs nothing. Leaving attenuation short tinted the
    // stone grey and flattened it — Infinity is three's own "no absorption".
    attenuationColor: new THREE.Color("#ffffff"),
    attenuationDistance: Infinity,
    // Facets are what sparkle, so let them catch the environment hard.
    envMapIntensity: 5.0,
    specularIntensity: 1.0,
    specularColor: new THREE.Color("#ffffff"),
    transparent: true,
    // Seeing the back facets through the front is most of the depth cue.
    side: THREE.DoubleSide,
  });
}

/** Sharp, flat-shaded facets so the stone sparkles like a real brilliant. */
export function facetGeometry(geometry: THREE.BufferGeometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.computeVertexNormals();
  return g;
}

/**
 * Depth of a stone, taken from its own bounding box.
 *
 * The shallowest axis is the right measure: a brilliant is wide across the
 * table and comparatively shallow through the girdle, and it is that shorter
 * path the light actually refracts along.
 */
export function gemThickness(geometry: THREE.BufferGeometry): number {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return 0.02;
  const size = box.getSize(new THREE.Vector3());
  const shallowest = Math.min(size.x, size.y, size.z);
  return shallowest > 0 ? shallowest : 0.02;
}
