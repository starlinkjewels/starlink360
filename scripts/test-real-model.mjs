/**
 * The shipped model, through the real selection pipeline.
 *
 * test-pipeline.mjs proves the mechanism on geometry it builds itself, and it
 * passes while the app misbehaves — because the bug was never in the mechanism,
 * it was in what the actual file looks like. LP043.glb is Draco-compressed, so
 * the geometry the viewer welds is not the geometry the CAD exported: Draco
 * snaps every vertex onto a quantisation grid on the way in.
 *
 * So this decodes the real file the same way the browser does and asks the only
 * question that matters: click any stone, does that stone and only that stone
 * change colour?
 *
 * The spatial check is the important one. Connectivity says nothing about where
 * a solid IS — if the weld fuses parts of two neighbouring stones, the split
 * still reports a clean count, and the only visible symptom is colour landing
 * half on the stone you clicked and half on its neighbour. A solid that spans
 * two stones is far wider than a solid that is one stone, so measure it.
 *
 * Usage: node scripts/test-real-model.mjs [path.glb]
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as THREE from "three";
import { MeshBVH, SAH } from "three-mesh-bvh";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import { facetGeometry, gemFresnel, gemTint } from "../.tmp-suite/components/jewelry/materials.js";
import {
  ensureSolids,
  parseId,
  solidAt,
  solidId,
  splitSolids,
} from "../.tmp-suite/components/jewelry/selection.js";
import {
  assignmentsFor,
  drawableCount,
  planRuns,
  runMaterials,
  runSlots,
} from "../.tmp-suite/components/jewelry/plan.js";

const FILE = process.argv[2] ?? "public/LP043.glb";

let fail = 0;
function check(ok, label, detail) {
  if (!ok) fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

/* ---------------------------------------------------------------- decoding */

function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.toString("utf8", 0, 4) !== "glTF") throw new Error(`${path} is not a GLB`);
  let off = 12;
  let json = null;
  let bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    if (type === 0x4e4f534a)
      json = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString("utf8"));
    if (type === 0x004e4942) bin = buf.subarray(off + 8, off + 8 + len);
    off += 8 + len + ((4 - ((off + 8 + len) % 4)) % 4);
  }
  return { json, bin };
}

/*
 * three ships the Draco decoder but does not publish it through its exports
 * map, and its package is "type": "module" — so requiring the file yields an
 * empty namespace rather than the emscripten factory. Evaluate it as CommonJS,
 * which is what its own footer is written for, and hand it the two globals it
 * reaches for when it detects Node.
 */
function loadDraco() {
  const dir = `${process.cwd()}/node_modules/three/examples/jsm/libs/draco`;
  const shim = { exports: {} };
  new Function(
    "module",
    "exports",
    "require",
    "__dirname",
    readFileSync(`${dir}/draco_decoder.js`, "utf8"),
  )(shim, shim.exports, createRequire(import.meta.url), dir);
  return new Promise((res) => shim.exports({ onModuleLoaded: res }));
}

function decodePrimitive(draco, json, bin, prim) {
  const ext = prim.extensions?.KHR_draco_mesh_compression;
  if (!ext) return null;
  const view = json.bufferViews[ext.bufferView];
  const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);

  const decoder = new draco.Decoder();
  const dbuf = new draco.DecoderBuffer();
  dbuf.Init(new Int8Array(bytes), bytes.length);
  const mesh = new draco.Mesh();
  decoder.DecodeBufferToMesh(dbuf, mesh);

  const att = decoder.GetAttributeByUniqueId(mesh, ext.attributes.POSITION);
  const points = mesh.num_points();
  const values = new draco.DracoFloat32Array();
  decoder.GetAttributeFloatForAllPoints(mesh, att, values);
  const position = new Float32Array(points * 3);
  for (let i = 0; i < points * 3; i++) position[i] = values.GetValue(i);

  const faces = mesh.num_faces();
  const index = new Uint32Array(faces * 3);
  const face = new draco.DracoInt32Array();
  for (let f = 0; f < faces; f++) {
    decoder.GetFaceFromMesh(mesh, f, face);
    index[f * 3] = face.GetValue(0);
    index[f * 3 + 1] = face.GetValue(1);
    index[f * 3 + 2] = face.GetValue(2);
  }

  draco.destroy(face);
  draco.destroy(values);
  draco.destroy(mesh);
  draco.destroy(dbuf);
  draco.destroy(decoder);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

