/**
 * Model Dimensions: calibration, per-stone measurement, and the breakdown.
 *
 * The one thing worth stating up front: `estimateCaratWeight`'s constant is
 * checked against the reference tool's own worked example (11.10 x 11.10 x
 * 6.91 mm -> 5.19 ct), not just trusted because it's a commonly cited number.
 *
 * Usage: node scripts/test-dimensions.mjs
 */
import * as THREE from "three";
import {
  DEFAULT_DIMENSIONS,
  boundsOfSolid,
  estimateCaratWeight,
  measureStone,
  mmPerUnit,
  summariseGems,
} from "../.tmp-jewelry/dimensions.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

console.log("=== calibration ===");
check(mmPerUnit(null, 5) === null, "uncalibrated stays null, never a guessed number");
check(mmPerUnit(50, 5) === 10, "known width over model width gives mm per unit");
check(mmPerUnit(50, 0) === null, "a zero-width piece cannot be calibrated, not a divide by zero");
check(mmPerUnit(50, -1) === null, "nor a negative one");

console.log("\n=== the default is honest, not a guess ===");
{
  // A made-up starting width would silently scale every mm figure and the
  // carat weight to match it, reading as a real measurement even though it
  // isn't — see the file header on dimensions.ts. So the default ships
  // uncalibrated, and the panel is expected to say so rather than show a
  // fabricated number.
  check(DEFAULT_DIMENSIONS.knownWidthMM === null, "ships uncalibrated, not a fabricated width");
  check(!DEFAULT_DIMENSIONS.autoDetected, "and not flagged as auto-detected either");
  check(
    !DEFAULT_DIMENSIONS.showOnCanvas && !DEFAULT_DIMENSIONS.showTable,
    "both visualisations start off, until someone asks for them",
  );
}

console.log("\n=== carat weight, against the reference tool's own numbers ===");
{
  const ct = estimateCaratWeight(11.1, 11.1, 6.91);
  check(
    Math.abs(ct - 5.19) < 0.01,
    "11.10 x 11.10 x 6.91 mm reads as ~5.19 ct",
    `${ct.toFixed(3)}`,
  );
  const melee = estimateCaratWeight(1.89, 1.89, 1.17);
  check(
    Math.abs(melee - 0.026) < 0.002,
    "1.89 x 1.89 x 1.17 mm reads as ~0.026 ct",
    `${melee.toFixed(4)}`,
  );
}

console.log("\n=== a box's extents sort into length/width/depth, not raw X/Y/Z ===");
{
  const round = measureStone(
    new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 2, 1)),
  );
  check(
    round.length === 2 && round.width === 2 && round.depth === 1,
    "square footprint, flatter axis is depth",
  );
  check(round.shape === "Round", "equal length and width reads as round");

  const fancy = measureStone(
    new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(5, 3, 1)),
  );
  check(
    fancy.length === 5 && fancy.width === 3 && fancy.depth === 1,
    "unequal footprint sorts largest first",
  );
  check(fancy.shape === "Fancy", "a clearly non-square footprint is not called round");

  // Depth is always the smallest, whichever raw axis it lands on — this is
  // what makes the measurement independent of how a stone happens to sit.
  const rotated = measureStone(
    new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 2, 2)),
  );
  check(
    rotated.depth === 1 && rotated.length === 2 && rotated.width === 2,
    "flatness on X is still found as depth",
  );
}

/** A flat-shaded (non-indexed) unit cube, so boundsOfSolid has real triangles to read. */
function unitCubeGeometry() {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  return geo.index ? geo.toNonIndexed() : geo;
}

console.log("\n=== per-solid bounds read the mesh's own triangles, in world space ===");
{
  const mesh = new THREE.Mesh(unitCubeGeometry());
  mesh.position.set(10, 0, 0);
  mesh.updateMatrixWorld(true);
  const box = boundsOfSolid(mesh, 0, mesh.geometry.attributes.position.count);
  const size = box.getSize(new THREE.Vector3());
  check(
    Math.abs(size.x - 1) < 1e-6 && Math.abs(size.y - 1) < 1e-6 && Math.abs(size.z - 1) < 1e-6,
    "a unit cube measures as a unit cube",
    `${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)}`,
  );
  check(
    Math.abs(box.min.x - 9.5) < 1e-6,
    "and world position is applied, not just local geometry",
    `min.x ${box.min.x}`,
  );
}

console.log("\n=== the breakdown groups real stones, ignores metal, and totals correctly ===");
{
  // Two identical melee stones (same size, so one row with qty 2) and one
  // larger centre stone (its own row), plus a metal part that must be ignored
  // entirely — counting it would silently double a piece's own settings.
  const melee = () => new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1).toNonIndexed());
  const centre = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 5).toNonIndexed());
  [melee(), melee(), centre].forEach((m) => m.updateMatrixWorld(true));

  const parts = [
    { id: "s1", label: "Melee 1", kind: "stone", mesh: melee() },
    { id: "s2", label: "Melee 2", kind: "stone", mesh: melee() },
    { id: "s3", label: "Centre", kind: "stone", mesh: centre },
    {
      id: "m1",
      label: "Band",
      kind: "metal",
      mesh: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)),
    },
  ];
  parts.forEach((p) => p.mesh.updateMatrixWorld(true));

  const uncalibrated = summariseGems(parts, null);
  check(
    uncalibrated.totalCount === 3,
    "three stones counted, the metal part excluded",
    `${uncalibrated.totalCount}`,
  );
  check(
    uncalibrated.totalCaratWt === 0,
    "carat weight is zero, not a fabricated number, until calibrated",
  );
  check(
    uncalibrated.rows.length === 2,
    "two distinct sizes, so two rows",
    `${uncalibrated.rows.length}`,
  );
  const meleeRow = uncalibrated.rows.find((r) => r.qty === 2);
  check(!!meleeRow, "the two identical melee stones collapse into one row with qty 2");

  const calibrated = summariseGems(parts, 1); // 1 mm per unit for a round number
  check(calibrated.totalCaratWt > 0, "calibrated, carat weight is a real positive number");
  const expectedTotal = 2 * estimateCaratWeight(2, 2, 1) + estimateCaratWeight(8, 8, 5);
  check(
    Math.abs(calibrated.totalCaratWt - expectedTotal) < 1e-9,
    "total is the sum of each stone's own estimate, not an approximation of one",
  );
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);
