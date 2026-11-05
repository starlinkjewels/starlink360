/**
 * The Brep mesher, against shapes whose true area and volume are known.
 *
 * Every Brep here is built by rhino3dm itself, so — exactly like a .3dm saved
 * without render meshes — none of its faces carries a mesh. The mesher's output
 * is then checked for what a renderer and a jeweller both need:
 *
 *  - watertight: after welding coincident vertices, every edge of a closed
 *    solid is shared by exactly two triangles (no cracks at seams or poles);
 *  - accurate: surface area and enclosed volume within a fraction of a percent
 *    of the analytic values;
 *  - consistently oriented: positive volume (outward winding), and vertex
 *    normals agreeing with the winding.
 *
 * Usage: npm run test:mesher
 */
import rhino3dm from "rhino3dm";
import { BREP_MESHER_SOURCE } from "../.tmp-jewelry/brepMesher.js";
import { EARCUT_SOURCE } from "../.tmp-jewelry/vendor/earcutSource.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

const rh = await rhino3dm();
const { createBrepMesher } = new Function(
  EARCUT_SOURCE + BREP_MESHER_SOURCE + "\nreturn { createBrepMesher: createBrepMesher };",
)();
const earcut = new Function(EARCUT_SOURCE + "\nreturn earcut;")();
const mesher = createBrepMesher(rh, earcut);

/** Meshes every face and merges the result into one welded triangle soup. */
function meshAll(brep) {
  const faces = brep.faces();
  const ids = [];
  for (let i = 0; i < faces.count; i++) {
    check(!faces.get(i).getMesh(rh.MeshType.Any), `face ${i} starts with no render mesh`);
    ids.push(i);
  }
  const t0 = performance.now();
  const parts = mesher.meshBrepFaces(brep, ids);
  const ms = performance.now() - t0;
  const failed = parts.filter((p) => !p).length;

  const pos = [];
  const nrm = [];
  const idx = [];
  for (const p of parts) {
    if (!p) continue;
    const base = pos.length / 3;
    pos.push(...p.position);
    nrm.push(...p.normal);
    for (const i of p.index) idx.push(i + base);
  }
  return { pos, nrm, idx, failed, ms, faces: faces.count };
}

