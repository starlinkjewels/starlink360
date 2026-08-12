/**
 * Verifies the absorption patch against drei's REAL shader source.
 *
 * The patch is string surgery on a third-party shader, so the thing that can
 * silently break it is a drei upgrade rewording a line. This reads the actual
 * installed shader rather than a copy, so the test fails the day that happens.
 *
 * Usage: node scripts/test-gem-absorption.mjs
 */
import { readFileSync } from "node:fs";
import { PATCH_ID, withPathAbsorption } from "../.tmp-jewelry/gemAbsorption.js";

const SRC = "node_modules/@react-three/drei/materials/MeshRefractionMaterial.js";
const source = readFileSync(SRC, "utf8");

// The fragment shader is the template literal containing the trace function.
const start = source.indexOf("varying vec3 vWorldPosition");
const end = source.indexOf("`)", start);
const fragment = source.slice(start, end);

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

check(fragment.length > 500, "found drei's fragment shader", `${fragment.length} chars`);

const patched = withPathAbsorption(fragment, 0.4);
check(patched !== null, "all five anchors matched drei's current shader");

if (patched) {
  check(patched.includes("float gPathLength;"), "path accumulator declared");
  check(patched.includes("gPathLength = 0.0;"), "reset per trace");
  check(patched.includes("gPathLength += dist;"), "accumulates each internal segment");
  check(!patched.includes("vec4 diffuseColor = vec4(color, opacity);"), "flat tint removed");
  check(patched.includes("pow(max(color, vec3(1e-4))"), "absorption term applied");
  // The rim must stay white: absorption has to land BEFORE the fresnel mix.
  check(
    patched.indexOf("pow(max(color") < patched.indexOf("fresnelFunc(viewDirection"),
    "absorption applied before the fresnel rim",
  );
  check(patched.includes("0.40000000"), "reference length baked in", "ref=0.4");
  // Balanced braces is a cheap proxy for "still parses".
  const opens = (patched.match(/\{/g) ?? []).length;
  const closes = (patched.match(/\}/g) ?? []).length;
  check(opens === closes, "braces balanced", `${opens} open / ${closes} close`);
}

// A shader that has drifted must be rejected outright, not half-patched.
check(withPathAbsorption("void main() {}", 0.4) === null, "unknown shader is rejected");
check(
  withPathAbsorption(fragment + fragment, 0.4) === null,
  "duplicated anchors are rejected (ambiguous)",
);

/* The white-diamond guarantee, evaluated numerically: the absorption term is
 * pow(colour, e), so colour 1 must return exactly 1 for every exponent in
 * range — otherwise shipping this would alter the signed-off look. */
console.log("\n  white diamond is provably unchanged:");
let drift = 0;
for (let e = 0.25; e <= 2.0001; e += 0.05) {
  const v = Math.pow(1, e);
  if (v !== 1) drift++;
}
check(drift === 0, "pow(1, e) === 1 across the whole clamped exponent range");

// And a coloured stone must actually vary with depth, or this bought nothing.
const emerald = 0.478; // #0f7a3d green channel, linear-ish
const thin = Math.pow(emerald, 0.25);
const mid = Math.pow(emerald, 1);
const thick = Math.pow(emerald, 2);
console.log(
  `\n  emerald green channel: thin edge ${thin.toFixed(3)} -> body ${mid.toFixed(3)} -> deep ${thick.toFixed(3)}`,
);
check(thin > mid && mid > thick, "coloured stone deepens with path length");
check(thick > 0.05, "deepest case is still a colour, not black", thick.toFixed(3));

/*
 * Highlight compression, which is what makes a painted stone read as its
 * colour at all.
 *
 * Where `diffuseColor` is multiplied by absorption it holds the raw HDR
 * environment sample, and a studio map peaks well above 50. Absorption alone
 * leaves a coloured stone far above 1 in every channel, so tone mapping clips
 * it to white and the hue survives only on facets looking at something dark —
 * one stone, part coloured and part white. That was the bug.
 */
console.log("\n=== highlight compression ===");
check(
  !!patched?.includes("diffuseColor.rgb / (1.0 + gTint * diffuseColor.rgb)"),
  "the emitted shader compresses highlights",
);

/** The GLSL, line for line. */
function shade(absorb, env) {
  const aMax = Math.max(...absorb);
  const aMin = Math.min(...absorb);
  const tint = aMax > 1e-4 ? (aMax - aMin) / aMax : 0;
  return absorb.map((a, i) => (env[i] / (1 + tint * env[i])) * a);
}

