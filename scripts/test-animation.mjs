/**
 * Camera moves.
 *
 * These cannot be eyeballed without rendering, and the ways they go wrong are
 * specific and silent: a move that passes through the floor, one that snaps at
 * the pole because `lookAt` cannot decide roll, one that claims to loop and
 * jumps on repeat, or one that jumps mid-clip because a term wrapped. All four
 * are arithmetic, so all four are checked here.
 *
 * Usage: node scripts/test-animation.mjs
 */
import {
  ANIMATIONS,
  MAX_ELEVATION,
  MIN_ELEVATION,
  animationById,
  poseAt,
  posePosition,
  AT_REST,
  OBJECT_MOVES,
  bounceHeight,
  dampedSwing,
  objectMoveById,
  objectPoseAt,
  returnsHome,
} from "../.tmp-jewelry/animation.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

const TAU = Math.PI * 2;
/** 200 samples across the clip, which is finer than 24fps at any usable length. */
const SAMPLES = 200;
const walk = (preset) => Array.from({ length: SAMPLES + 1 }, (_, i) => poseAt(preset, i / SAMPLES));

console.log("=== the set ===");
check(ANIMATIONS.length >= 8, `${ANIMATIONS.length} moves offered`);
check(new Set(ANIMATIONS.map((a) => a.id)).size === ANIMATIONS.length, "every id is unique");
check(
  ANIMATIONS.every((a) => a.label.trim() && a.hint.trim()),
  "every one is named and explained",
);
check(ANIMATIONS[0].id === "turntable", "the turntable is first, as the familiar one");
check(animationById("nope").id === "turntable", "an unknown id falls back rather than throwing");

/*
 * The pole is the one that looks like a bug rather than a bad shot. At exactly
 * +/-PI/2 the up vector is parallel to the view direction, `lookAt` has no way
 * to decide roll, and the frame snaps to an arbitrary rotation mid-move.
 */
console.log("\n=== nothing reaches the pole, or goes under the bench ===");
for (const a of ANIMATIONS) {
  const poses = walk(a);
  const hi = Math.max(...poses.map((p) => p.elevation));
  const lo = Math.min(...poses.map((p) => p.elevation));
  check(
    hi <= MAX_ELEVATION + 1e-9 && lo >= MIN_ELEVATION - 1e-9,
    `${a.id} stays inside the safe elevation band`,
    `${lo.toFixed(2)} .. ${hi.toFixed(2)}`,
  );
}

console.log("\n=== the camera is never inside the piece ===");
for (const a of ANIMATIONS) {
  const poses = walk(a);
  const near = Math.min(...poses.map((p) => p.distance));
  check(near > 0.2, `${a.id} keeps its distance`, `closest ${near.toFixed(2)}x`);
}

/*
 * A jump mid-clip is a term that wrapped or an ease applied to a looping move.
 * Sampled as the change between adjacent frames rather than by inspection.
 */
console.log("\n=== every move is continuous ===");
for (const a of ANIMATIONS) {
  const poses = walk(a);
  let worstAz = 0;
  let worstEl = 0;
  let worstD = 0;
  for (let i = 1; i < poses.length; i++) {
    worstAz = Math.max(worstAz, Math.abs(poses[i].azimuth - poses[i - 1].azimuth));
    worstEl = Math.max(worstEl, Math.abs(poses[i].elevation - poses[i - 1].elevation));
    worstD = Math.max(worstD, Math.abs(poses[i].distance - poses[i - 1].distance));
  }
  // A full turn over 200 samples is 0.031 rad a step; triple that is generous
  // for an eased move and still far below anything that would read as a cut.
  check(
    worstAz < 0.1 && worstEl < 0.1 && worstD < 0.1,
    `${a.id} has no jump between frames`,
    `az ${worstAz.toFixed(3)} el ${worstEl.toFixed(3)} d ${worstD.toFixed(3)}`,
  );
}

