import * as THREE from "three";
import { MeshBVHUniformStruct, SAH } from "three-mesh-bvh";
import { buildBVH } from "@/lib/bvhAsync";
import { bvhSource } from "@/components/jewelry/GemRefraction";
import { upAxisRotation, type CameraSettings } from "@/components/jewelry/camera";
import type { Category } from "./catalog";
import {
  NECK_SIDE_Y,
  UNIT_MM,
  chainDrape,
  occluderCylinder,
  type BuiltPiece,
  type ChainLength,
  type Kit,
} from "./jewelry";

/*
 * Trying on the piece the studio is showing, rather than a catalogue piece.
 *
 * The catalogue pieces are built for the tracker: each category has its own
 * units and axes (jewelry.ts), e.g. a ring's inner radius is 1 and the finger
 * runs along +Y. A piece from the studio is a CAD model in whatever units and
 * orientation it was drawn in. This works out, from the geometry, how to put
 * it into the category's frame:
 *
 *   ring, bracelet, bangle  the hole's axis becomes the finger / wrist, the
 *                           stones face out of the back of the hand, and the
 *                           inside of the band is scaled to the body.
 *   necklace                a full necklace (a closed loop) is tilted round
 *                           the neck and sized to it; a pendant on its own is
 *                           hung on a chain at its real size.
 *   earrings                hung from its top point, at real size.
 *
 * "Up" and "front" come from the studio's own view (its up-axis setting), so
 * the piece goes on the way it looked on screen. Geometry is shared with the
 * studio, not copied: only the transform is new.
 */

/** What the studio hands over. */
export interface StudioPieceSource {
  /** The loaded piece: meshes named "metal" and "gem", unit-normalised. */
  object: THREE.Object3D;
  name: string;
  /** Reference or SKU line; only used to guess the category. */
  ref?: string;
  upAxis: CameraSettings["upAxis"];
  /** Real millimetres per model unit, when the file said. */
  mmPerUnit: number | null;
}

interface Part {
  geometry: THREE.BufferGeometry;
  /** Mesh space → the studio's display frame (+Y up, +Z toward the viewer). */
  matrix: THREE.Matrix4;
  gem: boolean;
  /** Stones only: the traced-material inputs. */
  bvh?: MeshBVHUniformStruct;
  absorbRef?: number;
  epsilon?: number;
}

export interface PreparedStudioPiece {
  id: string;
  name: string;
  ref: string;
  parts: Part[];
  hasGems: boolean;
  mmPerUnit: number | null;
  /** Sampled points in the display frame, for the fits below. */
  metalPoints: THREE.Vector3[];
  gemPoints: THREE.Vector3[];
}

const SAMPLE = 40_000;

function samplePoints(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, budget: number) {
  const pos = geometry.getAttribute("position");
  const out: THREE.Vector3[] = [];
  if (!pos || pos.count === 0) return out;
  const step = Math.max(1, Math.floor(pos.count / budget));
  for (let i = 0; i < pos.count; i += step) {
    out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(matrix));
  }
  return out;
}

/**
 * Gathers the studio piece's meshes and builds its stones' BVHs (in a worker,
 * see bvhAsync.ts). Done once per piece; fitting it to a category is cheap.
 */
