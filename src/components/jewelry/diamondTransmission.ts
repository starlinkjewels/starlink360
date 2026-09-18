/*
 * A soft glow blended under the faceted reflection, so a dark facet reads as
 * dim glass with light still moving through it, not a flat opaque mirror.
 *
 * Direct user diagnosis, confirmed against a real reference image, in four
 * concrete parts: our dark facets are flat and opaque rather than
 * translucent; the tone jumps binary between blown white and flat gray
 * rather than graduating; there is no soft "glow" near the stone's centre
 * the way light passing mostly straight through produces; and our brightest
 * points are broad flat fields rather than small sharp glints. This patch
 * targets the first two directly and the third as a side effect; the fourth
 * is a separate, already-tuned concern (`envResponseExponent`/HDR knee).
 *
 * The root cause: `totalInternalReflection()` (drei's shader) only ever
 * produces ONE kind of ray — bounce around inside the pavilion by total
 * internal reflection until it finds an exit, then sample the environment.
 * Every pixel, dark or bright, is that same reflection-only sample. A real
 * diamond is not only that: some light also travels through with far less
 * internal bouncing, especially near facets closer to face-up, and that
 * component is what reads as "you can see into it" rather than "it is a
 * mirror shaped like a diamond". There was never a second kind of ray to
 * blend in — this is a structural gap, not a mistuned constant, which is
 * why more bounces or a different tone curve could never have fixed it.
 *
 * This does NOT reintroduce real scene transmission (a `MeshPhysicalMaterial`
 * with `transmission` was tried for this earlier in the project and
 * reverted — every stone took on the colour of whatever was behind it,
 * grey from metal and milky when pushed further, because it was sampling
 * the actual rendered scene). The direct ray here still only ever samples
 * OUR OWN studio environment texture, exactly like the reflected ray does —
 * never the metal or anything else in the scene — so that failure mode
 * structurally cannot recur. What makes it read as "transmission" instead
 * of "a second reflection" is that it is far SMOOTHER: one refraction at
 * the entry surface, then straight on, with none of the pavilion's internal
 * bounces to chop it into facets. Approximate — a physically exact version
 * would also refract once more on the way OUT the far side, which needs its
 * own BVH hit and isn't attempted here — but the visual target is "soft
 * glow under sharp facets", and a cheap, zero-BVH-cost ray already produces
 * that.
 *
 * The blend is weighted by how dark the reflected result already is, not
 * applied at a flat percentage everywhere. The first version DID apply it
 * flat, and a direct user check of the shipped result called it out
 * immediately and specifically: "looks like a white plastic piece" — a real
 * regression, not a subjective quibble, and the cause was legible in the
 * code, not a mystery. `diffuseColor` at the blend site is still raw,
 * pre-tonemap HDR (`gemAbsorption.ts` measured bright facets running well
 * past 50), and a flat `mix` blends the SAME percentage into an already-hot,
 * sparkling facet as into a dead dark one — diluting exactly the highlights
 * that give a diamond its life, everywhere at once, which reads as a
 * uniform, low-contrast, matte wash. That is what "white plastic" was
 * describing. Weighting the blend by `1 - clamp(luminance, 0, 1)` makes an
 * already-bright facet's weight (correctly) zero — nothing to fix there —
 * while a dark, dead facet still gets the full blend. The competitor's own
 * captured settings are worth noting here too: their `.dmat` file (see
 * `library.ts`'s diamond entry history) ships with `transmission: 0` —
 * whatever their engine's transmission knob does, THEIR reference render
 * achieved its look with it off, which is further evidence that a heavy,
 * un-targeted glow was never going to be the fix on its own.
 *
 * Same string-replacement approach as every other patch in this shader, for
 * the same reason: the material's source lives inside drei, every anchor is
 * checked, and the whole patch is abandoned rather than partially applied if
 * drei's shader has changed shape.
 */

interface Anchor {
  find: string;
  replace: string;
}

