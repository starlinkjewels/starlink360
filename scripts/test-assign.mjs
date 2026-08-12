/**
 * Where a material lands.
 *
 * This is the rule the whole Materials panel rests on, and it is the sort of
 * thing that is obvious until someone has two metal parts selected and a stone
 * changes colour. Every branch is checked here rather than in a browser.
 *
 * Usage: node scripts/test-assign.mjs
 */
import {
  applyMaterial,
  patchMaterial,
  assignToPart,
  canPaint,
  clearMaterial,
  commonMaterial,
  commonPatch,
  describeTargets,
  targetIds,
  targetsEverything,
} from "../.tmp-jewelry/assign.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};
const set = (...ids) => new Set(ids);

// A piece shaped like a real one: metal split across layers, two stone sets.
const parts = [
  { id: "m1", label: "Metal 01", kind: "metal" },
  { id: "m2", label: "Heads", kind: "metal" },
  { id: "g1", label: "Gem 01", kind: "stone" },
  { id: "g2", label: "Gem 02", kind: "stone" },
];

console.log("=== nothing selected means the whole piece ===");
check(
  JSON.stringify(targetIds(parts, set(), "metal")) === '["m1","m2"]',
  "a metal lands on every metal part",
);
check(
  JSON.stringify(targetIds(parts, set(), "stone")) === '["g1","g2"]',
  "and a gem on every stone set",
);
check(targetsEverything(parts, set(), "metal"), "and the panel can say so");

console.log("\n=== a selection narrows it ===");
check(
  JSON.stringify(targetIds(parts, set("m2"), "metal")) === '["m2"]',
  "only the selected metal part",
);
check(!targetsEverything(parts, set("m2"), "metal"), "and the panel knows it is narrowed");
check(
  JSON.stringify(targetIds(parts, set("m1", "m2"), "metal")) === '["m1","m2"]',
  "both, when both are selected",
);

/*
 * The case that makes the rule worth writing down: a gem swatch clicked while
 * only metal is selected. Doing nothing would read as a broken swatch.
 */
console.log("\n=== a selection of the wrong kind falls back ===");
check(
  JSON.stringify(targetIds(parts, set("m1"), "stone")) === '["g1","g2"]',
  "clicking a gem with only metal selected still recolours the stones",
);
check(
  targetsEverything(parts, set("m1"), "stone"),
  "and it is reported as a whole-piece change, not a silent one",
);

console.log("\n=== applying ===");
{
  let a = applyMaterial({}, parts, set(), "metal", "gold-18k");
  check(a.m1?.material === "gold-18k" && a.m2?.material === "gold-18k", "both metal parts take it");
  check(a.g1 === undefined, "the stones are untouched");

  a = applyMaterial(a, parts, set("m2"), "metal", "platinum-950");
  check(a.m1.material === "gold-18k", "a narrowed apply leaves the other part alone");
  check(a.m2.material === "platinum-950", "and changes the selected one");

  const before = applyMaterial({}, parts, set(), "metal", "gold-18k");
  const after = applyMaterial(before, parts, set(), "metal", "silver-925");
  check(before.m1.material === "gold-18k", "the input is never mutated, so React sees a change");
  check(after.m1.material === "silver-925", "and the result is the new one");
}

console.log("\n=== patching ===");
{
  let a = applyMaterial({}, parts, set(), "metal", "gold-18k");
  a = patchMaterial(a, parts, set("m1"), "metal", { roughness: 0.6 }, "gold-18k");
  check(a.m1.patch.roughness === 0.6, "the edit lands");
  check(a.m1.material === "gold-18k", "on top of the library material, which is still named");
  check(a.m2.patch === undefined, "and only on the selected part");

  a = patchMaterial(a, parts, set("m1"), "metal", { color: "#ff0000" }, "gold-18k");
  check(
    a.m1.patch.roughness === 0.6 && a.m1.patch.color === "#ff0000",
    "a second edit merges rather than replacing — moving one slider keeps the other",
  );

  // Choosing a different material has to start clean, or the previous stone's
  // hand-tuned numbers follow it and look like a catalogue error.
  a = applyMaterial(a, parts, set("m1"), "metal", "platinum-950");
  check(a.m1.patch === undefined, "picking a new material drops the old edits");

  const fresh = patchMaterial({}, parts, set("g1"), "stone", { ior: 1.9 }, "diamond");
  check(
    fresh.g1.material === "diamond" && fresh.g1.patch.ior === 1.9,
    "editing with nothing assigned yet falls back to the given material",
  );
}

console.log("\n=== clearing ===");
{
  let a = applyMaterial({}, parts, set(), "metal", "gold-18k");
  a = clearMaterial(a, parts, set("m1"), "metal");
  check(a.m1 === undefined, "the part goes back to what the file said");
  check(a.m2.material === "gold-18k", "and nothing else moves");
}