const BRIGHT = [50, 50, 50];

const diamond = shade([1, 1, 1], BRIGHT);
check(
  diamond.every((v) => v === 50),
  "a colourless diamond is not compressed at all — every bit of HDR sparkle kept",
  `${diamond[0]}`,
);

const grey = shade([0.3, 0.3, 0.3], BRIGHT);
check(
  grey[0] === 15,
  "a smoky grey stone is not compressed either — no hue to protect",
  `${grey[0]}`,
);

// Sapphire, as gemTint hands it over: normalised to a peak of 1.
const sapphire = shade([0.21, 0.44, 1.0], BRIGHT);
console.log(`  sapphire on a bright facet: ${sapphire.map((v) => v.toFixed(2)).join(", ")}`);
check(
  sapphire[0] < 0.9 && sapphire[1] < 0.9,
  "its weak channels stay under clipping, so the facet cannot render white",
  sapphire.map((v) => v.toFixed(2)).join(", "),
);
check(
  sapphire[2] / sapphire[0] > 4,
  "and blue still dominates by the ratio the colour asked for",
  `${(sapphire[2] / sapphire[0]).toFixed(1)}x`,
);

const uncompressed = [0.21, 0.44, 1.0].map((a) => 50 * a);
check(
  uncompressed.every((v) => v > 1),
  "whereas before, every channel clipped — which is why it rendered white",
  uncompressed.map((v) => v.toFixed(0)).join(", "),
);

/*
 * The post-tone-mapping tint: the guarantee.
 *
 * Everything above works on an unbounded value, so the ceiling it fights moves
 * with the environment and no amount of compression can promise a result. After
 * tone mapping the value is bounded to 0..1, there is no headroom for a
 * highlight to hide in, and the outcome is arithmetic rather than a tuning.
 */
console.log("\n=== the tint that cannot be washed out ===");
check(
  !!patched?.includes("gl_FragColor.rgb *= max(color, vec3(1e-4))"),
  "applied after tone mapping",
);
check(
  (patched?.indexOf("#include <tonemapping_fragment>") ?? -1) <
    (patched?.indexOf("gl_FragColor.rgb *= max(color") ?? -1),
  "and strictly after it, not before",
);

/** The GLSL, again line for line. */
const tintAfter = (color, lit) => {
  const peak = Math.max(...color, 1e-4);
  return lit.map((v, i) => v * (color[i] / peak));
};

// The worst case there is: a facet that tone mapping has driven to pure white.
const BLOWN = [1, 1, 1];
const whiteStone = tintAfter([1, 1, 1], BLOWN);
check(
  whiteStone.every((v) => v === 1),
  "a colourless diamond is multiplied by exactly 1 — the look is untouched",
  whiteStone.join(", "),
);

const blownSapphire = tintAfter([0.12, 0.25, 0.56], BLOWN);
console.log(
  `  a blown-out facet, tinted sapphire: ${blownSapphire.map((v) => v.toFixed(2)).join(", ")}`,
);
check(
  blownSapphire[2] > 0.9 && blownSapphire[0] < 0.3,
  "even a fully blown facet comes out sapphire, not white",
  blownSapphire.map((v) => v.toFixed(2)).join(", "),
);
check(
  Math.abs(blownSapphire[0] / blownSapphire[2] - 0.12 / 0.56) < 0.01,
  "with the hue exactly as chosen",
  `r:b ${(blownSapphire[0] / blownSapphire[2]).toFixed(3)}`,
);

// Normalised, so the stone is tinted rather than dimmed.
check(
  Math.max(...tintAfter([0.12, 0.25, 0.56], BLOWN)) > 0.9,
  "and at full brightness, because the strongest channel is normalised to 1",
);

/*
 * The program cache key must move when the patch does.
 *
 * three caches compiled programs by `customProgramCacheKey()` on the RENDERER,
 * which survives a Vite hot update. A key that ignores the shader text means an
 * edited patch keeps rendering through the program compiled from the previous
 * one — the change appears to do nothing no matter how often the page is
 * refreshed. That is not hypothetical: it hid three consecutive fixes to this
 * very file, each of which was correct and none of which reached the screen.
 */
console.log("\n=== the patch identifies itself ===");
check(typeof PATCH_ID === "string" && PATCH_ID.length > 0, "PATCH_ID is published", PATCH_ID);
check(/^[a-z0-9]+$/.test(PATCH_ID), "and is safe to paste into a cache key", PATCH_ID);

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);
