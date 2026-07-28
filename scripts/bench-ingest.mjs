/**
 * Measures compressToJewelryScene against increasingly heavy scenes so the
 * upload limits are based on numbers rather than guesswork.
 *
 * Node is single-threaded like the browser main thread, so these timings track
 * what a desktop tab would do. A mid-range phone is roughly 3-5x slower.
 *
 * Usage: npm run bench:ingest
 */
import * as THREE from "three";
import { compressToJewelryScene } from "../.tmp-jewelry/loadJewelryFile.js";

const mb = (b) => (b / 1048576).toFixed(0);

function buildScene(meshCount, segsPerMesh) {
  const root = new THREE.Object3D();
  root.userData.layers = [
    { name: "Metal 01", fullPath: "Metal 01", visible: true },
    { name: "Gem 01", fullPath: "Gem 01", visible: true },
  ];
  let verts = 0;
  for (let i = 0; i < meshCount; i++) {
    // TorusKnot mimics a Rhino BRep render mesh: indexed, curved, dense.
    const g = new THREE.TorusKnotGeometry(1, 0.3, segsPerMesh, Math.max(3, segsPerMesh >> 3));
    verts += g.attributes.position.count;
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
    m.userData.attributes = { layerIndex: i % 8 === 0 ? 1 : 0 };
    m.position.set((i % 10) * 0.1, 0, 0);
    root.add(m);
  }
  return { root, verts };
}

console.log("input verts |  meshes | time    | out verts  | normals | peak heap | verdict");
console.log("-".repeat(88));

const CASES = [
  [20, 40],
  [40, 90],
  [60, 150],
  [80, 220],
  [60, 400],
  [90, 500],
];

for (const [meshCount, segs] of CASES) {
  const { root, verts } = buildScene(meshCount, segs);
  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;

  const t0 = process.hrtime.bigint();
  let out, err;
  try {
    out = await compressToJewelryScene(root);
  } catch (e) {
    err = e;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const peak = process.memoryUsage().heapUsed - before;

  if (err) {
    console.log(
      `${String(verts).padStart(11)} | ${String(meshCount).padStart(7)} | FAILED: ${err.message}`,
    );
    continue;
  }
  const outVerts = out.children.reduce((n, c) => n + c.geometry.attributes.position.count, 0);
  // Creasing splits shared vertices, so a rebuild shows up as a large jump in
  // output vertices. Source normals are kept as-is and stay near parity.
  const welded = outVerts > verts * 2.2 ? "rebuilt" : "source ";
  const verdict = ms < 500 ? "instant" : ms < 2000 ? "ok" : ms < 6000 ? "SLUGGISH" : "UNUSABLE";
  console.log(
    `${String(verts).padStart(11)} | ${String(meshCount).padStart(7)} | ${(ms / 1000).toFixed(2).padStart(6)}s | ` +
      `${String(outVerts).padStart(10)} | ${welded}     | ${mb(peak).padStart(6)} MB | ${verdict}`,
  );

  out.traverse((c) => c.geometry?.dispose?.());
}
