import * as THREE from "three";
import { parseId, solidId, solidRange, type Part } from "./selection";

/*
 * Prong height.
 *
 * Everything else this app adjusts is a render parameter — a light, a colour,
 * a lens. This is the first control that moves actual geometry.
 *
 * A merged metal mesh has no idea which of its solids are prongs: "Metal 01"
 * is the shank, the head and every claw, welded into one buffer for the draw
 * call (see selection.ts). What the decoder DOES give us, for free, is each
 * solid's own triangle range — the same addressing the Materials panel uses
 * to recolour one prong without touching its neighbours. This module reuses
 * that to scale one solid taller or shorter along its own long axis, anchored
 * at whichever end sits closer to the piece's body, so the tip moves and the
 * base does not.
 *
 * The axis and anchor are a guess from shape (the solid's own bounding box),
 * not something read from the file. Right on an ordinary claw prong; possibly
 * wrong on an unusual one — which is exactly why WHICH solid gets adjusted is
 * always a person's own click (the Prongs brush), never an automatic guess.
 * An earlier version of this file also tried to guess "every prong on the
 * piece" from shape and stone proximity, to drive a one-click "select all."
 * It was pulled after repeated tuning against a real piece never reached a
 * result better than "either everything or nothing" — manual, one-at-a-time
 * picking turned out to be both simpler and reliably correct.
 */

export type ProngHeights = Record<string, number>;

/** Shorter than this looks collapsed; taller starts clipping through the crown. */
export const PRONG_HEIGHT_MIN = 0.5;
export const PRONG_HEIGHT_MAX = 1.6;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function clampProngHeight(n: number): number {
  return clamp(n, PRONG_HEIGHT_MIN, PRONG_HEIGHT_MAX);
}

interface SolidAxis {
  /** The solid's own long direction, a unit vector — not necessarily aligned
   *  to x/y/z. A prong built at an angle has no reason to point along a
   *  world axis, and scaling along the wrong one shears the shape sideways
   *  instead of lengthening it, which is what a plain "biggest bounding-box
   *  dimension" version of this did: it read as tilted and stretched rather
   *  than taller, on anything not built axis-aligned. */
  axis: THREE.Vector3;
  /** Where the anchored end projects onto that axis, in the geometry's BASE positions. */
  anchorT: number;
}

interface ProngGeometryCache {
  /** The pristine position buffer, snapshotted before the first deformation. */
  base: Float32Array;
  axes: Map<number, SolidAxis>;
  /** The factor currently baked into `position`, per solid — lets a repeat
   *  call skip any solid whose target hasn't changed. */
  applied: Map<number, number>;
  groupCenter?: THREE.Vector3;
  /** The single largest solid's bounding diagonal in this group — computed
   *  once and reused by `isReasonablySized`, since it never changes. */
  maxDiagonal?: number;
}

/*
 * Keyed off the geometry object itself rather than `geometry.userData`.
 *
 * `userData` round-trips through JSON on some clone paths elsewhere in this
 * codebase (see the comment on `ensureSolids`) — fine for a plain number
 * array, fatal for a Map or a Float32Array, which JSON turns into mush. A
 * WeakMap keyed by the geometry sidesteps that entirely and cleans itself up
 * when the geometry is disposed.
 */
const caches = new WeakMap<THREE.BufferGeometry, ProngGeometryCache>();

function getCache(geometry: THREE.BufferGeometry): ProngGeometryCache | null {
  let cache = caches.get(geometry);
  if (cache) return cache;

  const position = geometry.attributes.position as THREE.BufferAttribute | undefined;
  if (!position) return null;

  cache = {
    base: Float32Array.from(position.array as ArrayLike<number>),
    axes: new Map(),
    applied: new Map(),
  };
  caches.set(geometry, cache);
  return cache;
}

function groupCenterOf(cache: ProngGeometryCache): THREE.Vector3 {
  if (!cache.groupCenter) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    const n = cache.base.length / 3;
    for (let i = 0; i < n; i++) {
      sx += cache.base[i * 3];
      sy += cache.base[i * 3 + 1];
      sz += cache.base[i * 3 + 2];
    }
    cache.groupCenter = new THREE.Vector3(sx / n, sy / n, sz / n);
  }
  return cache.groupCenter;
}

