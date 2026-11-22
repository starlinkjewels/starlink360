/**
 * Try-on maths, checked against synthetic bodies with known answers.
 *
 * The failures this guards against are silent ones: a sign error puts the
 * diamond on the palm side of the finger, a crop error shifts every piece by
 * a few pixels, a mis-wound facet renders as a hole in the stone. None of
 * them throw, so each check here states the geometric fact it relies on.
 *
 * Usage: npm run test:tryon
 */
import {
  basisYZ,
  cross,
  dot,
  headPose,
  len,
  mapDir,
  mapDirs,
  mapPoint,
  mapPoints,
  neckAnchor,
  dorsalNormal,
  rightInImageFromLabel,
  ringAnchor,
  wristAnchor,
  RING_INNER_PER_SPACING,
  BRACELET_BACK,
} from "../.tmp-jewelry/tryon/anchors.js";
import { OneEuroFilter, HandednessVote } from "../.tmp-jewelry/tryon/filters.js";
import { roundBrilliant, caratToDiameterMm } from "../.tmp-jewelry/tryon/brilliant.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const fmt = (n) => (Math.round(n * 1000) / 1000).toString();

/** det of the basis matrix: +1 for a proper rotation, -1 for a reflection. */
const det = (b) => dot(b.x ?? b.xAxis, cross(b.y ?? b.yAxis, b.z ?? b.zAxis));
const orthonormal = (b) => {
  const x = b.x ?? b.xAxis,
    y = b.y ?? b.yAxis,
    z = b.z ?? b.zAxis;
  return (
    near(len(x), 1, 1e-6) &&
    near(len(y), 1, 1e-6) &&
    near(len(z), 1, 1e-6) &&
    near(dot(x, y), 0, 1e-6) &&
    near(dot(y, z), 0, 1e-6) &&
    near(dot(x, z), 0, 1e-6)
  );
};

