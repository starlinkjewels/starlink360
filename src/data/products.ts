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
    id: "lp-043",
    name: "Lumière Pendant",
    ref: "Ref. LP 043",
    glbUrl: "/LP043.glb?v=4",
    description: "A flat brilliant-set pendant, hand-finished and set with a single round stone.",
  },
];
