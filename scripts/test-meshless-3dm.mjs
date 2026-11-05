/**
 * A .3dm saved WITHOUT render meshes, end to end through the real decoder.
 *
 * Builds a small ring-like document in rhino3dm — a torus shank and a capped
 * tube head on a metal layer, three round stones on a gem layer, one part as an
 * Extrusion object — none of which carries a render mesh, exactly like a file
 * saved with "Save Small" or exported by a plugin. It is written to bytes and
 * decoded by the actual WORKER_SOURCE the browser runs (with `self` stubbed),
 * so this exercises the same path an upload takes.
 *
 * Before the Brep mesher, every one of these parts was dropped with "N parts
 * had no render mesh". Now each must arrive, on the right layer, watertight.
 *
 * Usage: npm run test:meshless
 */
import rhino3dm from "rhino3dm";
import { WORKER_SOURCE } from "../.tmp-jewelry/rhinoDecode.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

const rh = await rhino3dm();
const PI = Math.PI;

/* ── the document ── */
const doc = new rh.File3dm();
doc.settings().modelUnitSystem = rh.UnitSystem.Millimeters;

function layer(name) {
  const l = new rh.Layer();
  l.name = name;
  return doc.layers().add(l);
}
const METAL = layer("Metal");
const GEM = layer("Gem 01");

function add(geometry, layerIndex) {
  const attrs = new rh.ObjectAttributes();
  attrs.layerIndex = layerIndex;
  doc.objects().add(geometry, attrs);
}

// Shank: a torus, closed both ways.
const profile = new rh.Circle(1.2);
profile.plane = { origin: [9, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1], zAxis: [0, -1, 0] };
const shank = rh.Brep.createFromRevSurface(
  rh.RevSurface.create(
    rh.NurbsCurve.createFromCircle(profile),
    new rh.Line([0, 0, 0], [0, 0, 1]),
    0,
    2 * PI,
  ),
  false,
  false,
);
add(shank, METAL);

// Head: a tube with a seat hole, as an EXTRUSION object (not a Brep).
const head = rh.Extrusion.create(rh.NurbsCurve.createFromCircle(new rh.Circle(2.5)), 3, true);
const seat = new rh.Circle(1.6);
seat.center = [0, 2.5, 0];
head.addInnerProfile(rh.NurbsCurve.createFromCircle(seat));
head.translate([0, 0, 10]);
add(head, METAL);

// Three round stones.
for (const [x, r] of [
  [0, 1.5],
  [-3.2, 0.8],
  [3.2, 0.8],
]) {
  add(rh.Brep.createFromSphere(new rh.Sphere([x, 0, 14], r)), GEM);
}

const bytes = doc.toByteArray();
check(bytes.length > 0, "document written", `${bytes.length} bytes`);

/* ── confirm the file really has no render meshes ── */
{
  const back = rh.File3dm.fromByteArray(bytes);
  const objs = back.objects();
  let cached = 0;
  for (let i = 0; i < objs.count; i++) {
    const g = objs.get(i).geometry();
    if (g.constructor.name === "Brep") {
      const f = g.faces();
      for (let k = 0; k < f.count; k++) if (f.get(k).getMesh(rh.MeshType.Any)) cached++;
    } else if (g.constructor.name === "Extrusion" && g.getMesh(rh.MeshType.Any)) cached++;
  }
  check(
    objs.count === 5 && cached === 0,
    "five objects, not one render mesh among them",
    `${cached} cached`,
  );
}

/* ── decode through the real worker source ── */
let done = null;
globalThis.self = {
  onmessage: null,
  importScripts: () => {},
  rhino3dm: (opts) => rhino3dm(opts),
  postMessage: (m) => {
    if (m.type !== "progress") done = m;
  },
};
(0, eval)(WORKER_SOURCE);

const rules = {
  gemLayer: "^gems?\\s*[\\d._-]*$",
  metalLayer: "^metals?\\s*[\\d._-]*$",
  gemWords: "gem|stone|diamond",
  metalWords: "metal|band|shank",
  constructionWords: "\\b(construction|reference)\\b",
};
const t0 = performance.now();
await self.onmessage({
  data: {
    type: "decode",
    buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    libraryPath: "./node_modules/rhino3dm/",
    rules,
  },
});
for (let i = 0; i < 1200 && !done; i++) await new Promise((r) => setTimeout(r, 50));
const ms = performance.now() - t0;

check(
  !!done && done.type === "done",
  "decoder finished",
  done?.type === "error" ? done.message : `${ms.toFixed(0)} ms`,
);
if (!done || done.type !== "done") process.exit(1);

console.log("\n=== every part arrives ===");
check(
  done.missingMesh === 0,
  "no part dropped for lack of a render mesh",
  `missingMesh=${done.missingMesh}`,
);
check(done.unmeshedFaces === 0, "no face left unmeshed", `unmeshedFaces=${done.unmeshedFaces}`);
// torus 1 + tube 4 + three spheres 1 each.
check(
  done.autoMeshed === 8,
  "all eight faces were meshed from NURBS",
  `autoMeshed=${done.autoMeshed}`,
);

console.log("\n=== on the right layers, as the right parts ===");
const metals = done.metals ?? [];
const gems = done.gems ?? [];
check(
  metals.length >= 1 && metals.every((g) => g.layer === "Metal"),
  "metal arrives on the Metal layer",
  metals.map((g) => g.layer).join(","),
);
check(
  gems.length >= 1 && gems.every((g) => g.layer === "Gem 01"),
  "stones arrive on the Gem 01 layer",
  gems.map((g) => g.layer).join(","),
);
const stones = gems.reduce((n, g) => n + g.solids.length - 1, 0);
check(stones === 3, "three separate stones, each its own solid", `${stones}`);
const metalSolids = metals.reduce((n, g) => n + g.solids.length - 1, 0);
check(metalSolids === 2, "shank and head are two separate solids", `${metalSolids}`);

console.log("\n=== geometry is sound ===");
for (const g of [...metals, ...gems]) {
  const verts = g.position.length / 3;
  let outOfRange = 0;
  let nan = 0;
  for (const i of g.index) if (i >= verts) outOfRange++;
  for (const x of g.position) if (!Number.isFinite(x)) nan++;
  for (const x of g.normal) if (!Number.isFinite(x)) nan++;

  // Watertight after welding, which is what splitSolids does too.
  const id = new Int32Array(verts);
  const weld = new Map();
  for (let v = 0; v < verts; v++) {
    const k = `${Math.round(g.position[v * 3] * 1e4)},${Math.round(g.position[v * 3 + 1] * 1e4)},${Math.round(g.position[v * 3 + 2] * 1e4)}`;
    if (!weld.has(k)) weld.set(k, weld.size);
    id[v] = weld.get(k);
  }
  const edges = new Map();
  for (let t = 0; t < g.index.length; t += 3) {
    for (const [p, q] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      const a = id[g.index[t + p]];
      const b = id[g.index[t + q]];
      if (a === b) continue;
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of edges.values()) if (n !== 2) open++;
  check(
    outOfRange === 0 && nan === 0 && open === 0,
    `${g.layer} ${g.color}: indices in range, finite, watertight`,
    `${g.index.length / 3} tris, ${outOfRange} bad idx, ${nan} NaN, ${open} open edges`,
  );
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);
