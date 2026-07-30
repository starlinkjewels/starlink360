/**
 * Stones whose colour lives only in the material NAME.
 *
 * This is the RhinoGold / MatrixGold pattern, and it is how this client's files
 * are actually authored: materials called "/Diamond0.2-<guid>" with plain white
 * diffuse, because the plugin keeps the gem colour in its own data. Read
 * literally, every coloured stone in such a file is a colourless diamond.
 *
 * Every material below is deliberately WHITE. The only colour signal is the
 * name.
 *
 * Usage: node scripts/test-named-stones.mjs
 */
import rhino3dm from "rhino3dm";
import { WORKER_SOURCE } from "../.tmp-jewelry/rhinoDecode.js";

const rhino = await rhino3dm();
const doc = new rhino.File3dm();

function gemMesh(cx, s) {
  const mesh = new rhino.Mesh();
  const v = mesh.vertices();
  v.add(cx + s, 0, 0);
  v.add(cx - s, 0, 0);
  v.add(cx, s, 0);
  v.add(cx, -s, 0);
  v.add(cx, 0, s);
  v.add(cx, 0, -s);
  const f = mesh.faces();
  [
    [0, 2, 4],
    [2, 1, 4],
    [1, 3, 4],
    [3, 0, 4],
    [2, 0, 5],
    [1, 2, 5],
    [3, 1, 5],
    [0, 3, 5],
  ].forEach((t) => f.addTriFace(...t));
  mesh.normals().computeNormals();
  return mesh;
}

/** Always white — exactly as the plugin writes it. */
function whiteMaterial(name) {
  const m = new rhino.Material();
  m.name = name;
  m.diffuseColor = { r: 255, g: 255, b: 255, a: 255 };
  m.transparentColor = { r: 255, g: 255, b: 255, a: 255 };
  return doc.materials().add(m);
}

const layer = new rhino.Layer();
layer.name = "Gem 01";
const gemLayer = doc.layers().add(layer);
const metalLayer = (() => {
  const l = new rhino.Layer();
  l.name = "Metal 01";
  return doc.layers().add(l);
})();

// Plugin-style names, sizes and GUIDs included, all with white materials.
const CASES = [
  ["/Diamond0.2-960779ad-78a9-4f57-b66d-568aee82f44b", "#ffffff", "diamond stays colourless"],
  ["/Pink Sapphire0.15-aa11bb22", "#efa0bd", "pink sapphire reads pink, not blue"],
  ["/Blue Sapphire0.2-cc33dd44", "#12409b", "blue sapphire reads blue"],
  ["/Ruby0.1-ee55ff66", "#a5182b", "ruby reads red"],
  ["/Emerald0.3-1122aabb", "#0d7a45", "emerald reads green"],
  ["/Black Onyx4.0-99887766", "#141419", "onyx stays dark despite the near-black guard"],
  ["/Amethyst0.25-5566aabb", "#8f5cc0", "amethyst reads purple"],
  ["/Blue Topaz0.4-77aa88bb", "#77c6d8", "blue topaz reads aqua, not plain topaz"],
  ["/Cubic Zirconia0.2-abcdef01", "#ffffff", "CZ stays colourless"],
];

let x = 0;
for (const [name] of CASES) {
  const a = new rhino.ObjectAttributes();
  a.layerIndex = gemLayer;
  a.materialIndex = whiteMaterial(name);
  a.materialSource = rhino.ObjectMaterialSource.MaterialFromObject;
  doc.objects().addMesh(gemMesh((x += 12), 3), a);
}
// A white metal material named after a metal must NOT be tinted.
{
  const a = new rhino.ObjectAttributes();
  a.layerIndex = metalLayer;
  a.materialIndex = whiteMaterial("/Platinum-c2c50e8c-7ef4-477a-89ff-b43d05066f71");
  a.materialSource = rhino.ObjectMaterialSource.MaterialFromObject;
  doc.objects().addMesh(gemMesh(-30, 10), a);
}

const bytes = doc.toByteArray();
console.log(
  `  built a .3dm with ${CASES.length} stones — every material WHITE, name is the only signal\n`,
);

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
      gemLayer: "^gems?\s*[\d._-]*$",
      metalLayer: "^metals?\s*[\d._-]*$",
      gemWords: "gem|stone|diamond|crystal|glass|brilliant|sapphire|ruby|emerald|pearl",
      metalWords:
        "metal|band|shank|setting|prong|bezel|gold|silver|platinum|mount|head|bail|chain|ring|gallery|halo|basket",
      constructionWords:
        "\b(finger\s*sizes?|cutting\s*objects?|construction|reference|guides?|old)\b",
    },
  },
});
for (let i = 0; i < 400 && !done; i++) await new Promise((r) => setTimeout(r, 25));
if (!done || done.type === "error") {
  console.log("  DECODE FAILED:", done?.message ?? "timeout");
  process.exit(1);
}

const gems = done.gems ?? [];
console.log("  decoder returned:");
for (const g of gems)
  console.log(`    ${g.color}  ${g.position.length / 3} verts  "${g.material}"`);
console.log();

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};
for (const [name, want, label] of CASES) {
  /*
   * Look up by material name first, then by colour. Stones that resolve to the
   * same colour are merged into one group on purpose, and the group keeps only
   * the first material's name — so a colourless stone is legitimately not
   * findable by its own name once it has joined the white group.
   */
  const got =
    gems.find((g) => String(g.material) === name) ??
    gems.find((g) => String(g.color).toLowerCase() === want);
  const merged = got !== undefined && String(got.material) !== name;
  check(
    got !== undefined && String(got.color).toLowerCase() === want,
    label,
    got
      ? `got ${got.color}${merged ? " (merged into the " + got.color + " group)" : ""}`
      : "no group with that name or colour",
  );
}

// The two colourless stones must be one group, not two.
const white = gems.find((g) => String(g.color).toLowerCase() === "#ffffff");
check(
  white !== undefined && white.position.length / 3 === 12,
  "diamond and CZ merged into a single colourless group",
  white ? `${white.position.length / 3} verts (expected 12 = 2 stones)` : "no white group",
);
check(!!done.metal, "metal survived");
check(
  !gems.some((g) => String(g.material).includes("Platinum")),
  "platinum was not tinted as a stone",
);
console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);