/* ------------------------------------------------------------------- suite */

const { json, bin } = readGlb(FILE);
const draco = await loadDraco();

// Names live on the nodes, not the meshes — which is also how the viewer
// classifies stone from metal.
const named = new Map();
for (const node of json.nodes) {
  if (node.mesh !== undefined && node.name) named.set(node.name, node.mesh);
}
console.log(`${FILE}: ${[...named.keys()].join(", ")}`);

const stoneName = [...named.keys()].find((n) => /gem|stone|diamond/i.test(n));
check(!!stoneName, "the file has a stone group", stoneName);
if (!stoneName) process.exit(1);

console.log();
console.log("=== splitting the real pave ===");

const geometry = decodePrimitive(draco, json, bin, json.meshes[named.get(stoneName)].primitives[0]);
const triCount = geometry.getIndex().count / 3;
console.log(`  ${geometry.getAttribute("position").count} verts, ${triCount} triangles`);

const solids = splitSolids(geometry);
check(!!solids, "the pave splits into individual stones");
if (!solids) process.exit(1);

const count = solids.length - 1;
const sizes = [];
for (let i = 0; i < count; i++) sizes.push((solids[i + 1] - solids[i]) / 3);
const uniform = sizes.every((s) => s === sizes[0]);
console.log(
  `  ${count} solids, ${uniform ? `all ${sizes[0]} triangles` : `${Math.min(...sizes)}-${Math.max(...sizes)} triangles`}`,
);
check(count > 50, "the stones are found individually, not as one lump", `${count} solids`);

/*
 * Where each solid sits, and how big it is. One brilliant is a compact blob; a
 * solid welded across two neighbours is roughly twice as wide in one axis. The
 * median is the honest yardstick here because it IS a pave — the stones are
 * near-identical by construction, so any real outlier is a fault.
 */
const position = geometry.getAttribute("position");
const index = geometry.getIndex();
const diagonals = [];
for (let s = 0; s < count; s++) {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = solids[s]; i < solids[s + 1]; i++) {
    const v = index.getX(i);
    const x = position.getX(v),
      y = position.getY(v),
      z = position.getZ(v);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  diagonals.push(Math.hypot(maxX - minX, maxY - minY, maxZ - minZ));
}
/*
 * Do the solids come in coincident pairs?
 *
 * Connectivity finds SHELLS, not stones. A brilliant is very often modelled as
 * two closed shells — the crown above the girdle and the pavilion below — that
 * interpenetrate rather than share vertices, and no weld tolerance will ever
 * join those: there is no shared vertex to weld. The split then reports a clean
 * count of uniform, compact solids and every check above passes, while each
 * "solid" is half a stone. Clicking one paints half the stone you clicked, and
 * its other half stays white — which is the reported symptom exactly.
 *
 * Two halves of one stone sit on the same centre. Two neighbouring stones do
 * not. So measure how far each solid's centre is from its nearest neighbour,
 * against how big a solid is.
 */
const centres = [];
for (let s = 0; s < count; s++) {
  let cx = 0,
    cy = 0,
    cz = 0,
    n = 0;
  for (let i = solids[s]; i < solids[s + 1]; i++) {
    const v = index.getX(i);
    cx += position.getX(v);
    cy += position.getY(v);
    cz += position.getZ(v);
    n++;
  }
  centres.push([cx / n, cy / n, cz / n]);
}
let coincident = 0;
const nearest = [];
for (let a = 0; a < count; a++) {
  let best = Infinity;
  for (let b = 0; b < count; b++) {
    if (a === b) continue;
    const d = Math.hypot(
      centres[a][0] - centres[b][0],
      centres[a][1] - centres[b][1],
      centres[a][2] - centres[b][2],
    );
    if (d < best) best = d;
  }
  nearest.push(best);
  if (best < diagonals[a] * 0.25) coincident++;
}
const medianGap = [...nearest].sort((a, b) => a - b)[count >> 1];

