/**
 * Hallmarks.
 *
 * A stamp is part of the product rather than decoration — a purity mark is what
 * makes a piece sellable — so the things worth pinning down are the ones a
 * jeweller would notice and a screenshot would not: that the marks on offer are
 * the ones actually struck on a bench, that a saved stamp survives a reload
 * pointing at the same part, and that nothing can be placed which cannot then
 * be found again on the piece.
 *
 * Usage: node scripts/test-stamps.mjs
 */
import {
  DEFAULT_STAMP,
  HALLMARKS,
  HALLMARK_BY_ID,
  MAX_DEPTH,
  MAX_SIZE,
  MIN_SIZE,
  addStamp,
  clampStamp,
  hallmarkGroups,
  nextStampId,
  pruneStamps,
  removeStamp,
  resetStampIds,
  stampIsEmpty,
  stampLabel,
  stampText,
  updateStamp,
} from "../.tmp-jewelry/stamps.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

const at = (over = {}) => ({
  id: "s1",
  source: "hallmark",
  value: "750",
  position: [1, 2, 3],
  normal: [0, 1, 0],
  partId: "metal|Metal 01",
  rotation: 0,
  size: 1.2,
  depth: 0.08,
  ...over,
});

console.log("=== the marks on offer ===");
{
  const ids = HALLMARKS.map((h) => h.id);
  check(new Set(ids).size === ids.length, "no duplicate ids", `${ids.length} marks`);
  check(
    HALLMARKS.every((h) => h.mark.trim()),
    "every mark has something to strike",
  );

  /*
   * The purity marks a bench actually uses. Both spellings of each gold carat
   * are listed, because 14K ships to the US and 585 ships to Europe and nobody
   * would think to look for a format switch.
   */
  for (const [carat, european] of [
    ["10k", "417"],
    ["14k", "585"],
    ["18k", "750"],
    ["22k", "916"],
  ]) {
    check(
      HALLMARK_BY_ID.has(carat) && HALLMARK_BY_ID.has(european),
      `${carat.toUpperCase()} is offered in both spellings`,
      `${carat} / ${european}`,
    );
  }
  check(HALLMARK_BY_ID.has("925"), "sterling silver is offered");
  check(HALLMARK_BY_ID.has("pt950"), "platinum is offered");
  check(HALLMARK_BY_ID.has("916"), "the Indian gold standard is offered", "916");

  const groups = hallmarkGroups();
  check(
    groups.length === 4,
    "grouped by metal, so the list is scannable",
    `${groups.length} groups`,
  );
  check(
    groups.every((g) => g.items.length > 0),
    "and no group is shown empty",
  );
  check(
    groups.reduce((n, g) => n + g.items.length, 0) === HALLMARKS.length,
    "every mark appears in exactly one group",
  );
}

console.log("\n=== what a mark is called ===");
{
  check(stampText(at()) === "750", "a hallmark resolves to the characters struck", stampText(at()));
  check(
    stampText(at({ source: "text", value: "©MAKER" })) === "©MAKER",
    "custom text is struck as typed",
  );
  /*
   * A logo is an image. Returning its data URL here would put a kilobyte of
   * base64 into a tooltip and a list row.
   */
  const logo = at({ source: "logo", value: "data:image/png;base64,AAAA" });
  check(stampText(logo) === "", "a logo has no text");
  check(stampLabel(logo) === "Logo", "and is listed by name, never by its data URL");
  check(
    !stampLabel(at({ source: "text", value: "M".repeat(40) })).includes("MMMMMMMMMMMMMMMMMMMM"),
    "a very long custom mark is truncated for the list",
    stampLabel(at({ source: "text", value: "M".repeat(40) })),
  );
}

