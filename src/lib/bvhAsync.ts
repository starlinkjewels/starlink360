import * as THREE from "three";
import { MeshBVH, type MeshBVHOptions, type SerializedBVH } from "three-mesh-bvh";
import type { BvhRequest } from "./bvh.worker";

/*
 * Building a BVH without freezing the page.
 *
 * Two of the viewer's load-time freezes were BVH builds on the main thread,
 * measured on a desktop with LP043:
 *
 *  - the picking tree for the 970k-vertex metal mesh, about 1 s, built on
 *    load whether or not anyone ever clicks the piece;
 *  - the diamonds' tracing tree (SAH, the slow, high-quality split), about
 *    250 ms, and built twice.
 *
 * On a phone each is several times longer, and nothing on the page answers
 * while it runs. Here the build happens in a worker on a copy of the
 * geometry, and only the finished tree comes back. The copy costs memory for
 * a moment (twelve bytes a vertex) and keeps the page's own buffers intact.
 *
 * Falls back to an ordinary build where there is no Worker (the Node test
 * suites, server rendering) or if the worker fails to start, so callers never
 * have to care which happened.
 */

type Pending = {
  resolve: (s: SerializedBVH) => void;
  reject: (e: Error) => void;
};

let worker: Worker | null | undefined;
const pending = new Map<number, Pending>();
let nextId = 1;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === "undefined") return (worker = null);
  try {
    worker = new Worker(new URL("./bvh.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return (worker = null);
  }
  worker.onmessage = (
    e: MessageEvent<{ id: number; serialized?: SerializedBVH; error?: string }>,
  ) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    pending.delete(e.data.id);
    if (e.data.serialized) job.resolve(e.data.serialized);
    else job.reject(new Error(e.data.error ?? "BVH worker failed"));
  };
  worker.onerror = (e) => {
    // A worker that cannot start fails every job; stop using it.
    e.preventDefault();
    worker?.terminate();
    worker = null;
    for (const job of pending.values()) job.reject(new Error("BVH worker failed to start"));
    pending.clear();
  };
  return worker;
}

export interface BuildOptions extends MeshBVHOptions {
  /**
   * Keep the geometry's index order and track the tree's order separately.
   * Required for picking: selection addresses solids as ranges of the index
   * buffer, and an ordinary build reorders it (pickBvh.ts explains).
   */
  indirect?: boolean;
}

/**
 * A MeshBVH for `geometry`, built off the main thread when possible.
 *
 * For a non-indirect build the tree's triangle order is written into the
 * geometry's index once it arrives, exactly as a main-thread build would
 * leave it; only use that on geometry made for the purpose.
 */
export async function buildBVH(
  geometry: THREE.BufferGeometry,
  options: BuildOptions = {},
): Promise<MeshBVH> {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const interleaved =
    (position as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ||
    (index as unknown as THREE.InterleavedBufferAttribute | null)?.isInterleavedBufferAttribute;
  const w = interleaved ? null : getWorker();
  if (!w || !(position.array instanceof Float32Array)) {
    return new MeshBVH(geometry, options);
  }

  const request: BvhRequest = {
    id: nextId++,
    position: position.array.slice(),
    index: index ? (index.array as Uint16Array | Uint32Array).slice() : null,
    options,
  };

  let serialized: SerializedBVH;
  try {
    serialized = await new Promise<SerializedBVH>((resolve, reject) => {
      pending.set(request.id, { resolve, reject });
      const transfer: Transferable[] = [request.position.buffer];
      if (request.index) transfer.push(request.index.buffer);
      w.postMessage(request, transfer);
    });
  } catch {
    return new MeshBVH(geometry, options);
  }

  /*
   * An indirect build leaves the index as it was, so nothing is written back.
   * An ordinary build reorders it, and the tree is only valid against that
   * order, so it is copied in (or created, for geometry that had none).
   */
  return MeshBVH.deserialize(serialized, geometry, { setIndex: !options.indirect });
}