/*
 * Is each solid ONE stone, or several fused together?
 *
 * The oversized check above compares each solid against the median, which is
 * blind to the case that matters: if the weld fuses stones systematically then
 * every solid is a pair, the median is a pair too, and nothing stands out. That
 * would paint the stone under the cursor AND its neighbour on one click, which
 * is what "a different diamond also changes colour" describes.
 *
 * Absolute scale settles it, where shape does not.
 *
 * Two ways to look for fusion were tried and both are dead ends on real jewellery
 * geometry. A gap along the longest axis fires on EVERY stone, because a
 * pavilion is a cone whose facets run from girdle straight to culet with no
 * vertices in between. Counting culets fires on the 30 stones here that are not
 * round brilliants — a cut with a keel has a ridge at the bottom, not a point.
 * And relative size cannot see systematic fusion at all: if every solid were a
 * pair, the median would be a pair too and nothing would look out of place.
 *
 * Millimetres do see it. The chain measures 182.5 across and the pendant face
 * 31.8, so this file is in millimetres like every Rhino jewellery file. A
 * bead-set pave stone is 1 to 2mm. If each solid were two stones fused, each
 * stone would be well under a millimetre and there would be 280 of them across
 * a 32mm face, which is not a piece anyone could set.
 */
const widths = [];
for (let s = 0; s < count; s++) {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = solids[s]; i < solids[s + 1]; i++) {
    const v = index.getX(i);
    const p = [position.getX(v), position.getY(v), position.getZ(v)];
    for (let c = 0; c < 3; c++) {
      if (p[c] < mn[c]) mn[c] = p[c];
      if (p[c] > mx[c]) mx[c] = p[c];
    }
  }
  // The girdle: a stone is always wider than it is deep, so the two larger
  // extents are across it and the smallest is table to culet.
  const extents = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]].sort((a, b) => b - a);
  widths.push(extents[0]);
}
const medianWidth = [...widths].sort((a, b) => a - b)[count >> 1];
console.log(`  each stone measures ${medianWidth.toFixed(2)}mm across the girdle`);
check(
  medianWidth > 0.9 && medianWidth < 2.5,
  "each solid measures like a single pave stone, so it is one stone",
  `${medianWidth.toFixed(2)}mm`,
);
check(
  Math.max(...widths) < medianWidth * 1.6,
  "and none is wide enough to be two of them",
  `widest ${Math.max(...widths).toFixed(2)}mm`,
);

const median = [...diagonals].sort((a, b) => a - b)[count >> 1];
console.log(
  `  nearest neighbouring centre: median ${medianGap.toPrecision(4)}, closest ${Math.min(...nearest).toPrecision(4)}`,
);
check(
  coincident === 0,
  "each solid is a whole stone, not one shell of one",
  coincident
    ? `${coincident} solids share a centre with another — these are half-stones`
    : "no pairs",
);

const oversized = diagonals.filter((d) => d > median * 1.8).length;
console.log(
  `  median stone ${median.toPrecision(4)} across, largest ${Math.max(...diagonals).toPrecision(4)}`,
);
check(oversized === 0, "no solid spans more than one stone", `${oversized} oversized`);

console.log();
console.log("=== faceting, then picking ===");

const mesh = new THREE.Mesh(facetGeometry(geometry));
mesh.userData.solids = solids;
check(
  drawableCount(mesh.geometry) === solids[count],
  "the offsets still describe the geometry after faceting",
  `${drawableCount(mesh.geometry)} vs ${solids[count]}`,
);

/*
 * Every triangle, not a sample. A raycast can only reach the stones facing the
 * camera, and an off-by-one in the binary search hides at exactly the boundary
 * a sample is least likely to land on.
 */
let misplaced = 0;
for (let s = 0; s < count; s++) {
  for (let t = solids[s] / 3; t < solids[s + 1] / 3; t++) {
    if (solidAt(mesh.userData.solids, t) !== s) misplaced++;
  }
}
check(
  misplaced === 0,
  "every triangle resolves to the stone it belongs to",
  `${misplaced} of ${triCount} misplaced`,
);

console.log();
console.log("=== painting one stone ===");

/*
 * The middle stone rather than the first: run planning special-cases neither,
 * but an offset error at the head of the buffer is invisible when the painted
 * run starts at zero.
 */
const target = count >> 1;
const base = { color: "#ffffff" };
const runs = planRuns(
  mesh.userData.solids,
  drawableCount(mesh.geometry),
  base,
  new Map([[target, { color: "#ff0000" }]]),
);
const specs = runMaterials(runs);
const slots = runSlots(runs, specs);

check(specs.length === 2, "two materials: the pave and the painted stone", `${specs.length}`);

const painted = runs.filter((r, i) => specs[slots[i]].color === "#ff0000");
check(painted.length === 1, "exactly one painted run", `${painted.length}`);

