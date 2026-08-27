import type { Object3D } from "three";

export interface Product {
  id: string;
  name: string;
  ref: string;
  glbUrl: string;
  description: string;
  /** In-memory scene for user-uploaded pieces (.3dm / .glb). */
  object?: Object3D;
}

export const products: Product[] = [
  {
    id: "sdag-076",
    name: "SDAG076",
    ref: "Ref. SDAG076",
    glbUrl: "/SDAG076.glb",
    description: "A pavé-set piece, hand-finished with round brilliant stones.",
  },
];
