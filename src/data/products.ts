import type { Object3D } from "three";

export interface Product {
  id: string;
  name: string;
  ref: string;
  glbUrl: string;
  description: string;
  /** A CAD file in `public/`, decoded in the browser through the upload path. */
  sourceUrl?: string;
  /** In-memory scene for user-uploaded pieces (.3dm / .glb). */
  object?: Object3D;
}

/*
 * The opening piece, built from the client's own `03.3dm`.
 *
 * Shipped as a Draco GLB rather than decoded in the browser, and that is not a
 * shortcut. Decoding a 6 MB Rhino document on every page load holds a large
 * WASM heap while it runs, and on a RELOAD that overlaps with the previous
 * page's GPU memory before the browser has released it — measured here, a
 * cold load was fine and the next three reloads all died with
 * "THREE.WebGLRenderer: Context Lost" and a white screen. The same test
 * against a GLB passed four times out of four.
 *
 * Nothing is lost by converting. `scripts/convert-3dm.mjs` runs the SAME
 * worker source the browser uses for an upload, so the shipped asset and a
 * file someone drags in cannot disagree — and the real `.3dm` path is still
 * exercised by every upload, which is where it matters.
 *
 * To rebuild after the CAD changes:
 *   npm run convert:3dm -- path/to/03.3dm public/03.glb
 */
export const products: Product[] = [
  {
    id: "03",
    name: "03",
    ref: "Ref. 03",
    glbUrl: "",
    sourceUrl: "/03.3dm",
    description: "A round brilliant solitaire on a stone-set band.",
  },
];