export async function prepareStudioPiece(src: StudioPieceSource): Promise<PreparedStudioPiece> {
  const display = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(...upAxisRotation(src.upAxis)),
  );
  src.object.updateMatrixWorld(true);
  const rootInverse = src.object.matrixWorld.clone().invert();

  const meshes: THREE.Mesh[] = [];
  src.object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry?.getAttribute("position")) meshes.push(mesh);
  });
  const total = meshes.reduce((n, m) => n + m.geometry.getAttribute("position").count, 0) || 1;

  const parts: Part[] = [];
  const metalPoints: THREE.Vector3[] = [];
  const gemPoints: THREE.Vector3[] = [];
  await Promise.all(
    meshes.map(async (mesh) => {
      const matrix = display.clone().multiply(rootInverse.clone().multiply(mesh.matrixWorld));
      const gem = /gem|stone|diamond/i.test(mesh.name);
      const budget = Math.max(
        500,
        Math.round((SAMPLE * mesh.geometry.getAttribute("position").count) / total),
      );
      (gem ? gemPoints : metalPoints).push(...samplePoints(mesh.geometry, matrix, budget));
      const part: Part = { geometry: mesh.geometry, matrix, gem };
      if (gem) {
        const tree = await buildBVH(bvhSource(mesh.geometry), { strategy: SAH });
        part.bvh = new MeshBVHUniformStruct();
        part.bvh.updateFrom(tree);
        if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
        const r = mesh.geometry.boundingSphere?.radius ?? 0.25;
        // As the studio sets them (GemRefraction.tsx), in the mesh's own space.
        part.absorbRef = r * 4;
        part.epsilon = r * 1e-4;
      }
      parts.push(part);
    }),
  );

  return {
    id: src.object.uuid,
    name: src.name,
    ref: src.ref ?? "",
    parts,
    hasGems: parts.some((p) => p.gem),
    mmPerUnit: src.mmPerUnit,
    // A piece with no metal tagged still needs something to measure.
    metalPoints: metalPoints.length ? metalPoints : gemPoints,
    gemPoints,
  };
}

/* ------------------------------------------------------------- geometry */

function centroid(points: THREE.Vector3[]): THREE.Vector3 {
  const c = new THREE.Vector3();
  for (const p of points) c.add(p);
  return points.length ? c.divideScalar(points.length) : c;
}

/** Eigenvectors of the points' covariance, smallest spread first (Jacobi). */
function principalAxes(points: THREE.Vector3[]): THREE.Vector3[] {
  const c = centroid(points);
  const a = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of points) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[i][j] += d[i] * d[j];
  }
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 32; sweep++) {
    let off = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += a[i][j] * a[i][j];
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-20) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const cs = 1 / Math.sqrt(t * t + 1);
        const sn = t * cs;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = cs * akp - sn * akq;
          a[k][q] = sn * akp + cs * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = cs * apk - sn * aqk;
          a[q][k] = sn * apk + cs * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = cs * vkp - sn * vkq;
          v[k][q] = sn * vkp + cs * vkq;
        }
      }
    }
  }
  return [0, 1, 2]
    .sort((i, j) => a[i][i] - a[j][j])
    .map((i) => new THREE.Vector3(v[0][i], v[1][i], v[2][i]).normalize());
}

function bounds(points: THREE.Vector3[]): THREE.Box3 {
  return new THREE.Box3().setFromPoints(points);
}

/** The value below which `q` of the values fall. */
function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
}

/**
 * Whether the piece is a closed loop (a ring, bangle or a whole necklace) as
 * opposed to a pendant or an earring: nothing near the middle of its front
 * view.
 */
function isLoop(points: THREE.Vector3[]): boolean {
  const b = bounds(points);
  const c = b.getCenter(new THREE.Vector3());
  const r = 0.22 * Math.min(b.max.x - b.min.x, b.max.y - b.min.y);
  let inside = 0;
  for (const p of points) if (Math.hypot(p.x - c.x, p.y - c.y) < r) inside++;
  return inside / Math.max(1, points.length) < 0.015;
}

/* ------------------------------------------------------------------ fits */

interface Fit {
  /** Display frame → category frame. */
  matrix: THREE.Matrix4;
  /** Optional pendulum the matrix is relative to; see BuiltPiece.swing. */
  swingAt?: THREE.Vector3;
  swingLength?: number;
  /** Add the catalogue chain (a pendant without its own). */
  chain?: boolean;
}

/**
 * Ring, bracelet, bangle: the hole's axis along +Y, the stones toward +Z,
 * and the inside of the band at `innerRadius`.
 */