const ANCHORS: Anchor[] = [
  // The new uniform. `uniform float fresnel;` is the same anchor
  // `gemHdrKnee.ts`, `diamondEnvResponse.ts`, `diamondEnvIntensity.ts` and
  // `diamondGeometryBlend.ts` each already append after — additive inserts
  // on the same anchor don't conflict with each other, only a rewrite would.
  {
    find: "uniform float fresnel;",
    replace: "uniform float fresnel;\n  uniform float uTransmissionGlow;",
  },
  /*
   * The direct-ray function itself, declared right before the function it
   * sits alongside. One refraction at the entry surface — exactly the first
   * line of `totalInternalReflection` — then straight through with no
   * pavilion bounce at all.
   */
  {
    find:
      "vec3 totalInternalReflection(vec3 ro, vec3 rd, vec3 normal, float ior, " +
      "mat4 modelMatrixInverse) {",
    replace:
      "vec3 gDirectTransmission(vec3 rd, vec3 n, float ior) {\n" +
      "    vec3 refracted = refract(rd, n, 1.0 / ior);\n" +
      "    return normalize((modelMatrix * vec4(refracted, 0.0)).xyz);\n" +
      "  }\n" +
      "  vec3 totalInternalReflection(vec3 ro, vec3 rd, vec3 normal, float ior, " +
      "mat4 modelMatrixInverse) {",
  },
  /*
   * Captured before `rayDirection`/`normal` are touched by either branch
   * below — the aberration branch never reassigns them, but the plain
   * branch reassigns `rayDirection` to the REFLECTED result on the very
   * next line, which would otherwise leave nothing to compute this from.
   */
  {
    find: "vec3 rayOrigin = cameraPosition;",
    replace:
      "vec3 rayOrigin = cameraPosition;\n    " +
      "vec3 gDirectDir = gDirectTransmission(normalize(vWorldPosition - cameraPosition), " +
      "vNormal, max(ior, 1.0));",
  },
  /*
   * One blend site, not one per branch. Both the dispersion and plain
   * branches feed into `diffuseColor` and then converge here regardless of
   * which one actually ran, so this is the one place downstream of both
   * that is guaranteed to exist no matter which compiles — and it is
   * `gemAbsorption.ts`'s own last anchor, which PREPENDS its own code and
   * preserves this exact line verbatim as the tail of its replacement, so
   * it is still here to find no matter how many patches ran first. Anchoring
   * on either branch's own "diffuseColor.rgb *= ..." line directly is the
   * fragile alternative: `diamondEnvResponse.ts` already rewrites the
   * dispersion branch's version of that line, so a patch running after it
   * (this one does) would have to match ITS rewritten text instead of the
   * original — coupling this file to another patch's exact output instead
   * of a stable convergence point.
   */
  {
    find: "vec3 viewDirection = normalize(vWorldPosition - cameraPosition);",
    replace:
      "vec3 gDirectSample = textureGradient(envMap, gDirectDir, directionCamPerfect).rgb;\n    " +
      // Weighted by how DARK the reflected result already is, not applied
      // flat. `diffuseColor` here is still raw, pre-tonemap HDR — the file's
      // own history (gemAbsorption.ts) measured bright facets running past
      // 50 — so luminance 1.0 is already a generous "this facet is doing
      // its job" threshold, past which the weight is exactly zero. A flat,
      // unweighted mix blends the SAME percentage into an already-bright
      // sparkling facet as into a dead dark one, which dulls the highlights
      // that give a diamond its sparkle along with fixing the facets that
      // actually needed it — read back as "looks like white plastic", a
      // real regression from a real user check, not a subjective call.
      // Weighting by darkness targets only the facets the fix was for.
      "float gLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));\n    " +
      "float gDarkness = 1.0 - clamp(gLum, 0.0, 1.0);\n    " +
      "diffuseColor.rgb = mix(diffuseColor.rgb, gDirectSample, uTransmissionGlow * gDarkness);\n    " +
      "vec3 viewDirection = normalize(vWorldPosition - cameraPosition);",
  },
];

/**
 * Identifies the CONTENT of this patch, for the program cache key — see
 * `gemAbsorption.ts`'s `PATCH_ID` doc for why this is derived rather than a
 * hand-written string.
 */
export const TRANSMISSION_PATCH_ID = (() => {
  const text = ANCHORS.map((a) => a.replace).join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
})();

/**
 * Rewrites the fragment shader to blend a soft direct-transmission glow
 * under the reflected result. Returns null if the shader is not the one
 * this was written against, which the caller must treat as "leave the
 * material alone".
 */
export function withTransmissionGlow(fragmentShader: string): string | null {
  let out = fragmentShader;
  for (const { find, replace } of ANCHORS) {
    const first = out.indexOf(find);
    if (first === -1 || out.indexOf(find, first + find.length) !== -1) return null;
    out = out.slice(0, first) + replace + out.slice(first + find.length);
  }
  return out;
}
