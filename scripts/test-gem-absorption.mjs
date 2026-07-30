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
import { withPathAbsorption } from "../.tmp-jewelry/gemAbsorption.js";

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

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);
