/**
 * Groups the user makes.
 *
 * A group is a named set of ids and nothing more, which is the point: every
 * renderer already resolves an id to a draw run, so a group only has to be
 * expanded away before the assignment maps see it. The things worth pinning
 * down are therefore the ways that expansion can go wrong — a group id leaking
 * through as if it were a part, a member counted twice, a nested group, or a
 * group outliving the piece it was made on.
 *
 * Usage: node scripts/test-groups.mjs
 */
import {
  GROUP_PREFIX,
  createGroup,
  describeGroup,
  expandIds,
  groupById,
  isGroupId,
  kindOf,
  nextGroupId,
  pruneGroups,
  removeGroup,
  renameGroup,
  resetGroupIds,
  setMembers,
  uniqueGroupName,
} from "../.tmp-jewelry/groups.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

// Mirrors selection.ts, so the suite does not depend on it.
const parseId = (id) => {
  const m = /#solid(\d+)$/.exec(id);
  return m ? { group: id.slice(0, m.index) } : { group: id };
};

console.log("=== a group can never be mistaken for a part ===");
{
  resetGroupIds();
  const a = nextGroupId();
  check(isGroupId(a), "ids carry a reserved prefix", a);
  check(a.startsWith(GROUP_PREFIX), "which is the published one");
  check(!isGroupId("metal|Metal 01"), "a part id is not a group");
  check(!isGroupId("stone|Stones#solid7"), "nor is a solid id");
  /*
   * Assignments, stamps and selection are all flat maps keyed by id. Without
   * the prefix a group named after a layer would overwrite that layer's
   * material, and the only symptom would be the wrong metal on one part.
   */
  check(nextGroupId() !== a, "ids are unique");
  resetGroupIds();
  check(nextGroupId() === a, "and restart with a new piece");
}

console.log("\n=== creating one ===");
{
  resetGroupIds();
  let list = createGroup([], "Centre", ["stone|Stones#solid1", "stone|Stones#solid2"], "stone");
  check(list.length === 1, "a group is added");
  check(list[0].memberIds.length === 2, "with its members");
  check(list[0].kind === "stone", "and its kind");

  // A material is assigned per kind, so a group has to be one or the other.
  check(createGroup(list, "Empty", [], "stone").length === 1, "an empty selection makes no group");

  list = createGroup(list, "Dupes", ["a", "a", "b"], "metal");
  check(list[1].memberIds.length === 2, "members are de-duplicated", `${list[1].memberIds}`);

  /*
   * Nesting is refused at creation rather than handled at expansion. Selecting
   * a group and grouping THAT would otherwise need a recursive expand with a
   * cycle guard; flattening here means the structure cannot express it.
   */
  const nested = createGroup(list, "Nested", ["group:1", "c"], "metal");
  check(
    !nested[2].memberIds.some(isGroupId),
    "a group cannot contain a group",
    `${nested[2].memberIds}`,
  );
}

console.log("\n=== names stay usable ===");
{
  const list = [
    { id: "group:1", name: "Centre", memberIds: ["a"], kind: "stone" },
    { id: "group:2", name: "Centre 2", memberIds: ["b"], kind: "stone" },
  ];
  check(uniqueGroupName("Halo", list) === "Halo", "a free name is kept");
  check(uniqueGroupName("Centre", list) === "Centre 3", "a taken one is numbered past the clash");
  check(uniqueGroupName("   ", list) === "Group", "an empty name still gets one");

  /*
   * Renaming to a taken name is numbered past the clash, not refused. Asking
   * for "Centre" when another group holds it legitimately lands on "Centre 2";
   * what must never happen is two groups sharing a name.
   */
  const renamed = renameGroup(list, "group:2", "Centre");
  check(renamed[1].name !== renamed[0].name, "renaming does not collide", renamed[1].name);
  // Renaming to its own name must not number it against itself.
  check(renameGroup(list, "group:1", "Centre")[0].name === "Centre", "nor fight itself");
}

console.log("\n=== expanding, which is the whole integration ===");
{
  const list = [
    { id: "group:1", name: "Centre", memberIds: ["s1", "s2", "s3"], kind: "stone" },
    { id: "group:2", name: "Prongs", memberIds: ["m1"], kind: "metal" },
  ];

  check(expandIds(list, ["group:1"]).length === 3, "a group becomes its members");
  check(expandIds(list, ["s9"])[0] === "s9", "a plain id passes through untouched");
  check(expandIds(list, ["group:404"]).length === 0, "an unknown group expands to nothing");

  /*
   * Selecting a group AND one of its members must not yield that member twice.
   * The run planner would split one solid into two identical adjacent runs —
   * an extra draw call for no reason, and a merge that silently stops working.
   */
  const both = expandIds(list, ["group:1", "s2"]);
  check(both.length === 3, "a member selected alongside its group appears once", `${both}`);
  check(new Set(both).size === both.length, "and the result never contains a duplicate");

  const ordered = expandIds(list, ["group:2", "group:1"]);
  check(ordered[0] === "m1", "order follows the selection, not the group list");
  check(!ordered.some(isGroupId), "no group id survives expansion");
}

console.log("\n=== a group cannot outlive its piece ===");
{
  /*
   * Loading a different model keeps panel state. A group pointing at ids from
   * the last piece would sit in the list, named and selectable, selecting
   * nothing at all.
   */
  const list = [
    { id: "group:1", name: "Mixed", memberIds: ["Metal 01#solid7", "Gone#solid2"], kind: "metal" },
    { id: "group:2", name: "Dead", memberIds: ["Gone"], kind: "metal" },
  ];
  const kept = pruneGroups(list, new Set(["Metal 01"]), parseId);
  check(kept.length === 1, "a group with no surviving members is dropped", `${kept.length}`);
  check(kept[0].memberIds.length === 1, "and dead members are removed from the rest");
  check(
    kept[0].memberIds[0] === "Metal 01#solid7",
    "a solid survives as long as its part does",
    kept[0].memberIds[0],
  );
  check(pruneGroups(list, new Set(), parseId).length === 0, "a whole new piece clears them all");
}

console.log("\n=== the panel can refuse a mixture ===");
{
  const kindById = (id) =>
    id.startsWith("s") ? "stone" : id.startsWith("m") ? "metal" : undefined;
  check(kindOf(["s1", "s2"], kindById) === "stone", "all stones is a stone group");
  check(kindOf(["m1"], kindById) === "metal", "all metal is a metal group");
  /*
   * Refused rather than allowed. The metal renderer ignores stone ids and the
   * gem renderer ignores metal ones, so a mixed group given a gold would apply
   * to half of it with nothing on screen to say why.
   */
  check(kindOf(["s1", "m1"], kindById) === null, "a mixture belongs to neither");
  check(kindOf([], kindById) === null, "and nothing selected is not a kind");
  check(kindOf(["s1", "unknown"], kindById) === "stone", "an untagged id does not spoil the vote");
}

console.log("\n=== small things ===");
{
  const g = { id: "group:1", name: "Centre", memberIds: ["a", "b"], kind: "stone" };
  check(describeGroup(g) === "Centre · 2", "a group reads with its size", describeGroup(g));
  check(groupById([g], "group:1") === g, "lookup by id");
  check(groupById([g], "nope") === undefined, "and a miss is undefined, not a throw");
  check(removeGroup([g], "group:1").length === 0, "removal");
  check(setMembers([g], "group:1", ["x", "x", "y"])[0].memberIds.length === 2, "members replace");
  check(g.memberIds.length === 2, "and none of it mutates the input");
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);
