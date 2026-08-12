/**
 * Selection behaviour.
 *
 * Click semantics are the sort of thing that feels obviously right and is
 * obviously wrong once someone uses it: additive click must toggle, plain click
 * must replace, and there must always be a way to end up with nothing selected
 * without reaching for the keyboard.
 *
 * Usage: node scripts/test-selection.mjs
 */
import * as THREE from "three";
import {
  applyClick,
  attachHighlight,
  collectParts,
  describeSelection,
  ensurePart,
  hideOverlays,
  parseId,
  SELECT_COLOR,
  solidAt,
  solidId,
  solidRange,
  synthLabel,
  uniqueLabel,
} from "../.tmp-jewelry/selection.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};
const set = (...ids) => new Set(ids);
const eq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

console.log("=== plain click replaces ===");
check(eq(applyClick(set(), "a", false), set("a")), "from nothing, selects it");
check(eq(applyClick(set("b"), "a", false), set("a")), "replaces a different part");
check(eq(applyClick(set("a", "b"), "a", false), set("a")), "collapses a multi-selection to one");

console.log("\n=== clicking the only selection clears it ===");
check(
  eq(applyClick(set("a"), "a", false), set()),
  "there is always a way out without the keyboard",
);
check(
  eq(applyClick(set("a", "b"), "b", false), set("b")),
  "but with two selected it narrows, it does not clear",
);

console.log("\n=== ctrl/shift click toggles ===");
check(eq(applyClick(set("a"), "b", true), set("a", "b")), "adds");
check(eq(applyClick(set("a", "b"), "a", true), set("b")), "removes");
check(eq(applyClick(set("a"), "a", true), set()), "removing the last one leaves nothing");
check(eq(applyClick(set(), "a", true), set("a")), "additive from empty still selects");

console.log("\n=== the input is never mutated ===");
{
  const before = set("a");
  applyClick(before, "b", true);
  check(eq(before, set("a")), "applyClick returns a new set, so React sees a change");
}

console.log("\n=== what the HUD says ===");
const parts = [
  { id: "m1", label: "Metal 01", kind: "metal" },
  { id: "m2", label: "Heads", kind: "metal" },
  { id: "g1", label: "Gem 03", kind: "stone" },
];
check(describeSelection(parts, set()) === "", "nothing selected says nothing");
check(describeSelection(parts, set("g1")) === "Gem 03", "one part is named, not counted");
check(describeSelection(parts, set("m1", "g1")) === "2 parts", "two are counted");
check(
  describeSelection(parts, set("m1", "m2", "g1")) === "everything",
  "all of them reads as everything, which is more useful than '3 parts'",
);
check(
  describeSelection(parts, set("gone")) === "",
  "an id that no longer exists is ignored, not counted",
);

console.log("\n=== collectParts reads the built scene ===");
{
  const mesh = (id, label, kind) => ({
    isMesh: true,
    userData: { part: { id, label, kind } },
  });
  const plain = { isMesh: true, userData: {} };
  const root = {
    traverse(fn) {
      [mesh("a", "Metal 01", "metal"), plain, mesh("b", "Gem 03", "stone")].forEach(fn);
    },
  };
  const found = collectParts(root);
  check(found.length === 2, "only tagged meshes are selectable", `${found.length} of 3`);
  check(found[0].kind === "metal" && found[1].kind === "stone", "kind survives");
  check(found[1].label === "Gem 03", "label survives");
}

/*
 * The highlight, against real three objects.
 *
 * A bounding box was the first attempt and it was useless — around a 740k-vert
 * metal group it encloses the whole ring. The tint replaced it, and it brings
 * two ways to break things silently that are worth pinning down: an overlay
 * that swallows clicks, and an overlay that ends up in an exported photo.
 */
