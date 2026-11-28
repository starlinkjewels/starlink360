import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVH, MeshBVHUniformStruct, SAH } from "three-mesh-bvh";
import { bvhSource } from "@/components/jewelry/GemRefraction";
import { createMetalMaterial } from "@/components/jewelry/materials";
import { gemById, metalById, resolveGem } from "@/components/jewelry/library";
import { roundBrilliant, caratToDiameterMm } from "./brilliant";
import { createDiamondMaterial } from "@/components/jewelry/diamondMaterial";
import type { GemTune } from "@/components/jewelry/lighting";
import { STONE_ALPHA } from "./sparkle";
import type { Category } from "./catalog";

/*
 * Procedural fine jewellery for the try-on.
 *
 * Each builder returns a piece in its own MODEL UNITS, chosen so the tracker
 * can size it with a single number measured off the body:
 *
 *   ring       1 unit = ring inner radius        (~8.7 mm, US size 7)
 *   bracelet   1 unit = palm width               (~62 mm, index→pinky knuckle)
 *   bangle     1 unit = palm width
 *   earrings   1 unit = face width               (~140 mm, ear to ear)
 *   necklace   1 unit = shoulder width           (~360 mm)
 *
 * and in its own axes, which the matching anchor in anchors.ts provides:
 *
 *   ring / bracelet / bangle   +Y along the finger/hand, +Z out of the back of the hand
 *   earrings                   origin at the piercing, +Y up, +Z forward
 *   necklace                   origin mid-shoulder, +Y up, +Z out of the chest
 *
 * Stone sizes are real: a 1 ct round brilliant is 6.5 mm across, converted
 * into the piece's units. That is what keeps a solitaire looking like a
 * solitaire on the finger rather than a costume ring.
 *
 * Every piece carries a hidden OCCLUDER for the body part it wraps: depth only,
 * no colour. The back of a ring band then disappears behind the finger
 * exactly where it would in life, which more than anything else is what
 * separates a convincing try-on from a sticker floating over the video.
 */

export const UNIT_MM: Record<Category, number> = {
  ring: 8.7,
  bracelet: 62,
  bangle: 62,
  earrings: 140,
  necklace: 360,
};

const UP = new THREE.Vector3(0, 1, 0);

/* ----------------------------------------------------------- the stone */

interface SharedStone {
  geometry: THREE.BufferGeometry;
  bvh: MeshBVHUniformStruct;
  /** Heights of the cut, for setting design. Girdle radius is 1. */
  info: ReturnType<typeof roundBrilliant>;
}
let sharedStone: SharedStone | null = null;

/** The one brilliant every stone instances, with its BVH built once. */
export function brilliantAsset(): SharedStone {
  if (sharedStone) return sharedStone;
  const info = roundBrilliant();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(info.positions, 3));
  // Non-indexed, so this gives true flat facet normals.
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.shared = true;
  const bvh = new MeshBVHUniformStruct();
  bvh.updateFrom(new MeshBVH(bvhSource(geometry), { strategy: SAH }));
  sharedStone = { geometry, bvh, info };
  return sharedStone;
}

/**
 * Stone materials, on the shared diamond shader (jewelry/diamondMaterial.ts),
 * the same one the studio viewer uses.
 *
 * Owns every material it makes so they can be disposed together.
 */
export class StoneMaterials {
  private made: THREE.Material[] = [];
  /** Turns the light environment every stone sees; see twinkle(). */
  readonly envRotation = new THREE.Matrix3();
  private rot = new THREE.Matrix4();
  private euler = new THREE.Euler();

  constructor(
    private readonly env: THREE.Texture,
    /** The gem tuning of the room the stones look into (lighting.ts). */
    private readonly tune: GemTune = {},
  ) {}

  make(gemId: string): THREE.Material {
    return this.makeTraced(gemId, brilliantAsset().bvh);
  }

