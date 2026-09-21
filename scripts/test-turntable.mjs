/**
 * The turntable controls, checked against the OrbitControls they replace.
 *
 * Two claims have to hold at once, and they are the reason this file exists:
 *
 *   1. It FEELS like Givara. Givara's viewer is OrbitControls with
 *      `rotateSpeed` 0.85 and `dampingFactor` 0.06, so the pixels-to-radians
 *      conversion and the accumulate-and-decay have to match OrbitControls
 *      exactly. Those formulae are reimplemented here from three's source and
 *      compared, rather than asserted as magic numbers.
 *
 *   2. It never stops. OrbitControls clamps its polar angle and then calls
 *      `Spherical.makeSafe()`, which pins it inside [EPS, PI-EPS]. The whole
 *      point of the replacement is that the vertical carries on through the
 *      poles and round, so that is driven past PI/2, PI and 2PI here.
 *
 * Usage: node scripts/test-turntable.mjs
 */
import * as THREE from "three";
import { TurntableControls } from "../.tmp-jewelry/turntableControls.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const HEIGHT = 800;

/** Just enough DOM for the controls, plus a way to fire events at them. */
function stubElement() {
  const handlers = new Map();
  return {
    clientHeight: HEIGHT,
    clientWidth: 1200,
    style: {},
    addEventListener: (type, fn) => handlers.set(type, fn),
    removeEventListener: (type) => handlers.delete(type),
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => true,
    fire: (type, event) => handlers.get(type)?.({ preventDefault() {}, ...event }),
  };
}

function rig({ damping = false, rotateSpeed = 0.85, dampingFactor = 0.06 } = {}) {
  const camera = new THREE.PerspectiveCamera(40, 1.4, 0.1, 100);
  camera.position.set(0, 0, 4);
  const el = stubElement();
  const controls = new TurntableControls(camera, el);
  controls.enableDamping = damping;
  controls.dampingFactor = dampingFactor;
  controls.rotateSpeed = rotateSpeed;
  controls.minDistance = 0.5;
  controls.maxDistance = 20;
  return { camera, el, controls };
}

/** Drag from (x0,y0) by (dx,dy), as a pointer would. */
function drag(el, dx, dy, x0 = 600, y0 = 400) {
  el.fire("pointerdown", { pointerId: 1, clientX: x0, clientY: y0 });
  el.fire("pointermove", { pointerId: 1, clientX: x0 + dx, clientY: y0 + dy });
  el.fire("pointerup", { pointerId: 1 });
}

/** The angle a camera sits at around Y, from its position. Wraps at +/-PI. */
const yawOf = (c, t) => Math.atan2(c.position.x - t.x, c.position.z - t.z);

/**
 * Total yaw turned over a drag, unwrapped.
 *
 * `atan2` cannot express more than half a revolution, and these controls turn
 * further than that in one go — so the drag is applied in steps small enough
 * that each is unambiguous, and the shortest-path differences are summed.
 */
function turnedBy(el, controls, camera, dx, steps = 8) {
  let total = 0;
  let prev = yawOf(camera, controls.target);
  for (let i = 0; i < steps; i++) {
    drag(el, dx / steps, 0);
    controls.update();
    const now = yawOf(camera, controls.target);
    let step = prev - now;
    while (step > Math.PI) step -= 2 * Math.PI;
    while (step < -Math.PI) step += 2 * Math.PI;
    total += step;
    prev = now;
  }
  return total;
}