if (painted.length === 1) {
  const run = painted[0];
  check(
    run.start === solids[target],
    "the painted run starts at the clicked stone",
    `${run.start} vs ${solids[target]}`,
  );
  check(
    run.count === solids[target + 1] - solids[target],
    "the painted run is exactly one stone long",
    `${run.count / 3} triangles vs ${sizes[target]}`,
  );

  // The whole point, stated as the user would: no part of any other stone.
  let bled = 0;
  for (let s = 0; s < count; s++) {
    if (s === target) continue;
    for (let i = solids[s]; i < solids[s + 1]; i++) {
      if (i >= run.start && i < run.start + run.count) bled++;
    }
  }
  check(bled === 0, "no other stone is touched", `${bled} stray vertices`);
}

console.log();
console.log("=== painting several stones ===");

/*
 * Nobody paints one stone. They paint a handful, and usually several the same
 * colour — which is the case the single-stone check above cannot reach, because
 * runs are merged by VALUE. Two stones painted the same pink share a material
 * slot, and if the slot mapping is off by one the colour lands on the runs
 * BETWEEN them: the untouched pave either side. That reads exactly like colour
 * appearing on stones nobody clicked.
 */
{
  const pink = { color: "#ff4fa3" };
  const blue = { color: "#4f7bff" };
  const wanted = new Map([
    [3, pink],
    [4, pink], // adjacent and identical: the merge case
    [40, pink], // same colour, far away: the dedupe case
    [41, blue], // adjacent, different colour: the boundary case
    [count - 1, pink], // the very last stone: the tail case
  ]);

  const runs = planRuns(mesh.userData.solids, drawableCount(mesh.geometry), base, wanted);
  const specs = runMaterials(runs);
  const slots = runSlots(runs, specs);

  check(specs.length === 3, "three materials: pave, pink and blue", `${specs.length}`);

  // What colour every triangle in the buffer actually ends up drawn with.
  const drawn = new Array(triCount).fill(null);
  runs.forEach((run, i) => {
    const spec = specs[slots[i]];
    for (let t = run.start / 3; t < (run.start + run.count) / 3; t++)
      drawn[t] = spec?.color ?? null;
  });

  check(
    drawn.every((c) => c !== null),
    "every triangle is drawn by some run",
    `${drawn.filter((c) => c === null).length} undrawn`,
  );

  let wrong = 0;
  const wrongStones = [];
  for (let s = 0; s < count; s++) {
    const expected = (wanted.get(s) ?? base).color;
    for (let t = solids[s] / 3; t < solids[s + 1] / 3; t++) {
      if (drawn[t] !== expected) {
        wrong++;
        if (!wrongStones.includes(s)) wrongStones.push(s);
      }
    }
  }
  check(
    wrong === 0,
    "every stone is the colour it was assigned, and no other stone moved",
    wrong
      ? `${wrong} triangles across stones ${wrongStones.slice(0, 8).join(", ")}`
      : `all ${count} stones`,
  );

  // Half a stone in one colour and half in another is the reported symptom, so
  // name it directly rather than inferring it from a triangle count.
  const halves = [];
  for (let s = 0; s < count; s++) {
    const first = drawn[solids[s] / 3];
    for (let t = solids[s] / 3; t < solids[s + 1] / 3; t++) {
      if (drawn[t] !== first) {
        halves.push(s);
        break;
      }
    }
  }
  check(
    halves.length === 0,
    "no stone is drawn in two colours at once",
    `${halves.length} split stones`,
  );
}

console.log();
console.log("=== the colour actually reaching the screen ===");

/*
 * The refraction shader ends on mix(color, vec3(1.0), fresnel). At fresnel 1 a
 * painted stone renders white everywhere the camera is not square-on to a
 * facet, which on a small pave stone is most of it — colour on the middle,
 * white around it, indistinguishable from the paint landing on half a stone.
 */
check(
  gemFresnel("#ffffff") === 1,
  "a colourless diamond keeps the full sparkle",
  `${gemFresnel("#ffffff")}`,
);
const pinkF = gemFresnel("#ff4fa3");
check(pinkF < 0.5, "a saturated stone keeps its colour to the rim", `fresnel ${pinkF.toFixed(2)}`);
check(
  pinkF > 0,
  "but never loses all of its white, which would read as plastic",
  `${pinkF.toFixed(2)}`,
);
check(
  gemFresnel("#f7f2ea") > 0.9,
  "a faint champagne tint still sparkles like a diamond",
  `${gemFresnel("#f7f2ea").toFixed(2)}`,
);
check(
  gemFresnel("#8b1a1a") < gemFresnel("#d4a5a5"),
  "a deep ruby holds more colour than a dusty rose",
  `${gemFresnel("#8b1a1a").toFixed(2)} vs ${gemFresnel("#d4a5a5").toFixed(2)}`,
);

