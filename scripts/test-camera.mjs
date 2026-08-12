/**
 * Framing maths, checked against the geometry it claims to frame.
 *
 * This is the one piece of Phase 1 that can fail silently: the live viewport
 * and an exported file call the same function with different aspect ratios, and
 * a mistake shows up as a download that does not match the screen — which
 * nobody notices until a client lays two renders side by side.
 *
 * So rather than assert magic numbers, each check projects the piece through
 * the camera it was handed and verifies the piece actually lands inside the
 * frame, with the expected margin.
 *
 * Usage: node scripts/test-camera.mjs
 */
import {
  DEFAULT_CAMERA,
  UP_AXES,
  upAxisRotation,
  FIT_MARGIN,
  VIEW_DIR,
  applyAspect,
  cameraPosition,
  clipPlanes,
  frameFit,
  guessUpAxis,
  isPinned,
} from "../.tmp-jewelry/camera.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

/** A pendant: tall and narrow. And a bangle: wide and flat. */
const PENDANT = { radius: 1, radiusXZ: 0.35, halfHeight: 1 };
const BANGLE = { radius: 1, radiusXZ: 1, halfHeight: 0.18 };

/** Half-extents visible at `distance`, for whichever projection this is. */
function visibleHalfExtent(fit, settings, aspect) {
  const f = frameFit(fit, settings, aspect);
  if (settings.projection === "orthographic") {
    return { halfH: f.orthoHalfHeight, halfW: f.orthoHalfHeight * aspect, framing: f };
  }
  // The piece's nearest face is what has to fit, not its centre.
  const toFace = f.distance - fit.radiusXZ;
  const halfH = Math.tan((settings.fov * Math.PI) / 360) * toFace;
  return { halfH, halfW: halfH * aspect, framing: f };
}

console.log("=== the piece fits, in both projections and every shape ===");
for (const projection of ["perspective", "orthographic"]) {
  for (const [name, fit] of [
    ["pendant", PENDANT],
    ["bangle", BANGLE],
  ]) {
    for (const [shape, aspect] of [
      ["16:9", 16 / 9],
      ["1:1", 1],
      ["9:16", 9 / 16],
    ]) {
      const settings = { ...DEFAULT_CAMERA, projection };
      const { halfH, halfW } = visibleHalfExtent(fit, settings, aspect);
      const fitsTall = halfH >= fit.halfHeight;
      const fitsWide = halfW >= fit.radiusXZ;
      check(
        fitsTall && fitsWide,
        `${projection.slice(0, 5)} ${name} in ${shape}`,
        `need ${fit.radiusXZ.toFixed(2)}x${fit.halfHeight.toFixed(2)}, ` +
          `have ${halfW.toFixed(2)}x${halfH.toFixed(2)}`,
      );
    }
  }
}

console.log("\n=== the margin is real, not accidental slack ===");
{
  // At 1:1 the pendant is height-limited, so the vertical margin should land
  // close to FIT_MARGIN rather than being wildly generous.
  const { halfH } = visibleHalfExtent(PENDANT, DEFAULT_CAMERA, 1);
  const ratio = halfH / PENDANT.halfHeight;
  check(
    ratio > 1.05 && ratio < 1.6,
    "perspective leaves a sane margin",
    `${ratio.toFixed(3)}x (FIT_MARGIN is ${FIT_MARGIN})`,
  );
}
{
  const ortho = { ...DEFAULT_CAMERA, projection: "orthographic" };
  const { halfH } = visibleHalfExtent(PENDANT, ortho, 1);
  check(
    near(halfH / PENDANT.halfHeight, FIT_MARGIN, 1e-9),
    "orthographic margin is exactly FIT_MARGIN",
    `${(halfH / PENDANT.halfHeight).toFixed(4)}x`,
  );
}

console.log("\n=== a narrow frame pulls back, a wide one does not ===");
{
  const wide = frameFit(BANGLE, DEFAULT_CAMERA, 16 / 9).distance;
  const narrow = frameFit(BANGLE, DEFAULT_CAMERA, 9 / 16).distance;
  check(
    narrow > wide,
    "portrait needs more distance than landscape for a wide piece",
    `${narrow.toFixed(2)} > ${wide.toFixed(2)}`,
  );
}

