/**
 * Times the real .3dm upload flow end to end, so the slow phase is identified
 * by measurement rather than assumption.
 *
 * Generates a synthetic .3dm with rhino3dm, then runs the exact steps
 * Rhino3dmLoader's worker performs: fromByteArray -> per-object
 * toThreejsJSON -> BufferGeometry, followed by compressToJewelryScene.
 *
 * Usage: npm run bench:upload
 */
import rhino3dm from "rhino3dm";
import * as THREE from "three";
import { compressToJewelryScene } from "../.tmp-jewelry/loadJewelryFile.js";

const rhino = await rhino3dm();
const now = () => Number(process.hrtime.bigint()) / 1e6;
const mb = (b) => (b / 1048576).toFixed(1);

/** A tessellated grid, standing in for one Rhino BRep render mesh. */
function gridMesh(n, ox) {
  const m = new rhino.Mesh();
  const v = m.vertices();
  const f = m.faces();
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      v.add(ox + i / n, j / n, Math.sin(i * 0.3) * Math.cos(j * 0.3) * 0.2);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * (n + 1) + j;
      f.addTriFace(a, a + 1, a + n + 1);
      f.addTriFace(a + 1, a + n + 2, a + n + 1);
    }
  }
  m.normals().computeNormals();
  return m;
}

function buildDoc(meshCount, grid) {
  const doc = new rhino.File3dm();
  const metal = new rhino.Layer();
  metal.name = "Metal 01";
  doc.layers().add(metal);
  const gem = new rhino.Layer();
  gem.name = "Gem 01";
  doc.layers().add(gem);

  let verts = 0;
  for (let i = 0; i < meshCount; i++) {
    const m = gridMesh(grid, i * 0.1);
    verts += m.vertices().count;
    const att = new rhino.ObjectAttributes();
    att.layerIndex = i % 8 === 0 ? 1 : 0;
    doc.objects().addMesh(m, att);
    m.delete();
    att.delete();
  }
  return { doc, verts };
}

console.log(
  "verts     | .3dm size |  parse  | toJSON  | build*  | compress* | BROWSER TOTAL   (* = blocks UI)",
);
console.log("-".repeat(92));

for (const [meshCount, grid] of [
  [12, 60],
  [24, 90],
  [40, 120],
  [40, 170],
]) {
  const { doc, verts } = buildDoc(meshCount, grid);

  let t = now();
  const bytes = doc.toByteArray();
  const write = now() - t;
  doc.delete();

  // ── what Rhino3dmLoader's worker does ──
  t = now();
  const parsed = rhino.File3dm.fromByteArray(bytes);
  const parse = now() - t;

  const root = new THREE.Object3D();
  root.userData.layers = [];
  const layers = parsed.layers();
  for (let i = 0; i < layers.count; i++) {
    const l = layers.get(i);
    root.userData.layers.push({ name: l.name, fullPath: l.fullPath ?? l.name, visible: true });
  }

  // WORKER side: rhino -> plain-JS-array JSON, then structured-cloned back.
  const objs = parsed.objects();
  const jsons = [];
  const layerIdx = [];
  t = now();
  for (let i = 0; i < objs.count; i++) {
    const obj = objs.get(i);
    jsons.push(obj.geometry().toThreejsJSON());
    layerIdx.push(obj.attributes().layerIndex);
  }
  const toJson = now() - t;

  // MAIN-THREAD side: exactly what 3DMLoader._createObject does.
  t = now();
  const bgl = new THREE.BufferGeometryLoader();
  for (let i = 0; i < jsons.length; i++) {
    const mesh = new THREE.Mesh(bgl.parse(jsons[i]), new THREE.MeshStandardMaterial());
    mesh.userData.attributes = { layerIndex: layerIdx[i] };
    root.add(mesh);
  }
  const build = now() - t;
  parsed.delete();

  t = now();
  const out = await compressToJewelryScene(root);
  const compress = now() - t;
  out.traverse((c) => c.geometry?.dispose?.());

  const total = parse + toJson + build + compress;
  const blocking = build + compress;
  const s = (v) => `${(v / 1000).toFixed(2)}s`.padStart(7);
  console.log(
    `${String(verts).padStart(9)} | ${mb(bytes.length).padStart(6)} MB | ${s(parse)} | ${s(toJson)} | ` +
      `${s(build)} | ${s(compress).padStart(9)} | ${s(total)}  (UI frozen ${s(blocking).trim()})`,
  );
}
