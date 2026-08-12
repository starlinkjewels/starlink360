/**
 * Single-solid selection and materials, through the REAL pipeline.
 *
 * Every unit suite passes while the feature does nothing in the app, twice now,
 * because the bugs were never in the logic — they were in what happens to the
 * data between the decoder and the renderer. So this runs the actual sequence:
 *
 *   decode a real .3dm  ->  build meshes the way the loader does
 *   ->  Object3D.clone(), which is what the viewer does
 *   ->  facet the stones, which de-indexes them
 *   ->  raycast at one stone and resolve the hit to a solid
 *   ->  plan the draw runs and apply a material array
 *
 * If a single stone cannot be picked and recoloured at the end of that, this
 * fails — regardless of how healthy the pieces look on their own.
 *
 * Usage: node scripts/test-pipeline.mjs
 */
import * as THREE from "three";
import rhino3dm from "rhino3dm";
import { WORKER_SOURCE } from "../.tmp-suite/lib/rhinoDecode.js";
import { facetGeometry } from "../.tmp-suite/components/jewelry/materials.js";
import { parseId, solidAt, solidId } from "../.tmp-suite/components/jewelry/selection.js";
import {
  assignmentsFor,
  drawableCount,
  planRuns,
  runMaterials,
  runSlots,
} from "../.tmp-suite/components/jewelry/plan.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

// ── a piece with several separate stones on one layer ───────────────────────
const rhino = await rhino3dm();

/** An octahedron, which is a closed solid and reads as a stone. */
function octa(cx, cy, cz, s) {
  const mesh = new rhino.Mesh();
  const v = mesh.vertices();
  v.add(cx + s, cy, cz);
  v.add(cx - s, cy, cz);
  v.add(cx, cy + s, cz);
  v.add(cx, cy - s, cz);
  v.add(cx, cy, cz + s);
  v.add(cx, cy, cz - s);
  const f = mesh.faces();
  f.addTriFace(0, 2, 4);
  f.addTriFace(2, 1, 4);
  f.addTriFace(1, 3, 4);
  f.addTriFace(3, 0, 4);
  f.addTriFace(2, 0, 5);
  f.addTriFace(1, 2, 5);
  f.addTriFace(3, 1, 5);
  f.addTriFace(0, 3, 5);
  mesh.normals().computeNormals();
  return mesh;
}

const doc = new rhino.File3dm();
const mat = (name, r, g, b) => {
  const m = new rhino.Material();
  m.name = name;
  m.diffuseColor = { r, g, b, a: 255 };
  return doc.materials().add(m);
};
const layer = (name, materialIndex) => {
  const l = new rhino.Layer();
  l.name = name;
  if (materialIndex !== undefined) l.renderMaterialIndex = materialIndex;
  return doc.layers().add(l);
};
const lGem = layer("Gem 01", mat("Diamond", 255, 255, 255));
const lMetal = layer("Metal 01", mat("18k Yellow Gold", 212, 175, 55));
const place = (mesh, layerIndex) => {
  const a = new rhino.ObjectAttributes();
  a.layerIndex = layerIndex;
  doc.objects().addMesh(mesh, a);
};

// Four stones in a row, well separated so a ray can hit exactly one.
const STONES = 4;
const SPACING = 20;
for (let i = 0; i < STONES; i++) place(octa(i * SPACING, 0, 0, 4), lGem);
place(octa(0, -40, 0, 10), lMetal);

const bytes = doc.toByteArray();
console.log(
  `  built a ${(bytes.length / 1024).toFixed(1)} KB .3dm with ${STONES} separate stones\n`,
);

// ── decode through the real worker ──────────────────────────────────────────
let done = null;
globalThis.self = {
  onmessage: null,
  importScripts: () => {},
  rhino3dm: (o) => rhino3dm(o),
  postMessage: (m) => {
    if (m.type !== "progress") done = m;
  },
};
(0, eval)(WORKER_SOURCE);
await self.onmessage({
  data: {
    type: "decode",
    buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    libraryPath: "./node_modules/rhino3dm/",
    rules: {
      gemLayer: "^gems?\\s*[\\d._-]*$",
      metalLayer: "^metals?\\s*[\\d._-]*$",
      gemWords: "gem|stone|diamond|crystal|glass|brilliant|sapphire|ruby|emerald|pearl",
      metalWords: "metal|band|shank|setting|prong|bezel|gold|silver|platinum|mount|head|bail",
      constructionWords: "\\b(finger\\s*sizes?|cutting\\s*objects?|construction|reference)\\b",
    },
  },
});
for (let i = 0; i < 400 && !done; i++) await new Promise((r) => setTimeout(r, 25));
if (!done || done.type === "error") {
  console.log("  DECODE FAILED:", done?.message ?? "timeout");
  process.exit(1);
}

const gem = (done.gems ?? [])[0];
check(!!gem, "the decoder returned a stone group");
check(
  (gem.solids?.length ?? 1) - 1 === STONES,
  "and found every separate stone in it",
  `${(gem.solids?.length ?? 1) - 1} of ${STONES}`,
);

