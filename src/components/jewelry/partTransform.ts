import * as THREE from "three";
import type { Part } from "./selection";

/*
 * Model part transform.
 *
 * Whole-part only — this moves and scales a `Part.mesh` itself (a named CAD
 * layer: "Shank", "Head", "Bail"), using the mesh's own `position`/`scale`
 * directly, which is exactly what those properties are for. It deliberately
 * does NOT reach inside a multi-solid group to move one stone or one prong:
 * that would mean rewriting vertices the way `prongs.ts` does for height,
 * which is a real, separate piece of work this control does not fake by
 * quietly moving the whole group instead. Selecting a solid id disables this
 * panel with an explanation rather than silently acting on its parent part.
 */

export interface PartTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
}

export type PartTransforms = Record<string, PartTransform>;

export const IDENTITY_PART_TRANSFORM: PartTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
};

/** Smaller reads as a part failing to render; larger starts swallowing its neighbours. */
export const PART_SCALE_MIN = 0.2;
export const PART_SCALE_MAX = 3;
/** The piece is unit-normalised on load, so a whole unit of offset already moves a part
 *  most of the way across it — generous enough for a real nudge, not enough to lose it. */
export const PART_OFFSET_LIMIT = 2;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function clampPartScale(n: number): number {
  return clamp(n, PART_SCALE_MIN, PART_SCALE_MAX);
}

export function clampPartOffset(n: number): number {
  return clamp(n, -PART_OFFSET_LIMIT, PART_OFFSET_LIMIT);
}

function isIdentity(t: PartTransform): boolean {
  return t.scale === 1 && t.offsetX === 0 && t.offsetY === 0 && t.offsetZ === 0;
}

interface MeshBase {
  position: THREE.Vector3;
  scale: THREE.Vector3;
  /** The part's own local bounding-box centre, so scaling grows it in place
   *  rather than away from wherever it happens to sit in the piece. */
  center: THREE.Vector3;
}

/*
 * Keyed on the mesh itself, not `userData` — the same reasoning as
 * `prongs.ts`'s cache: `Object3D.clone()` round-trips `userData` through
 * JSON on some paths in this codebase, which would turn a `Vector3` to mush.
 * A WeakMap sidesteps that and cleans itself up when the mesh is disposed.
 */
const bases = new WeakMap<THREE.Mesh, MeshBase>();

function baseOf(mesh: THREE.Mesh): MeshBase {
  let base = bases.get(mesh);
  if (base) return base;
  mesh.geometry.computeBoundingBox();
  const center = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  base = { position: mesh.position.clone(), scale: mesh.scale.clone(), center };
  bases.set(mesh, base);
  return base;
}

/**
 * Applies a part's scale/offset directly to its mesh, always computed fresh
 * from the cached base rather than compounded — so a missing entry, a reset,
 * and a hundred slider drags in between all land on exactly the same place.
 */
export function applyPartTransform(part: Part, transforms: PartTransforms): void {
  const t = transforms[part.id] ?? IDENTITY_PART_TRANSFORM;
  const base = baseOf(part.mesh);
  const scale = clampPartScale(t.scale);
  part.mesh.scale.set(base.scale.x * scale, base.scale.y * scale, base.scale.z * scale);
  part.mesh.position.set(
    base.position.x + base.center.x * (1 - scale) + clampPartOffset(t.offsetX),
    base.position.y + base.center.y * (1 - scale) + clampPartOffset(t.offsetY),
    base.position.z + base.center.z * (1 - scale) + clampPartOffset(t.offsetZ),
  );
}

export function setPartScale(
  transforms: PartTransforms,
  partId: string,
  scale: number,
): PartTransforms {
  const next = { ...transforms };
  const updated = { ...(next[partId] ?? IDENTITY_PART_TRANSFORM), scale: clampPartScale(scale) };
  if (isIdentity(updated)) delete next[partId];
  else next[partId] = updated;
  return next;
}

export function setPartOffset(
  transforms: PartTransforms,
  partId: string,
  axis: "offsetX" | "offsetY" | "offsetZ",
  value: number,
): PartTransforms {
  const next = { ...transforms };
  const updated = { ...(next[partId] ?? IDENTITY_PART_TRANSFORM), [axis]: clampPartOffset(value) };
  if (isIdentity(updated)) delete next[partId];
  else next[partId] = updated;
  return next;
}

export function resetPartScale(transforms: PartTransforms, partId: string): PartTransforms {
  if (!transforms[partId]) return transforms;
  const next = { ...transforms };
  const updated = { ...next[partId], scale: 1 };
  if (isIdentity(updated)) delete next[partId];
  else next[partId] = updated;
  return next;
}

export function resetPartPosition(transforms: PartTransforms, partId: string): PartTransforms {
  if (!transforms[partId]) return transforms;
  const next = { ...transforms };
  const updated = { ...next[partId], offsetX: 0, offsetY: 0, offsetZ: 0 };
  if (isIdentity(updated)) delete next[partId];
  else next[partId] = updated;
  return next;
}
