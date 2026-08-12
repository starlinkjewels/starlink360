/**
 * Per-solid materials, as draw runs.
 *
 * The whole reason this exists is "make THIS stone ruby" on a layer holding 140
 * of them. The property that has to hold, and the one that is easy to lose, is
 * that the cost tracks how many stones were CUSTOMISED and not how many exist —
 * 140 draw calls on a pave field would be worse than not having the feature.
 *
 * Usage: node scripts/test-plan.mjs
 */
import {
  assignmentsFor,
  drawableCount,
  planRuns,
  runMaterials,
  runSlots,
  sameAssignment,
} from "../.tmp-jewelry/plan.js";
import { parseId, solidAt, solidId } from "../.tmp-jewelry/selection.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

const A = (material, patch) => (patch ? { material, patch } : { material });
/** Five solids of three triangles each. */
const FIVE = [0, 9, 18, 27, 36, 45];
const covers = (runs, total) => {
  let at = 0;
  for (const r of runs) {
    if (r.start !== at) return false;
    at += r.count;
  }
  return at === total;
};

console.log("=== nothing customised stays one draw call ===");
{
  const runs = planRuns(FIVE, 45, A("diamond"), new Map());
  check(runs.length === 1, "one run", `${runs.length}`);
  check(runs[0].start === 0 && runs[0].count === 45, "covering the whole buffer");
  check(planRuns(undefined, 45, null, new Map()).length === 1, "a group with no split too");
  check(planRuns(FIVE, 0, null, new Map()).length === 0, "an empty mesh plans nothing");
}

console.log("=== one stone out of five ===");
{
  const runs = planRuns(FIVE, 45, A("diamond"), new Map([[2, A("ruby")]]));
  check(runs.length === 3, "before, the stone, after", `${runs.length}`);
  check(covers(runs, 45), "and the runs tile the buffer with no gap or overlap");
  check(runs[1].start === 18 && runs[1].count === 9, "the middle run is exactly that solid");
  check(runs[1].assignment.material === "ruby", "and carries the new material");
  check(
    runs[0].assignment.material === "diamond" && runs[2].assignment.material === "diamond",
    "the rest keeps the group's material",
  );
}

console.log("=== the cost tracks customisation, not stone count ===");
{
  // 140 stones, the real number on the client's pendant.
  const many = [0];
  for (let i = 0; i < 140; i++) many.push(many[many.length - 1] + 954);
  const total = many[many.length - 1];

  check(
    planRuns(many, total, A("diamond"), new Map()).length === 1,
    "140 untouched stones: 1 call",
  );

  const one = planRuns(many, total, A("diamond"), new Map([[70, A("ruby")]]));
  check(one.length === 3, "one recoloured: 3 calls", `${one.length}`);
  check(covers(one, total), "still tiling exactly");

  const three = planRuns(
    many,
    total,
    A("diamond"),
    new Map([
      [10, A("ruby")],
      [70, A("ruby")],
      [130, A("emerald")],
    ]),
  );
  check(three.length === 7, "three recoloured: 7 calls, not 140", `${three.length}`);
  check(covers(three, total), "still tiling exactly");

  // Adjacent stones in the same new material must not each cost a call.
  const adjacent = planRuns(
    many,
    total,
    A("diamond"),
    new Map([
      [10, A("ruby")],
      [11, A("ruby")],
      [12, A("ruby")],
    ]),
  );
  check(
    adjacent.length === 3,
    "three adjacent in one material merge into one run",
    `${adjacent.length}`,
  );

  // Only three distinct materials, however many runs reference them.
  const mats = runMaterials(three);
  check(mats.length === 3, "and only 3 materials are built", `${mats.length}`);
  const slots = runSlots(three, mats);
  check(slots.length === three.length, "every run gets a slot");
  check(
    slots.every((sIdx, i) => sameAssignment(mats[sIdx], three[i].assignment)),
    "and every slot points at the right material",
  );
}

console.log("=== a stone overrides its group ===");
{
  const runs = planRuns(FIVE, 45, A("ruby"), new Map([[0, A("diamond")]]));
  check(runs[0].assignment.material === "diamond", "the solid wins over the group");
  check(runs[1].assignment.material === "ruby", "and the group still covers the rest");

  // With no group assignment, untouched stretches must stay null so the
  // renderer falls back to whatever the FILE said, not to some default.
  const bare = planRuns(FIVE, 45, null, new Map([[1, A("ruby")]]));
  check(bare[0].assignment === null, "untouched runs stay unassigned");
  check(bare[1].assignment.material === "ruby", "and the painted one is set");
  check(covers(bare, 45), "still tiling exactly");
}

