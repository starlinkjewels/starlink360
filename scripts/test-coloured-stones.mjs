/**
 * Coloured stones, end to end.
 *
 * A piece can carry diamond, ruby and sapphire at once, and every one of them
 * has to come out of the decoder as its own mesh carrying its own colour —
 * merge them and every stone renders as a white diamond.
 *
 * No client file has ever been available to check that on, so this builds one:
 * a real .3dm, written with rhino3dm, with stones coloured three different
 * ways Rhino actually stores colour, then run through the REAL worker source.
 *
 * Usage: node scripts/test-coloured-stones.mjs
 */
import rhino3dm from "rhino3dm";
import { WORKER_SOURCE } from "../.tmp-jewelry/rhinoDecode.js";

const rhino = await rhino3dm();

/** A closed octahedron — stone-shaped, and no filter should reject it. */
function gemMesh(cx, cy, cz, s) {
  const mesh = new rhino.Mesh();
  const v = mesh.vertices();
  v.add(cx + s, cy, cz);
  v.add(cx - s, cy, cz);
  v.add(cx, cy + s, cz);
  v.add(cx, cy - s, cz);
  v.add(cx, cy, cz + s);
  v.add(cx, cy, cz - s);
  const f = mesh.faces();
  // Wound outward, consistently.
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

function addMaterial(name, r, g, b) {
  const m = new rhino.Material();
  m.name = name;
  m.diffuseColor = { r, g, b, a: 255 };
  return doc.materials().add(m);
}

function addLayer(name, materialIndex) {
  const l = new rhino.Layer();
  l.name = name;
  if (materialIndex !== undefined) l.renderMaterialIndex = materialIndex;
  return doc.layers().add(l);
}

// Colours a jeweller would actually send.
const MATS = {
  diamond: addMaterial("Diamond", 255, 255, 255),
  ruby: addMaterial("Ruby", 176, 16, 42),
  sapphire: addMaterial("Blue Sapphire", 11, 63, 168),
  emerald: addMaterial("Emerald", 15, 122, 61),
  gold: addMaterial("18k Yellow Gold", 212, 175, 55),
  // Deliberately below the decoder's near-black threshold — see the onyx check.
  onyx: addMaterial("Black Onyx", 10, 10, 12),
};

const layerStone = addLayer("Diamond");
// This layer carries the colour itself, with nothing set on the objects —
// the ByLayer case, which is how most real files are organised.
const layerEmerald = addLayer("Stone::Emerald Accents", MATS.emerald);
const layerMetal = addLayer("Gold", MATS.gold);

function place(mesh, layerIndex, materialIndex) {
  const a = new rhino.ObjectAttributes();
  a.layerIndex = layerIndex;
  if (materialIndex !== undefined) {
    a.materialIndex = materialIndex;
    a.materialSource = rhino.ObjectMaterialSource.MaterialFromObject;
  }
  doc.objects().addMesh(mesh, a);
}

// Per-object colour: three different stones on one stone layer.
place(gemMesh(0, 0, 0, 4), layerStone, MATS.diamond);
place(gemMesh(10, 0, 0, 3), layerStone, MATS.ruby);
place(gemMesh(20, 0, 0, 3), layerStone, MATS.sapphire);
place(gemMesh(30, 0, 0, 3), layerStone, MATS.ruby); // second ruby — must merge with the first
// ByLayer colour: nothing set on the object at all.
place(gemMesh(40, 0, 0, 2), layerEmerald);
place(gemMesh(50, 0, 0, 2), layerEmerald);
// A genuinely dark stone, to pin down what the near-black guard does to one.
place(gemMesh(60, 0, 0, 3), layerStone, MATS.onyx);
// Metal, so the stones have something to be separated from.
place(gemMesh(0, -20, 0, 12), layerMetal, MATS.gold);

const bytes = doc.toByteArray();
console.log(`  built a ${(bytes.length / 1024).toFixed(1)} KB .3dm with 7 stones in 5 colours\n`);

// ── run the real worker ────────────────────────────────────────────────────
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

await self.onmessage({
  data: {
    type: "decode",
    buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
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
for (let i = 0; i < 400 && !done; i++) await new Promise((r) => setTimeout(r, 25));

if (!done) {
  console.log("  TIMED OUT");
  process.exit(1);
}
if (done.type === "error") {
  console.log("  DECODE ERROR:", done.message);
  process.exit(1);
}

// ── check ──────────────────────────────────────────────────────────────────
const gems = done.gems ?? [];
console.log(`  decoder returned ${gems.length} stone group(s):`);
for (const g of gems) {
  console.log(
    `    ${String(g.color).padEnd(9)} verts=${String(g.position.length / 3).padStart(4)}  material="${g.material}"`,
  );
}
console.log(`  metal: ${done.metal ? done.metal.position.length / 3 + " verts" : "(none)"}\n`);

const EXPECTED = [
  { hex: "#ffffff", stones: 2, label: "Diamond + onyx fallback (per-object)" },
  { hex: "#b0102a", stones: 2, label: "Ruby x2, merged (per-object)" },
  { hex: "#0b3fa8", stones: 1, label: "Sapphire (per-object)" },
  { hex: "#0f7a3d", stones: 2, label: "Emerald x2, merged (ByLayer)" },
];

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

for (const want of EXPECTED) {
  const got = gems.find((g) => String(g.color).toLowerCase() === want.hex);
  if (!got) {
    check(false, want.label, `no group with colour ${want.hex}`);
    continue;
  }
  // 6 verts per octahedron. The decoder keeps the mesh's shared vertices —
  // faceting splits them per triangle later, in Model.tsx, not here.
  const expectVerts = want.stones * 6;
  check(
    got.position.length / 3 === expectVerts,
    want.label,
    `${want.hex}, ${got.position.length / 3} verts (expected ${expectVerts})`,
  );
}

/*
 * Known limitation, asserted so it cannot change silently.
 *
 * Rhino leaves diffuse at (0,0,0) on any material where it was never set, so
 * the decoder reads anything below 24/255 as "unset" and falls back to
 * colourless. That is right for the common case and wrong for a genuinely dark
 * stone: black onyx, black spinel and the darkest garnets come through white.
 * Raising the threshold is not a fix — it would let real unset materials paint
 * stones black again, which is the worse failure.
 */
const onyx = gems.find((g) => String(g.color).toLowerCase() === "#0a0a0c");
check(
  !onyx,
  "KNOWN: black onyx is NOT kept dark — it falls back to colourless",
  onyx ? "unexpectedly preserved" : "merged into the #ffffff group, as designed",
);

check(gems.length === EXPECTED.length, "no extra or missing groups", `${gems.length} groups`);
check(!!done.metal, "metal kept separate from the stones");
check(
  !gems.some((g) => String(g.color).toLowerCase() === "#d4af37"),
  "gold did not leak into the stones",
);

// The colour has to survive the trip into the mesh name and back out, because
// that round trip is how the viewer's material gets its tint.
const NAME = /gem-([0-9a-f]{6})/i;
for (const g of gems) {
  const name = `gem-${String(g.color).slice(1)}`;
  const back = NAME.exec(name);
  check(
    !!back && "#" + back[1].toLowerCase() === String(g.color).toLowerCase(),
    `colour survives the gem-<hex> mesh name (${name})`,
  );
}

console.log(failures === 0 ? "\n  All checks passed" : `\n  ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