  /**
   * The same stone material, traced against any stone geometry rather than
   * the shared brilliant: a piece brought over from the studio carries its
   * own cut stones (studioFit.ts). `absorbRef` and `epsilon` are in that
   * geometry's object space; see DiamondOptions.
   */
  makeTraced(
    gemId: string,
    bvh: MeshBVHUniformStruct,
    scale?: { absorbRef: number; epsilon: number },
  ): THREE.Material {
    const gem = gemById(gemId) ?? gemById("diamond")!;
    const spec = resolveGem(gem);

    if (spec.transmission < 0.5) {
      const opaque = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(spec.color),
        metalness: 0,
        roughness: 0.06,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        envMapIntensity: 1.6,
        flatShading: true,
      });
      this.made.push(opaque);
      return opaque;
    }

    const material = createDiamondMaterial(bvh, this.env, spec, {
      ...scale,
      envRotation: this.envRotation,
      // Marks stone pixels for the glint pass (sparkle.ts).
      outputAlpha: STONE_ALPHA,
      envIntensity: this.tune.intensity,
      gamma: this.tune.gamma,
    });
    this.made.push(material);
    return material;
  }

  /**
   * Moves the lights a fraction of a degree, continuously.
   *
   * Two incommensurate sines per axis so the motion never visibly repeats.
   * Small on purpose: about ±9° of yaw and ±5° of pitch is enough for the
   * pinpoint lights to cross facet boundaries, which is all scintillation is.
   */
  twinkle(tSec: number): void {
    this.euler.set(
      0.06 * Math.sin(tSec * 1.3) + 0.03 * Math.sin(tSec * 3.1),
      0.12 * Math.sin(tSec * 0.6) + 0.04 * Math.sin(tSec * 2.3),
      0,
    );
    this.envRotation.setFromMatrix4(this.rot.makeRotationFromEuler(this.euler));
  }

  dispose(): void {
    for (const m of this.made) m.dispose();
    this.made = [];
  }
}

export interface Kit {
  metal: THREE.Material;
  /** The feature stone: centre stone, drop, pendant. */
  centre: THREE.Material;
  /** Melee: halo, pavé, eternity. Always colourless diamond unless the style says otherwise. */
  accent: THREE.Material;
}

export function metalMaterial(metalId: string): THREE.MeshPhysicalMaterial {
  const m = metalById(metalId) ?? metalById("gold-18k")!;
  const mat = createMetalMaterial({
    id: m.id,
    name: m.name,
    color: m.color,
    roughness: m.roughness,
  });
  // Lathe and tube normals are reliable, but a few merged parts face inward;
  // double-sided costs nothing on pieces this small and removes the risk.
  mat.side = THREE.DoubleSide;
  return mat;
}

/** Depth-only: hides what is behind the body part, draws nothing itself. */
export function occluderMaterial(debug = false): THREE.Material {
  if (debug) {
    return new THREE.MeshBasicMaterial({
      color: 0x33ccff,
      transparent: true,
      opacity: 0.25,
      depthWrite: true,
    });
  }
  return new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
}

/* ------------------------------------------------------------- helpers */

const tmpQ = new THREE.Quaternion();
const spinQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();

/** A stone (or setting) at `pos`, table facing `up`, girdle radius `r`. */
function placeUp(pos: THREE.Vector3, up: THREE.Vector3, r: number, spin = 0): THREE.Matrix4 {
  tmpQ.setFromUnitVectors(UP, up.clone().normalize());
  if (spin) tmpQ.multiply(spinQ.setFromAxisAngle(UP, spin));
  return new THREE.Matrix4().compose(pos, tmpQ, tmpS.setScalar(r));
}

/** Placement from an explicit frame: local x → `x`, local y → `y`. */
function placeBasis(
  pos: THREE.Vector3,
  x: THREE.Vector3,
  y: THREE.Vector3,
  r: number,
): THREE.Matrix4 {
  const X = x.clone().normalize();
  const Y = y
    .clone()
    .sub(X.clone().multiplyScalar(y.dot(X)))
    .normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y);
  return new THREE.Matrix4().makeBasis(X, Y, Z).scale(tmpS.setScalar(r)).setPosition(pos);
}

function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  matrices: THREE.Matrix4[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, matrices.length));
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = matrices.length;
  mesh.instanceMatrix.needsUpdate = true;
  // Instances are spread far beyond the base geometry's bounds.
  mesh.frustumCulled = false;
  return mesh;
}

function stones(material: THREE.Material, matrices: THREE.Matrix4[]): THREE.InstancedMesh {
  const mesh = instanced(brilliantAsset().geometry, material, matrices);
  mesh.userData.stones = true;
  return mesh;
}

