/*
 * A response curve on the diamond's raw environment sample.
 *
 * Phase 20 traced drei's compiled `MeshRefractionMaterial` shader end to end
 * and found the raw environment lookup reaches `diffuseColor` with no
 * tone-adjustment of its own (`diffuseColor.rgb *= vec3(finalColorR,
 * finalColorG, finalColorB);`) before ACES tonemapping's `saturate()` — and
 * the studio environment's HDR values run "well above 50" (see
 * `gemAbsorption.ts`), far past where ACES's filmic curve has already
 * flattened toward white. Many different bright facet values were
 * converging on the same near-white output there, reading as broad,
 * same-toned regions instead of distinct bright/dark facets. See
 * `diamondOptics.ts`'s `envResponseExponent` doc for the full investigation
 * and the sweep that landed on 1.2.
 *
 * Patched the same way as the other diamond-specific uniforms in this
 * codebase (`gemAbsorption.ts`, `diamondEnvIntensity.ts`,
 * `diamondEnvRotation.ts`): by string replacement against drei's shader
 * source, since the GLSL lives inside the package, not this repo. Applied to
 * the raw sample specifically — before the absorption tint and the
 * environment-intensity multiply — so it reshapes the environment's own
 * dynamic range rather than compounding with either of those.
 */

interface Anchor {
  find: string;
  replace: string;
}

const ANCHORS: Anchor[] = [
  {
    find: "uniform float fresnel;",
    replace: "uniform float fresnel;\n  uniform float uEnvResponseExponent;",
  },
  {
    find: "diffuseColor.rgb *= vec3(finalColorR, finalColorG, finalColorB);",
    replace:
      "diffuseColor.rgb *= pow(max(vec3(finalColorR, finalColorG, finalColorB), vec3(1e-6)), vec3(uEnvResponseExponent));",
  },
];

/** Same derivation as `gemAbsorption.ts`'s `PATCH_ID` — see that file for why. */
export const ENV_RESPONSE_PATCH_ID = (() => {
  const text = ANCHORS.map((a) => a.replace).join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
})();

/**
 * Rewrites the fragment shader to add a live `uEnvResponseExponent` uniform.
 *
 * Returns null if the shader is not the one this was written against, which
 * the caller must treat as "leave the shader alone" — see `withPathAbsorption`
 * for why a partial patch is worse than none.
 */
export function withEnvResponse(fragmentShader: string): string | null {
  let out = fragmentShader;

  for (const { find, replace } of ANCHORS) {
    const first = out.indexOf(find);
    if (first === -1 || out.indexOf(find, first + find.length) !== -1) return null;
    out = out.slice(0, first) + replace + out.slice(first + find.length);
  }

  return out;
}