console.log("=== the conversion from pixels is OrbitControls' own ===");
{
  /*
   * three's OrbitControls, in `handleMouseMoveRotate`:
   *
   *   rotateDelta = (end - start) * rotateSpeed
   *   rotateLeft( 2 * PI * rotateDelta.x / element.clientHeight )   // theta -= angle
   *
   * so a drag of exactly one canvas HEIGHT is one full turn at rotateSpeed 1.
   * Height is used for the horizontal too, which is why the piece turns at the
   * same rate in a wide window as a tall one.
   */
  const orbitFormula = (px, rotateSpeed) => (2 * Math.PI * px * rotateSpeed) / HEIGHT;

  for (const speed of [0.85, 1, 2.4]) {
    const { camera, el, controls } = rig({ rotateSpeed: speed });
    const turned = turnedBy(el, controls, camera, 200);
    check(
      near(turned, orbitFormula(200, speed), 1e-9),
      `a 200px drag at rotateSpeed ${speed} turns exactly as OrbitControls would`,
      `${turned.toFixed(6)} rad`,
    );
  }

  const { camera, el, controls } = rig({ rotateSpeed: 1 });
  const full = turnedBy(el, controls, camera, HEIGHT);
  check(
    near(Math.abs(full), 2 * Math.PI, 1e-9),
    "and a drag of one canvas height is exactly one full turn",
    `${full.toFixed(6)} rad`,
  );
}

console.log("\n=== damping is OrbitControls' accumulate-and-decay ===");
{
  const f = 0.06;
  const { camera, el, controls } = rig({ damping: true, dampingFactor: f, rotateSpeed: 1 });
  const target = controls.target;
  const start = yawOf(camera, target);
  const total = (2 * Math.PI * 200) / HEIGHT;

  // The drag itself steps once, because the pointer handler calls update() —
  // OrbitControls does the same, and it is why the camera keeps up with the
  // hand instead of trailing a frame behind it.
  drag(el, 200, 0);
  check(
    near(start - yawOf(camera, target), total * f, 1e-9),
    "the pointer event itself advances by dampingFactor, without waiting a frame",
    `${(f * 100).toFixed(0)}%`,
  );

  // And the geometric series sums to the whole delta: d*f*(1+(1-f)+(1-f)^2+…) = d.
  for (let i = 0; i < 400; i++) controls.update();
  check(
    near(start - yawOf(camera, target), total, 1e-6),
    "and the easing converges on the full drag, losing none of it",
  );
}

console.log("\n=== the vertical never stops: this is what OrbitControls could not do ===");
{
  const { camera, el, controls } = rig({ rotateSpeed: 1 });
  const seen = [];
  // 24 drags of a fifteenth of a turn each = one complete revolution.
  for (let i = 0; i < 24; i++) {
    drag(el, 0, HEIGHT / 24);
    controls.update();
    seen.push(camera.position.clone());
  }

  const heights = seen.map((p) => p.y);
  check(
    Math.max(...heights) > 3.9 && Math.min(...heights) < -3.9,
    "it passes directly overhead AND directly underneath",
    `y from ${Math.min(...heights).toFixed(2)} to ${Math.max(...heights).toFixed(2)}`,
  );

  /*
   * The regression this file exists for. Under OrbitControls the last frames
   * would all be the same clamped pose, so consecutive positions would stop
   * differing. Every step here has to keep moving.
   */
  let stalled = 0;
  for (let i = 1; i < seen.length; i++) {
    if (seen[i].distanceTo(seen[i - 1]) < 1e-3) stalled++;
  }
  check(stalled === 0, "and no step stalls against a clamp", `${stalled} stalled`);

  check(
    seen[seen.length - 1].distanceTo(new THREE.Vector3(0, 0, 4)) < 1e-6,
    "a full revolution arrives exactly back where it started",
  );
}

console.log("\n=== the camera faces the target from everywhere, poles included ===");
{
  const { camera, el, controls } = rig({ rotateSpeed: 1 });
  let worst = 0;
  for (let i = 0; i < 40; i++) {
    drag(el, 37, HEIGHT / 40);
    controls.update();
    // A camera looks down its own -Z.
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const toTarget = controls.target.clone().sub(camera.position).normalize();
    worst = Math.max(worst, forward.angleTo(toTarget));
  }
  check(
    worst < 1e-6,
    "never drifts off-centre, and never hits the singularity that forced the clamp",
    `worst ${worst.toExponential(1)} rad`,
  );
}