function solid(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

/** A unit stone's girdle radius for `carat`, in the piece's units. */
function stoneRadius(carat: number, category: Category): number {
  return caratToDiameterMm(carat) / 2 / UNIT_MM[category];
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // mergeGeometries needs identical attribute sets on every part.
  const clean = parts.map((g) => {
    if (!g.getAttribute("uv")) {
      const count = g.getAttribute("position").count;
      g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    return g;
  });
  const merged = mergeGeometries(clean, false);
  clean.forEach((g) => g.dispose());
  return merged ?? new THREE.BufferGeometry();
}

/** A ring of small spheres, used for milgrain and beads. */
function beads(points: THREE.Vector3[], r: number): THREE.BufferGeometry[] {
  return points.map((p) => new THREE.SphereGeometry(r, 10, 8).translate(p.x, p.y, p.z));
}

/* ------------------------------------------------------------ settings */

/*
 * Settings are modelled in STONE units (girdle radius 1, table +Y, girdle
 * centre at the origin) and scaled with the stone, so one head fits any size.
 */

/** A claw head: `count` prongs from under the pavilion up over the crown. */
function prongHead(count: number, wire = 0.085): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < count; k++) {
    const a = ((k + 0.5) / count) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const path = [
      [0.3, -1.0],
      [0.74, -0.5],
      [1.02, -0.04],
      [1.0, 0.12],
      [0.88, 0.22],
    ].map(([r, y]) => new THREE.Vector3(r * c, y, r * s));
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path), 20, wire, 8, false));
    const tip = path[path.length - 1];
    parts.push(new THREE.SphereGeometry(wire * 1.25, 12, 10).translate(tip.x, tip.y, tip.z));
  }
  // Gallery rails tie the prongs together under the girdle.
  parts.push(
    new THREE.TorusGeometry(0.66, 0.05, 8, 40).rotateX(Math.PI / 2).translate(0, -0.42, 0),
  );
  parts.push(
    new THREE.TorusGeometry(0.36, 0.06, 8, 32).rotateX(Math.PI / 2).translate(0, -0.88, 0),
  );
  return merge(parts);
}

/** A square four-claw collet for line jewellery, with a hinge bar along X. */
function clawCollet(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(
    new THREE.CylinderGeometry(0.98, 0.5, 0.78, 4, 1, true)
      .rotateY(Math.PI / 4)
      .translate(0, -0.46, 0),
  );
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const x = Math.cos(a) * 0.9;
    const z = Math.sin(a) * 0.9;
    parts.push(new THREE.CylinderGeometry(0.11, 0.13, 0.62, 8).translate(x, -0.12, z));
    parts.push(new THREE.SphereGeometry(0.15, 10, 8).translate(x * 0.94, 0.2, z * 0.94));
  }
  parts.push(
    new THREE.CylinderGeometry(0.17, 0.17, 2.2, 8).rotateZ(Math.PI / 2).translate(0, -0.72, 0),
  );
  return merge(parts);
}

/** A rub-over bezel: a polished metal rim hugging the girdle. */
function bezelCollet(): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0.55, -0.85),
    new THREE.Vector2(1.06, -0.3),
    new THREE.Vector2(1.13, 0.05),
    new THREE.Vector2(1.1, 0.16),
    new THREE.Vector2(0.97, 0.12),
    new THREE.Vector2(0.95, -0.2),
    new THREE.Vector2(0.5, -0.7),
  ];
  const cup = new THREE.LatheGeometry(profile, 32);
  const bar = new THREE.CylinderGeometry(0.17, 0.17, 2.3, 8)
    .rotateZ(Math.PI / 2)
    .translate(0, -0.7, 0);
  return merge([cup, bar]);
}

/** A comfort-fit court band around the Y axis, seam on the palm side. */
function band(inner: number, thickness: number, width: number, grooves = 0): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI / 2 + (i / N) * Math.PI;
    let r = inner + 0.12 * thickness + 0.88 * thickness * Math.pow(Math.cos(a), 0.55);
    const y = (width / 2) * Math.sin(a);
    // Engraved lines for the classic kada: two narrow V grooves.
    if (grooves) {
      for (const gy of [-width * 0.22, width * 0.22]) {
        const d = Math.abs(y - gy) / (width * 0.05);
        if (d < 1) r -= thickness * 0.18 * (1 - d);
      }
    }
    pts.push(new THREE.Vector2(r, y));
  }
  for (let i = N; i >= 0; i--) {
    const a = -Math.PI / 2 + (i / N) * Math.PI;
    pts.push(
      new THREE.Vector2(inner + 0.12 * thickness * (1 - Math.cos(a)), (width / 2) * Math.sin(a)),
    );
  }
  return new THREE.LatheGeometry(pts, 180, Math.PI, Math.PI * 2);
}

