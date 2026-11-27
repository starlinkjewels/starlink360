import * as THREE from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import { buildBVH } from "@/lib/bvhAsync";

/*
 * Picking that does not walk every triangle.
 *
 * Hovering is wired to onPointerMove, and three's stock raycast tests every
 * triangle of every mesh it is given. On a piece with millions of them that is
 * a main-thread block per pointer event, and pointer events arrive sixty to a
 * hundred and twenty times a second — so moving the cursor across the piece
 * stalls the whole page. It needs no drag and no animation, which is why it
 * read as the viewer simply hanging.
 *
 * INDIRECT IS NOT OPTIONAL. A plain MeshBVH spatially reorders the index buffer
 * of the geometry it is built on. Selection addresses solids as ranges into
 * that buffer, so reordering it silently scrambles which triangles belong to
 * which object — the exact fault that painted one stone's colour onto its
 * neighbours, measured at 137 of 140 clicks landing off their stone. Indirect
 * mode keeps its own ordering and leaves the buffer untouched.
 */
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/** Geometry whose tree is being built, so a sweep does not start it twice. */
const building = new WeakSet<THREE.BufferGeometry>();

/**
 * Gives every mesh under `root` a bounds tree, once.
 *
 * The trees are built in a worker (lib/bvhAsync.ts). Built on the main thread
 * this was the largest single freeze on opening a piece: about a second for
 * LP043's metal on a desktop, far longer on a phone, and paid on every load
 * whether or not anyone clicked. Until a mesh's tree arrives, a click on it
 * falls back to three's ordinary raycast, which is slower but correct.
 *
 * Meshes that have a tree, or are getting one, are skipped, so this is safe
 * to run whenever the scene changes.
 */
export function acceleratePicking(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    if (!geometry || geometry.boundsTree || building.has(geometry)) return;
    const position = geometry.getAttribute("position");
    if (!position || position.count === 0) return;
    building.add(geometry);
    buildBVH(geometry, { indirect: true })
      .then((bvh) => {
        geometry.boundsTree = bvh;
      })
      .catch((err) => console.warn("[picking] could not build a bounds tree", err))
      .finally(() => building.delete(geometry));
  });
}