console.log("\n=== the loop flag is true ===");
for (const a of ANIMATIONS) {
  // Claiming a loop and not closing is the failure a viewer sees as a jump on
  // repeat, and platforms repeat everything.
  check(
    returnsHome(a) === a.loops,
    `${a.id} ${a.loops ? "loops, and closes" : "does not claim to loop"}`,
  );
}

console.log("\n=== each move actually does what it says ===");
{
  const at = (id, t) => poseAt(animationById(id), t);

  const turn = at("turntable", 1).azimuth - at("turntable", 0).azimuth;
  check(Math.abs(turn - TAU) < 1e-9, "turntable turns exactly once", turn.toFixed(3));

  // The one that was asked for by name: starts overhead, ends on the face.
  const topStart = at("top-down", 0);
  const topEnd = at("top-down", 1);
  check(topStart.elevation > 1.2, "top-to-front starts overhead", topStart.elevation.toFixed(2));
  check(topEnd.elevation < 0.3, "and finishes level with the piece", topEnd.elevation.toFixed(2));
  check(topEnd.distance < topStart.distance, "moving in as it lands, so it reads as arrival");
  check(
    Math.abs(topEnd.azimuth - topStart.azimuth) > 0.5,
    "and turns on the way down rather than dropping like a lift",
  );

  const dollyStart = at("dolly", 0);
  const dollyEnd = at("dolly", 1);
  check(dollyEnd.distance < dollyStart.distance * 0.5, "push in more than halves the distance");
  check(
    Math.abs(dollyEnd.azimuth - dollyStart.azimuth) < 1e-9,
    "and does not turn at all, which is the point of it",
  );

  const heroStart = at("hero", 0);
  const heroEnd = at("hero", 1);
  check(heroEnd.elevation > heroStart.elevation, "hero rises");
  check(heroEnd.distance > heroStart.distance, "and pulls back as it goes");

  // A pendulum that showed the back would defeat the purpose: on a pendant the
  // back is a clasp and a wire.
  const swing = walk(animationById("pendulum")).map((p) => p.azimuth);
  check(
    Math.max(...swing) - Math.min(...swing) < Math.PI,
    "pendulum never swings round to the back",
    (Math.max(...swing) - Math.min(...swing)).toFixed(2),
  );

  check(at("macro", 0).distance < 0.6, "macro starts in close");

  /*
   * Float's height runs at twice the rate of its swing, so the path is a figure
   * of eight rather than a line the camera retraces. Measured as the range over
   * the whole clip and as the two terms being out of phase — sampling one point
   * proves nothing, since the faster term is back through zero at the quarter.
   */
  const floatPoses = walk(animationById("float"));
  const els = floatPoses.map((p) => p.elevation);
  const azs = floatPoses.map((p) => p.azimuth);
  check(
    Math.max(...els) - Math.min(...els) > 0.1,
    "float drifts in height",
    (Math.max(...els) - Math.min(...els)).toFixed(3),
  );
  check(Math.max(...azs) - Math.min(...azs) > 0.3, "and swings sideways");
  // Peak height and peak swing at the same t would be a diagonal line.
  const peakEl = els.indexOf(Math.max(...els));
  const peakAz = azs.indexOf(Math.max(...azs));
  check(
    Math.abs(peakEl - peakAz) > SAMPLES * 0.05,
    "with the two out of phase, so the path is a figure of eight rather than a line",
    `peaks at ${(peakEl / SAMPLES).toFixed(2)} and ${(peakAz / SAMPLES).toFixed(2)}`,
  );

  check(Math.abs(at("reveal", 0).azimuth - Math.PI) < 1, "reveal starts behind the piece");
  check(Math.abs(at("reveal", 1).azimuth) < 1, "and finishes on the front");
}

