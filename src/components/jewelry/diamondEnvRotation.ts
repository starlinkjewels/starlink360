/*
 * A live rotation control for the diamond environment.
 *
 * `texture.offset`/`.matrix` do nothing here: drei's refraction shader
 * computes its own UV directly from the ray direction via `equirectUv()` and
 * samples the texture with it raw — it never consults a texture's transform
 * the way a standard material's `map` does. Verified by testing it: rotating
 * `diamondEnvironmentRotation` by 180° visibly changed nothing on screen.
 *
 * Patched the same way as `gemAbsorption.ts`/`diamondEnvIntensity.ts`, by
 * string replacement against drei's shader source: add a uniform and fold it
 * into the equirect UV's longitude (the `x` component) right where that UV is
 * computed, before either sample or its mip-derivative neighbour reads it.
 * Only applies to the non-cube (equirect) branch — a captured cube env (the
 * dynamic-reflection path) has no equivalent "rotate the room" operation.
 */

interface Anchor {
  find: string;
  replace: string;
}

const ANCHORS: Anchor[] = [
  {
    find: "uniform float aberrationStrength;",
    replace: "uniform float aberrationStrength;\n  uniform float uDiamondEnvRotation;",
  },
  {
    find: "vec2 uvv = equirectUv( rayDirection );",
    replace:
      "vec2 uvv = equirectUv( rayDirection );\n      uvv.x = fract(uvv.x + uDiamondEnvRotation);",
  },
  {
    find: "vec2 smoothUv = equirectUv( directionCamPerfect );",
    replace:
      "vec2 smoothUv = equirectUv( directionCamPerfect );\n      smoothUv.x = fract(smoothUv.x + uDiamondEnvRotation);",
  },
];

/** Same derivation as `gemAbsorption.ts`'s `PATCH_ID` — see that file for why. */
export const ENV_ROTATION_PATCH_ID = (() => {
  const text = ANCHORS.map((a) => a.replace).join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
})();

/**
 * Rewrites the fragment shader to add a live `uDiamondEnvRotation` uniform.
 *
 * Returns null if the shader is not the one this was written against, or if
 * the envMap is a cube texture (only the equirect `textureGradient` overload
 * has a `uvv`/`smoothUv` to rotate) — either way the caller leaves the
 * material alone, same convention as the other patches in this codebase.
 */
export function withEnvRotation(fragmentShader: string): string | null {
  let out = fragmentShader;

  for (const { find, replace } of ANCHORS) {
    const first = out.indexOf(find);
    if (first === -1 || out.indexOf(find, first + find.length) !== -1) return null;
    out = out.slice(0, first) + replace + out.slice(first + find.length);
  }

  return out;
}
