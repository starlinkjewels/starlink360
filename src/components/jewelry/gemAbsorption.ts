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
     */
    {
      find: "vec3 viewDirection = normalize(vWorldPosition - cameraPosition);",
      replace:
        "diffuseColor.rgb *= pow(max(color, vec3(1e-4)), vec3(clamp(gPathLength / " +
        `${ref}, ${MIN_EXPONENT.toFixed(2)}, ${MAX_EXPONENT.toFixed(2)})));\n    ` +
        "vec3 viewDirection = normalize(vWorldPosition - cameraPosition);",
    },
  ];
}

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