function fitBand(prep: PreparedStudioPiece, innerRadius: number): Fit {
  const metal = prep.metalPoints;
  const axis = principalAxes([...metal, ...prep.gemPoints])[0];

  // Toward the stones; failing that, whatever was up on screen.
  const toward = (v: THREE.Vector3) => v.clone().addScaledVector(axis, -v.dot(axis));
  let crest = prep.gemPoints.length
    ? toward(centroid(prep.gemPoints).sub(centroid(metal)))
    : new THREE.Vector3();
  if (crest.lengthSq() < 1e-8) crest = toward(new THREE.Vector3(0, 1, 0));
  if (crest.lengthSq() < 1e-8) crest = toward(new THREE.Vector3(1, 0, 0));
  crest.normalize();

  const Y = axis.clone();
  const Z = crest;
  const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
  const toLocal = new THREE.Matrix4().makeBasis(X, Y, Z).transpose();

  const local = metal.map((p) => p.clone().applyMatrix4(toLocal));
  const b = bounds(local);
  // Symmetric across the band, so its middle is the hole's middle; along the
  // crest the far side of the band is the reliable edge (the head sticks out).
  const rOuter = (b.max.x - b.min.x) / 2;
  const centre = new THREE.Vector3(
    (b.min.x + b.max.x) / 2,
    (b.min.y + b.max.y) / 2,
    b.min.z + rOuter,
  );
  let rInner = quantile(
    local.map((p) => Math.hypot(p.x - centre.x, p.z - centre.z)),
    0.01,
  );
  if (!(rInner > rOuter * 0.25)) rInner = rOuter * 0.85;

  const s = innerRadius / rInner;
  const matrix = new THREE.Matrix4()
    .makeScale(s, s, s)
    .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z))
    .multiply(toLocal);
  return { matrix };
}

/**
 * A whole necklace, drawn face-on as most are: tipped back round the neck so
 * the top of the loop sits behind it and the front falls onto the chest, the
 * way the catalogue chain drapes (jewelry.ts, chainCurve).
 */
function fitNecklaceLoop(prep: PreparedStudioPiece): Fit {
  const all = [...prep.metalPoints, ...prep.gemPoints];
  const b = bounds(all);
  const width = Math.max(1e-6, b.max.x - b.min.x);
  // Across the neck, as the catalogue chain is at its widest.
  const s = 0.33 / width;
  /*
   * Tipped just far enough that the front reaches the chest (z ≈ +0.09, the
   * catalogue chain's front) from the back of the neck (z ≈ -0.105). How far
   * it then falls is the necklace's own length, so the chain-length picker
   * does not apply to a whole necklace.
   */
  const loopH = Math.max(1e-6, (b.max.y - b.min.y) * s);
  const tilt = Math.asin(Math.min(1, 0.195 / loopH));
  const top = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2);
  const matrix = new THREE.Matrix4()
    .makeTranslation(0, NECK_SIDE_Y + 0.045, -0.105)
    .multiply(new THREE.Matrix4().makeRotationX(-tilt))
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-top.x, -top.y, -top.z));
  return { matrix };
}

/** Real size when the file gave one; otherwise `fallbackMm` tall. */
function realScale(prep: PreparedStudioPiece, unitMm: number, fallbackMm: number): number {
  if (prep.mmPerUnit) return prep.mmPerUnit / unitMm;
  const b = bounds([...prep.metalPoints, ...prep.gemPoints]);
  return fallbackMm / unitMm / Math.max(1e-6, b.max.y - b.min.y);
}

/** Hangs the piece from the middle of its top edge, at `s`. */
function hangFromTop(prep: PreparedStudioPiece, s: number): THREE.Matrix4 {
  const b = bounds([...prep.metalPoints, ...prep.gemPoints]);
  const top = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2);
  return new THREE.Matrix4()
    .makeScale(s, s, s)
    .multiply(new THREE.Matrix4().makeTranslation(-top.x, -top.y, -top.z));
}