/** Outer radius of `band` at its crest. */
const bandCrest = (inner: number, thickness: number) => inner + thickness;

/** An arc of torus in the XZ plane around Y, centred on +Z, `span` radians. */
function arcRail(radius: number, tube: number, span: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(radius, tube, 8, 120, span).rotateX(-Math.PI / 2);
  // After the tilt the arc starts at +X and runs toward -Z; centre it on +Z.
  const midU = span / 2;
  const mx = Math.cos(midU);
  const mz = -Math.sin(midU);
  g.rotateY(-Math.atan2(mx, mz));
  return g;
}

export function occluderCylinder(
  rx: number,
  rz: number,
  height: number,
  y: number,
  z = 0,
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, false);
  const mesh = new THREE.Mesh(geo);
  mesh.scale.set(rx, height, rz);
  mesh.position.set(0, y, z);
  mesh.userData.occluder = true;
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

/* --------------------------------------------------------------- rings */

function buildRing(style: string, kit: Kit, carat: number): THREE.Group {
  const root = new THREE.Group();
  const T = 0.17; // band thickness, inner radii (≈1.5 mm)
  let W = 0.24; // band width (≈2.1 mm)
  const crest = bandCrest(1, T);

  if (style === "eternity") {
    const r = stoneRadius(carat, "ring");
    W = Math.max(W, r * 2.7);
    root.add(solid(band(1, Math.max(T, r * 1.2), W), kit.metal));
    const outer = bandCrest(1, Math.max(T, r * 1.2));
    const n = Math.floor((Math.PI * 2 * outer) / (r * 2 * 1.12));
    const mats: THREE.Matrix4[] = [];
    const beadPts: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const nrm = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      mats.push(placeUp(nrm.clone().multiplyScalar(outer - r * 0.28), nrm, r));
      const ab = a + Math.PI / n;
      const nb = new THREE.Vector3(Math.sin(ab), 0, Math.cos(ab)).multiplyScalar(outer - r * 0.05);
      beadPts.push(nb.clone().setY(r * 0.82), nb.clone().setY(-r * 0.82));
    }
    root.add(stones(kit.centre, mats));
    root.add(solid(merge(beads(beadPts, r * 0.2)), kit.metal));
  } else {
    root.add(solid(band(1, T, W), kit.metal));
    const rc = stoneRadius(carat, "ring");
    const { info } = brilliantAsset();
    const lift = crest + -info.culetY * rc * 0.82; // culet just kisses the band
    const head = new THREE.Group();
    head.position.set(0, 0, lift);
    head.rotation.x = Math.PI / 2; // stone +Y → ring +Z (back of the hand)
    head.scale.setScalar(rc);
    head.add(stones(kit.centre, [new THREE.Matrix4()]));
    head.add(
      solid(prongHead(style === "halo" ? 4 : 6, style === "halo" ? 0.08 : 0.075), kit.metal),
    );

    if (style === "halo") {
      const rm = Math.max(0.062 / rc, 0.15); // ~1.1 mm halo melee, in centre-stone units
      const ringR = 1 + rm * 1.25;
      const n = Math.max(10, Math.round((Math.PI * 2 * ringR) / (rm * 2 * 1.1)));
      const mats: THREE.Matrix4[] = [];
      const beadPts: THREE.Vector3[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const p = new THREE.Vector3(Math.cos(a) * ringR, -0.12, Math.sin(a) * ringR);
        const tilt = new THREE.Vector3(Math.cos(a) * 0.25, 1, Math.sin(a) * 0.25);
        mats.push(placeUp(p, tilt, rm));
        const ab = a + Math.PI / n;
        beadPts.push(
          new THREE.Vector3(
            Math.cos(ab) * (ringR + rm * 0.85),
            -0.05,
            Math.sin(ab) * (ringR + rm * 0.85),
          ),
        );
      }
      head.add(stones(kit.accent, mats));
      const halo = merge([
        new THREE.TorusGeometry(ringR, rm * 0.95, 10, 64)
          .rotateX(Math.PI / 2)
          .translate(0, -0.12 - rm * 0.7, 0),
        new THREE.TorusGeometry(ringR + rm * 0.95, rm * 0.22, 6, 64)
          .rotateX(Math.PI / 2)
          .translate(0, -0.1, 0),
        ...beads(beadPts, rm * 0.24),
      ]);
      head.add(solid(halo, kit.metal));

      // Pavé down both shoulders.
      const rp = 0.058;
      const start = (rc * (ringR + rm)) / crest + rp / crest;
      const step = (rp * 2 * 1.1) / crest;
      const pave: THREE.Matrix4[] = [];
      const pb: THREE.Vector3[] = [];
      for (let a = start; a < 1.25; a += step) {
        for (const sgn of [1, -1]) {
          const nrm = new THREE.Vector3(Math.sin(a * sgn), 0, Math.cos(a * sgn));
          pave.push(placeUp(nrm.clone().multiplyScalar(crest - rp * 0.3), nrm, rp));
          pb.push(
            nrm
              .clone()
              .multiplyScalar(crest)
              .setY(rp * 1.02),
            nrm
              .clone()
              .multiplyScalar(crest)
              .setY(-rp * 1.02),
          );
        }
      }
      root.add(stones(kit.accent, pave));
      root.add(solid(merge(beads(pb, rp * 0.28)), kit.metal));
    }
    root.add(head);
  }

  // The finger, which hides the back of the band.
  root.add(occluderCylinder(0.985, 0.985, 4.2, 0.5));
  return root;
}