console.log("\n=== the selection tint ===");
{
  const part = (id) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.userData.part = { id, label: id, kind: "metal" };
    return { id, label: id, kind: "metal", mesh };
  };
  const a = part("a");
  const b = part("b");
  const parts = [a, b];

  const detach = attachHighlight(parts, new Set(["a"]), SELECT_COLOR, 0.5);
  check(
    a.mesh.children.length === 2,
    "a solid pass and an x-ray pass",
    `${a.mesh.children.length}`,
  );
  check(b.mesh.children.length === 0, "an unselected part is untouched");
  check(
    a.mesh.children.every(
      (c) => c.geometry.attributes.position.array === a.mesh.geometry.attributes.position.array,
    ),
    "the tint shares the part's vertex buffers — no second copy of 740k verts",
  );
  check(
    a.mesh.children.every((c) => c.matrix.equals(new THREE.Matrix4())),
    "parented at identity, so it inherits the part's transform and cannot drift",
  );
  check(
    a.mesh.children.some((c) => c.material.depthTest === false),
    "one pass ignores depth, so a part behind the shank still reads as selected",
  );

  /*
   * The overlay sits exactly on the part it marks. If it were pickable, every
   * click would land on the tint — which carries no part id — and clicking a
   * selected part to deselect it would do nothing at all.
   */
  const ray = new THREE.Raycaster();
  ray.set(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
  const hits = ray.intersectObject(a.mesh, true);
  check(hits.length > 0, "the part itself is still pickable", `${hits.length} hit(s)`);
  check(
    hits.every((h) => h.object === a.mesh),
    "and the tint never intercepts the click",
  );

  // An export is a photo of the piece, not a screenshot of the editor.
  const scene = new THREE.Scene();
  scene.add(a.mesh, b.mesh);
  const restore = hideOverlays(scene);
  check(
    a.mesh.children.every((c) => !c.visible),
    "capture hides the tint",
  );
  check(a.mesh.visible && b.mesh.visible, "and hides nothing else");
  restore();
  check(
    a.mesh.children.every((c) => c.visible),
    "the viewport gets it back afterwards",
  );

  detach();
  check(a.mesh.children.length === 0, "deselecting removes the tint entirely");
}

/*
 * Tagging a scene that arrived without tags.
 *
 * This is the bug that made the whole materials panel look broken: only the
 * .3dm loader tagged its meshes, so on a GLB or the built-in piece `parts` was
 * empty, every swatch click wrote an assignment for zero parts, and nothing
 * changed — with nothing on screen to say why.
 */
console.log("\n=== an untagged scene still gets parts ===");
{
  check(synthLabel("Cube.001", "metal") === "Cube", "exporter numbering is dropped");
  check(synthLabel("mesh_shank", "metal") === "Shank", "exporter prefixes are dropped");
  check(synthLabel("polySurface12", "metal") === "Metal", "a meaningless name falls back to kind");
  check(synthLabel("", "stone") === "Stones", "so does no name at all");
  check(synthLabel("gem-a5182b", "stone") === "Stones", "and a bare hex is not a name");
  check(synthLabel("centre_stone", "stone") === "Centre stone", "a real name survives, tidied");

  const seen = new Map();
  check(uniqueLabel("Cube", seen) === "Cube", "the first of a name keeps it");
  check(uniqueLabel("Cube", seen) === "Cube 2", "the second is numbered, not merged");
  check(
    uniqueLabel("Cube", seen) === "Cube 3" && uniqueLabel("Band", seen) === "Band",
    "numbering is per name",
  );
}

{
  const mesh = (name) => ({ name, userData: {} });
  const seen = new Map();
  const a = mesh("Cube");
  const b = mesh("Cube");
  ensurePart(a, "metal", seen);
  ensurePart(b, "metal", seen);
  check(a.userData.part.id !== b.userData.part.id, "two same-named meshes stay separate parts");
  check(a.userData.part.kind === "metal", "kind is recorded");

  const stone = mesh("gem-a5182b");
  ensurePart(stone, "stone", seen);
  check(
    stone.userData.stone?.id === stone.userData.part.id,
    "a stone gets the second identity too, which is what the colour override keys on",
  );
  check(stone.userData.stone.hex === "#a5182b", "and the colour is read out of the mesh name");

  // A .3dm mesh already carries the jeweller's own layer name. Overwriting it
  // with something derived from a mesh name would be strictly worse.
  const tagged = {
    name: "metal-Metal 01",
    userData: { part: { id: "keep", label: "Metal 01", kind: "metal" } },
  };
  ensurePart(tagged, "metal", seen);
  check(tagged.userData.part.id === "keep", "an already-tagged mesh is left alone");
}

/*
 * One stone, not one layer.
 *
 * "Gem 03" on the client's file is 140 separate diamonds. Selecting the layer
 * selects all of them, which is right for "make every stone ruby" and useless
 * for "make THIS one ruby" — which is what was actually asked for.
 */
console.log("\n=== picking one solid out of a group ===");
{
  // Three solids: 2 triangles, then 3, then 1. Offsets are into the index
  // buffer, so a triangle at face f sits at 3f.
  const solids = [0, 6, 15, 18];

  check(solidAt(solids, 0) === 0, "the first triangle is in the first solid");
  check(solidAt(solids, 1) === 0, "and so is the second");
  check(solidAt(solids, 2) === 1, "the boundary starts the next solid");
  check(solidAt(solids, 4) === 1, "the middle of a solid resolves to it");
  check(solidAt(solids, 5) === 2, "and the last triangle to the last solid");
  check(solidAt(solids, 6) === null, "past the end is nothing, not a wrong stone");
  check(solidAt(undefined, 0) === null, "a group with no split is nothing");
  check(solidAt([0], 0) === null, "and so is an empty one");

  // Binary search has to agree with a linear scan for every triangle, or a
  // click lands on the stone next door.
  const many = [0];
  for (let i = 0; i < 200; i++) many.push(many[many.length - 1] + (1 + (i % 7)) * 3);
  let agree = true;
  for (let f = 0; f < many[many.length - 1] / 3; f++) {
    let expect = 0;
    while (f * 3 >= many[expect + 1]) expect++;
    if (solidAt(many, f) !== expect) agree = false;
  }
  check(agree, "search agrees with a linear scan across 200 solids, every triangle");

  const r = solidRange(solids, 1);
  check(
    r.start === 6 && r.count === 9,
    "a solid's draw range is its offsets",
    `${r.start}+${r.count}`,
  );
  check(solidRange(solids, 3) === null, "an out-of-range solid has no range");
}