console.log("\n=== nothing invisible can be placed ===");
{
  check(!stampIsEmpty(at()), "a hallmark is never empty");
  check(stampIsEmpty(at({ source: "text", value: "" })), "empty text is not placeable");
  check(stampIsEmpty(at({ source: "text", value: "   " })), "nor is whitespace");
  check(!stampIsEmpty(at({ source: "text", value: "18K" })), "typed text is placeable");
  check(stampIsEmpty(at({ source: "logo", value: "" })), "a logo with no image is not placeable");
  check(
    !stampIsEmpty(at({ source: "logo", value: "data:image/png;base64,AAAA" })),
    "an uploaded logo is",
  );
}

console.log("\n=== bounds come from the bench, not the renderer ===");
{
  check(clampStamp(at({ size: 99 })).size === MAX_SIZE, "too large is capped", `${MAX_SIZE}mm`);
  check(
    clampStamp(at({ size: 0.01 })).size === MIN_SIZE,
    "too small to read is lifted",
    `${MIN_SIZE}mm`,
  );
  check(
    clampStamp(at({ depth: 5 })).depth === MAX_DEPTH,
    "a punch cannot be driven through the shank",
    `${MAX_DEPTH}mm`,
  );
  // Cast pieces carry a raised mark from the mould, which is the same height
  // field with one sign flipped.
  check(clampStamp(at({ depth: -0.08 })).depth === -0.08, "a raised mark is allowed");
  check(clampStamp(at({ depth: -9 })).depth === -MAX_DEPTH, "and is bounded the same way");

  check(clampStamp(at({ rotation: 370 })).rotation === 10, "rotation wraps rather than climbing");
  check(clampStamp(at({ rotation: -90 })).rotation === 270, "and a negative turn reads forwards");

  check(
    DEFAULT_STAMP.size >= MIN_SIZE && DEFAULT_STAMP.size <= MAX_SIZE,
    "the default is inside its own bounds",
    `${DEFAULT_STAMP.size}mm`,
  );
}

console.log("\n=== the list ===");
{
  resetStampIds();
  const a = nextStampId();
  const b = nextStampId();
  check(a !== b, "ids are unique", `${a}, ${b}`);
  resetStampIds();
  const afterReset = nextStampId();
  check(
    afterReset === a,
    "and restart with a new piece, so a fresh ring does not begin at stamp-97",
    afterReset,
  );

  let list = [];
  list = addStamp(list, at({ id: "s1" }));
  list = addStamp(list, at({ id: "s2", value: "925" }));
  check(list.length === 2, "stamps accumulate");

  // Clamping on the way in, so a bad value cannot be stored and later rendered.
  list = addStamp(list, at({ id: "s3", size: 99 }));
  check(list[2].size === MAX_SIZE, "and are bounded as they are added", `${list[2].size}`);

  const edited = updateStamp(list, "s2", { rotation: 45 });
  check(edited.find((s) => s.id === "s2").rotation === 45, "one can be edited");
  check(edited.find((s) => s.id === "s1").rotation === 0, "without disturbing the others");
  check(list.find((s) => s.id === "s2").rotation === 0, "the input is not mutated");

  check(removeStamp(edited, "s1").length === 2, "and removed");
  check(!removeStamp(edited, "s1").some((s) => s.id === "s1"), "by id, not by position");
}

console.log("\n=== a stamp cannot outlive its part ===");
{
  /*
   * Loading a different model keeps the panel state. A stamp pinned to a part
   * id that no longer exists would sit in the list for ever with nothing on
   * screen to match it — visible in a list, unfindable on the piece.
   */
  const list = [
    at({ id: "s1", partId: "metal|Metal 01" }),
    at({ id: "s2", partId: "metal|Heads" }),
    at({ id: "s3", partId: "metal|Gone" }),
  ];
  const kept = pruneStamps(list, new Set(["metal|Metal 01", "metal|Heads"]));
  check(kept.length === 2, "stamps on parts that survived are kept", `${kept.length} of 3`);
  check(!kept.some((s) => s.partId === "metal|Gone"), "and one on a part that vanished is dropped");
  check(pruneStamps(list, new Set()).length === 0, "a whole new piece clears them all");
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);