console.log("\n=== clipping planes ===");
{
  const f = frameFit(PENDANT, DEFAULT_CAMERA, 1);
  check(f.near > 0, "near is positive", f.near.toExponential(2));
  check(f.near < f.distance - PENDANT.radius, "near sits in front of the piece");
  check(f.far > f.distance + PENDANT.radius, "far sits behind the piece");

  // Raising the near factor is how you slice into a piece to see the setting.
  const sliced = frameFit(PENDANT, { ...DEFAULT_CAMERA, nearFactor: 0.9 }, 1);
  check(
    sliced.near > f.distance - PENDANT.radius,
    "a high near factor cuts into the piece, as intended",
    sliced.near.toFixed(3),
  );

  // A degenerate model must not produce a zero or negative near plane, which
  // silently breaks the depth buffer rather than throwing.
  const tiny = frameFit({ radius: 0, radiusXZ: 0, halfHeight: 0 }, DEFAULT_CAMERA, 1);
  check(
    tiny.near > 0 && tiny.far >= tiny.near,
    "a zero-size model still yields a valid frustum",
    `near ${tiny.near.toExponential(1)} far ${tiny.far.toExponential(1)}`,
  );
}
{
  const ortho = { ...DEFAULT_CAMERA, projection: "orthographic" };
  const f = frameFit(PENDANT, ortho, 1);
  check(f.near > 0, "orthographic near is positive", f.near.toFixed(3));
  check(
    f.near < f.distance - PENDANT.radius && f.far > f.distance + PENDANT.radius,
    "orthographic frustum contains the whole piece",
    `${f.near.toFixed(2)} .. ${f.far.toFixed(2)} around ${f.distance.toFixed(2)}`,
  );
  // clipPlanes must agree with frameFit, or exports drift from the viewport.
  const c = clipPlanes(f.distance, ortho, PENDANT.radius);
  check(near(c.near, f.near) && near(c.far, f.far), "clipPlanes matches frameFit (orthographic)");
  const p = frameFit(PENDANT, DEFAULT_CAMERA, 1);
  const cp = clipPlanes(p.distance, DEFAULT_CAMERA, PENDANT.radius);
  check(near(cp.near, p.near) && near(cp.far, p.far), "clipPlanes matches frameFit (perspective)");
}

console.log("\n=== applyAspect reshapes each camera type correctly ===");
{
  const persp = {
    near: 0.1,
    far: 10,
    aspect: 1,
    updateProjectionMatrix() {
      this.updated = true;
    },
  };
  applyAspect(persp, 16 / 9);
  check(
    near(persp.aspect, 16 / 9) && persp.updated === true,
    "perspective takes the ratio directly",
  );

  const ortho = {
    isOrthographicCamera: true,
    near: 0.1,
    far: 10,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    updateProjectionMatrix() {
      this.updated = true;
    },
  };
  applyAspect(ortho, 2, 3);
  check(
    ortho.top === 3 && ortho.bottom === -3 && ortho.right === 6 && ortho.left === -6,
    "orthographic frustum is rebuilt from half-height x aspect",
    `${ortho.left}..${ortho.right} x ${ortho.bottom}..${ortho.top}`,
  );
  check(ortho.updated === true, "orthographic projection matrix is refreshed");

  // Called without a half-height it must hold the current one, not collapse.
  applyAspect(ortho, 1);
  check(
    ortho.top === 3 && ortho.right === 3,
    "keeps its height when none is given",
    `top ${ortho.top} right ${ortho.right}`,
  );
}

console.log("\n=== field of view behaves like a lens ===");
{
  const wide = frameFit(PENDANT, { ...DEFAULT_CAMERA, fov: 70 }, 1).distance;
  const long = frameFit(PENDANT, { ...DEFAULT_CAMERA, fov: 15 }, 1).distance;
  check(
    long > wide,
    "a longer lens stands further back to hold the same framing",
    `15deg ${long.toFixed(2)} > 70deg ${wide.toFixed(2)}`,
  );
}