// ── build the mesh the way loadJewelryFile does ─────────────────────────────
function build(bucket, name, part) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(bucket.position, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(bucket.normal, 3));
  geo.setIndex(new THREE.BufferAttribute(bucket.index, 1));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
  mesh.name = name;
  // Exactly what the loader stores, including the plain-array conversion.
  if (bucket.solids && bucket.solids.length > 1) mesh.userData.solids = Array.from(bucket.solids);
  mesh.userData.part = part;
  mesh.userData.stone = { id: part.id, label: part.label, hex: bucket.color };
  return mesh;
}

const groupId = `${gem.layer}|${gem.color}`;
const loaded = new THREE.Group();
loaded.add(
  build(gem, `gem-${gem.color.slice(1)}`, { id: groupId, label: gem.layer, kind: "stone" }),
);

// ── what the viewer does to it ──────────────────────────────────────────────
/*
 * THE step that broke it. Object3D.copy() round-trips userData through JSON, so
 * a typed array arrives as {"0":0,...} with no length and every read of it
 * finds nothing. Nothing above this line can detect that.
 */
const cloned = loaded.clone(true);
const stone = cloned.children[0];

check(
  Array.isArray(stone.userData.solids),
  "the solid offsets survive the scene clone as a real array",
);
check(
  stone.userData.solids.length === STONES + 1,
  "with every offset intact",
  `${stone.userData.solids?.length} entries`,
);

// Faceting de-indexes the stones, which is where the element count changes.
const beforeCount = stone.geometry.index.count;
stone.geometry = facetGeometry(stone.geometry.clone());
check(stone.geometry.index === null, "faceting de-indexes the stone geometry");
check(
  drawableCount(stone.geometry) === beforeCount,
  "and the drawable count is unchanged, so the offsets still address it",
  `${drawableCount(stone.geometry)} vs ${beforeCount}`,
);

// ── pick one stone with a real raycast ──────────────────────────────────────
console.log("\n=== a ray at one stone resolves to that stone ===");
{
  let allRight = true;
  for (let i = 0; i < STONES; i++) {
    const ray = new THREE.Raycaster();
    // Straight down the +Z axis at stone i, which sits at x = i * SPACING.
    ray.set(new THREE.Vector3(i * SPACING, 0, 100), new THREE.Vector3(0, 0, -1));
    const hits = ray.intersectObject(stone, false);
    if (!hits.length) {
      check(false, `stone ${i} was hit by a ray aimed at it`);
      allRight = false;
      continue;
    }
    const got = solidAt(stone.userData.solids, hits[0].faceIndex);
    if (got !== i) {
      check(false, `stone ${i} resolved to solid ${got}`, `faceIndex ${hits[0].faceIndex}`);
      allRight = false;
    }
  }
  check(allRight, `all ${STONES} stones resolve to their own solid, in order`);
}

// ── recolour exactly one of them ────────────────────────────────────────────
console.log("\n=== a material lands on that stone alone ===");
{
  const target = 2;
  const id = solidId(groupId, target);
  const assignments = { [groupId]: { color: "#ffffff" }, [id]: { color: "#a5182b" } };

  const { base, perSolid } = assignmentsFor(assignments, groupId, parseId);
  check(base?.color === "#ffffff", "the group keeps its own material");
  check(
    perSolid.size === 1 && perSolid.get(target)?.color === "#a5182b",
    "and one solid overrides",
  );

  const runs = planRuns(stone.userData.solids, drawableCount(stone.geometry), base, perSolid);
  check(runs.length === 3, "which plans three runs: before, the stone, after", `${runs.length}`);

  let at = 0;
  for (const r of runs) {
    if (r.start !== at) {
      check(false, "the runs tile the buffer", `gap at ${at}`);
      break;
    }
    at += r.count;
  }
  check(at === drawableCount(stone.geometry), "covering every triangle exactly once", `${at}`);

  const specs = runMaterials(runs);
  const slots = runSlots(runs, specs);
  check(specs.length === 2, "and needs only two materials", `${specs.length}`);

  stone.geometry.clearGroups();
  runs.forEach((run, i) => stone.geometry.addGroup(run.start, run.count, slots[i]));
  stone.material = specs.map((s) => new THREE.MeshStandardMaterial({ color: s.color }));

  check(stone.geometry.groups.length === 3, "the geometry carries three draw groups");
  check(Array.isArray(stone.material) && stone.material.length === 2, "and the mesh two materials");

  /*
   * The point of the whole exercise: a ray at the recoloured stone must land in
   * a group whose material is the new one, and a ray at its neighbour must not.
   */
  const colorAt = (i) => {
    const ray = new THREE.Raycaster();
    ray.set(new THREE.Vector3(i * SPACING, 0, 100), new THREE.Vector3(0, 0, -1));
    const hit = ray.intersectObject(stone, false)[0];
    if (!hit) return null;
    const at = hit.faceIndex * 3;
    const group = stone.geometry.groups.find((g) => at >= g.start && at < g.start + g.count);
    return group ? `#${stone.material[group.materialIndex].color.getHexString()}` : null;
  };

  check(
    colorAt(target) === "#a5182b",
    "the chosen stone renders in the new colour",
    colorAt(target),
  );
  for (const other of [0, 1, 3]) {
    check(colorAt(other) === "#ffffff", `stone ${other} is untouched`, colorAt(other));
  }
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);
