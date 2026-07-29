/**
 * Converts a .3dm to a Draco-compressed GLB for shipping as a built-in piece.
 *
 * Runs the SAME worker source the browser uses (src/lib/rhinoDecode.ts) so the
 * offline asset and an in-browser upload can never disagree. The previous
 * version of this script kept its own copy of the extraction logic and silently
 * dropped block-instanced stones — LP043.glb shipped with 1,108 gem vertices
 * where the source file actually holds 80,080.
 *
 * Usage: npm run convert:3dm -- "input.3dm" public/OUT.glb
 */
import { readFileSync, writeFileSync } from "node:fs";
import rhino3dm from "rhino3dm";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import gltfPipeline from "gltf-pipeline";
import { WORKER_SOURCE } from "../.tmp-jewelry/rhinoDecode.js";

const { processGlb } = gltfPipeline;
const INPUT = process.argv[2];
const OUTPUT = process.argv[3] ?? "public/out.glb";
if (!INPUT) throw new Error('usage: npm run convert:3dm -- "input.3dm" public/out.glb');

const mb = (b) => (b / 1048576).toFixed(1);

// ── Node polyfills GLTFExporter expects ──────────────────────────────────
if (typeof globalThis.Blob === "undefined") {
  globalThis.Blob = (await import("node:buffer")).Blob;
}
if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((b) => {
        this.result = b;
        setImmediate(() => {
          this.onload?.({ target: this });
          this.onloadend?.({ target: this });
        });
      });
    }
  };
}

// ── run the real worker source with `self` stubbed ───────────────────────
let decoded;
globalThis.self = {
  onmessage: null,
  importScripts: () => {},
  rhino3dm: (opts) => rhino3dm(opts),
  postMessage: (m) => {
    if (m.type === "progress") {
      process.stdout.write(`\r  decoding ${Math.round((m.done / m.total) * 100)}%   `);
    } else decoded = m;
  },
};
(0, eval)(WORKER_SOURCE);

console.log(`⏳  ${INPUT}`);
const buffer = readFileSync(INPUT).buffer;
await self.onmessage({
  data: {
    type: "decode",
    buffer,
    libraryPath: "./node_modules/rhino3dm/",
    rules: {
      gemLayer: "^gems?\\s*[\\d._-]*$",
      metalLayer: "^metals?\\s*[\\d._-]*$",
      gemWords: "gem|stone|diamond|crystal|glass|brilliant|sapphire|ruby|emerald|pearl",
      metalWords:
        "metal|band|shank|setting|prong|bezel|gold|silver|platinum|mount|head|bail|chain|ring|gallery|halo|basket",
      constructionWords:
        "\\b(finger\\s*sizes?|cutting\\s*objects?|construction|reference|guides?|old)\\b",
    },
  },
});
for (let i = 0; i < 12000 && !decoded; i++) await new Promise((r) => setTimeout(r, 25));
console.log("");
if (!decoded || decoded.type === "error") throw new Error(decoded?.message ?? "decode timed out");

// ── assemble, normalise, export ──────────────────────────────────────────
const group = new THREE.Group();
// Metal, then one mesh per stone colour. The "gem-" prefix is what the viewer
// matches stones on, and the hex after it carries the colour through the GLB.
const buckets = [["metal", decoded.metal]].concat(
  (decoded.gems ?? []).map((g) => [`gem-${g.color.replace("#", "")}`, g]),
);
for (const [name, b] of buckets) {
  if (!b) continue;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(b.position, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(b.normal, 3));
  g.setIndex(new THREE.BufferAttribute(b.index, 1));
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.22 }));
  mesh.name = name;
  group.add(mesh);
  const label = b.material ? ` (${b.material})` : "";
  console.log(`✔   ${name}${label}: ${(b.position.length / 3).toLocaleString()} verts`);
}
if (!group.children.length) throw new Error("nothing renderable found");

// Unit bounding sphere at the origin. The scale has to be folded into the
// offset as well, or the piece ends up displaced by a model-unit distance at
// unit scale — the bug that left the old LP043.glb sitting 16 radii off-centre.
const box = new THREE.Box3().setFromObject(group);
const sphere = box.getBoundingSphere(new THREE.Sphere());
const s = 1 / (sphere.radius || 1);
group.scale.setScalar(s);
group.position.set(-sphere.center.x * s, -sphere.center.y * s, -sphere.center.z * s);
group.updateMatrixWorld(true);

console.log("⏳  exporting GLB…");
const raw = await new GLTFExporter().parseAsync(group, { binary: true });
console.log(`✔   raw GLB: ${mb(raw.byteLength)} MB`);

console.log("⏳  Draco compressing…");
const out = await processGlb(Buffer.from(raw), {
  dracoOptions: {
    compressionLevel: 10,
    quantizePositionBits: 14,
    quantizeNormalBits: 10,
    uncompressedFallback: false,
  },
});
writeFileSync(OUTPUT, Buffer.from(out.glb));
console.log(
  `✅  ${mb(raw.byteLength)} MB → ${mb(out.glb.byteLength)} MB  ` +
    `(${(raw.byteLength / out.glb.byteLength).toFixed(1)}x)  → ${OUTPUT}`,
);
