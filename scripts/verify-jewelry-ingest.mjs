/**
 * Verifies the .3dm ingest rules against a scene shaped exactly like
 * Rhino3dmLoader's output: all meshes flat under one root, layer table on
 * root.userData.layers, layer index on mesh.userData.attributes.layerIndex.
 */
import * as THREE from "three";
import { compressToJewelryScene } from "../.tmp-jewelry/loadJewelryFile.js";

let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`   ${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failures++;
};

function makeRoot(layers) {
  const root = new THREE.Object3D();
  root.userData.layers = layers;
  return root;
}

function add(root, geometry, layerIndex, name = "") {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = name;
  mesh.userData.attributes = { layerIndex, name };
  root.add(mesh);
  return mesh;
}

/** Fraction of triangles whose three vertex normals are identical (= flat shaded). */
function flatFraction(geo) {
  const n = geo.attributes.normal;
  const idx = geo.index;
  const tris = (idx ? idx.count : n.count) / 3;
  const at = (i) => {
    const v = idx ? idx.getX(i) : i;
    return [n.getX(v), n.getY(v), n.getZ(v)];
  };
  const same = (a, b) => a.every((x, k) => Math.abs(x - b[k]) < 1e-6);
  let flat = 0;
  for (let t = 0; t < tris; t++) {
    const [a, b, c] = [at(t * 3), at(t * 3 + 1), at(t * 3 + 2)];
    if (same(a, b) && same(b, c)) flat++;
  }
  return flat / tris;
}

const byName = (g, n) => g.children.find((c) => c.name === n);
const verts = (m) => m.geometry.attributes.position.count;

/** Run a single geometry through the real pipeline to get a comparison baseline. */
async function baselineVerts(geometry) {
  const root = makeRoot([{ name: "Metal 01", fullPath: "Metal 01", visible: true }]);
  add(root, geometry, 0);
  return verts(byName(await compressToJewelryScene(root), "metal"));
}

// ── 1. Metal*/Gem* convention: construction layers must be excluded ────────
{
  console.log("\n1. Rhino Metal/Gem convention");
  const root = makeRoot([
    { name: "Metal 01", fullPath: "Metal 01", visible: true },
    { name: "Gem 01", fullPath: "Gem 01", visible: true },
    { name: "Finger Sizes", fullPath: "Finger Sizes", visible: true },
    { name: "Cutting Objects", fullPath: "Cutting Objects", visible: true },
  ]);
  add(root, new THREE.TorusGeometry(10, 3, 16, 48), 0);
  add(root, new THREE.BoxGeometry(4, 4, 4), 1);
  const fingerSizes = new THREE.TorusGeometry(60, 2, 8, 32);
  add(root, fingerSizes, 2);
  add(root, new THREE.PlaneGeometry(400, 400), 3);

  const g = await compressToJewelryScene(root);
  check(
    "produces exactly metal + gem",
    g.children.length === 2,
    g.children.map((c) => c.name).join(","),
  );
  check("has a metal mesh", !!byName(g, "metal"));
  check("has a gem mesh", !!byName(g, "gem"));

  // Construction geometry was far larger than the jewellery; if it leaked in,
  // the normalised piece would be a fraction of the unit sphere.
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  check(
    "construction geometry excluded",
    size.length() > 1.5,
    `normalised extent ${size.length().toFixed(2)} (leak would shrink this)`,
  );
}

// ── 2. Hidden layers are scaffolding ───────────────────────────────────────
{
  console.log("\n2. Hidden layer handling");
  const root = makeRoot([
    { name: "Metal 01", fullPath: "Metal 01", visible: true },
    { name: "Metal 02", fullPath: "Metal 02", visible: false },
  ]);
  add(root, new THREE.TorusGeometry(10, 3, 16, 48), 0);
  const hidden = add(root, new THREE.BoxGeometry(200, 200, 1), 1);
  hidden.visible = false; // loader mirrors layer visibility onto the object

  const g = await compressToJewelryScene(root);
  const got = verts(byName(g, "metal"));
  const torusAlone = await baselineVerts(new THREE.TorusGeometry(10, 3, 16, 48));
  check(
    "hidden layer dropped",
    got === torusAlone,
    `${got} verts, torus-alone baseline ${torusAlone} (leak would add 36)`,
  );
}

// ── 3. No convention → relaxed pass, still rejects scaffolding ─────────────
{
  console.log("\n3. Non-conventional layer names");
  const root = makeRoot([
    { name: "Design", fullPath: "Design", visible: true },
    { name: "Stones", fullPath: "Stones", visible: true },
    { name: "Reference", fullPath: "Reference", visible: true },
  ]);
  add(root, new THREE.TorusGeometry(10, 3, 16, 48), 0);
  add(root, new THREE.BoxGeometry(4, 4, 4), 1);
  add(root, new THREE.PlaneGeometry(400, 400), 2);

  const g = await compressToJewelryScene(root);
  check("metal recovered from unnamed layer", !!byName(g, "metal"));
  check("gem recovered via 'Stones'", !!byName(g, "gem"));
  check("'Reference' layer excluded", g.children.length === 2);
}

// ── 4. The gold wall: a backdrop slab on a renderable layer ────────────────
{
  console.log("\n4. Backdrop slab removal (the gold wall)");
  const root = makeRoot([{ name: "Metal 01", fullPath: "Metal 01", visible: true }]);
  add(root, new THREE.TorusGeometry(10, 3, 16, 48), 0);
  add(root, new THREE.PlaneGeometry(400, 400), 0); // display card, same layer

  const g = await compressToJewelryScene(root);
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  check(
    "slab removed despite Metal layer",
    size.z > 0.1,
    `depth ${size.z.toFixed(3)} — a surviving flat plane would flatten this to ~0`,
  );
  check("jewellery survives", verts(byName(g, "metal")) > 500);
}

// ── 5. A genuinely flat piece must NOT be mistaken for a backdrop ──────────
{
  console.log("\n5. Flat pendant tag is preserved");
  const root = makeRoot([{ name: "Metal 01", fullPath: "Metal 01", visible: true }]);
  add(root, new THREE.TorusGeometry(60, 2, 12, 64), 0); // chain
  add(root, new THREE.BoxGeometry(12, 26, 0.8), 0); // flat tag, like LP043

  const g = await compressToJewelryScene(root);
  const got = verts(byName(g, "metal"));
  const chainAlone = await baselineVerts(new THREE.TorusGeometry(60, 2, 12, 64));
  // Geometry stays indexed now that source normals are preserved, so the tag
  // contributes exactly its own vertex count rather than 3-per-triangle.
  const tagVerts = new THREE.BoxGeometry(12, 26, 0.8).attributes.position.count;
  check(
    "tag kept alongside chain",
    got === chainAlone + tagVerts,
    `${got} verts = chain ${chainAlone} + tag ${got - chainAlone} (expected ${tagVerts})`,
  );
}

// ── 6. Shading quality: smooth metal, faceted gems ─────────────────────────
{
  console.log("\n6. Shading");
  const root = makeRoot([
    { name: "Metal 01", fullPath: "Metal 01", visible: true },
    { name: "Gem 01", fullPath: "Gem 01", visible: true },
  ]);
  add(root, new THREE.TorusGeometry(10, 3, 16, 48), 0);
  add(root, new THREE.OctahedronGeometry(3), 1);

  const g = await compressToJewelryScene(root);
  const metal = byName(g, "metal").geometry;
  const gem = byName(g, "gem").geometry;

  check("metal has normals", !!metal.attributes.normal);
  const mFlat = flatFraction(metal);
  check(
    "metal is smooth-shaded",
    mFlat < 0.05,
    `${(mFlat * 100).toFixed(1)}% of triangles flat (was 100% before the fix)`,
  );
  const gFlat = flatFraction(gem);
  check("gem stays faceted", gFlat > 0.95, `${(gFlat * 100).toFixed(1)}% of facets flat`);
}

// ── 7. Source normals are preserved, not rebuilt ───────────────────────────
{
  console.log("\n7. Source normals");
  const root = makeRoot([{ name: "Metal 01", fullPath: "Metal 01", visible: true }]);
  // TorusKnotGeometry ships normals, exactly like a Rhino render mesh.
  const src = new THREE.TorusKnotGeometry(1, 0.3, 64, 12);
  add(root, src, 0);

  const g = await compressToJewelryScene(root);
  const metal = byName(g, "metal").geometry;
  // Reconstructing would crease the mesh non-indexed, tripling the count.
  check(
    "keeps the supplied buffer (no weld/crease rebuild)",
    verts(byName(g, "metal")) === src.attributes.position.count,
    `${verts(byName(g, "metal"))} verts vs source ${src.attributes.position.count}`,
  );
  check("normals survive", !!metal.attributes.normal);
  check(
    "still smooth-shaded",
    flatFraction(metal) < 0.05,
    `${(flatFraction(metal) * 100).toFixed(1)}% flat`,
  );
}

// ── 8. Meshes with no normals still get shaded ─────────────────────────────
{
  console.log("\n8. Sources with no normals");
  const root = makeRoot([{ name: "Metal 01", fullPath: "Metal 01", visible: true }]);
  const bare = new THREE.TorusGeometry(10, 3, 16, 48);
  bare.deleteAttribute("normal");
  add(root, bare, 0);

  const g = await compressToJewelryScene(root);
  const metal = byName(g, "metal").geometry;
  check("normals reconstructed", !!metal.attributes.normal);
  check(
    "reconstruction is smooth",
    flatFraction(metal) < 0.05,
    `${(flatFraction(metal) * 100).toFixed(1)}% flat`,
  );
}

// ── 9. Absurd models fail with guidance, not a crash ───────────────────────
{
  console.log("\n9. Oversized model guard");
  const root = makeRoot([{ name: "Metal 01", fullPath: "Metal 01", visible: true }]);
  // 10 x 402,201 = 4.02M verts, just past the 4M ceiling.
  for (let i = 0; i < 10; i++) add(root, new THREE.TorusKnotGeometry(1, 0.3, 2000, 200), 0);
  let msg = "";
  try {
    await compressToJewelryScene(root);
  } catch (e) {
    msg = e.message;
  }
  check(
    "rejects with an actionable message",
    /vertices.*viewer can hold/i.test(msg),
    msg.slice(0, 110),
  );
}

// ── 10. Metal must survive real-world layer names (the LR-1341 bug) ────────
{
  console.log("\n10. Metal survives real layer names");
  // "Gold" contains "old"; an unanchored construction regex deleted the metal.
  for (const metalLayer of [
    "Gold",
    "18k Gold",
    "White Gold",
    "Yellow Gold",
    "Shank",
    "Head",
    "Prongs",
    "Bezel",
  ]) {
    const root = makeRoot([
      { name: metalLayer, fullPath: metalLayer, visible: true },
      { name: "Diamond", fullPath: "Diamond", visible: true },
    ]);
    add(root, new THREE.TorusGeometry(10, 3, 16, 48), 0);
    add(root, new THREE.OctahedronGeometry(3), 1);

    const g = await compressToJewelryScene(root);
    check(`"${metalLayer}" kept as metal`, !!byName(g, "metal") && !!byName(g, "gem"));
  }
}

// ── 11. Half-followed convention keeps both halves ─────────────────────────
{
  console.log("\n11. Partial Metal/Gem convention");
  // Stones on "Gem 01", metal on a non-conventional layer. The strict pass
  // matches only the stones, so it must not be trusted on its own.
  const root = makeRoot([
    { name: "Gem 01", fullPath: "Gem 01", visible: true },
    { name: "Gold", fullPath: "Gold", visible: true },
  ]);
  add(root, new THREE.OctahedronGeometry(3), 0);
  add(root, new THREE.TorusGeometry(10, 3, 16, 48), 1);

  const g = await compressToJewelryScene(root);
  check("gem kept", !!byName(g, "gem"));
  check("metal recovered despite strict pass matching only the gem", !!byName(g, "metal"));
}

// ── 12. Scaffolding is still excluded after the loosening ──────────────────
{
  console.log("\n12. Scaffolding still excluded");
  const root = makeRoot([
    { name: "Gold", fullPath: "Gold", visible: true },
    { name: "Finger Sizes", fullPath: "Finger Sizes", visible: true },
    { name: "Cutting Objects", fullPath: "Cutting Objects", visible: true },
  ]);
  add(root, new THREE.TorusGeometry(10, 3, 16, 48), 0);
  add(root, new THREE.TorusGeometry(60, 2, 8, 32), 1);
  add(root, new THREE.PlaneGeometry(400, 400), 2);

  const g = await compressToJewelryScene(root);
  const goldAlone = await baselineVerts(new THREE.TorusGeometry(10, 3, 16, 48));
  check("metal kept", !!byName(g, "metal"));
  check(
    "Finger Sizes + Cutting Objects still dropped",
    verts(byName(g, "metal")) === goldAlone,
    `${verts(byName(g, "metal"))} verts vs gold-alone ${goldAlone}`,
  );
}

// ── 13. Block-instanced stones survive a hidden definition layer ───────────
{
  console.log("\n13. Block instances (pavé placed as blocks)");
  // Rhino3dmLoader emits instances as root > wrapper > clonedMesh, and the
  // clone inherits the definition layer's visibility — routinely switched off.
  const root = makeRoot([
    { name: "Gold", fullPath: "Gold", visible: true },
    { name: "Block Definitions", fullPath: "Block Definitions", visible: false },
  ]);
  add(root, new THREE.TorusGeometry(10, 3, 16, 48), 0); // the band

  let stones = 0;
  for (let i = 0; i < 12; i++) {
    const wrapper = new THREE.Object3D();
    wrapper.position.set(Math.cos(i) * 10, Math.sin(i) * 10, 0);
    const stone = new THREE.Mesh(new THREE.OctahedronGeometry(1), new THREE.MeshStandardMaterial());
    stone.name = "Diamond";
    stone.userData.attributes = { layerIndex: 1, name: "Diamond" };
    stone.visible = false; // definition layer is off
    wrapper.add(stone);
    root.add(wrapper);
    stones++;
  }

  const g = await compressToJewelryScene(root);
  check("band kept", !!byName(g, "metal"));
  check(`all ${stones} instanced stones kept`, !!byName(g, "gem"));
  if (byName(g, "gem")) {
    const one = new THREE.OctahedronGeometry(1).attributes.position.count;
    check(
      "every instance present, not just one",
      verts(byName(g, "gem")) >= one * stones,
      `${verts(byName(g, "gem"))} verts vs ${one * stones} expected`,
    );
  }
  // A hidden *top-level* layer must still be excluded.
  const root2 = makeRoot([
    { name: "Gold", fullPath: "Gold", visible: true },
    { name: "Scrap", fullPath: "Scrap", visible: false },
  ]);
  add(root2, new THREE.TorusGeometry(10, 3, 16, 48), 0);
  const junk = add(root2, new THREE.BoxGeometry(200, 200, 1), 1);
  junk.visible = false;
  const g2 = await compressToJewelryScene(root2);
  const bandAlone = await baselineVerts(new THREE.TorusGeometry(10, 3, 16, 48));
  check(
    "hidden top-level layer still dropped",
    verts(byName(g2, "metal")) === bandAlone,
    `${verts(byName(g2, "metal"))} vs ${bandAlone}`,
  );
}

// ── 14. Every jewellery type, however the studio named its layers ──────────
{
  console.log("\n14. Jewellery types and naming conventions");
  const PIECES = [
    ["Solitaire ring", ["Shank", "Head", "Center Diamond"]],
    ["Pavé band", ["18k Gold", "Melee"]],
    ["Necklace", ["Chain", "Bail", "Pendant Stone"]],
    ["Earrings", ["Post", "Butterfly", "Sapphire"]],
    ["Bracelet", ["Links", "Clasp", "CZ"]],
    ["Bangle", ["Sterling Silver", "Amethyst"]],
    ["Halo ring", ["Halo", "Basket", "Gallery", "Moissanite"]],
    ["Bezel pendant", ["Bezel", "Collet", "Cabochon"]],
    ["Platinum set", ["Platinum", "Prongs", "Tanzanite"]],
    ["Unnamed layers", ["Layer 01", "Layer 02"]],
    ["No layers at all", []],
  ];

  for (const [label, names] of PIECES) {
    const root = makeRoot(names.map((n) => ({ name: n, fullPath: n, visible: true })));
    if (names.length === 0) {
      // Some exports carry no layer table whatsoever.
      add(root, new THREE.TorusGeometry(10, 3, 16, 48), -1);
      add(root, new THREE.OctahedronGeometry(3), -1);
    } else {
      names.forEach((_, i) =>
        add(
          root,
          i === names.length - 1
            ? new THREE.OctahedronGeometry(3)
            : new THREE.TorusGeometry(10, 3, 16, 48),
          i,
        ),
      );
    }

    let g, err;
    try {
      g = await compressToJewelryScene(root);
    } catch (e) {
      err = e.message;
    }
    const parts = g ? g.children.map((c) => c.name).join("+") : "—";
    check(
      `${label.padEnd(16)} renders (${parts})`,
      !err && !!g && g.children.length > 0 && !!byName(g, "metal"),
      err ?? "",
    );
  }
}

// ── 15. Empty / unusable input fails loudly ────────────────────────────────
{
  console.log("\n7. Error handling");
  let msg = "";
  try {
    await compressToJewelryScene(makeRoot([]));
  } catch (e) {
    msg = e.message;
  }
  check("empty scene throws a useful message", /render meshes/i.test(msg), msg);
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : "\nAll checks passed\n");
process.exit(failures ? 1 : 0);
