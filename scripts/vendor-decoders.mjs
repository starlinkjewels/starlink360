/**
 * Copies the Rhino and Draco decoders into public/vendor, so the site serves
 * them itself.
 *
 * They used to load from jsDelivr and gstatic at run time. Script loaded that
 * way runs with full access to the page, so whoever controls those hosts, or
 * the path to them, controls the viewer. `importScripts` in the Rhino worker
 * has no integrity check to pin it with. Serving our own copy, taken from the
 * exact versions in package-lock.json, removes that dependency, and the files
 * now come from the same origin as everything else.
 *
 * The copies are committed, so a build or a Lovable preview that never runs
 * this script still has them. Run it again after upgrading rhino3dm or three:
 *
 *   npm run vendor:decoders
 *
 * `npm run test:vendor` fails if a copy has drifted from node_modules.
 *
 * Usage: node scripts/vendor-decoders.mjs [--check]
 */
import { copyFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const VENDORED = [
  ["node_modules/rhino3dm/rhino3dm.js", "public/vendor/rhino3dm/rhino3dm.js"],
  ["node_modules/rhino3dm/rhino3dm.wasm", "public/vendor/rhino3dm/rhino3dm.wasm"],
  // The glTF-only build: smaller, and all GLTFLoader ever needs.
  [
    "node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js",
    "public/vendor/draco/draco_decoder.js",
  ],
  [
    "node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm",
    "public/vendor/draco/draco_decoder.wasm",
  ],
  [
    "node_modules/three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js",
    "public/vendor/draco/draco_wasm_wrapper.js",
  ],
];

const checkOnly = process.argv.includes("--check");
let fail = 0;

for (const [from, to] of VENDORED) {
  const src = join(root, from);
  const dest = join(root, to);
  if (!existsSync(src)) {
    console.log(`  FAIL  ${from} is missing — run npm install`);
    fail++;
    continue;
  }
  if (checkOnly) {
    const same = existsSync(dest) && readFileSync(src).equals(readFileSync(dest));
    console.log(`  ${same ? "PASS" : "FAIL"}  ${to} matches ${from}`);
    if (!same) fail++;
  } else {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    console.log(`  copied ${to}`);
  }
}

if (fail) {
  console.log(`\n  ${fail} problem(s)${checkOnly ? " — run npm run vendor:decoders" : ""}`);
  process.exit(1);
}
if (checkOnly) console.log("\n  All checks passed");