/* ------------------------------------------------------- wrist pieces */

/** Evenly spaced points by arc length around an ellipse in the XZ plane. */
function ellipseStations(a: number, b: number, spacing: number) {
  const dense = 720;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= dense; i++) {
    const t = (i / dense) * Math.PI * 2;
    // Starts on the palm side so any rounding gap lands where nobody looks.
    pts.push(new THREE.Vector3(a * Math.sin(t + Math.PI), 0, b * Math.cos(t + Math.PI)));
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = cum[cum.length - 1];
  const n = Math.max(8, Math.round(total / spacing));
  const out: { p: THREE.Vector3; normal: THREE.Vector3; tangent: THREE.Vector3 }[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (k / n) * total;
    while (cum[j + 1] < s) j++;
    const f = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    const p = pts[j].clone().lerp(pts[j + 1], f);
    const normal = new THREE.Vector3(p.x / (a * a), 0, p.z / (b * b)).normalize();
    const tangent = new THREE.Vector3(-normal.z, 0, normal.x);
    out.push({ p, normal, tangent });
  }
  return out;
}

function buildBracelet(style: string, kit: Kit, carat: number): THREE.Group {
  const root = new THREE.Group();
  const r = stoneRadius(carat, "bracelet");
  const A = 0.47;
  const B = 0.34;
  const stations = ellipseStations(A, B, r * 2 * 1.14);
  const stoneM: THREE.Matrix4[] = [];
  const linkM: THREE.Matrix4[] = [];
  for (const { p, normal, tangent } of stations) {
    const at = p.clone().add(normal.clone().multiplyScalar(r * 0.95));
    stoneM.push(placeBasis(at, tangent, normal, r));
    linkM.push(placeBasis(at, tangent, normal, r));
  }
  root.add(stones(kit.centre, stoneM));
  root.add(instanced(style === "bezel" ? bezelCollet() : clawCollet(), kit.metal, linkM));
  // Box clasp on the inside of the wrist.
  const clasp = new THREE.BoxGeometry(r * 3.2, r * 1.6, r * 1.1);
  const claspMesh = solid(clasp, kit.metal);
  claspMesh.position.set(0, 0, -B - r * 0.4);
  root.add(claspMesh);
  root.add(occluderCylinder(0.41, 0.29, 1.4, 0.1));
  return root;
}

function buildBangle(style: string, kit: Kit, carat: number): THREE.Group {
  const root = new THREE.Group();
  const inner = 0.5; // 62 mm inner diameter
  const classic = style === "classic";
  const T = classic ? 0.07 : 0.055;
  const W = classic ? 0.16 : 0.12;
  root.add(solid(band(inner, T, W, classic ? 2 : 0), kit.metal));
  const crest = bandCrest(inner, T);

  if (!classic) {
    const r = stoneRadius(carat, "bangle");
    const full = style === "eternity";
    const span = full ? Math.PI * 2 : (160 * Math.PI) / 180;
    const step = (r * 2 * 1.08) / crest;
    const n = Math.floor(span / step);
    const mats: THREE.Matrix4[] = [];
    for (let i = 0; i < n; i++) {
      const a = -span / 2 + (i + 0.5) * (span / n);
      const nrm = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      mats.push(placeUp(nrm.clone().multiplyScalar(crest - r * 0.25), nrm, r, Math.PI / 8));
    }
    root.add(stones(kit.centre, mats));
    // Channel walls either side of the row.
    const rails = merge([
      arcRail(crest - r * 0.05, r * 0.3, span).translate(0, r * 1.12, 0),
      arcRail(crest - r * 0.05, r * 0.3, span).translate(0, -r * 1.12, 0),
    ]);
    root.add(solid(rails, kit.metal));
  }
  root.add(occluderCylinder(0.41, 0.29, 1.4, 0.15));
  return root;
}

