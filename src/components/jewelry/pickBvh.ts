import * as THREE from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";

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

/**
 * Gives every mesh under `root` a bounds tree, once.
 *
 * Building one costs a beat on load, against a stall on every mouse move for
 * as long as the piece is open. Meshes already carrying a tree are skipped, so
 * this is safe to run whenever the scene changes.
 */
export function acceleratePicking(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    if (!geometry || geometry.boundsTree) return;
    const position = geometry.getAttribute("position");
    if (!position || position.count === 0) return;
    /*
     * Cast because the shipped types for 0.8.3 omit `indirect`, which the
     * runtime supports — the option is threaded through its raycast and
     * iteration paths. Dropping it to satisfy the compiler would reorder the
     * index buffer, so the cast is the safe half of this trade.
     */
    geometry.computeBoundsTree({ indirect: true } as Parameters<
      typeof geometry.computeBoundsTree
    >[0]);
  });
}