console.log("\n=== zoom ===");
{
  const { camera, el, controls } = rig();
  const step = Math.pow(0.95, controls.zoomSpeed);
  const before = camera.position.length();
  el.fire("wheel", { deltaY: -100 });
  controls.update();
  check(
    near(camera.position.length(), before * step, 1e-9),
    "a wheel notch is OrbitControls' 0.95 ^ zoomSpeed",
  );

  for (let i = 0; i < 200; i++) {
    el.fire("wheel", { deltaY: -100 });
    controls.update();
  }
  check(near(camera.position.length(), controls.minDistance, 1e-9), "and stops at minDistance");

  for (let i = 0; i < 400; i++) {
    el.fire("wheel", { deltaY: 100 });
    controls.update();
  }
  check(near(camera.position.length(), controls.maxDistance, 1e-9), "and at maxDistance");
}

console.log("\n=== something else moving the camera wins ===");
{
  /*
   * The angles are the source of truth here, which would otherwise stamp on a
   * view preset, a frame of an animation or the axis gizmo. Each of those sets
   * the camera and calls update(), so update() has to notice and adopt it.
   */
  const { camera, el, controls } = rig();
  drag(el, 120, 60);
  controls.update();

  camera.position.set(0, 5, 0.001);
  controls.update();
  check(
    camera.position.distanceTo(new THREE.Vector3(0, 5, 0.001)) < 1e-3,
    "a camera placed from outside is kept, not snapped back",
    `at ${camera.position.toArray().map((n) => n.toFixed(2))}`,
  );

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const toTarget = controls.target.clone().sub(camera.position).normalize();
  check(forward.angleTo(toTarget) < 1e-6, "and it still looks at the target from there");
}

console.log("\n=== only the newest controls drives a camera ===");
{
  /*
   * Duplicates really happened — six were updating one camera per frame, the
   * stale ones dragging it back to their own opening radius. That is the
   * "it shrinks when I touch it" and "it judders upside down" report.
   */
  const camera = new THREE.PerspectiveCamera(40, 1.4, 0.1, 100);
  camera.position.set(0, 0, 4);
  const elOld = stubElement();
  const old = new TurntableControls(camera, elOld);
  old.minDistance = 0.5;
  old.maxDistance = 20;

  old.claim(); // as its component mounting would

  // A second one arrives, as a reload or a re-mount would, and takes over.
  const elNew = stubElement();
  const fresh = new TurntableControls(camera, elNew);
  fresh.minDistance = 0.5;
  fresh.maxDistance = 20;
  fresh.rotateSpeed = 1;
  fresh.claim();

  camera.position.set(0, 0, 9);
  fresh.update();
  const claimed = camera.position.length();
  check(
    near(claimed, 9, 1e-9),
    "a camera placed before the first update is adopted, not overwritten",
    `${claimed.toFixed(3)}`,
  );

  // Everything the stale one can do must be ignored.
  drag(elOld, 300, 200);
  elOld.fire("wheel", { deltaY: -100 });
  old.update();
  check(
    near(camera.position.length(), claimed, 1e-9),
    "a superseded instance cannot move the camera",
    `${camera.position.length().toFixed(3)} vs ${claimed.toFixed(3)}`,
  );

  const before = yawOf(camera, fresh.target);
  drag(elNew, 120, 0);
  check(
    Math.abs(before - yawOf(camera, fresh.target)) > 1e-6,
    "while the newest one still drives it",
  );

  /*
   * And the claim is only ever made by a mounted component. React can build an
   * instance through `useMemo` and discard it; if merely constructing one took
   * the camera, that discarded object would silence the live controls and the
   * viewer would not move at all.
   */
  const elGhost = stubElement();
  const ghost = new TurntableControls(camera, elGhost);
  ghost.minDistance = 0.5;
  ghost.maxDistance = 20;
  const held = yawOf(camera, fresh.target);
  drag(elNew, 90, 0);
  check(
    Math.abs(held - yawOf(camera, fresh.target)) > 1e-6,
    "a constructed-but-never-mounted instance does not steal the camera",
  );
  ghost.dispose();
}

console.log("\n=== disabled means disabled ===");
{
  const { camera, el, controls } = rig();
  controls.enabled = false;
  const before = camera.position.clone();
  drag(el, 300, 200);
  el.fire("wheel", { deltaY: -100 });
  controls.update();
  check(camera.position.distanceTo(before) < 1e-9, "a locked camera ignores drags and the wheel");
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);