/* ------------------------------------------------------------ earrings */

export interface BuiltPiece {
  root: THREE.Group;
  /** Optional pendulum: hangs from its origin, children along local -Y. */
  swing?: THREE.Group;
  /** Swing length in model units, for the pendulum's natural frequency. */
  swingLength?: number;
}

function buildEarring(style: string, kit: Kit, carat: number): BuiltPiece {
  const root = new THREE.Group();
  const mm = 1 / UNIT_MM.earrings;

  if (style === "hoop") {
    const R = 7.5 * mm;
    const r = stoneRadius(carat, "earrings");
    // The band is as deep as the stones it carries, so they sit in metal.
    const tube = Math.max(1.3 * mm, r * 1.1);
    const hoop = new THREE.Group();
    hoop.position.set(0, -R, 0);
    // Hoop plane is the head's sagittal plane: axis along X.
    hoop.add(solid(new THREE.TorusGeometry(R, tube, 12, 80).rotateY(Math.PI / 2), kit.metal));
    const outer = R + tube * 0.6;
    const n = Math.floor((((150 * Math.PI) / 180) * outer) / (r * 2.15));
    const mats: THREE.Matrix4[] = [];
    for (let i = 0; i < n; i++) {
      const psi = (-25 + (i + 0.5) * (150 / n)) * (Math.PI / 180);
      const nrm = new THREE.Vector3(0, -Math.sin(psi), Math.cos(psi));
      mats.push(placeUp(nrm.clone().multiplyScalar(outer), nrm, r));
    }
    hoop.add(stones(kit.centre, mats));
    root.add(hoop);
    return { root };
  }

  if (style === "drop") {
    // Small stud at the piercing, then an articulated halo drop below it.
    const rs = 1.9 * mm;
    const stud = new THREE.Group();
    stud.rotation.x = Math.PI / 2;
    stud.position.z = rs * 0.4;
    stud.scale.setScalar(rs);
    stud.add(stones(kit.accent, [new THREE.Matrix4()]));
    stud.add(solid(prongHead(4, 0.1), kit.metal));
    root.add(stud);

    const swing = new THREE.Group();
    swing.position.set(0, -rs * 1.1, 0);
    root.add(swing);
    const rc = stoneRadius(carat, "earrings");
    const link = 3.2 * mm;
    swing.add(
      solid(
        new THREE.TorusGeometry(link * 0.32, 0.35 * mm, 8, 24).translate(0, -link * 0.3, 0),
        kit.metal,
      ),
    );
    const drop = new THREE.Group();
    const halo = 1 + Math.max(0.16, (0.7 * mm) / rc) * 1.2;
    drop.position.set(0, -link * 0.65 - rc * halo * 1.05, 0);
    drop.rotation.x = Math.PI / 2;
    drop.scale.setScalar(rc);
    drop.add(stones(kit.centre, [new THREE.Matrix4()]));
    drop.add(solid(prongHead(4, 0.07), kit.metal));
    const rm = halo - 1;
    const n = Math.max(10, Math.round((Math.PI * 2 * halo) / (rm * 2.2)));
    const mats: THREE.Matrix4[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      mats.push(
        placeUp(new THREE.Vector3(Math.cos(a) * halo, -0.1, Math.sin(a) * halo), UP, rm * 0.92),
      );
    }
    drop.add(stones(kit.accent, mats));
    drop.add(
      solid(
        new THREE.TorusGeometry(halo, rm * 0.9, 10, 64)
          .rotateX(Math.PI / 2)
          .translate(0, -0.1 - rm * 0.7, 0),
        kit.metal,
      ),
    );
    swing.add(drop);
    return { root, swing, swingLength: link + rc * halo * 2 };
  }

  // Solitaire stud: six claws, table facing forward.
  const rc = stoneRadius(carat, "earrings");
  const stud = new THREE.Group();
  stud.rotation.x = Math.PI / 2;
  stud.position.z = rc * 0.45;
  stud.scale.setScalar(rc);
  stud.add(stones(kit.centre, [new THREE.Matrix4()]));
  stud.add(solid(prongHead(6, 0.07), kit.metal));
  root.add(stud);
  return { root };
}