/*
 * And the tint that reaches the shader. It multiplies an HDR environment, so a
 * dark swatch used raw attenuates every channel, the bright facets clip to
 * white after tone mapping, and the stone shows colour only in patches.
 */
const sapphire = gemTint("#1e3f8f");
check(
  gemTint("#ffffff") === "#ffffff",
  "a colourless diamond is handed through untouched",
  gemTint("#ffffff"),
);
{
  const before = new THREE.Color("#1e3f8f").getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const after = new THREE.Color(sapphire).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const peak = Math.max(after.r, after.g, after.b);
  check(
    peak > 0.99,
    "a sapphire passes its strongest channel at full strength",
    `${sapphire} peak ${peak.toFixed(3)}`,
  );
  // Hue is the whole point: a brighter stone, not a different one.
  const ratioBefore = before.r / before.b;
  const ratioAfter = after.r / after.b;
  check(
    Math.abs(ratioBefore - ratioAfter) < 0.02,
    "and keeps its hue exactly",
    `r:b ${ratioBefore.toFixed(3)} -> ${ratioAfter.toFixed(3)}`,
  );
}
check(gemTint("#000000") === "#000000", "black is left alone rather than divided by zero");

console.log();
console.log("=== building the gem BVH must not disturb the geometry ===");

/*
 * The bug that produced every screenshot in this saga.
 *
 * MeshBVH REORDERS the index buffer as it builds — that is how it groups
 * triangles into spatially coherent nodes. Handed an indexed geometry,
 * `toNonIndexed()` gives it a fresh copy and the original is safe. Handed a
 * NON-indexed one, it creates an index on that very geometry and reorders it.
 *
 * Stones are non-indexed, because faceting de-indexes them for flat shading. So
 * the render geometry was being reordered underneath the solid offsets. The
 * element count never changes, so every count-based check still passes; what
 * changes is which triangles a draw run points at, and after a spatial sort
 * those are a cluster spanning the clicked stone and its neighbour.
 *
 * None of the checks above catch it because none of them build a BVH. This one
 * does exactly what GemRefraction does, to the real pave.
 */
{
  const faceted = new THREE.Mesh(
    facetGeometry(
      decodePrimitive(draco, json, bin, json.meshes[named.get(stoneName)].primitives[0]),
    ),
  );
  const own = splitSolids(faceted.geometry) ?? mesh.userData.solids;
  faceted.userData.solids = own;

  const geo = faceted.geometry;
  check(geo.index === null, "the faceted stone geometry starts non-indexed", `${geo.index}`);

  // A fingerprint of the triangle order, before anything touches it.
  const pos = geo.getAttribute("position");
  const fingerprint = (g) => {
    const p = g.getAttribute("position");
    let h = 0;
    for (let i = 0; i < Math.min(p.count, 3000); i++) {
      h = (Math.imul(h, 31) + Math.round(p.getX(i) * 1000)) | 0;
    }
    return h;
  };
  const before = fingerprint(geo);
  const beforeFirst = [pos.getX(0), pos.getY(0), pos.getZ(0)];

  // Exactly what GemRefraction does.
  new MeshBVH(bvhSource(geo), { strategy: SAH });

  check(geo.index === null, "and is still non-indexed after the BVH is built", `${geo.index}`);
  check(fingerprint(geo) === before, "the vertex order is untouched");
  check(
    pos.getX(0) === beforeFirst[0] &&
      pos.getY(0) === beforeFirst[1] &&
      pos.getZ(0) === beforeFirst[2],
    "and the first triangle is where it was",
  );

  // The whole point: picking still resolves to the stone it did before.
  let moved = 0;
  for (let s = 0; s < own.length - 1; s++) {
    for (let t = own[s] / 3; t < own[s + 1] / 3; t += 17) {
      if (solidAt(own, t) !== s) moved++;
    }
  }
  check(
    moved === 0,
    "every triangle still resolves to its own stone after the BVH",
    `${moved} moved`,
  );

  /*
   * And the old way, to show this was the fault rather than a precaution. The
   * previous code passed the render geometry straight in whenever it had no
   * index, which is always, for a stone.
   */
  const victim = new THREE.Mesh(
    facetGeometry(
      decodePrimitive(draco, json, bin, json.meshes[named.get(stoneName)].primitives[0]),
    ),
  );
  const victimSolids = splitSolids(victim.geometry) ?? own;
  new MeshBVH(victim.geometry, { strategy: SAH });

  check(
    victim.geometry.index !== null,
    "the old code gave MeshBVH the render geometry, which indexed it in place",
    `index is now ${victim.geometry.index ? `${victim.geometry.index.count} long` : "null"}`,
  );

  /*
   * How far the reorder threw the paint. Each triangle's centroid is compared
   * against the stone its offsets now claim it belongs to: if the BVH shuffled
   * the order, a run points at triangles scattered away from that stone.
   */
  const centreOf = (offsets, s, g) => {
    const p = g.getAttribute("position");
    const idx = g.index;
    let x = 0,
      y = 0,
      z = 0,
      n = 0;
    for (let i = offsets[s]; i < offsets[s + 1]; i++) {
      const v = idx ? idx.getX(i) : i;
      x += p.getX(v);
      y += p.getY(v);
      z += p.getZ(v);
      n++;
    }
    return [x / n, y / n, z / n];
  };
  let drifted = 0;
  for (let s = 0; s < victimSolids.length - 1; s++) {
    const good = centreOf(own, s, geo);
    const bad = centreOf(victimSolids, s, victim.geometry);
    if (Math.hypot(good[0] - bad[0], good[1] - bad[1], good[2] - bad[2]) > medianWidth * 0.5)
      drifted++;
  }
  console.log(
    `  ${drifted} of ${victimSolids.length - 1} draw runs land off their stone under the old code`,
  );
  check(
    drifted > 0,
    "which moved the draw runs off the stones they describe — the reported bug",
    `${drifted} runs displaced by more than half a stone`,
  );
}

