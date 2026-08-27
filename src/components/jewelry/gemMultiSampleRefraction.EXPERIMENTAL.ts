/*
 * PHASE 9 EXPERIMENTAL PROTOTYPE — NOT PRODUCTION CODE.
 *
 * Not imported by GemRefraction.tsx, Model.tsx, or any production path. Wired
 * in only via `GemRefractionExperimental.EXPERIMENTAL.tsx` and a URL query
 * flag, for the duration of the Phase 9 feasibility test. Safe to delete
 * entirely with zero effect on the shipped app.
 *
 * Tests one specific hypothesis from the Phase 8 investigation: that
 * drei's refraction shader samples the environment exactly ONCE per colour
 * channel per fragment (confirmed by reading the actual shader source, not
 * assumed — see `node_modules/@react-three/drei/materials/
 * MeshRefractionMaterial.js`), and that this single-sample-per-facet
 * architecture is what produces the hard facet-to-facet transitions Phase 8
 * found relative to the market reference.
 *
 * Approach: average N environment samples at small, deterministic angular
 * offsets around the already-traced exit ray direction, instead of
 * re-tracing the BVH N times. This treats a facet as having a small but
 * finite angular footprint — a cheap, defensible approximation of what a
 * real camera aperture or a path-traced renderer's own multi-sample
 * integration would naturally produce, without the cost of N times as many
 * BVH intersections.
 *
 * Sample pattern: a Vogel/Fermat spiral — a well-known, deterministic,
 * low-discrepancy way to fill a 2D disk with N points (used for the same
 * reason in screen-space AO and depth-of-field bokeh sampling elsewhere in
 * real-time graphics). For point i of n, at spread radius `spread`:
 *
 *   theta_i = i * goldenAngle       (goldenAngle = 2.39996323 rad ≈ 137.5°)
 *   r_i     = spread * sqrt((i + 0.5) / n)
 *
 * This is NOT random noise — every run of the same (i, n, spread) produces
 * the exact same offset, and the pattern is chosen specifically because it
 * avoids the clustering a uniform random distribution would produce at
 * small N.
 *
 * N=1 is deliberately NOT patched at all — `withMultiSampleEnv` returns the
 * unmodified shader for sampleCount <= 1, so the N=1 condition is bit-for-bit
 * the current production shader, not a "patched but degenerate" version of
 * this experiment.
 */

interface Anchor {
  find: string;
  replace: string;
}

/**
 * Every optical input this patch leaves untouched, for the record: IOR,
 * Fresnel, bounces, and the dispersion (chromatic aberration) ray directions
 * are all computed exactly as before, by the exact same
 * `totalInternalReflection` calls, using the exact same uniforms. This patch
 * only changes what happens to an ALREADY-COMPUTED exit ray direction: how
 * many times the environment is sampled around it, and how those samples are
 * combined. `gemAbsorption.ts`'s path-length absorption and
 * `diamondEnvIntensity.ts`/`diamondEnvRotation.ts`'s live uniforms are
 * unaffected and can be layered on top of this patch exactly as they are
 * layered on the unpatched shader.
 */
function anchors(sampleCount: number, spread: number): Anchor[] {
  const n = Math.max(2, Math.round(sampleCount));
  const spreadLiteral = spread.toPrecision(6);

  return [
    {
      find: "void main() {\n    vec2 uv = gl_FragCoord.xy / resolution;",
      replace:
        `#define GEM_SAMPLE_COUNT ${n}\n` +
        `#define GEM_SAMPLE_SPREAD ${spreadLiteral}\n\n` +
        "vec2 gemMultiSampleOffset(int i) {\n" +
        "  float golden = 2.39996323;\n" +
        "  float theta = float(i) * golden;\n" +
        "  float r = GEM_SAMPLE_SPREAD * sqrt((float(i) + 0.5) / float(GEM_SAMPLE_COUNT));\n" +
        "  return vec2(r * cos(theta), r * sin(theta));\n" +
        "}\n\n" +
        "vec4 gemMultiSampleEnv(vec3 baseDir, vec3 camPerfect) {\n" +
        "  vec3 up = abs(baseDir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);\n" +
        "  vec3 tangent = normalize(cross(up, baseDir));\n" +
        "  vec3 bitangent = cross(baseDir, tangent);\n" +
        "  vec4 sum = vec4(0.0);\n" +
        "  for (int i = 0; i < GEM_SAMPLE_COUNT; i++) {\n" +
        "    vec2 o = gemMultiSampleOffset(i);\n" +
        "    vec3 dir = normalize(baseDir + tangent * o.x + bitangent * o.y);\n" +
        "    sum += textureGradient(envMap, dir, camPerfect);\n" +
        "  }\n" +
        "  return sum / float(GEM_SAMPLE_COUNT);\n" +
        "}\n\n" +
        "void main() {\n    vec2 uv = gl_FragCoord.xy / resolution;",
    },
    {
      find:
        "float finalColorR = textureGradient(envMap, rayDirectionR, directionCamPerfect).r;\n" +
        "      float finalColorG = textureGradient(envMap, rayDirectionG, directionCamPerfect).g;\n" +
        "      float finalColorB = textureGradient(envMap, rayDirectionB, directionCamPerfect).b;",
      replace:
        "float finalColorR = gemMultiSampleEnv(rayDirectionR, directionCamPerfect).r;\n" +
        "      float finalColorG = gemMultiSampleEnv(rayDirectionG, directionCamPerfect).g;\n" +
        "      float finalColorB = gemMultiSampleEnv(rayDirectionB, directionCamPerfect).b;",
    },
  ];
}

/** Same derivation as `gemAbsorption.ts`'s `PATCH_ID` — see that file for why. */
export function multiSamplePatchId(sampleCount: number, spread: number): string {
  const text = anchors(Math.max(2, sampleCount), spread)
    .map((a) => a.replace)
    .join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Rewrites the fragment shader to average `sampleCount` environment lookups
 * around each of the three (R/G/B) exit ray directions instead of one.
 *
 * `sampleCount <= 1` returns the shader UNCHANGED — this is what makes N=1
 * the true production baseline rather than a degenerate patched case.
 * `spread` is the Vogel-spiral disk radius, in the same units as a
 * normalized ray direction component (so ~0.02–0.05 is a small-angle
 * perturbation, a few degrees at most).
 *
 * Returns null if the shader is not the one this was written against, which
 * the caller must treat as "leave the material alone" — same convention as
 * every other patch in this codebase.
 */
export function withMultiSampleEnv(
  fragmentShader: string,
  sampleCount: number,
  spread: number,
): string | null {
  if (sampleCount <= 1) return fragmentShader;

  let out = fragmentShader;
  for (const { find, replace } of anchors(sampleCount, spread)) {
    const first = out.indexOf(find);
    if (first === -1 || out.indexOf(find, first + find.length) !== -1) return null;
    out = out.slice(0, first) + replace + out.slice(first + find.length);
  }
  return out;
}