/* ------------------------------------------------------------ necklace */

export type ChainLength = "choker" | "princess" | "matinee";
/** How far below the neck-side points the front of the chain falls, shoulder widths. */
export const CHAIN_DROP: Record<ChainLength, number> = {
  choker: 0.1,
  princess: 0.22,
  matinee: 0.38,
};
/** Neck-side contact points sit this far above the shoulder line. */
export const NECK_SIDE_Y = 0.1;

function chainCurve(length: ChainLength): THREE.CatmullRomCurve3 {
  const D = CHAIN_DROP[length];
  const ys = NECK_SIDE_Y;
  const half = [
    [0.155, ys, 0.01],
    [0.165, ys - 0.3 * D, 0.045],
    [0.125, ys - 0.74 * D, 0.075],
    [0.06, ys - 0.96 * D, 0.088],
  ];
  const front = [
    ...half.map(([x, y, z]) => new THREE.Vector3(-x, y, z)),
    new THREE.Vector3(0, ys - D, 0.09),
    ...[...half].reverse().map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  ];
  const back = [
    new THREE.Vector3(0.115, ys + 0.03, -0.075),
    new THREE.Vector3(0, ys + 0.045, -0.105),
    new THREE.Vector3(-0.115, ys + 0.03, -0.075),
  ];
  return new THREE.CatmullRomCurve3([...front, ...back], true, "centripetal");
}

/**
 * A cable chain around the neck, and the point at the bottom of its front
 * drape where a pendant hangs. Shared by the catalogue necklaces and by a
 * pendant brought over from the studio (studioFit.ts).
 */
export function chainDrape(
  kit: Kit,
  length: ChainLength,
): { links: THREE.Object3D; curve: THREE.CatmullRomCurve3; total: number; uBottom: number } {
  const mm = 1 / UNIT_MM.necklace;
  const curve = chainCurve(length);
  const total = curve.getLength();

  // Cable chain: alternate links turned 90° about the chain.
  const linkLen = 4.2 * mm;
  const pitch = linkLen * 0.72;
  const n = Math.floor(total / pitch);
  const linkGeo = new THREE.TorusGeometry(linkLen * 0.36, 0.55 * mm, 6, 14).scale(1.45, 1, 1);
  const links: THREE.Matrix4[] = [];
  const fwd = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).normalize();
    const nrm = fwd
      .clone()
      .sub(t.clone().multiplyScalar(fwd.dot(t)))
      .normalize();
    const bin = new THREE.Vector3().crossVectors(t, nrm);
    links.push(placeBasis(p, t, i % 2 ? nrm : bin, 1));
  }

  // The lowest point of the front drape, where the pendant hangs.
  let uBottom = 0;
  let yMin = Infinity;
  for (let i = 0; i < 400; i++) {
    const p = curve.getPointAt(i / 400);
    if (p.z > 0 && p.y < yMin) {
      yMin = p.y;
      uBottom = i / 400;
    }
  }
  return { links: instanced(linkGeo, kit.metal, links), curve, total, uBottom };
}

