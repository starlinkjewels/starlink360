import type { Object3D } from "three";
import type { ProceduralSpec } from "@/components/tryon/studioPieces";

export interface Product {
  id: string;
  name: string;
  ref: string;
  glbUrl: string;
  description: string;
  /** In-memory scene for user-uploaded pieces (.3dm / .glb). */
  object?: Object3D;
  /**
   * Built in the browser from the try-on's own jewellery builders instead of
   * loaded from a file, so the studio shows exactly the piece customers try
   * on. Takes priority over `glbUrl`.
   */
  procedural?: ProceduralSpec;
}

export const products: Product[] = [
  {
    id: "rs-001",
    name: "Classic Solitaire",
    ref: "Ref. RS 001",
    glbUrl: "",
    procedural: { category: "ring", style: "solitaire", carat: 1 },
    description:
      "A 1 ct round brilliant in a six-claw head on a comfort-fit court band, the same ring as in the virtual try-on.",
  },
];