/** Mirrors the helper in GemRefraction. */
function bvhSource(geo) {
  if (geo.index) return geo.toNonIndexed();
  const shared = new THREE.BufferGeometry();
  shared.setAttribute("position", geo.getAttribute("position"));
  return shared;
}

console.log();
console.log("=== the metal ===");

/*
 * The cap exists because this runs on the main thread and a GLB's metal group
 * is large. But a cap that silently declines is indistinguishable from a broken
 * feature: every prong and the shank are separate solids, and if the split is
 * skipped, clicking one prong repaints the entire piece. So measure what the
 * real file actually costs rather than guessing at a limit.
 */
const metalGeo = decodePrimitive(draco, json, bin, json.meshes[named.get("metal")].primitives[0]);
const metalVerts = metalGeo.getAttribute("position").count;
console.log(`  ${metalVerts} verts, ${metalGeo.getIndex().count / 3} triangles`);

const started = process.hrtime.bigint();
const metalSolids = ensureSolids(metalGeo);
const ms = Number(process.hrtime.bigint() - started) / 1e6;

if (!metalSolids) {
  check(
    false,
    "the metal splits into its prongs and shank",
    `declined — ${metalVerts} verts is over the cap`,
  );
} else {
  console.log(`  ${metalSolids.length - 1} solids in ${ms.toFixed(0)}ms`);
  check(
    metalSolids.length - 1 > 1,
    "the metal splits into its prongs and shank",
    `${metalSolids.length - 1} solids`,
  );
  /*
   * A ceiling loose enough to survive a loaded machine and tight enough to
   * catch the thing worth catching. Wall clock here swings between about 1.3s
   * and 4.2s run to run depending on what else is running, so a snug bound just
   * fails at random — and a test that cries wolf gets ignored, which is how a
   * real regression ships. What this guards against is the union-find going
   * quadratic, which on a million vertices would not be seconds.
   *
   * The cost that actually reaches a user is the cached one, checked below.
   */
  check(ms < 20000, "splitting the metal has not gone quadratic", `${ms.toFixed(0)}ms`);
}

console.log();
console.log("=== texturing one metal object ===");