/** The distinct vertex indices a solid's triangles touch. */
function solidVertices(index: ArrayLike<number>, start: number, count: number): Set<number> {
  const out = new Set<number>();
  for (let i = start; i < start + count; i++) out.add(index[i]);
  return out;
}

/** A solid's own bounding-box diagonal, from its vertex spread. */
function diagonalOf(base: Float32Array, vertices: Iterable<number>): number {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const vi of vertices) {
    const x = base[vi * 3];
    const y = base[vi * 3 + 1];
    const z = base[vi * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
}

function maxDiagonalOf(part: Part, cache: ProngGeometryCache): number {
  if (cache.maxDiagonal !== undefined) return cache.maxDiagonal;

  let max = 1e-6;
  const solids = part.solids;
  const index = part.mesh.geometry.index;
  if (solids && solids.length > 1 && index) {
    const count = solids.length - 1;
    for (let s = 0; s < count; s++) {
      const range = solidRange(solids, s);
      if (!range) continue;
      const d = diagonalOf(cache.base, solidVertices(index.array, range.start, range.count));
      if (d > max) max = d;
    }
  }
  cache.maxDiagonal = max;
  return max;
}

/**
 * Whether one solid is small enough to plausibly be a prong — nothing more
 * specific than that. Found necessary against a real piece where a whole
 * pavé face turned out to be modelled as one connected sheet of metal
 * holding every stone: clicking anywhere on it selected that entire sheet,
 * which is unmistakably not a claw regardless of its shape. No aspect ratio
 * or stone-proximity test here — both were tried in an earlier version and
 * tuned against a real piece without ever landing on numbers that worked;
 * size alone is the one thing that reliably tells "a prong" from "the plate
 * the prongs are cut into," because nothing shaped like an actual claw is
 * anywhere near as large as the metal that holds a whole field of stones.
 */
export function isReasonablySized(part: Part, solidIndex: number): boolean {
  if (part.kind !== "metal") return false;
  const solids = part.solids;
  if (!solids || solids.length < 2) return false;
  const geometry = part.mesh.geometry;
  const index = geometry.index;
  if (!index) return false;
  const cache = getCache(geometry);
  if (!cache) return false;

  const range = solidRange(solids, solidIndex);
  if (!range) return false;
  const diagonal = diagonalOf(cache.base, solidVertices(index.array, range.start, range.count));
  return diagonal <= maxDiagonalOf(part, cache) * 0.35;
}

/**
 * The solid's true long direction: the dominant eigenvector of its own
 * vertices' covariance, found by power iteration on the (symmetric, 3x3)
 * covariance matrix. A handful of iterations is enough — a claw is exactly
 * the shape power iteration converges fastest on, one eigenvalue clearly
 * dominating the other two. A solid closer to round has no single "long
 * axis" to find in the first place, so an imprecise answer there costs
 * nothing real: nobody raises the height of something that isn't a claw.
 */
function principalAxis(base: Float32Array, vertices: Iterable<number>): THREE.Vector3 {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let n = 0;
  for (const vi of vertices) {
    cx += base[vi * 3];
    cy += base[vi * 3 + 1];
    cz += base[vi * 3 + 2];
    n++;
  }
  cx /= n || 1;
  cy /= n || 1;
  cz /= n || 1;

  let xx = 0;
  let yy = 0;
  let zz = 0;
  let xy = 0;
  let xz = 0;
  let yz = 0;
  for (const vi of vertices) {
    const dx = base[vi * 3] - cx;
    const dy = base[vi * 3 + 1] - cy;
    const dz = base[vi * 3 + 2] - cz;
    xx += dx * dx;
    yy += dy * dy;
    zz += dz * dz;
    xy += dx * dy;
    xz += dx * dz;
    yz += dy * dz;
  }

  let vx = xx || 1;
  let vy = xy || 1;
  let vz = xz || 1;
  for (let iter = 0; iter < 24; iter++) {
    const nx = xx * vx + xy * vy + xz * vz;
    const ny = xy * vx + yy * vy + yz * vz;
    const nz = xz * vx + yz * vy + zz * vz;
    const len = Math.hypot(nx, ny, nz) || 1;
    vx = nx / len;
    vy = ny / len;
    vz = nz / len;
  }
  return new THREE.Vector3(vx, vy, vz);
}

/** The end of the solid's true long axis that sits closer to the piece's body. */
function axisOf(
  base: Float32Array,
  vertices: Iterable<number>,
  groupCenter: THREE.Vector3,
): SolidAxis {
  const axis = principalAxis(base, vertices);
  let minT = Infinity;
  let maxT = -Infinity;
  for (const vi of vertices) {
    const t = base[vi * 3] * axis.x + base[vi * 3 + 1] * axis.y + base[vi * 3 + 2] * axis.z;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }
  const centerT = groupCenter.x * axis.x + groupCenter.y * axis.y + groupCenter.z * axis.z;
  const anchorT = Math.abs(minT - centerT) <= Math.abs(maxT - centerT) ? minT : maxT;
  return { axis, anchorT };
}

/**
 * Recomputes normals for one solid's own triangles only.
 *
 * The same accumulate-cross-products-then-normalize three.js's own
 * `computeVertexNormals` uses, just scoped to this solid's triangle range
 * instead of the whole geometry — correct because a solid's vertices, by
 * definition, are not shared with any triangle outside its own range (that
 * connectivity is exactly what makes it one solid; see `splitSolids`).
 */
function recomputeNormals(
  geometry: THREE.BufferGeometry,
  range: { start: number; count: number },
  vertices: ReadonlySet<number>,
): void {
  const normalAttr = geometry.attributes.normal as THREE.BufferAttribute | undefined;
  if (!normalAttr) return;
  const index = geometry.index;
  if (!index) return;
  const pos = geometry.attributes.position.array as Float32Array;
  const nrm = normalAttr.array as Float32Array;
  const idx = index.array;

  for (const vi of vertices) {
    nrm[vi * 3] = 0;
    nrm[vi * 3 + 1] = 0;
    nrm[vi * 3 + 2] = 0;
  }

  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();
  for (let i = range.start; i < range.start + range.count; i += 3) {
    const ia = idx[i];
    const ib = idx[i + 1];
    const ic = idx[i + 2];
    pA.fromArray(pos, ia * 3);
    pB.fromArray(pos, ib * 3);
    pC.fromArray(pos, ic * 3);
    cb.subVectors(pC, pB);
    ab.subVectors(pA, pB);
    cb.cross(ab);
    nrm[ia * 3] += cb.x;
    nrm[ia * 3 + 1] += cb.y;
    nrm[ia * 3 + 2] += cb.z;
    nrm[ib * 3] += cb.x;
    nrm[ib * 3 + 1] += cb.y;
    nrm[ib * 3 + 2] += cb.z;
    nrm[ic * 3] += cb.x;
    nrm[ic * 3 + 1] += cb.y;
    nrm[ic * 3 + 2] += cb.z;
  }

  for (const vi of vertices) {
    const x = nrm[vi * 3];
    const y = nrm[vi * 3 + 1];
    const z = nrm[vi * 3 + 2];
    const len = Math.hypot(x, y, z) || 1;
    nrm[vi * 3] = x / len;
    nrm[vi * 3 + 1] = y / len;
    nrm[vi * 3 + 2] = z / len;
  }
  normalAttr.needsUpdate = true;
}

/*
 * How many solids one call touches.
 *
 * Testing against a real piece with a dense pavé face — 313 prong candidates
 * from one "Select all" — found that moving all of them in a single pass
 * reliably lost the WebGL context: one JS task doing hundreds of vertex
 * rewrites, hundreds of per-solid normal recomputes, and a full-geometry
 * bounding recompute is enough synchronous GPU-adjacent work to stall the
 * renderer. A batch this size finishes in well under a frame; the caller
 * (Model.tsx) reschedules another pass on the next animation frame until
 * nothing is left, which is the same fix already used for the viewport's
 * "Best look" button, and for the same reason.
 */
const PRONG_BATCH_SIZE = 48;

/**
 * Applies whatever height factors are set, and puts every other solid back to
 * its original height — always computed fresh from the cached base positions,
 * never compounded from the last frame, so repeated drags cannot drift and a
 * missing entry always means "unchanged."
 *
 * Touches at most `PRONG_BATCH_SIZE` outstanding solids and returns whether
 * any are still left, so a change spanning many solids spreads itself across
 * several calls instead of one large one — see the constant's comment.
 */
export function applyProngHeights(part: Part, heights: ProngHeights): boolean {
  if (part.kind !== "metal") return false;
  const solids = part.solids;
  if (!solids || solids.length < 2) return false;
  const geometry = part.mesh.geometry;
  const index = geometry.index;
  if (!index) return false;

  const cache = getCache(geometry);
  if (!cache) return false;
  const position = geometry.attributes.position as THREE.BufferAttribute;

  const count = solids.length - 1;
  let touched = false;
  let done = 0;
  let remaining = false;

  for (let s = 0; s < count; s++) {
    const factor = clampProngHeight(heights[solidId(part.id, s)] ?? 1);
    const last = cache.applied.get(s) ?? 1;
    if (factor === last) continue;

    if (done >= PRONG_BATCH_SIZE) {
      remaining = true;
      continue;
    }

    const range = solidRange(solids, s);
    if (!range) continue;
    const vertices = solidVertices(index.array, range.start, range.count);

    let axis = cache.axes.get(s);
    if (!axis) {
      axis = axisOf(cache.base, vertices, groupCenterOf(cache));
      cache.axes.set(s, axis);
    }

    const { axis: ax, anchorT } = axis;
    for (const vi of vertices) {
      const o = vi * 3;
      const t = cache.base[o] * ax.x + cache.base[o + 1] * ax.y + cache.base[o + 2] * ax.z;
      const scaledDelta = (t - anchorT) * (factor - 1);
      position.array[o] = cache.base[o] + ax.x * scaledDelta;
      position.array[o + 1] = cache.base[o + 1] + ax.y * scaledDelta;
      position.array[o + 2] = cache.base[o + 2] + ax.z * scaledDelta;
    }
    recomputeNormals(geometry, range, vertices);
    cache.applied.set(s, factor);
    touched = true;
    done++;
  }

  if (touched) {
    position.needsUpdate = true;
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
  }
  return remaining;
}

/**
 * The selected ids this control can act on: individual metal solids only.
 *
 * Deliberately narrower than the Materials panel's `targetIds` — that falls
 * back to "every part of the kind" when nothing is selected, which is right
 * for a colour (recolour the whole piece) and wrong here (there is no "whole
 * piece" reading for height; a shank is not a prong). Selecting nothing here
 * means adjusting nothing, on purpose.
 */
export function targetProngIds(parts: Part[], selected: ReadonlySet<string>): string[] {
  const metalGroups = new Set(parts.filter((p) => p.kind === "metal").map((p) => p.id));
  return [...selected].filter((id) => {
    const { group, solid } = parseId(id);
    return solid !== null && metalGroups.has(group);
  });
}

/** What the panel says it is about to change. */
export function describeProngTargets(parts: Part[], selected: ReadonlySet<string>): string {
  const ids = targetProngIds(parts, selected);
  if (!ids.length) return "";
  if (ids.length === 1) {
    const { group, solid } = parseId(ids[0]);
    const part = parts.find((p) => p.id === group);
    return `${part?.label ?? "part"} · ${(solid ?? 0) + 1}`;
  }
  return `${ids.length} selected`;
}

/** The one height shown as active — only when every target agrees. */
export function commonProngHeight(heights: ProngHeights, ids: string[]): number | null {
  if (!ids.length) return null;
  const first = heights[ids[0]] ?? 1;
  return ids.every((id) => (heights[id] ?? 1) === first) ? first : null;
}

/** Sets the height on the given ids. A factor of 1 clears the entry, so "no
 *  override" stays the representation of "unchanged" rather than a stored 1. */
export function setProngHeights(
  heights: ProngHeights,
  ids: string[],
  factor: number,
): ProngHeights {
  const next = { ...heights };
  const clamped = clampProngHeight(factor);
  for (const id of ids) {
    if (clamped === 1) delete next[id];
    else next[id] = clamped;
  }
  return next;
}

/** Drops any override on the given ids, returning them to their original height. */
export function resetProngHeights(heights: ProngHeights, ids: string[]): ProngHeights {
  const next = { ...heights };
  for (const id of ids) delete next[id];
  return next;
}