console.log("\n=== an eased move starts and stops gently ===");
{
  // Linear moves are the giveaway that a render is a render. A looping move
  // must NOT ease, or it stalls visibly at every repeat.
  const dolly = animationById("dolly");
  const first = Math.abs(poseAt(dolly, 0.02).distance - poseAt(dolly, 0).distance);
  const middle = Math.abs(poseAt(dolly, 0.52).distance - poseAt(dolly, 0.5).distance);
  check(
    middle > first * 2,
    "push in accelerates out of the start",
    `${first.toFixed(4)} vs ${middle.toFixed(4)}`,
  );

  const turntable = animationById("turntable");
  const a = Math.abs(poseAt(turntable, 0.02).azimuth - poseAt(turntable, 0).azimuth);
  const b = Math.abs(poseAt(turntable, 0.52).azimuth - poseAt(turntable, 0.5).azimuth);
  check(
    Math.abs(a - b) < 1e-9,
    "but a looping move runs at a constant rate, or it stalls on every repeat",
  );
}

console.log("\n=== poses become positions ===");
{
  const p = posePosition({ azimuth: 0, elevation: 0, distance: 1 }, 10);
  check(
    Math.abs(p[0]) < 1e-9 && Math.abs(p[1]) < 1e-9 && Math.abs(p[2] - 10) < 1e-9,
    "azimuth 0 at the horizon puts the camera on +Z, which is the front",
    p.map((n) => n.toFixed(2)).join(", "),
  );

  const up = posePosition({ azimuth: 0, elevation: Math.PI / 2, distance: 1 }, 10);
  check(Math.abs(up[1] - 10) < 1e-9, "elevation PI/2 puts it overhead");

  const side = posePosition({ azimuth: Math.PI / 2, elevation: 0, distance: 1 }, 10);
  check(Math.abs(side[0] - 10) < 1e-9, "a quarter turn puts it on +X");

  const near = posePosition({ azimuth: 0, elevation: 0, distance: 0.5 }, 10);
  check(Math.abs(near[2] - 5) < 1e-9, "the multiplier scales the fitted distance");

  // Radius is preserved whatever the angles, or the piece would appear to
  // breathe as the camera swings.
  let worst = 0;
  for (const a of ANIMATIONS) {
    for (const pose of walk(a)) {
      const [x, y, z] = posePosition(pose, 10);
      worst = Math.max(worst, Math.abs(Math.hypot(x, y, z) - 10 * pose.distance));
    }
  }
  check(worst < 1e-9, "and the radius is exact at every angle", worst.toExponential(1));

  // A degenerate fit must not put the camera at the origin, inside the piece.
  const tiny = posePosition({ azimuth: 0, elevation: 0, distance: 1 }, 0);
  check(Math.hypot(...tiny) > 0, "a zero-size piece still gets a camera outside itself");
}

console.log();
console.log("=== object moves: the piece arriving ===");
{
  /*
   * These are solved in closed form rather than stepped, because a video export
   * renders frames as fast as the machine manages — a stepped simulation would
   * land the piece somewhere different on a desktop than on a phone, and
   * differently again on the next run.
   */
  for (const m of OBJECT_MOVES) {
    const poses = Array.from({ length: SAMPLES + 1 }, (_, i) => objectPoseAt(m, i / SAMPLES));

    check(
      poses.every((p) => p.lift >= 0),
      `${m.id} never sinks below its resting height`,
      Math.min(...poses.map((p) => p.lift)).toFixed(3),
    );
    check(
      poses.every((p) => Number.isFinite(p.lift + p.rotX + p.rotY + p.rotZ)),
      `${m.id} produces no NaN`,
    );

    let jump = 0;
    for (let i = 1; i < poses.length; i++) {
      jump = Math.max(jump, Math.abs(poses[i].lift - poses[i - 1].lift));
    }
    check(jump < 0.2, `${m.id} moves continuously`, jump.toFixed(3));

    // Determinism is the whole reason for the closed form.
    check(
      JSON.stringify(objectPoseAt(m, 0.37)) === JSON.stringify(objectPoseAt(m, 0.37)),
      `${m.id} is the same every time it is asked`,
    );
  }
}