console.log("\n=== up axis ===");
{
  check(DEFAULT_CAMERA.upAxis === "y", "Y-up by default, so nothing existing moves");
  check(DEFAULT_CAMERA.rawGeometry === false, "raw mesh view is off by default");
  const [yx, yy, yz] = upAxisRotation("y");
  check(yx === 0 && yy === 0 && yz === 0, "Y-up applies no rotation at all");
  const [zx] = upAxisRotation("z");
  check(
    Math.abs(zx + Math.PI / 2) < 1e-12,
    "Z-up tips a quarter turn about X, the CAD convention",
    `${zx.toFixed(4)} rad`,
  );
  // The rotation must actually put the source up-axis onto three's +Y.
  const rotX = (v, a) => [
    v[0],
    v[1] * Math.cos(a) - v[2] * Math.sin(a),
    v[1] * Math.sin(a) + v[2] * Math.cos(a),
  ];
  const rotZ = (v, a) => [
    v[0] * Math.cos(a) - v[1] * Math.sin(a),
    v[0] * Math.sin(a) + v[1] * Math.cos(a),
    v[2],
  ];
  const zUp = rotX([0, 0, 1], upAxisRotation("z")[0]);
  check(
    Math.abs(zUp[1] - 1) < 1e-9,
    "a Z-up model's up vector lands on +Y",
    `(${zUp.map((n) => n.toFixed(2))})`,
  );
  const xUp = rotZ([1, 0, 0], upAxisRotation("x")[2]);
  check(
    Math.abs(xUp[1] - 1) < 1e-9,
    "an X-up model's up vector lands on +Y",
    `(${xUp.map((n) => n.toFixed(2))})`,
  );
}

console.log("\n=== the camera is framed until it is pinned ===");
{
  check(DEFAULT_CAMERA.position === null, "a fresh camera follows the framing");
  check(!isPinned(DEFAULT_CAMERA), "and is not reported as pinned");

  const framed = cameraPosition(DEFAULT_CAMERA, 10);
  check(
    Math.abs(framed[0] - VIEW_DIR[0] * 10) < 1e-9 && Math.abs(framed[2] - VIEW_DIR[2] * 10) < 1e-9,
    "so it sits on the standard direction at the fitted distance",
    framed.map((n) => n.toFixed(2)).join(", "),
  );
  const near = cameraPosition(DEFAULT_CAMERA, 2);
  check(near[2] < framed[2], "and a closer fit brings it closer");

  const pinned = { ...DEFAULT_CAMERA, position: [1, 2, 3] };
  check(isPinned(pinned), "a set position is pinned");
  check(
    JSON.stringify(cameraPosition(pinned, 999)) === "[1,2,3]",
    "and it wins over the framing, whatever the distance",
  );

  /*
   * The origin is rejected rather than honoured. A camera there is inside the
   * piece looking at itself, `lookAt` has no direction to work with, and the
   * result is a blank frame that reads as a broken render — which is what
   * clearing all three fields to zero would otherwise produce.
   */
  const origin = { ...DEFAULT_CAMERA, position: [0, 0, 0] };
  check(!isPinned(origin), "all zeroes is not a pin");
  check(
    JSON.stringify(cameraPosition(origin, 10)) === JSON.stringify(framed),
    "it falls back to the framing rather than putting the camera inside the piece",
  );
  check(
    isPinned({ ...DEFAULT_CAMERA, position: [0, 0, 0.5] }),
    "but a single non-zero axis still counts",
  );
}

console.log("\n=== which way up ===");
{
  check(UP_AXES.length === 3, "three axes offered");
  check(
    UP_AXES.every((a) => upAxisRotation(a.value) !== undefined),
    "each one maps to a rotation",
  );
  check(
    new Set(UP_AXES.map((a) => JSON.stringify(upAxisRotation(a.value)))).size === 3,
    "and all three rotations differ, so the choice is never a no-op",
  );

  /*
   * A guess, offered as one. Rhino and the CAD interchange formats are almost
   * all Z-up, while a GLB is written by a web tool and already upright. Our own
   * .3dm worker outputs Y-up, so it must not be guessed as Z.
   */
  check(guessUpAxis("ring.obj") === "z", "OBJ is guessed Z-up");
  check(guessUpAxis("RING.STL") === "z", "so is STL, whatever the case");
  check(guessUpAxis("piece.glb") === "y", "a GLB is already upright");
  check(guessUpAxis("LP 043.3dm") === "y", "and our own .3dm decoder outputs Y-up");
  check(guessUpAxis("no-extension") === "y", "an unknown file is left alone");
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);