console.log("=== a patch is part of a material's identity ===");
{
  check(sameAssignment(A("ruby"), A("ruby")), "same material, same thing");
  check(!sameAssignment(A("ruby"), A("emerald")), "different material, different thing");
  check(
    !sameAssignment(A("ruby"), A("ruby", { ior: 1.9 })),
    "a patched ruby is not a plain ruby, so their runs must not merge",
  );
  check(
    sameAssignment(A("ruby", { ior: 1.9 }), A("ruby", { ior: 1.9 })),
    "identical patches do merge",
  );
  check(sameAssignment(null, null), "two defaults merge");
  check(!sameAssignment(null, A("ruby")), "a default and a material do not");

  const runs = planRuns(
    FIVE,
    45,
    A("ruby"),
    new Map([
      [1, A("ruby", { ior: 1.9 })],
      [2, A("ruby")],
    ]),
  );
  // Solid 2 is back to the group's plain ruby, so it merges with 3 and 4.
  check(
    runs.length === 3,
    "a patched stone splits the run, an unpatched one does not",
    `${runs.length}`,
  );
}

console.log("=== splitting the flat assignment map per group ===");
{
  const all = {
    "Gem 03|#ffffff": A("diamond"),
    [solidId("Gem 03|#ffffff", 7)]: A("ruby"),
    [solidId("Gem 03|#ffffff", 9)]: A("emerald"),
    "Metal 01|#93939b": A("gold-18k"),
    [solidId("Metal 01|#93939b", 2)]: A("platinum-950"),
  };

  const gem = assignmentsFor(all, "Gem 03|#ffffff", parseId);
  check(gem.base.material === "diamond", "the group's own assignment is the base");
  check(gem.perSolid.size === 2, "its solids are picked out", `${gem.perSolid.size}`);
  check(gem.perSolid.get(7).material === "ruby", "keyed by solid index");
  check(!gem.perSolid.has(2), "and another group's solid is not stolen");

  const metal = assignmentsFor(all, "Metal 01|#93939b", parseId);
  check(metal.base.material === "gold-18k" && metal.perSolid.size === 1, "the other group too");

  const missing = assignmentsFor(all, "Nothing|#000000", parseId);
  check(missing.base === null && missing.perSolid.size === 0, "an absent group gets nothing");

  /*
   * The id trap again: a group id ends with a hex colour, so this only works
   * because the solid suffix is "#solid<n>".
   */
  check(
    assignmentsFor({ "Metal 01|#999": A("gold-18k") }, "Metal 01|#999", parseId).base !== null,
    "a three-digit hex group id is not mistaken for a solid",
  );
}

/*
 * Two bugs every test above passed straight through, because they are about how
 * the data REACHES this code rather than what this code does with it. Both made
 * the feature do nothing in the app while the suite stayed green.
 */
console.log("\n=== the offsets have to survive reaching the renderer ===");
{
  /*
   * `Object3D.clone()` round-trips userData through JSON, and the viewer clones
   * the loaded scene. A Uint32Array comes out as {"0":0,"1":954} with NO
   * length, so every read of it found nothing and single-stone selection and
   * colour both silently did nothing — while these tests passed, because they
   * build plain arrays by hand.
   */
  const typed = new Uint32Array([0, 954, 1908]);
  const clonedTyped = JSON.parse(JSON.stringify({ solids: typed })).solids;
  check(
    clonedTyped.length === undefined,
    "a typed array does NOT survive the scene clone — this was the bug",
  );
  check(solidAt(clonedTyped, 200) === null, "so a click resolves to no solid at all");
  check(
    planRuns(clonedTyped, 1908, null, new Map([[1, A("ruby")]])).length === 1,
    "and a per-solid material plans a single whole-mesh run instead",
  );

  const plain = Array.from(typed);
  const clonedPlain = JSON.parse(JSON.stringify({ solids: plain })).solids;
  check(clonedPlain.length === 3, "a plain array survives it, which is why the loader stores one");
  check(solidAt(clonedPlain, 200) === 0, "clicks resolve normally afterwards");
  // Two solids, the second recoloured: the default one, then the ruby one.
  const planned = planRuns(clonedPlain, 1908, null, new Map([[1, A("ruby")]]));
  check(planned.length === 2, "and per-solid runs plan normally too", `${planned.length}`);
  check(
    planned[0].assignment === null && planned[1].assignment.material === "ruby",
    "with only the chosen solid changed",
  );
}

console.log("\n=== de-indexed geometry still draws ===");
{
  /*
   * Stones are de-indexed by the faceting pass, so `index` is null on every one
   * of them. Reading `index.count` gives zero, which plans no runs at all and
   * leaves the stone with no material — every gem in the piece, not just a
   * customised one.
   */
  const indexed = { index: { count: 45 }, attributes: { position: { count: 20 } } };
  const faceted = { index: null, attributes: { position: { count: 45 } } };
  check(drawableCount(indexed) === 45, "an indexed mesh counts its index");
  check(drawableCount(faceted) === 45, "a de-indexed one counts its vertices — the same units");
  check(drawableCount({ attributes: {} }) === 0, "and an empty one is zero, not a throw");
  check(
    planRuns(FIVE, drawableCount(faceted), A("diamond"), new Map()).length === 1,
    "so a faceted stone still plans a run and keeps its material",
  );
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);