/* ------------------------------------------------------------- brilliant */
console.log("\nRound brilliant");
{
  const b = roundBrilliant();
  check(b.facets === 73, "57 facets plus 16 girdle segments", `${b.facets}`);
  const P = b.positions;
  const tri = (t) =>
    [0, 1, 2].map((k) => [P[t * 9 + k * 3], P[t * 9 + k * 3 + 1], P[t * 9 + k * 3 + 2]]);
  const normal = ([a, b2, c]) => {
    const u = [b2[0] - a[0], b2[1] - a[1], b2[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(...n);
    return n.map((x) => x / l);
  };
  const centre = [0, (b.tableY + b.culetY) / 2, 0];
  let outward = 0;
  const edges = new Map();
  const key = (p) => p.map((x) => x.toFixed(5)).join(",");
  for (let t = 0; t < b.triangles; t++) {
    const v = tri(t);
    const n = normal(v);
    const c = [0, 1, 2].map((k) => (v[0][k] + v[1][k] + v[2][k]) / 3 - centre[k]);
    if (n[0] * c[0] + n[1] * c[1] + n[2] * c[2] > 0) outward++;
    for (let e = 0; e < 3; e++) {
      const k2 = [key(v[e]), key(v[(e + 1) % 3])].sort().join("|");
      edges.set(k2, (edges.get(k2) ?? 0) + 1);
    }
  }
  check(outward === b.triangles, "every triangle wound outward", `${outward}/${b.triangles}`);
  const open = [...edges.values()].filter((n) => n !== 2).length;
  check(open === 0, "watertight: every edge shared by exactly two triangles", `${open} open`);

  // Kites (bezels, pavilion mains) are split into two triangles; both halves
  // must be coplanar or the facet is bent and flashes as two facets.
  let bent = 0;
  for (let i = 0; i < 8; i++) {
    const base = 8 + 9 * i;
    for (const [a, c] of [
      [base + 1, base + 2],
      [base + 5, base + 6],
    ]) {
      const na = normal(tri(a));
      const nc = normal(tri(c));
      if (na[0] * nc[0] + na[1] * nc[1] + na[2] * nc[2] < 0.99999) bent++;
    }
  }
  check(bent === 0, "bezel and pavilion-main kites are flat", `${bent} bent`);

  const diameter = 2;
  const depth = (b.tableY - b.culetY) / diameter;
  const crown = (b.tableY - b.girdleTop) / diameter;
  const pavilion = (b.girdleBottom - b.culetY) / diameter;
  check(
    depth > 0.57 && depth < 0.635,
    "total depth in GIA Excellent range (57–63 %)",
    `${fmt(depth * 100)} %`,
  );
  check(crown > 0.125 && crown < 0.17, "crown height 12.5–17 %", `${fmt(crown * 100)} %`);
  check(
    pavilion > 0.42 && pavilion < 0.445,
    "pavilion depth 42–44.5 %",
    `${fmt(pavilion * 100)} %`,
  );
  check(near(caratToDiameterMm(1), 6.5), "1 ct is 6.5 mm across");
  check(
    near(caratToDiameterMm(2) / caratToDiameterMm(0.25), 2, 1e-9),
    "8× the weight is 2× the diameter",
  );
}

/* --------------------------------------------------------------- filters */
console.log("\nOne Euro filter");
{
  const f = new OneEuroFilter();
  let out = 0;
  for (let i = 0; i < 60; i++) out = f.filter(0.5, i / 30);
  check(near(out, 0.5), "a still point stays put");

  // Deterministic noise around a still point.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.004;
  const g = new OneEuroFilter();
  let rawVar = 0,
    outVar = 0;
  for (let i = 0; i < 300; i++) {
    const n = rnd();
    const y = g.filter(0.5 + n, i / 30);
    if (i > 30) {
      rawVar += n * n;
      outVar += (y - 0.5) ** 2;
    }
  }
  check(outVar < rawVar * 0.25, "jitter at rest cut by more than 4×", `${fmt(rawVar / outVar)}×`);

  // A brisk sweep: one frame-width per second. Lag must stay small.
  const h = new OneEuroFilter();
  let lag = 0;
  for (let i = 0; i < 30; i++) lag = i / 30 - h.filter(i / 30, i / 30);
  check(
    lag < 0.03,
    "keeps up with a moving hand (under 3 % of frame behind)",
    `${fmt(lag * 100)} %`,
  );

  const vote = new HandednessVote();
  let side = vote.push(1, 0.9);
  for (let i = 0; i < 3; i++) side = vote.push(-1, 0.6);
  check(side === true, "handedness ignores a short contrary flicker");
  for (let i = 0; i < 20; i++) side = vote.push(-1, 0.9);
  check(side === false, "…but follows a sustained change");
}

/* --------------------------------------------------------------- mapping */
console.log("\nStage mapping (object-fit: cover)");
{
  const f = { stageW: 400, stageH: 800, videoW: 1280, videoH: 720, mirrored: false };
  const c = mapPoint(f, { x: 0.5, y: 0.5, z: 0 });
  check(near(c.x, 0) && near(c.y, 0), "frame centre lands on stage centre");
  // Portrait stage over landscape video: height fits, sides are cropped.
  const scale = 800 / 720;
  const p = mapPoint(f, { x: 0.6, y: 0.25, z: 0 });
  check(near(p.x, 0.1 * 1280 * scale, 1e-6), "x follows the cropped, scaled frame", fmt(p.x));
  check(near(p.y, 0.25 * 720 * scale, 1e-6), "y is flipped to point up", fmt(p.y));
  const m = mapPoint({ ...f, mirrored: true }, { x: 0.6, y: 0.25, z: 0 });
  check(near(m.x, -p.x) && near(m.y, p.y), "mirroring flips x only");
  const z = mapPoint(f, { x: 0.5, y: 0.5, z: -0.05 });
  check(z.z > 0, "closer to the camera (smaller MediaPipe z) is toward the viewer");
  const d = mapDir({ ...f, mirrored: true }, { x: 1, y: 1, z: 1 });
  check(d.x === -1 && d.y === -1 && d.z === -1, "world directions: x mirrored, y and z flipped");
}

/* ----------------------------------------------------------------- hands */
console.log("\nHands");
{
  /*
   * A right hand held up, fingers up, BACK toward the camera, in the raw
   * (unmirrored) frame. The subject's right side appears on the image's left,
   * and with the palm facing the subject the thumb points to their right,
   * so the index knuckle is LEFT of the pinky knuckle in the image.
   */
  const hand = (indexLeft) => {
    const s = indexLeft ? 1 : -1;
    const pts = Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.8, z: 0 }));
    pts[0] = { x: 0.3, y: 0.8, z: 0 };
    pts[5] = { x: 0.3 - 0.05 * s, y: 0.55, z: 0 };
    pts[6] = { x: 0.3 - 0.055 * s, y: 0.45, z: 0 };
    pts[9] = { x: 0.3 - 0.012 * s, y: 0.53, z: 0 };
    pts[10] = { x: 0.3 - 0.014 * s, y: 0.42, z: 0 };
    pts[13] = { x: 0.3 + 0.026 * s, y: 0.545, z: 0 };
    pts[14] = { x: 0.3 + 0.03 * s, y: 0.445, z: 0 };
    pts[17] = { x: 0.3 + 0.065 * s, y: 0.58, z: 0 };
    pts[18] = { x: 0.3 + 0.072 * s, y: 0.5, z: 0 };
    return pts;
  };
  const frame = (mirrored) => ({ stageW: 720, stageH: 1280, videoW: 720, videoH: 1280, mirrored });

  // MediaPipe assumes mirrored input, so on a raw frame it calls a right hand "Left".
  check(
    rightInImageFromLabel("Left") === true,
    "raw-frame label 'Left' means a right-looking hand",
  );

  for (const mirrored of [false, true]) {
    const f = frame(mirrored);
    const back = hand(true);
    const dirs = mapDirs(
      f,
      back.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    );
    const n = dorsalNormal(dirs, true, mirrored);
    check(
      n.z > 0.9,
      `right hand, back to camera${mirrored ? " (mirrored)" : ""}: back-of-hand faces the viewer`,
      fmt(n.z),
    );

    const palm = hand(false);
    const n2 = dorsalNormal(mapDirs(f, palm), true, mirrored);
    check(
      n2.z < -0.9,
      `right hand, palm to camera${mirrored ? " (mirrored)" : ""}: back-of-hand faces away`,
      fmt(n2.z),
    );

    // A left hand showing its back looks exactly like a right hand showing its palm.
    const n3 = dorsalNormal(mapDirs(f, palm), false, mirrored);
    check(
      n3.z > 0.9,
      `left hand, back to camera${mirrored ? " (mirrored)" : ""}: back-of-hand faces the viewer`,
      fmt(n3.z),
    );

    const img = mapPoints(f, back);
    const ring = ringAnchor(img, mapDirs(f, back), "ring", true, mirrored);
    check(
      orthonormal(ring) && near(det(ring), 1, 1e-6),
      `ring pose is a proper rotation${mirrored ? " (mirrored)" : ""}`,
    );
    check(ring.yAxis.y > 0.95, "ring axis runs along the finger toward the tip", fmt(ring.yAxis.y));
    check(
      ring.zAxis.z > 0.9,
      "centre stone faces the camera on a back-facing hand",
      fmt(ring.zAxis.z),
    );
    const mcp = img[13],
      pip = img[14];
    const t =
      dot(
        { x: ring.position.x - mcp.x, y: ring.position.y - mcp.y, z: 0 },
        { x: pip.x - mcp.x, y: pip.y - mcp.y, z: 0 },
      ) /
      ((pip.x - mcp.x) ** 2 + (pip.y - mcp.y) ** 2);
    check(t > 0.3 && t < 0.55, "ring sits on the proximal phalanx, nearer the knuckle", fmt(t));
    const spacing =
      (Math.hypot(img[13].x - img[9].x, img[13].y - img[9].y) +
        Math.hypot(img[13].x - img[17].x, img[13].y - img[17].y)) /
      2;
    check(
      near(ring.scale, spacing * RING_INNER_PER_SPACING, 1e-6),
      "ring inner radius scales with knuckle spacing",
    );

    const wrist = wristAnchor(img, mapDirs(f, back), true, mirrored, BRACELET_BACK);
    check(
      orthonormal(wrist) && near(det(wrist), 1, 1e-6),
      `wrist pose is a proper rotation${mirrored ? " (mirrored)" : ""}`,
    );
    check(wrist.position.y < img[0].y, "bracelet sits below the wrist landmark, on the forearm");
  }
}