/*
 * Give a single prong a hammered finish and check it reaches a draw run of its
 * own.
 *
 * This could not work at all until today: the metal mesh was over the split
 * cap, so it had no solids, `planRuns` collapsed to one full-length run, and a
 * finish assigned to one object landed on the whole piece or on nothing. The
 * panel had been writing the assignment correctly the whole time — there was
 * simply nowhere for it to land.
 *
 * Mirrors the real path: the panel keys textures by part id, the route folds
 * them into the per-part metal spec, and the renderer plans runs from that.
 */
{
  const GROUP = "metal|Metal 01";
  const TARGET = 5;
  const polished = { color: "#d4af37", roughness: 0.25, metalness: 1 };
  const hammered = {
    ...polished,
    texture: { finish: "hammered", enabled: true, scale: 8, strength: 1, channels: {} },
  };

  // Exactly what the route builds from `textures`.
  const overrides = { [solidId(GROUP, TARGET)]: hammered };
  const { base: mBase, perSolid: mPerSolid } = assignmentsFor(overrides, GROUP, parseId);

  check(mBase === null, "the rest of the piece keeps the global finish", `${mBase}`);
  check(mPerSolid.size === 1, "one object carries its own finish", `${mPerSolid.size}`);

  const total = metalSolids[metalSolids.length - 1];
  const metalRuns = planRuns(metalSolids, total, mBase, mPerSolid);
  const textured = metalRuns.filter((r) => r.assignment?.texture);

  check(textured.length === 1, "which becomes exactly one textured draw run", `${textured.length}`);
  if (textured.length === 1) {
    check(
      textured[0].start === metalSolids[TARGET] &&
        textured[0].count === metalSolids[TARGET + 1] - metalSolids[TARGET],
      "covering that object and nothing else",
      `${textured[0].start}..${textured[0].start + textured[0].count}`,
    );
  }

  /*
   * And the draw-call count tracks how many objects were customised, not how
   * many exist. 675 prongs at one call each would cost more than the feature is
   * worth.
   */
  check(metalRuns.length === 3, "at a cost of three draw calls, not 675", `${metalRuns.length}`);
}

/*
 * And only once. DressedScene re-clones the scene on every finish and lighting
 * change; if each clone re-split the metal, changing a swatch would freeze for
 * as long as the load did.
 */
const again = process.hrtime.bigint();
const second = ensureSolids(metalGeo);
const cachedMs = Number(process.hrtime.bigint() - again) / 1e6;
check(
  second === metalSolids,
  "the split is cached on the source geometry",
  `${cachedMs.toFixed(1)}ms on the second call`,
);

console.log();
console.log();
console.log("=== striking a hallmark into the real metal ===");