console.log("\n=== solid ids round-trip ===");
{
  check(
    solidId("Gem 03|#ffffff", 11) === "Gem 03|#ffffff#solid11",
    "an id is the group plus the solid",
  );
  const back = parseId("Gem 03|#ffffff#solid11");
  check(back.group === "Gem 03|#ffffff" && back.solid === 11, "and it parses back");
  /*
   * Group ids contain '#' already, because the colour is a hex. Splitting on
   * the FIRST separator would cut "Gem 03|" off its colour and point the
   * selection at a group that does not exist.
   */
  const plain = parseId("Gem 03|#ffffff");
  check(
    plain.group === "Gem 03|#ffffff" && plain.solid === null,
    "a group id with a hex is not mistaken for a solid",
  );
  check(parseId("a#solidb").solid === null, "a non-numeric suffix is not a solid");
  /*
   * The one that actually bit: a group id ends with its colour, and "#999" is
   * a perfectly good number. A bare "#" separator read the colour as a solid.
   */
  check(parseId("Metal 01|#999").solid === null, "a three-digit hex colour is not a solid index");
  check(
    parseId("Metal 01|#93939b").group === "Metal 01|#93939b",
    "and a six-digit one keeps its whole group id",
  );
  check(parseId("a#solid-1").solid === null, "and neither is a negative one");
}

console.log("\n=== what the HUD says about solids ===");
{
  const parts = [
    { id: "g|#fff", label: "Gem 03", kind: "stone", solids: [0, 3, 6, 9] },
    { id: "m|#999", label: "Metal 01", kind: "metal" },
  ];
  check(
    describeSelection(parts, set("g|#fff#solid0")) === "Gem 03 · 1",
    "one stone is numbered from 1",
  );
  check(describeSelection(parts, set("g|#fff")) === "Gem 03", "the whole group is not");
  check(
    describeSelection(parts, set("g|#fff#solid0", "g|#fff#solid2")) === "2 parts",
    "two stones count as two",
  );
  check(
    describeSelection(parts, set("g|#fff", "m|#999")) === "everything",
    "every group still reads as everything",
  );
  check(
    describeSelection(parts, set("g|#fff#solid0", "g|#fff#solid1")) !== "everything",
    "but two stones out of a group never do, however many are picked",
  );
  check(
    describeSelection(parts, set("gone#solid3")) === "",
    "a stone of a vanished group is dropped",
  );
}

console.log("\n=== the highlight lights one solid ===");
{
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(geo);
  mesh.userData.part = { id: "g|#fff", label: "Gem 03", kind: "stone" };
  const parts = [{ id: "g|#fff", label: "Gem 03", kind: "stone", mesh, solids: [0, 18, 36] }];

  const detach = attachHighlight(parts, new Set(["g|#fff#solid1"]), SELECT_COLOR, 0.5);
  const overlay = mesh.children[0];
  check(overlay !== undefined, "an overlay is attached for a solid");
  check(
    overlay.geometry.drawRange.start === 18 && overlay.geometry.drawRange.count === 18,
    "and it draws only that solid's range",
    `${overlay.geometry.drawRange.start}+${overlay.geometry.drawRange.count}`,
  );
  /*
   * The clone shares its attribute buffers with the real geometry — the whole
   * point is not to copy 740k vertices to light one stone.
   */
  check(
    overlay.geometry.attributes.position.array === geo.attributes.position.array,
    "the clone shares the original's buffers rather than copying them",
  );
  detach();

  // Two solids of the SAME group need two clones: one shared geometry cannot
  // hold two draw ranges, and the second would silently win.
  const two = attachHighlight(
    parts,
    new Set(["g|#fff#solid0", "g|#fff#solid1"]),
    SELECT_COLOR,
    0.5,
  );
  const ranges = mesh.children.map((c) => c.geometry.drawRange.start);
  check(
    new Set(ranges).size === 2,
    "two solids in one group get two ranges, not one",
    ranges.join(","),
  );
  two();
  check(mesh.children.length === 0, "and both are removed again");
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);
