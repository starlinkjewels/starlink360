import type * as THREE from "three";

// Lives in the loader because the decoder path must not import component code:
// the ingest suite compiles that path standalone, without tsconfig aliases.
export { stoneLabel } from "@/lib/loadJewelryFile";

/*
 * A selectable set of stones.
 *
 * "Select a diamond and set its colour" needs a definition of one diamond, and
 * the honest answer in a jewellery file is: a set. A pave field is two hundred
 * separate solids, and giving each its own mesh would mean two hundred draw
 * calls, two hundred BVHs and two hundred shader programs on a phone. Nobody
 * recolours one stone out of a pave field anyway — they recolour the pave.
 *
 * So the unit is the group the jeweller already made: stones sharing a colour
 * on one Rhino layer. "Gem 01" is the centre stone, "Gem 02" the melee, and
 * those are exactly the things a client asks to see in ruby instead.
 */

export interface StoneGroup {
  /** Stable across reloads of the same piece — used as a React key and a map key. */
  id: string;
  /** What the picker shows: "Gem 01", "Pink Sapphire". */
  label: string;
  /** The colour the file itself specified, so "reset" has something to return to. */
  originalHex: string;
  /** The mesh carrying these stones. */
  mesh: THREE.Mesh;
}

/** Colours a jeweller actually orders, for one-tap selection. */
export const STONE_PRESETS: { id: string; label: string; hex: string }[] = [
  { id: "diamond", label: "Diamond", hex: "#ffffff" },
  { id: "ruby", label: "Ruby", hex: "#a5182b" },
  { id: "sapphire", label: "Blue Sapphire", hex: "#12409b" },
  { id: "pink-sapphire", label: "Pink Sapphire", hex: "#efa0bd" },
  { id: "emerald", label: "Emerald", hex: "#0d7a45" },
  { id: "amethyst", label: "Amethyst", hex: "#8f5cc0" },
  { id: "citrine", label: "Citrine", hex: "#e6c33c" },
  { id: "aquamarine", label: "Aquamarine", hex: "#77c6d8" },
  { id: "tanzanite", label: "Tanzanite", hex: "#4b5ec4" },
  { id: "peridot", label: "Peridot", hex: "#adc523" },
  { id: "garnet", label: "Garnet", hex: "#7b2233" },
  { id: "morganite", label: "Morganite", hex: "#efa0bd" },
  { id: "onyx", label: "Black Onyx", hex: "#141419" },
];

/** Reads the groups back off a built scene, in the order they were added. */
export function collectStoneGroups(root: THREE.Object3D): StoneGroup[] {
  const groups: StoneGroup[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const info = mesh.userData?.stone as { id: string; label: string; hex: string } | undefined;
    if (mesh.isMesh && info) {
      groups.push({ id: info.id, label: info.label, originalHex: info.hex, mesh });
    }
  });
  return groups;
}
