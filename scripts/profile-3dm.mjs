/**
 * Profiles a real .3dm through the exact steps the browser performs, so the
 * slow phase is identified by measurement.
 *
 * Usage: node --max-old-space-size=8192 scripts/profile-3dm.mjs "path/to/file.3dm"
 */
import { readFileSync } from "node:fs";
import rhino3dm from "rhino3dm";

const FILE = process.argv[2];
if (!FILE) throw new Error("pass a .3dm path");

const now = () => Number(process.hrtime.bigint()) / 1e6;
const s = (ms) => `${(ms / 1000).toFixed(2)}s`;
const rhino = await rhino3dm();

console.log(`file: ${FILE}`);
let t = now();
const bytes = new Uint8Array(readFileSync(FILE));
console.log(`  read           ${s(now() - t)}   (${(bytes.length / 1048576).toFixed(1)} MB)`);

t = now();
const doc = rhino.File3dm.fromByteArray(bytes);
console.log(`  fromByteArray  ${s(now() - t)}`);
if (!doc) throw new Error("parse failed");

const layers = doc.layers();
const layerNames = [];
for (let i = 0; i < layers.count; i++) {
  const l = layers.get(i);
  layerNames.push({ name: l.name, full: l.fullPath ?? l.name, visible: l.visible });
}
console.log(`\nlayers (${layers.count}):`);
for (const l of layerNames) console.log(`   ${l.visible ? " " : "x"} ${l.full}`);

const objs = doc.objects();
console.log(`\nobjects: ${objs.count}`);

// Census by geometry type + per-type conversion cost.
const byType = new Map();
t = now();
let verts = 0;
let noMesh = 0;
const perObject = [];

for (let i = 0; i < objs.count; i++) {
  const obj = objs.get(i);
  const geo = obj.geometry();
  const type = geo.constructor.name;
  const attrs = obj.attributes();
  const layerName = layerNames[attrs.layerIndex]?.full ?? "?";

  const t0 = now();
  let n = 0;

  // Mirror 3DMLoader exactly: Breps are NOT convertible directly — it walks
  // every face and pulls the cached render mesh off each one.
  if (type === "Brep") {
    let faces = null;
    try {
      faces = geo.faces();
    } catch {
      /* not a brep after all */
    }
    if (faces) {
      for (let f = 0; f < faces.count; f++) {
        const face = faces.get(f);
        let m = null;
        try {
          m = face.getMesh(rhino.MeshType.Any);
        } catch {
          /* no cached mesh */
        }
        if (!m) continue;
        const j = m.toThreejsJSON();
        n += (j?.data?.attributes?.position?.array.length ?? 0) / 3;
      }
    }
  } else {
    try {
      const json = geo.toThreejsJSON();
      n = (json?.data?.attributes?.position?.array.length ?? 0) / 3;
    } catch {
      /* not convertible */
    }
  }

  const ms = now() - t0;
  if (!n) noMesh++;
  verts += n;

  const rec = byType.get(type) ?? { count: 0, ms: 0, verts: 0 };
  rec.count++;
  rec.ms += ms;
  rec.verts += n;
  byType.set(type, rec);

  perObject.push({ i, type, layerName, n, ms });
}
const convert = now() - t;

console.log(`\nby geometry type:`);
for (const [type, r] of [...byType].sort((a, b) => b[1].ms - a[1].ms)) {
  console.log(
    `   ${type.padEnd(16)} count=${String(r.count).padStart(5)}  verts=${String(r.verts).padStart(9)}  toThreejsJSON=${s(r.ms)}`,
  );
}

console.log(`\ntotals:`);
console.log(`   renderable vertices : ${verts.toLocaleString()}`);
console.log(`   objects w/o mesh    : ${noMesh}`);
console.log(`   toThreejsJSON total : ${s(convert)}`);

console.log(`\nslowest 10 objects:`);
for (const o of perObject.sort((a, b) => b.ms - a.ms).slice(0, 10)) {
  console.log(
    `   #${String(o.i).padStart(5)} ${o.type.padEnd(14)} ${s(o.ms).padStart(8)}  verts=${String(o.n).padStart(8)}  layer=${o.layerName}`,
  );
}

console.log(`\nper-layer vertex totals:`);
const byLayer = new Map();
for (const o of perObject) {
  const r = byLayer.get(o.layerName) ?? { verts: 0, count: 0 };
  r.verts += o.n;
  r.count++;
  byLayer.set(o.layerName, r);
}
for (const [name, r] of [...byLayer].sort((a, b) => b[1].verts - a[1].verts)) {
  console.log(
    `   ${name.padEnd(28)} objects=${String(r.count).padStart(5)}  verts=${r.verts.toLocaleString()}`,
  );
}

doc.delete();
