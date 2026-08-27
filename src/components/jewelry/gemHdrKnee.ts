/*
 * A diamond-scoped, pre-ACES HDR compression.
 *
 * Identity below a threshold T (dark/mid facets pass through completely
 * unchanged), Reinhard-style compression of only the EXCESS above T (bright
 * facets get pulled down toward, but not collapsed onto, a shared ceiling):
 *
 *   excess = max(x - T, 0)
 *   x' = min(x, T) + excess / (1 + k * excess)
 *
 * At k=0 this is exactly the identity function (excess/(1+0) = excess), so
 * `kneeStrength: 0` is a true, exact no-op, not an approximation.
 *
 * Applied identically to R, G, and B — the same scalar function of each
 * channel's own value, never mixing channels or reading hue/saturation — so
 * this cannot introduce a colour shift or dispersion-like effect on its own.
 * See `diamondOptics.ts`'s `kneeThreshold`/`kneeStrength` docs for the full
 * measurement and the visual sweep that landed on the shipped values.
 *
 * Inserted immediately before `#include <tonemapping_fragment>`, operating
 * on `gl_FragColor.rgb` — the final combined pre-tonemap value, after
 * refraction/response/absorption/intensity/Fresnel have all already been
 * applied — the one place a diamond-only patch can affect what reaches ACES
 * without touching the renderer's own global tonemapping or exposure.
 */

interface Anchor {
  find: string;
  replace: string;
}

const ANCHORS: Anchor[] = [
  {
    find: "uniform float fresnel;",
    replace:
      "uniform float fresnel;\n  uniform float uKneeThreshold;\n  uniform float uKneeStrength;",
  },
  {
    find: "#include <tonemapping_fragment>",
    replace:
      "vec3 gemKneeExcess = max(gl_FragColor.rgb - vec3(uKneeThreshold), vec3(0.0));\n" +
      "  gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(uKneeThreshold)) + gemKneeExcess / (1.0 + uKneeStrength * gemKneeExcess);\n" +
      "  #include <tonemapping_fragment>",
  },
];

function applyAnchors(fragmentShader: string, anchors: Anchor[]): string | null {
  let out = fragmentShader;
  for (const { find, replace } of anchors) {
    const first = out.indexOf(find);
    if (first === -1 || out.indexOf(find, first + find.length) !== -1) return null;
    out = out.slice(0, first) + replace + out.slice(first + find.length);
  }
  return out;
}

/** Same derivation as `gemAbsorption.ts`'s `PATCH_ID` — see that file for why. */
export const HDR_KNEE_PATCH_ID = (() => {
  const text = ANCHORS.map((a) => a.replace).join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
})();

/**
 * Rewrites the fragment shader to add live `uKneeThreshold`/`uKneeStrength`
 * uniforms.
 *
 * Returns null if the shader is not the one this was written against, which
 * the caller must treat as "leave the shader alone" — see `withPathAbsorption`
 * for why a partial patch is worse than none.
 */
export function withHdrKnee(fragmentShader: string): string | null {
  return applyAnchors(fragmentShader, ANCHORS);
}