/* ------------------------------------------------------------------ face */
console.log("\nFace");
{
  const face = (yaw, swapSides) => {
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    const rot = (x, y, z) => ({ x: x * c + z * s, y, z: -x * s + z * c });
    const a = swapSides ? 1 : -1;
    const pts = [];
    pts[234] = rot(70 * a, 0, 0);
    pts[454] = rot(-70 * a, 0, 0);
    pts[132] = rot(62 * a, -55, 5);
    pts[361] = rot(-62 * a, -55, 5);
    pts[10] = rot(0, 95, 25);
    pts[152] = rot(0, -95, 25);
    pts[1] = rot(0, -5, 70);
    return pts;
  };
  for (const swap of [false, true]) {
    const h = headPose(face(0, swap));
    const tag = swap ? " (mirrored)" : "";
    check(
      orthonormal(h.basis) && near(det(h.basis), 1, 1e-6),
      `head basis is a proper rotation${tag}`,
    );
    check(
      h.basis.z.z > 0.99,
      "head forward points at the camera, whichever way the image is flipped",
      fmt(h.basis.z.z),
    );
    check(h.basis.y.y > 0.99, "head up is up");
    check(near(h.width, 140, 1e-9), "face width is ear-to-ear distance");
    for (const ear of h.ears) {
      const top = ear.side === "A" ? face(0, swap)[234] : face(0, swap)[454];
      check(
        ear.lobe.y < top.y && Math.abs(ear.lobe.x) >= Math.abs(top.x) * 0.95,
        `lobe ${ear.side} hangs below the ear point, at the side of the head`,
        `${fmt(ear.lobe.x)}, ${fmt(ear.lobe.y)}`,
      );
      check(
        Math.abs(ear.facing) < 0.2,
        `ear ${ear.side} is side-on to a frontal camera`,
        fmt(ear.facing),
      );
    }
  }
  const turned = headPose(face(1.1, false));
  const facings = turned.ears.map((e) => e.facing).sort((a, b) => a - b);
  check(
    facings[0] < -0.55 && facings[1] > 0.55,
    "turning the head hides one ear and shows the other",
    facings.map(fmt).join(" / "),
  );
}

