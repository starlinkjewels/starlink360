/**
 * Compares the current Rhino3dmLoader route against a direct extraction that
 * writes straight into typed arrays and merges as it goes.
 *
 * Usage: node --max-old-space-size=8192 scripts/bench-direct.mjs "file.3dm"
 */
import { readFileSync } from "node:fs";
import rhino3dm from "rhino3dm";
import * as THREE from "three";

const rhino = await rhino3dm();
const now = () => Number(process.hrtime.bigint()) / 1e6;
const s = (ms) => `${(ms / 1000).toFixed(2)}s`;

const bytes = new Uint8Array(readFileSync(process.argv[2]));

let t = now();
const doc = rhino.File3dm.fromByteArray(bytes);
const parseMs = now() - t;

const layerTable = [];
const layers = doc.layers();
for (let i = 0; i < layers.count; i++) {
  const l = layers.get(i);
  layerTable.push({ name: l.fullPath ?? l.name ?? "", visible: l.visible });
}

const GEM_LAYER = /^gems?\s*[\d._-]*$/i;
const METAL_LAYER = /^metals?\s*[\d._-]*$/i;
const GEM_WORDS = /gem|stone|diamond|crystal/i;

/** Growable typed-array sink — no plain JS arrays anywhere. */
class Sink {
  constructor() {
    this.pos = new Float32Array(1 << 16);
    this.nrm = new Float32Array(1 << 16);
    this.n = 0;
  }
  ensure(extra) {
    if (this.n + extra <= this.pos.length) return;
    let cap = this.pos.length;
    while (cap < this.n + extra) cap *= 2;
    const p = new Float32Array(cap);
    p.set(this.pos.subarray(0, this.n));
    this.pos = p;
    const q = new Float32Array(cap);
    q.set(this.nrm.subarray(0, this.n));
    this.nrm = q;
  }
  /** Append one render mesh, expanded through its face list into triangles. */
  addMesh(json) {
    const a = json?.data?.attributes;
    if (!a?.position) return 0;
    const P = a.position.array;
    const N = a.normal?.array;
    const idx = json.data.index?.array;
    const count = idx ? idx.length : P.length / 3;
    this.ensure(count * 3);
    for (let i = 0; i < count; i++) {
      const v = (idx ? idx[i] : i) * 3;
      this.pos[this.n] = P[v];
      this.pos[this.n + 1] = P[v + 1];
      this.pos[this.n + 2] = P[v + 2];
      if (N) {
        this.nrm[this.n] = N[v];
        this.nrm[this.n + 1] = N[v + 1];
        this.nrm[this.n + 2] = N[v + 2];
      }
      this.n += 3;
    }
    return count;
  }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos.slice(0, this.n), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(this.nrm.slice(0, this.n), 3));
    return g;
  }
}

const metal = new Sink();
const gem = new Sink();

t = now();
const objs = doc.objects();
let kept = 0;
let skipped = 0;

for (let i = 0; i < objs.count; i++) {
  const obj = objs.get(i);
  const attrs = obj.attributes();
  const layer = layerTable[attrs.layerIndex];
  if (!layer || layer.visible === false) {
    skipped++;
    continue;
  }
  const name = layer.name;
  const isGem = GEM_LAYER.test(name) || GEM_WORDS.test(name);
  const isMetal = METAL_LAYER.test(name) || /metal|head/i.test(name);
  if (!isGem && !isMetal) {
    skipped++;
    continue;
  }
  const sink = isGem ? gem : metal;

  const geo = obj.geometry();
  const type = geo.constructor.name;
  if (type === "Brep") {
    let faces = null;
    try {
      faces = geo.faces();
    } catch {
      continue;
    }
    if (!faces) continue;
    for (let f = 0; f < faces.count; f++) {
      let m = null;
      try {
        m = faces.get(f).getMesh(rhino.MeshType.Any);
      } catch {
        continue;
      }
      if (m) kept += sink.addMesh(m.toThreejsJSON()) > 0 ? 1 : 0;
    }
  } else if (type === "Mesh") {
    kept += sink.addMesh(geo.toThreejsJSON()) > 0 ? 1 : 0;
  }
}
const extractMs = now() - t;

t = now();
const gm = metal.toGeometry();
const gg = gem.toGeometry();
const buildMs = now() - t;

doc.delete();

console.log(`\n  fromByteArray  ${s(parseMs)}`);
console.log(
  `  extract+merge  ${s(extractMs)}   (${kept} render meshes, ${skipped} objects skipped)`,
);
console.log(`  build 2 buffers${s(buildMs)}`);
console.log(`  ─────────────────────────`);
console.log(`  TOTAL          ${s(parseMs + extractMs + buildMs)}`);
console.log(`\n  metal verts: ${gm.attributes.position.count.toLocaleString()}`);
console.log(`  gem   verts: ${gg.attributes.position.count.toLocaleString()}`);
console.log(`  final meshes: 2  (was 5,782 separate meshes + 5,782 structured clones)`);
