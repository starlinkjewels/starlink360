/*
 * Colour that deepens with depth, the way a real gemstone does.
 *
 * drei's refraction material tints a stone by multiplying the refracted sample
 * by one flat colour. Every facet therefore gets the same amount of green, and
 * the stone reads as tinted glass — which is exactly the gap against a
 * path-traced product render, where an emerald is pale at its thin edges and
 * deeply saturated through its body.
 *
 * The physics is Beer-Lambert: light is absorbed in proportion to how far it
 * travelled through the material, so transmission is exp(-k * length). Writing
 * it as a power of the stone's own colour is the same curve with a far more
 * useful parameter:
 *
 *     transmitted = colour ^ (pathLength / reference)
 *
 * At the reference length the result is exactly the colour the stone already
 * had, so the piece still reads as ruby or emerald. Shorter paths tend towards
 * white, longer ones towards saturation. Two properties make this safe to ship:
 *
 *  - A colourless stone is untouched. pow(1, x) is 1 for every x, so a white
 *    diamond renders bit-identically to before.
 *  - It cannot produce a black gem. The exponent is clamped, so the darkest
 *    possible result is colour squared — deeper, never dead.
 *
 * The shader is patched by string replacement because the material's source
 * lives inside drei. Every anchor is checked, and if any one of them fails to
 * match — a drei upgrade rewording a line — the whole patch is abandoned and
 * the caller keeps the original flat-tint behaviour. Silently shipping half a
 * patch would corrupt every stone.
 */

/** Bounds on `pathLength / reference`, so absorption stays a variation. */
const MIN_EXPONENT = 0.25;
const MAX_EXPONENT = 2;

interface Anchor {
  find: string;
  replace: string;
}