/** Area, signed volume, open-edge count after welding, and normal agreement. */
function measure({ pos, nrm, idx }) {
  const weld = new Map();
  const id = new Int32Array(pos.length / 3);
  for (let v = 0; v < id.length; v++) {
    const key = `${Math.round(pos[v * 3] * 1e6)},${Math.round(pos[v * 3 + 1] * 1e6)},${Math.round(pos[v * 3 + 2] * 1e6)}`;
    if (!weld.has(key)) weld.set(key, weld.size);
    id[v] = weld.get(key);
  }
  let area = 0;
  let volume = 0;
  let agree = 0;
  let disagree = 0;
  let bad = 0;
  const edges = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const A = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]];
    const B = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]];
    const C = [pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]];
    if ([...A, ...B, ...C].some((x) => !Number.isFinite(x))) bad++;
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    area += Math.hypot(...n) / 2;
    volume +=
      (A[0] * (B[1] * C[2] - B[2] * C[1]) -
        A[1] * (B[0] * C[2] - B[2] * C[0]) +
        A[2] * (B[0] * C[1] - B[1] * C[0])) /
      6;
    for (const v of [a, b, c]) {
      const d = n[0] * nrm[v * 3] + n[1] * nrm[v * 3 + 1] + n[2] * nrm[v * 3 + 2];
      if (Math.hypot(...n) < 1e-12) continue;
      if (d >= 0) agree++;
      else disagree++;
    }
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const i = id[p];
      const j = id[q];
      if (i === j) continue;
      const k = i < j ? `${i}_${j}` : `${j}_${i}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of edges.values()) if (n !== 2) open++;
  return { area, volume, open, agree, disagree, bad, tris: idx.length / 3 };
}

function solid(name, brep, trueArea, trueVolume, tolPct = 0.5) {
  console.log(`\n=== ${name} ===`);
  const m = meshAll(brep);
  const r = measure(m);
  check(
    m.failed === 0,
    "every face meshed",
    `${m.faces - m.failed}/${m.faces} in ${m.ms.toFixed(0)} ms, ${r.tris} triangles`,
  );
  check(r.bad === 0, "no NaN or infinite vertices");
  check(
    r.open === 0,
    "watertight — every welded edge shared by exactly two triangles",
    `${r.open} open edges`,
  );
  const aErr = (Math.abs(r.area - trueArea) / trueArea) * 100;
  check(
    aErr < tolPct,
    `surface area within ${tolPct}%`,
    `${r.area.toFixed(3)} vs ${trueArea.toFixed(3)} (${aErr.toFixed(3)}%)`,
  );
  const vErr = (Math.abs(r.volume - trueVolume) / trueVolume) * 100;
  check(r.volume > 0, "wound outward (positive volume)", r.volume.toFixed(3));
  check(
    vErr < tolPct,
    `volume within ${tolPct}%`,
    `${r.volume.toFixed(3)} vs ${trueVolume.toFixed(3)} (${vErr.toFixed(3)}%)`,
  );
  const share = r.agree / (r.agree + r.disagree);
  check(share > 0.99, "vertex normals agree with the winding", `${(share * 100).toFixed(2)}%`);
}

const PI = Math.PI;

solid(
  "sphere r=5 (one face, a seam and two poles)",
  rh.Brep.createFromSphere(new rh.Sphere([0, 0, 0], 5)),
  4 * PI * 25,
  (4 / 3) * PI * 125,
);

solid(
  "capped cylinder r=3 h=10 (seam + two trimmed planar caps)",
  rh.Brep.createFromCylinder(new rh.Cylinder(new rh.Circle(3), 10), true, true),
  2 * PI * 3 * 10 + 2 * PI * 9,
  PI * 9 * 10,
);

{
  const bb = new rh.BoundingBox([-1, -2, -3], [4, 5, 6]);
  solid("box 5x7x9 (six planar faces)", rh.Brep.createFromBoundingBox(bb), 2 * (35 + 45 + 63), 315);
}

{
  // Tiny, like a melee stone: tolerances must scale with the part.
  solid(
    "melee-sized sphere r=0.5 mm",
    rh.Brep.createFromSphere(new rh.Sphere([10, 0, 0], 0.5)),
    4 * PI * 0.25,
    (4 / 3) * PI * 0.125,
  );
}

{
  // An Extrusion object saved without a mesh reaches the mesher through toBrep.
  const circle = rh.NurbsCurve.createFromCircle(new rh.Circle(2));
  const ext = rh.Extrusion.create(circle, 4, true);
  check(!!ext, "rhino3dm built the extrusion");
  if (ext)
    solid(
      "capped extrusion r=2 h=4, via toBrep",
      ext.toBrep(true),
      2 * PI * 2 * 4 + 2 * PI * 4,
      PI * 4 * 4,
    );
}

{
  // Closed in BOTH directions: two seams that meet, no poles. A ring's shank
  // is this shape.
  const profile = new rh.Circle(1.5);
  profile.plane = { origin: [8, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1], zAxis: [0, -1, 0] };
  const rev = rh.RevSurface.create(
    rh.NurbsCurve.createFromCircle(profile),
    new rh.Line([0, 0, 0], [0, 0, 1]),
    0,
    2 * PI,
  );
  solid(
    "torus R=8 r=1.5 (seams in u and v)",
    rh.Brep.createFromRevSurface(rev, false, false),
    4 * PI * PI * 8 * 1.5,
    2 * PI * PI * 8 * 1.5 * 1.5,
  );
}

{
  // Faces WITH HOLES: each cap is a trimmed plane with an outer loop and an
  // inner one — the shape of a stone seat cut through metal.
  const tube = rh.Extrusion.create(rh.NurbsCurve.createFromCircle(new rh.Circle(3)), 5, true);
  // Inner profiles are in the PROFILE plane's coordinates, whose origin is the
  // outer curve's start (3,0,0) with x along world Y — so (0,3) is the axis.
  const hole = new rh.Circle(1.5);
  hole.center = [0, 3, 0];
  tube.addInnerProfile(rh.NurbsCurve.createFromCircle(hole));
  const brep = tube.toBrep(true);
  const holed = [...Array(brep.faces().count).keys()].filter(
    (f) => brep.faces().get(f).loops.count === 2,
  );
  check(holed.length === 2, "both caps carry a hole loop", `${holed.length} faces with two loops`);
  solid(
    "tube r=3 / 1.5 h=5 (annular caps with holes)",
    brep,
    2 * PI * 3 * 5 + 2 * PI * 1.5 * 5 + 2 * (PI * 9 - PI * 2.25),
    PI * (9 - 2.25) * 5,
  );
}

console.log("\n=== normals at a pole point out of the stone ===");
{
  // rhino3dm's normalAt returns (0,0,-1) at a sphere's NORTH pole. Used raw,
  // that is an inside-out dark spot at the table of every round stone.
  const r = 1.5;
  const p = mesher.meshBrepFaces(rh.Brep.createFromSphere(new rh.Sphere([0, 0, 0], r)), [0])[0];
  let inward = 0;
  let worst = 1;
  let poleChecked = 0;
  for (let v = 0; v < p.position.length / 3; v++) {
    const x = p.position[v * 3],
      y = p.position[v * 3 + 1],
      z = p.position[v * 3 + 2];
    const d = (x * p.normal[v * 3] + y * p.normal[v * 3 + 1] + z * p.normal[v * 3 + 2]) / r;
    if (d < 0) inward++;
    if (d < worst) worst = d;
    if (Math.abs(Math.abs(z) - r) < 1e-9) poleChecked++;
  }
  check(poleChecked >= 2, "both poles are vertices of the mesh", `${poleChecked}`);
  check(inward === 0, "no vertex normal points into the sphere", `${inward} inward`);
  check(
    worst > 0.99,
    "every normal within ~8 degrees of the true radial direction",
    `worst cos ${worst.toFixed(4)}`,
  );
}

console.log("\n=== a face that cannot be meshed is reported, not thrown ===");
{
  const brep = rh.Brep.createFromSphere(new rh.Sphere([0, 0, 0], 1));
  const out = mesher.meshBrepFaces(brep, [0, 99]);
  check(
    out.length === 2 && !!out[0] && out[1] === null,
    "bad face index comes back as null in its slot",
  );
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);
