/**
 * Runs the REAL worker source (not a copy) against a real .3dm, with `self`
 * stubbed out, so the browser decode path can be verified from Node.
 *
 * Usage: node --max-old-space-size=8192 scripts/test-worker-3dm.mjs "file.3dm"
 */
import { readFileSync } from "node:fs";
import rhino3dm from "rhino3dm";
import { WORKER_SOURCE } from "../.tmp-jewelry/rhinoDecode.js";

const rhinoFactory = rhino3dm;
const now = () => Number(process.hrtime.bigint()) / 1e6;

let done,
  lastProgress = 0,
  progressCalls = 0;
const started = now();

globalThis.self = {
  onmessage: null,
  importScripts: () => {},
  rhino3dm: (opts) => rhinoFactory(opts),
  postMessage: (m) => {
    if (m.type === "progress") {
      progressCalls++;
      lastProgress = m.done / m.total;
      return;
    }
    done = m;
  },
};

(0, eval)(WORKER_SOURCE);

const buffer = readFileSync(process.argv[2]).buffer;
const rules = {
  gemLayer: "^gems?\s*[\d._-]*$",
  metalLayer: "^metals?\s*[\d._-]*$",
  gemWords: "gem|stone|diamond|crystal|glass|brilliant|sapphire|ruby|emerald|pearl",
  metalWords:
    "metal|band|shank|setting|prong|bezel|gold|silver|platinum|mount|head|bail|chain|ring|gallery|halo|basket",
  constructionWords: "\b(finger\s*sizes?|cutting\s*objects?|construction|reference|guides?|old)\b",
};

await self.onmessage({
  data: { type: "decode", buffer, libraryPath: "./node_modules/rhino3dm/", rules },
});

// worker resolves asynchronously
for (let i = 0; i < 6000 && !done; i++) await new Promise((r) => setTimeout(r, 50));

const elapsed = now() - started;
if (!done) {
  console.log("TIMED OUT");
  process.exit(1);
}
if (done.type === "error") {
  console.log("ERROR:", done.message);
  process.exit(1);
}

const fmt = (n) => n.toLocaleString("en-US");
console.log(`\n  TOTAL decode        ${(elapsed / 1000).toFixed(2)}s`);
console.log(`  progress messages   ${progressCalls} (last ${(lastProgress * 100).toFixed(0)}%)`);
console.log(`  parts w/o mesh      ${done.missingMesh}`);
/*
 * Both buckets arrive as a list of groups now — metal split by layer the same
 * way stones always were, so each part can be picked on its own. The geometry
 * has to be sound in every group, not just in aggregate: one out-of-range index
 * in one group is enough to drop a whole draw call on the floor.
 */
let broken = 0;
for (const k of ["metals", "gems"]) {
  const groups = done[k] ?? [];
  console.log(`\n  ${k} (${groups.length})`);
  if (groups.length === 0) console.log("    (none)");
  for (const b of groups) {
    const verts = b.position.length / 3;
    console.log(
      `    ${String(b.color).padEnd(8)} verts=${fmt(verts).padStart(9)}  tris=${fmt(b.index.length / 3).padStart(9)}  layer="${b.layer}"`,
    );
    let bad = 0,
      zeroN = 0;
    for (let i = 0; i < b.position.length; i++) if (!Number.isFinite(b.position[i])) bad++;
    for (let i = 0; i < b.normal.length; i += 3)
      if (b.normal[i] === 0 && b.normal[i + 1] === 0 && b.normal[i + 2] === 0) zeroN++;
    let maxIdx = 0;
    for (let i = 0; i < b.index.length; i++) if (b.index[i] > maxIdx) maxIdx = b.index[i];
    const inRange = maxIdx < verts;
    if (bad > 0 || !inRange) broken++;
    console.log(
      `    ${" ".repeat(8)} non-finite=${bad}  zero-normals=${zeroN}  maxIndex=${fmt(maxIdx)} (bound ${fmt(verts - 1)}) ${inRange ? "OK" : "OUT OF RANGE"}`,
    );
  }
}

const totalVerts = ["metals", "gems"]
  .flatMap((k) => done[k] ?? [])
  .reduce((t, b) => t + b.position.length / 3, 0);
console.log(`\n  ${fmt(totalVerts)} verts across every group`);
console.log(broken === 0 ? "  All checks passed" : `  ${broken} FAILED`);
process.exit(broken === 0 ? 0 : 1);
