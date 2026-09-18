/*
 * Blends each bounce's flat facet normal toward a smooth one, to stop
 * internal reflection from fragmenting at more than a couple of bounces.
 *
 * The root cause, read directly out of drei's compiled shader
 * (`MeshRefractionMaterial.js`): every bounce inside `totalInternalReflection`
 * calls `bvhIntersectFirstHit`, which hands back `faceNormal` — the exact,
 * raw, flat normal of whichever BVH triangle the ray happens to hit — and
 * that value is fed straight into `refract()`/`reflect()` with nothing to
 * smooth it. On our geometry specifically that is about as flat as a normal
 * can be: `materials.ts`'s `facetGeometry` calls `toNonIndexed()` before
 * `computeVertexNormals()`, which deliberately discards shared vertices and
 * gives every triangle its own hard, unblended normal (the whole point of
 * that function — a real diamond IS sharp facet planes, not a smooth dome).
 * An exact mirror-like reflection off a razor-flat plane is chaotically
 * sensitive: two rays a pixel apart can diverge sharply after just one
 * bounce, and every additional bounce compounds it. That is a tidy
 * explanation for a finding already on record in `diamondOptics.ts` — 1
 * bounce reads as a smooth dome (nothing to compound), 2 is the sweet spot,
 * and 3 and up "shatters" into small disconnected-looking shards — and it is
 * WHY a competitor's own captured material settings (a `.dmat` file, see
 * `library.ts`'s diamond entry history) can run 5 bounces cleanly: their
 * material exposes a `geometryFactor` knob with no equivalent here, which
 * this file is the equivalent of.
 *
 * The fix blends `faceNormal`, at every bounce, toward a genuinely smooth
 * alternative — recovered via `textureSampleBarycoord`, a function already
 * compiled into this shader as part of `shaderIntersectFunction`
 * (three-mesh-bvh's own GPU hit-point utility, built for exactly this: given
 * a hit's `barycoord` and `faceIndices`, it samples a texture at all three
 * hit-triangle vertices and returns the properly barycentric-interpolated
 * result — the standard three-mesh-bvh pattern for reading arbitrary
 * per-vertex data at a ray-hit point, not something invented here). The
 * texture it samples is a `FloatVertexAttributeTexture` (also
 * three-mesh-bvh's own, public API) built from a `smoothNormal` custom
 * attribute — real smooth-shaded normals, captured in `loadJewelryFile.ts`'s
 * `shadeGem` on the geometry's ORIGINAL, still-connected vertices, before
 * `toNonIndexed()` throws that connectivity away (`materials.ts`'s
 * `facetGeometry` guarantees the attribute exists even on a path that
 * skipped that capture, falling back to the flat normal itself — see its
 * own comment). At `geometryFactor: 0` this is an exact identity: mixing a
 * normal with itself changes nothing, so the shader falls fully back to
 * today's behaviour with the value at zero.
 *
 * Same string-replacement approach as `gemAbsorption.ts` and the other
 * `diamondEnv*.ts` patches, for the same reason: the material's source lives
 * inside drei, every anchor is checked, and the whole patch is abandoned
 * (not partially applied) if drei's shader has changed shape.
 */

interface Anchor {
  find: string;
  replace: string;
}

const ANCHORS: Anchor[] = [
  // Declare the two new uniforms. `uniform float fresnel;` is the same,
  // already-reused anchor `gemHdrKnee.ts`, `diamondEnvResponse.ts` and
  // `diamondEnvIntensity.ts` each append after — additive inserts on the
  // same anchor don't conflict with each other, only a rewrite would.
  {
    find: "uniform float fresnel;",
    replace:
      "uniform float fresnel;\n  uniform float uGeometryFactor;\n  uniform sampler2D uSmoothNormalMap;",
  },
  /*
   * Overwrite `faceNormal` itself, right after the BVH hands it back and
   * before anything reads it — `refract(rayDirection, faceNormal, ior)` and
   * `reflect(rayDirection, faceNormal)` immediately below both keep working
   * unmodified, because they already read `faceNormal` by name.
   */
  {
    find:
      "      bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, " +
      "faceNormal, barycoord, side, dist );",
    replace:
      "      bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, " +
      "faceNormal, barycoord, side, dist );\n      " +
      "vec3 gSmoothNormal = textureSampleBarycoord( uSmoothNormalMap, barycoord, faceIndices.xyz ).xyz;\n      " +
      "faceNormal = normalize(mix(faceNormal, gSmoothNormal, uGeometryFactor));",
  },
];

/**
 * Identifies the CONTENT of this patch, for the program cache key — see
 * `gemAbsorption.ts`'s `PATCH_ID` doc for why this is derived rather than a
 * hand-written string: a changed replacement with an unchanged key means
 * three keeps serving a stale compiled program after a hot update.
 */
export const GEOMETRY_BLEND_PATCH_ID = (() => {
  const text = ANCHORS.map((a) => a.replace).join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
})();

/**
 * Rewrites the fragment shader to blend each bounce's facet normal toward a
 * smooth one. Returns null if the shader is not the one this was written
 * against, which the caller must treat as "leave the material alone".
 */
export function withGeometryBlend(fragmentShader: string): string | null {
  let out = fragmentShader;
  for (const { find, replace } of ANCHORS) {
    const first = out.indexOf(find);
    if (first === -1 || out.indexOf(find, first + find.length) !== -1) return null;
    out = out.slice(0, first) + replace + out.slice(first + find.length);
  }
  return out;
}
