/// <reference lib="webworker" />
import { BufferAttribute, BufferGeometry } from "three";
import { MeshBVH, type MeshBVHOptions, type SerializedBVH } from "three-mesh-bvh";

/*
 * Builds a MeshBVH off the main thread. See bvhAsync.ts.
 *
 * Gets its own copy of the positions and index, so the mesh on the page keeps
 * its buffers the whole time; three-mesh-bvh's stock worker transfers the
 * mesh's real arrays away and leaves them empty while it builds, which would
 * break anything that reads the geometry in the meantime (picking, the
 * dimensions panel, prong detection).
 */

export interface BvhRequest {
  id: number;
  position: Float32Array;
  index: Uint16Array | Uint32Array | null;
  options: MeshBVHOptions;
}

self.onmessage = (e: MessageEvent<BvhRequest>) => {
  const { id, position, index, options } = e.data;
  try {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(position, 3, false));
    if (index) geometry.setIndex(new BufferAttribute(index, 1, false));

    const bvh = new MeshBVH(geometry, options);
    // The shipped types omit `indirectBuffer`, which the runtime includes.
    const serialized = MeshBVH.serialize(bvh, { cloneBuffers: false }) as SerializedBVH & {
      indirectBuffer?: Uint16Array | Uint32Array | null;
    };

    const transfer: Transferable[] = serialized.roots.slice();
    if (serialized.index) transfer.push(serialized.index.buffer);
    if (serialized.indirectBuffer) transfer.push(serialized.indirectBuffer.buffer);
    (self as unknown as Worker).postMessage({ id, serialized }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