function fitFor(prep: PreparedStudioPiece, category: Category, chain: ChainLength): Fit {
  switch (category) {
    case "ring":
      return fitBand(prep, 1);
    case "bracelet":
      return fitBand(prep, 0.43);
    case "bangle":
      return fitBand(prep, 0.5);
    case "necklace": {
      if (isLoop(prep.metalPoints)) return fitNecklaceLoop(prep);
      const s = realScale(prep, UNIT_MM.necklace, 30);
      const b = bounds([...prep.metalPoints, ...prep.gemPoints]);
      return {
        matrix: hangFromTop(prep, s),
        chain: true,
        swingLength: (b.max.y - b.min.y) * s,
      };
    }
    case "earrings":
      return { matrix: hangFromTop(prep, realScale(prep, UNIT_MM.earrings, 20)) };
  }
}

/** The category's body occluder, matching the catalogue pieces (jewelry.ts). */
function occluderFor(category: Category): THREE.Mesh | null {
  switch (category) {
    case "ring":
      return occluderCylinder(0.985, 0.985, 4.2, 0.5);
    case "bracelet":
      return occluderCylinder(0.41, 0.29, 1.4, 0.1);
    case "bangle":
      return occluderCylinder(0.41, 0.29, 1.4, 0.15);
    case "necklace":
      return occluderCylinder(0.128, 0.11, 0.42, NECK_SIDE_Y + 0.2, -0.03);
    case "earrings":
      return null;
  }
}

/** The studio piece as try-on pieces: one per anchor, two for earrings. */
export function buildStudioPieces(
  prep: PreparedStudioPiece,
  category: Category,
  chain: ChainLength,
  kit: Kit,
  stone: (part: Part) => THREE.Material,
): BuiltPiece[] {
  const fit = fitFor(prep, category, chain);

  const dressed = () => {
    const group = new THREE.Group();
    for (const part of prep.parts) {
      const mesh = new THREE.Mesh(part.geometry, part.gem && part.bvh ? stone(part) : kit.metal);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(fit.matrix).multiply(part.matrix);
      // The studio's buffers: drawn here, never freed here (disposePiece).
      mesh.userData.borrowed = true;
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    return group;
  };

  const one = (): BuiltPiece => {
    const root = new THREE.Group();
    const occluder = occluderFor(category);
    if (fit.chain) {
      const { links, curve, uBottom } = chainDrape(kit, chain);
      root.add(links);
      const swing = new THREE.Group();
      swing.position.copy(curve.getPointAt(uBottom));
      swing.add(dressed());
      root.add(swing);
      if (occluder) root.add(occluder);
      return { root, swing, swingLength: fit.swingLength };
    }
    root.add(dressed());
    if (occluder) root.add(occluder);
    return { root };
  };

  return category === "earrings" ? [one(), one()] : [one()];
}

/** Whether the chain-length choice means anything for this piece. */
export function usesChainLength(prep: PreparedStudioPiece): boolean {
  return !isLoop(prep.metalPoints);
}

/**
 * Which body part a piece most likely goes on: from its name first, then from
 * its size when the file gave real units. Only a starting point; the visitor
 * can pick another category.
 */
export function guessCategory(prep: PreparedStudioPiece): Category {
  const n = `${prep.name} ${prep.ref}`.toLowerCase();
  if (/ear|stud|hoop|jhumk|bali/.test(n)) return "earrings";
  if (/neck|pendant|chain|mangal|haar|locket/.test(n)) return "necklace";
  if (/bangle|kada|kangan/.test(n)) return "bangle";
  if (/bracelet|tennis/.test(n)) return "bracelet";
  if (/ring|band|solitaire/.test(n)) return "ring";

  const all = [...prep.metalPoints, ...prep.gemPoints];
  if (prep.mmPerUnit && all.length) {
    const b = bounds(all);
    const spanMm = Math.max(b.max.x - b.min.x, b.max.y - b.min.y) * prep.mmPerUnit;
    if (isLoop(prep.metalPoints)) {
      if (spanMm < 35) return "ring";
      if (spanMm < 95) return "bangle";
      return "necklace";
    }
    return spanMm < 25 ? "earrings" : "necklace";
  }
  return "ring";
}