/*
 * The stamping projection, against the shipped model.
 *
 * This was written and shipped without ever being seen on a screen, on the
 * grounds that a decal needs eyes. Most of it does not: `DecalGeometry` is pure
 * geometry with no WebGL in it, so the parts that actually go wrong — an empty
 * projection, a mark floating off the surface, a size that ignores the model's
 * scale — are all arithmetic and all checkable here.
 *
 * What genuinely still needs eyes is how the punch READS: depth, softness,
 * whether it looks struck. Not this.
 */
{
  const target = new THREE.Mesh(metalGeo);
  target.updateWorldMatrix(true, false);

  /*
   * A real point on the real surface, taken from a triangle rather than by
   * raycasting. Firing at the bounding-box centre finds nothing on a necklace:
   * the middle of the chain loop is empty air.
   */
  const mp = metalGeo.getAttribute("position");
  const mi = metalGeo.getIndex();
  // Well into the mesh rather than the first triangle, which on a merged
  // export is as likely to be a clasp fixing as a face anyone would stamp.
  const tri = Math.floor(mi.count / 3 / 2) * 3;
  const a = new THREE.Vector3().fromBufferAttribute(mp, mi.getX(tri));
  const b = new THREE.Vector3().fromBufferAttribute(mp, mi.getX(tri + 1));
  const c = new THREE.Vector3().fromBufferAttribute(mp, mi.getX(tri + 2));
  const hit = a.distanceTo(b) > 1e-9 && a.distanceTo(c) > 1e-9;

  check(!!hit, "there is a real triangle on the metal to strike");
  if (hit) {
    const position = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
    const normal = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());

    const orient = new THREE.Object3D();
    orient.position.copy(position);
    orient.lookAt(position.clone().add(normal));
    orient.rotateZ(0);

    // 1.2mm, the default — the file is in millimetres and the mesh is unscaled
    // here, so a world scale of 1 makes the arithmetic directly checkable.
    const mm = 1.2;
    const extent = new THREE.Vector3(mm * 2.2, mm * 2.2, mm * 4);
    /*
     * Culled first, exactly as StampDecals does. DecalGeometry clips against
     * EVERY triangle of its target, and projecting a 1.2mm mark against 1.5
     * million of them measured 5.9 seconds — on the main thread, per stamp,
     * re-run whenever the panel changes. The projector cannot reach anything
     * outside its own extent, so the triangles dropped here were destined to be
     * clipped away regardless.
     */
    const struckAt = process.hrtime.bigint();
    const reach = extent.length();
    const near = [];
    const vtx = new THREE.Vector3();
    const lo = position.clone().subScalar(reach);
    const hi = position.clone().addScalar(reach);
    for (let t = 0; t < mi.count; t += 3) {
      for (let k = 0; k < 3; k++) {
        vtx.fromBufferAttribute(mp, mi.getX(t + k));
        if (
          vtx.x >= lo.x &&
          vtx.x <= hi.x &&
          vtx.y >= lo.y &&
          vtx.y <= hi.y &&
          vtx.z >= lo.z &&
          vtx.z <= hi.z
        ) {
          near.push(mi.getX(t), mi.getX(t + 1), mi.getX(t + 2));
          break;
        }
      }
    }
    const proxyGeo = new THREE.BufferGeometry();
    proxyGeo.setAttribute("position", mp);
    proxyGeo.setIndex(near);
    const proxy = new THREE.Mesh(proxyGeo);
    proxy.updateWorldMatrix(false, false);
    console.log(`  culled to ${near.length / 3} triangles of ${mi.count / 3}`);

    const decal = new DecalGeometry(proxy, position, orient.rotation, extent);
    const strikeMs = Number(process.hrtime.bigint() - struckAt) / 1e6;
    console.log(`  striking took ${strikeMs.toFixed(0)}ms against ${mi.count / 3} triangles`);
    /*
     * DecalGeometry clips against EVERY triangle of the target, and this metal
     * is 1.5 million of them. That cost is paid per stamp, on the main thread,
     * on a machine with no GPU — so it is the difference between a hallmark
     * appearing on click and the tab locking up for a few seconds.
     */
    check(strikeMs < 3000, "and is fast enough to feel like a click", `${strikeMs.toFixed(0)}ms`);

    const count = decal.getAttribute("position")?.count ?? 0;
    check(count > 0, "the projection produces geometry rather than nothing", `${count} verts`);

    if (count > 0) {
      /*
       * On the surface, not floating over it. Every vertex of a decal is
       * clipped out of the target's own triangles, so the furthest any of them
       * can sit from the strike point is the projector's own half-extent — a
       * mark that drifts further has been projected against the wrong space.
       */
      const p = decal.getAttribute("position");
      let furthest = 0;
      for (let i = 0; i < p.count; i++) {
        furthest = Math.max(
          furthest,
          new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).distanceTo(position),
        );
      }
      check(
        furthest <= extent.length(),
        "every vertex lies within the projector, so the mark is on the metal",
        `${furthest.toFixed(2)}mm from the strike point`,
      );

      /*
       * And it is the size that was asked for. A hallmark is specified in
       * millimetres, so a mark that comes out at the fit scale instead of at
       * 1.2mm is the bug worth catching — it would be invisible on one piece
       * and enormous on the next.
       */
      decal.computeBoundingBox();
      const size = decal.boundingBox.getSize(new THREE.Vector3());
      const widest = Math.max(size.x, size.y, size.z);
      check(
        widest > mm * 0.5 && widest <= extent.length(),
        "and measures like a 1.2mm mark, not like the model's own scale",
        `${widest.toFixed(2)}mm across`,
      );

      /*
       * The local-space round trip. Stamps are stored in the part's own space
       * so they survive recentring, the fit scale and the turntable; the decal
       * is built in world space and baked back. With an identity world matrix
       * the two must agree exactly, which is the cheapest possible guard on the
       * transform that would otherwise put every mark somewhere else.
       */
      const baked = decal.clone();
      baked.applyMatrix4(new THREE.Matrix4().copy(target.matrixWorld).invert());
      const q = baked.getAttribute("position");
      let drift = 0;
      for (let i = 0; i < Math.min(q.count, 200); i++) {
        drift = Math.max(drift, Math.abs(q.getX(i) - p.getX(i)));
      }
      check(drift < 1e-6, "the world-to-local bake is exact", `${drift.toExponential(1)}`);
    }
  }
}

console.log();
console.log(fail === 0 ? "  All checks passed" : `  ${fail} check(s) failed`);
process.exit(fail ? 1 : 0);
