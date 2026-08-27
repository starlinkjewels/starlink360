/*
 * A live intensity control for the diamond environment.
 *
 * drei's refraction material has no `envMapIntensity` uniform — `bounces`,
 * `ior`, `fresnel` and `aberrationStrength` are the whole tunable surface.
 * The Diamond Studio environment is a baked texture (see `lighting.ts`), so
 * the alternative to a shader uniform is re-baking it per intensity change,
 * which is the exact per-edit cost the bake was built to avoid.
 *
 * Patched in the same way as `gemAbsorption.ts`, by string replacement
 * against drei's shader source, and for the same reason: the material's GLSL
 * lives inside drei, not in this repo. Applied after the environment sample
 * and before the fresnel-to-white mix, so intensity brightens the stone's
 * own facets without also brightening the fresnel rim.
 */

interface Anchor {
  find: string;
  replace: string;
}

const ANCHORS: Anchor[] = [
  {
    find: "uniform float fresnel;",
    replace: "uniform float fresnel;\n  uniform float uDiamondEnvIntensity;",
  },
  {
    find: "float nFresnel = fresnelFunc(viewDirection, normal) * fresnel;",
    replace:
      "diffuseColor.rgb *= uDiamondEnvIntensity;\n    " +
      "float nFresnel = fresnelFunc(viewDirection, normal) * fresnel;",
  },
];

/** Same derivation as `gemAbsorption.ts`'s `PATCH_ID` — see that file for why. */
export const ENV_INTENSITY_PATCH_ID = (() => {
  const text = ANCHORS.map((a) => a.replace).join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
})();

/**
 * Rewrites the fragment shader to add a live `uDiamondEnvIntensity` uniform.
 *
 * Returns null if the shader is not the one this was written against, which
 * the caller must treat as "leave the shader alone" — see `withPathAbsorption`
 * for why a partial patch is worse than none.
 */
export function withEnvIntensity(fragmentShader: string): string | null {
  let out = fragmentShader;

  for (const { find, replace } of ANCHORS) {
    const first = out.indexOf(find);
    if (first === -1 || out.indexOf(find, first + find.length) !== -1) return null;
    out = out.slice(0, first) + replace + out.slice(first + find.length);
  }

  return out;
}