function anchors(reference: number): Anchor[] {
  // Guard the divisor: a degenerate stone would otherwise divide by zero.
  const ref = Math.max(reference, 1e-6).toPrecision(8);

  return [
    // Somewhere to accumulate the traced distance.
    {
      find: "uniform float bounces;",
      replace: "uniform float bounces;\n  float gPathLength;",
    },
    // Reset per trace, so the value belongs to this pixel's ray.
    {
      find: "    vec3 rayOrigin = ro;",
      replace: "    gPathLength = 0.0;\n    vec3 rayOrigin = ro;",
    },
    /*
     * Accumulate the distance of each internal segment. `dist` is in model
     * space, which is why the reference length is measured from the geometry
     * rather than being a fixed number.
     */
    {
      find:
        "      bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, " +
        "faceNormal, barycoord, side, dist );",
      replace:
        "      bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, " +
        "faceNormal, barycoord, side, dist );\n      gPathLength += dist;",
    },
    // Stop tinting flatly; the tint is applied by path length below instead.
    {
      find: "vec4 diffuseColor = vec4(color, opacity);",
      replace: "vec4 diffuseColor = vec4(1.0, 1.0, 1.0, opacity);",
    },
    /*
     * Apply it after the environment sample and before the fresnel rim, so the
     * rim stays white — on a real stone that edge is a surface reflection and
     * never picks up body colour.
     *
     * The highlight compression in the middle is what makes a coloured stone
     * actually read as its colour. `diffuseColor` at this point is the raw HDR
     * environment sample, and a studio map peaks well above 50. Multiplying
     * that by an absorption of 0.12 still leaves 6, so the channel clips to
     * white in tone mapping and the stone shows its colour only on the facets
     * that happen to be looking at something dark — one stone, part coloured
     * and part white, which is exactly the fault this fixes.
     *
     * Reinhard with the CHROMA of the absorption as its knee — `e / (1 + k*e)`
     * rather than a blend toward `e / (1 + e)`. A blend was tried first and is
     * far too weak: interpolating 79% of the way from 50 toward 0.98 still
     * leaves 11, which clips just the same. As a knee, k=0 passes the value
     * through untouched and any k>0 bounds the result at 1/k.
     *
     * So a colourless diamond is not compressed at all and keeps every bit of
     * its HDR sparkle; the more colour a stone carries, the harder its
     * highlights are pulled into range so the hue survives them. Chroma rather
     * than darkness, so a smoky grey stone stays uncompressed too — it has no
     * hue to protect.
     */
    {
      find: "vec3 viewDirection = normalize(vWorldPosition - cameraPosition);",
      replace:
        "vec3 gAbsorb = pow(max(color, vec3(1e-4)), vec3(clamp(gPathLength / " +
        `${ref}, ${MIN_EXPONENT.toFixed(2)}, ${MAX_EXPONENT.toFixed(2)})));\n    ` +
        "float gAbsMax = max(max(gAbsorb.r, gAbsorb.g), gAbsorb.b);\n    " +
        "float gAbsMin = min(min(gAbsorb.r, gAbsorb.g), gAbsorb.b);\n    " +
        "float gTint = gAbsMax > 1e-4 ? (gAbsMax - gAbsMin) / gAbsMax : 0.0;\n    " +
        "diffuseColor.rgb = diffuseColor.rgb / (1.0 + gTint * diffuseColor.rgb);\n    " +
        "diffuseColor.rgb *= gAbsorb;\n    " +
        "vec3 viewDirection = normalize(vWorldPosition - cameraPosition);",
    },
    /*
     * The body colour again, once more, after tone mapping — and this is the
     * one that cannot fail.
     *
     * Everything above applies colour to an UNBOUNDED value. The environment
     * sample runs past 50 on a bright facet, so any colour multiplied into it
     * is still far above 1 and tone mapping flattens it to white; the hue
     * survives only where the environment happened to be dim. Compression and
     * normalisation each shrink that problem without removing it, because the
     * ceiling they are fighting moves with the environment.
     *
     * After `tonemapping_fragment` the value is bounded to 0..1, and there is
     * no headroom left for a highlight to hide in. White times a normalised
     * sapphire is exactly sapphire. Normalised, so the stone is tinted rather
     * than darkened — dividing by the strongest channel keeps the hue and the
     * brightness, and leaves a colourless stone multiplied by exactly 1, which
     * is why the diamond look is untouched to the last bit.
     */
    {
      find: "#include <tonemapping_fragment>",
      replace:
        "#include <tonemapping_fragment>\n    " +
        "gl_FragColor.rgb *= max(color, vec3(1e-4)) / " +
        "max(max(color.r, max(color.g, color.b)), 1e-4);",
    },
  ];
}

/**
 * Identifies the CONTENT of this patch, for the program cache key.
 *
 * three caches compiled programs by `customProgramCacheKey()`, and that cache
 * lives on the renderer — which survives a Vite hot update. So when the patch
 * below changes but the key does not, three finds the program it compiled from
 * the OLD shader text and reuses it: the edit appears to do nothing, however
 * many times the page is refreshed, and only a hard reload that tears down the
 * renderer shows the new code.
 *
 * That cost this project an entire debugging session. Deriving the key from the
 * patch text means it cannot happen again — change any replacement here and the
 * key changes with it.
 */
export const PATCH_ID = (() => {
  const text = anchors(1)
    .map((a) => a.replace)
    .join("|");
  // FNV-1a, which is plenty to notice an edit and is not a security boundary.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
})();

/**
 * Rewrites the fragment shader to absorb by path length.
 *
 * `reference` is the model-space distance at which the stone shows exactly its
 * own colour — roughly a ray's whole journey through it.
 *
 * Returns null if the shader is not the one this was written against, which the
 * caller must treat as "leave the material alone".
 */
export function withPathAbsorption(fragmentShader: string, reference: number): string | null {
  let out = fragmentShader;

  for (const { find, replace } of anchors(reference)) {
    // Every anchor must appear exactly once. Two matches would mean the shader
    // changed shape and the patch is no longer describing what it thinks.
    const first = out.indexOf(find);
    if (first === -1 || out.indexOf(find, first + find.length) !== -1) return null;
    out = out.slice(0, first) + replace + out.slice(first + find.length);
  }

  return out;
}