console.log("\n=== what the grid shows as active ===");
{
  const a = applyMaterial({}, parts, set(), "metal", "gold-18k");
  check(commonMaterial(a, parts, set(), "metal") === "gold-18k", "one metal everywhere lights up");

  const mixed = applyMaterial(a, parts, set("m2"), "metal", "platinum-950");
  check(
    commonMaterial(mixed, parts, set(), "metal") === null,
    "a piece in two metals lights nothing — claiming one would be a lie",
  );
  check(
    commonMaterial(mixed, parts, set("m2"), "metal") === "platinum-950",
    "but selecting one part shows that part's metal",
  );
  check(commonMaterial({}, parts, set(), "metal") === null, "nothing assigned lights nothing");
  check(
    commonMaterial({}, [], set(), "metal") === null,
    "and a piece with no parts does not throw",
  );

  const patched = patchMaterial(a, parts, set(), "metal", { roughness: 0.4 }, "gold-18k");
  check(commonPatch(patched, parts, set(), "metal").roughness === 0.4, "a shared edit shows");
  const half = patchMaterial(a, parts, set("m1"), "metal", { roughness: 0.4 }, "gold-18k");
  check(
    commonPatch(half, parts, set(), "metal").roughness === undefined,
    "an edit on only one of two parts shows blank rather than a wrong number",
  );
}

/*
 * Paint: arm a material, then click stones one at a time.
 *
 * The point is that it ignores the selection entirely. Setting a halo stone by
 * stone through select-then-apply is two steps per stone, which is exactly the
 * job where that becomes tiring.
 */
console.log("\n=== painting one part at a time ===");
{
  let a = applyMaterial({}, parts, set(), "stone", "diamond");
  a = assignToPart(a, "g2", "ruby");
  check(a.g2.material === "ruby", "the clicked part takes the brush");
  check(a.g1.material === "diamond", "and no other part moves");

  // Painting must not be narrowed by whatever happened to be selected when the
  // mode was switched on.
  const elsewhere = assignToPart(a, "g1", "emerald");
  check(elsewhere.g1.material === "emerald", "a selection elsewhere does not redirect it");
  check(a.g1.material === "diamond", "and the input is not mutated");

  check(
    assignToPart({}, "m1", "gold-18k").m1.material === "gold-18k",
    "painting works from nothing assigned",
  );
}

/*
 * A brush only paints its own kind.
 *
 * Letting a metal brush onto a stone was not merely untidy. The assignment
 * landed under the STONE's id holding a METAL material, so the metal renderer
 * skipped it (wrong group) and the gem renderer skipped it (not a gem). The
 * click did nothing at all, with nothing on screen to explain it — which is
 * exactly what "single diamond colour change does not work" looks like from
 * the outside.
 */
console.log("\n=== a brush only paints its own kind ===");
check(canPaint("metal", "metal"), "a metal brush paints metal");
check(canPaint("stone", "stone"), "a gem brush paints stones");
check(!canPaint("stone", "metal"), "a metal brush does NOT paint a stone");
check(!canPaint("metal", "stone"), "and a gem brush does not paint metal");
check(!canPaint("metal", null), "with no brush, nothing is painted");

console.log("\n=== what the panel says it will change ===");
check(describeTargets(parts, set(), "metal") === "all 2 metal parts", "the whole piece");
check(describeTargets(parts, set("m2"), "metal") === "Heads", "one part, by name");
/*
 * A material lands on exactly what was selected — one stone if one stone is
 * selected, the whole group if the group is.
 *
 * The renderer used to allow only one material per mesh, so a solid id had to
 * be widened to its group and picking one stone turned all 140. It can split a
 * mesh into draw runs now, so the id selected is the id assigned.
 */
{
  const many = [
    { id: "m1", label: "Metal 01", kind: "metal", solids: [0, 3, 6, 9] },
    { id: "g1", label: "Gem 03", kind: "stone", solids: [0, 3, 6] },
  ];
  check(
    JSON.stringify(targetIds(many, set("g1#solid1"), "stone")) === '["g1#solid1"]',
    "one solid is the target — it is no longer widened to its group",
  );
  check(
    describeTargets(many, set("m1#solid1"), "metal") === "Metal 01 · 2",
    "and the panel names that one solid, numbered from 1",
  );
  /*
   * Selecting the GROUP still says how many solids that is, because "Gem 03"
   * reads as one stone and is in fact 140 — changing all of them while the
   * label implies one is the surprise this avoids.
   */
  check(
    describeTargets(many, set("g1"), "stone") === "Gem 03 — all 2",
    "selecting the whole group says how many solids it covers",
  );
  check(
    JSON.stringify(targetIds(many, set("g1"), "stone")) === '["g1"]',
    "and targets the group itself",
  );
  check(
    !targetsEverything(many, set("g1#solid1"), "stone"),
    "and it counts as a narrowed selection, not a whole-piece change",
  );
}
check(describeTargets(parts, set("m1", "m2"), "metal") === "2 selected", "several, by count");
check(describeTargets(parts, set(), "stone") === "all 2 stone sets", "stones read as sets");
check(
  describeTargets([{ id: "m1", label: "Band", kind: "metal" }], set(), "metal") ===
    "the metal part",
  "a single part is not called 'all 1'",
);
check(
  describeTargets([], set(), "stone") === "no stones in this piece",
  "a piece with no stones says so instead of offering to recolour nothing",
);

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);