console.log();
console.log("=== a drop lands, bounces, and settles ===");
{
  const start = bounceHeight(0, 2);
  check(Math.abs(start - 2) < 1e-9, "starts at the height it was dropped from", start.toFixed(2));
  check(bounceHeight(1, 2) === 0, "and is at rest by the end");

  // A real bounce touches down, comes back lower, and touches down again.
  const h = Array.from({ length: 400 }, (_, i) => bounceHeight(i / 399, 2));
  /*
   * A contact is a local minimum near the ground, not an exact zero: the zeros
   * fall between samples, and sampling for one would be testing the sampling
   * rate rather than the bounce.
   */
  const touches = [];
  for (let i = 1; i < h.length - 1; i++) {
    if (h[i] < 0.02 && h[i] <= h[i - 1] && h[i] <= h[i + 1]) touches.push(i / 399);
  }
  check(touches.length >= 2, "it hits the ground more than once", `${touches.length} contacts`);

  const peaks = [];
  for (let i = 1; i < h.length - 1; i++) {
    if (h[i] > h[i - 1] && h[i] >= h[i + 1] && h[i] > 1e-4) peaks.push(h[i]);
  }
  check(peaks.length >= 1, "and rebounds after the first landing");
  check(
    peaks.every((v, i) => i === 0 || v < peaks[i - 1]),
    "with every rebound lower than the last, which is what makes it read as settling",
    peaks.map((v) => v.toFixed(2)).join(" > "),
  );
  check(peaks[0] < 2, "and never higher than it was dropped from");
}

console.log();
console.log("=== a released piece swings and stops ===");
{
  const swing = Array.from({ length: 400 }, (_, i) => dampedSwing(i / 399, 0.6));
  check(Math.abs(swing[0] - 0.6) < 1e-9, "starts at full deflection");
  check(Math.abs(swing[swing.length - 1]) < 0.02, "and finishes upright, not mid-swing");

  // Crossing the middle repeatedly is what makes it a swing rather than a lean.
  let crossings = 0;
  for (let i = 1; i < swing.length; i++) {
    if (Math.sign(swing[i]) !== Math.sign(swing[i - 1])) crossings++;
  }
  check(crossings >= 4, "swinging through the middle several times", `${crossings} crossings`);

  const firstHalf = Math.max(...swing.slice(0, 200).map(Math.abs));
  const lastHalf = Math.max(...swing.slice(200).map(Math.abs));
  check(
    lastHalf < firstHalf * 0.5,
    "and losing energy as it goes",
    `${firstHalf.toFixed(2)} then ${lastHalf.toFixed(2)}`,
  );
}

console.log();
console.log("=== spin down slows without reversing ===");
{
  const m = objectMoveById("spin-settle");
  const rot = Array.from({ length: 200 }, (_, i) => objectPoseAt(m, i / 199).rotY);
  check(
    rot.every((v, i) => i === 0 || v >= rot[i - 1] - 1e-9),
    "it only ever turns one way — a reversal would read as a rewind",
  );
  const early = rot[20] - rot[19];
  const late = rot[199] - rot[198];
  check(
    late < early * 0.5,
    "and it is slower at the end than the start",
    `${early.toFixed(4)} to ${late.toFixed(4)}`,
  );
}

console.log();
console.log("=== the still and looping ones behave ===");
{
  const still = objectMoveById("none");
  check(
    [0, 0.3, 1].every((t) => JSON.stringify(objectPoseAt(still, t)) === JSON.stringify(AT_REST)),
    "'Still' really does nothing at any point",
  );
  check(objectMoveById("nope").id === "none", "an unknown id falls back to doing nothing");

  const sway = objectMoveById("sway");
  const a = objectPoseAt(sway, 0);
  const b = objectPoseAt(sway, 1);
  check(Math.abs(a.rotZ - b.rotZ) < 1e-9, "sway ends where it began, so it loops");
  check(
    OBJECT_MOVES.filter((m) => m.loops).every(
      (m) => Math.abs(objectPoseAt(m, 0).rotZ - objectPoseAt(m, 1).rotZ) < 1e-6,
    ),
    "and every move claiming to loop actually closes",
  );
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);