function buildNecklace(style: string, kit: Kit, carat: number, length: ChainLength): BuiltPiece {
  const root = new THREE.Group();
  const mm = 1 / UNIT_MM.necklace;
  const { links, curve, total, uBottom } = chainDrape(kit, length);
  root.add(links);
  const fwd = new THREE.Vector3(0, 0, 1);
  const bottom = curve.getPointAt(uBottom);
  let swing: THREE.Group | undefined;
  let swingLength: number | undefined;

  if (style === "riviere") {
    // Graduated line of claw-set stones across the front of the neck.
    const rMax = stoneRadius(carat, "necklace");
    const rMin = rMax * 0.45;
    const mats: THREE.Matrix4[] = [];
    const u = uBottom;
    const placed: { u: number; r: number }[] = [];
    // Walk outward from the centre stone in both directions.
    const sizeAt = (du: number) => rMin + (rMax - rMin) * Math.pow(Math.max(0, 1 - du / 0.26), 0.8);
    placed.push({ u, r: rMax });
    for (const dir of [1, -1]) {
      let cu = u;
      let cr = rMax;
      for (;;) {
        const nr = sizeAt(Math.abs(cu - u));
        const step = ((cr + nr) * 1.08) / total;
        cu += dir * step;
        cr = nr;
        if (Math.abs(cu - u) > 0.26) break;
        placed.push({ u: cu, r: nr });
      }
    }
    for (const s of placed) {
      const p = curve.getPointAt(((s.u % 1) + 1) % 1);
      const t = curve.getTangentAt(((s.u % 1) + 1) % 1).normalize();
      const out = fwd
        .clone()
        .sub(t.clone().multiplyScalar(fwd.dot(t)))
        .normalize();
      mats.push(placeBasis(p.clone().add(out.clone().multiplyScalar(s.r * 0.6)), t, out, s.r));
    }
    root.add(stones(kit.centre, mats));
    root.add(instanced(clawCollet(), kit.metal, mats));
  } else {
    // Pendant on a bale, free to swing.
    swing = new THREE.Group();
    swing.position.copy(bottom);
    root.add(swing);
    const bale = 3 * mm;
    swing.add(
      solid(
        new THREE.TorusGeometry(bale * 0.5, 0.6 * mm, 8, 24).translate(0, -bale * 0.35, 0),
        kit.metal,
      ),
    );
    const rc = stoneRadius(carat, "necklace");
    const halo = style === "halo" ? 1 + Math.max(0.16, (0.65 * mm) / rc) * 1.2 : 1;
    const head = new THREE.Group();
    head.position.set(0, -bale * 0.85 - rc * halo * 1.02, rc * 0.2);
    head.rotation.x = Math.PI / 2;
    head.scale.setScalar(rc);
    head.add(stones(kit.centre, [new THREE.Matrix4()]));
    head.add(solid(prongHead(4, 0.075), kit.metal));
    if (style === "halo") {
      const rm = halo - 1;
      const k = Math.max(10, Math.round((Math.PI * 2 * halo) / (rm * 2.2)));
      const mats: THREE.Matrix4[] = [];
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2;
        mats.push(
          placeUp(new THREE.Vector3(Math.cos(a) * halo, -0.1, Math.sin(a) * halo), UP, rm * 0.92),
        );
      }
      head.add(stones(kit.accent, mats));
      head.add(
        solid(
          new THREE.TorusGeometry(halo, rm * 0.9, 10, 64)
            .rotateX(Math.PI / 2)
            .translate(0, -0.1 - rm * 0.7, 0),
          kit.metal,
        ),
      );
    }
    swing.add(head);
    swingLength = bale + rc * halo * 2;
  }

  // The neck: hides the chain where it passes behind.
  root.add(occluderCylinder(0.128, 0.11, 0.42, NECK_SIDE_Y + 0.2, -0.03));
  return { root, swing, swingLength };
}

/* --------------------------------------------------------------- build */

export interface PieceOptions {
  category: Category;
  style: string;
  carat: number;
  chain: ChainLength;
}

/** One piece per anchor: two for earrings, one otherwise. */
export function buildPieces(o: PieceOptions, kit: Kit): BuiltPiece[] {
  switch (o.category) {
    case "ring":
      return [{ root: buildRing(o.style, kit, o.carat) }];
    case "bracelet":
      return [{ root: buildBracelet(o.style, kit, o.carat) }];
    case "bangle":
      return [{ root: buildBangle(o.style, kit, o.carat) }];
    case "earrings":
      return [buildEarring(o.style, kit, o.carat), buildEarring(o.style, kit, o.carat)];
    case "necklace":
      return [buildNecklace(o.style, kit, o.carat, o.chain)];
  }
}

/**
 * Frees everything a piece made, leaving the shared stone geometry alone, and
 * any geometry the piece only borrowed (`userData.borrowed` on the mesh): a
 * piece from the studio draws the studio's own buffers, and disposing them on
 * every metal or stone change would re-upload a million vertices each time.
 */
export function disposePiece(piece: BuiltPiece): void {
  piece.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry && !mesh.geometry.userData.shared && !mesh.userData.borrowed)
      mesh.geometry.dispose();
    if ((mesh as unknown as THREE.InstancedMesh).isInstancedMesh)
      (mesh as unknown as THREE.InstancedMesh).dispose();
  });
}

/** Applies the depth-only material to every occluder in a piece. */
export function assignOccluders(piece: BuiltPiece, material: THREE.Material): void {
  piece.root.traverse((o) => {
    if (o.userData.occluder) (o as THREE.Mesh).material = material;
  });
}