/* ------------------------------------------------------------- shoulders */
console.log("\nShoulders");
{
  const sparse = [];
  sparse[11] = { x: 100, y: -200, z: 0 };
  sparse[12] = { x: -100, y: -200, z: 0 };
  const a = neckAnchor(sparse, null);
  check(orthonormal(a) && near(det(a), 1, 1e-6), "necklace pose is a proper rotation");
  check(a.zAxis.z > 0.99 && a.yAxis.y > 0.99, "necklace faces the camera, upright");
  check(near(a.scale, 200) && near(a.position.y, -200), "sized and placed on the shoulder line");

  // Mirrored: the subject's left shoulder appears on the other side.
  const m = [];
  m[11] = { x: -100, y: -200, z: 0 };
  m[12] = { x: 100, y: -200, z: 0 };
  const b = neckAnchor(m, null);
  check(b.zAxis.z > 0.99 && near(det(b), 1, 1e-6), "still faces the camera when mirrored");

  // Turned 45°: image width shrinks, measured width must not.
  const yaw = Math.PI / 4;
  const t = [];
  t[11] = { x: 100 * Math.cos(yaw), y: -200, z: 0 };
  t[12] = { x: -100 * Math.cos(yaw), y: -200, z: 0 };
  const dirs = [];
  dirs[11] = { x: Math.cos(yaw) * 0.18, y: 0, z: -Math.sin(yaw) * 0.18 };
  dirs[12] = { x: -Math.cos(yaw) * 0.18, y: 0, z: Math.sin(yaw) * 0.18 };
  const c = neckAnchor(t, dirs);
  check(near(c.scale, 200, 1e-6), "shoulder width is corrected for a turned body", fmt(c.scale));
  check(Math.abs(Math.abs(c.yaw) - yaw) < 1e-6, "reports the turn", fmt(c.yaw));
}

/* ----------------------------------------------------------------- basis */
console.log("\nBasis");
{
  const b = basisYZ({ x: 0, y: 2, z: 0 }, { x: 0.3, y: 0.5, z: 1 });
  check(
    orthonormal(b) && near(det(b), 1, 1e-9),
    "Gram–Schmidt gives a right-handed orthonormal basis",
  );
  const d = basisYZ({ x: 0, y: 1, z: 0 }, { x: 0, y: 5, z: 0 });
  check(orthonormal(d), "degenerate input still gives a basis");
}

console.log(fail ? `\n${fail} FAILED` : "\nAll try-on checks passed");
process.exit(fail ? 1 : 0);
