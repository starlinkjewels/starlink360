/*
 * Metal HDR & Material Selection.
 *
 * i3D's own gallery turned out, once its hover tooltips were actually read
 * ("Metal copper 4", "2 metal silver polished"), to be neither a new alloy
 * catalogue nor a new environment system — it is a curated list of
 * (alloy, finish) PAIRS, previewed under one shared studio setup and applied
 * as both at once. That is exactly what this file is: a thin convenience
 * layer over the two catalogues that already exist (`METALS` in library.ts,
 * `SURFACE_FINISHES` in textures.ts). Picking a preset here does not create a
 * third material system — it writes into the exact same `assignments` and
 * `textures` maps a manual pick of alloy-then-finish would.
 *
 * The list below is hand-curated rather than a full cross product of every
 * alloy against every finish (18 × 12 = 216 combinations nobody would
 * meaningfully browse). Each entry pairs a metal with a finish a jeweller
 * would actually put on it — titanium brushed, not titanium mirror-polished.
 */
import { METALS, metalById, type MetalMaterial } from "./library";
import { SURFACE_FINISHES, type FinishTexture } from "./textures";

export interface MetalPreset {
  id: string;
  name: string;
  metalId: string;
  finishId: string;
}

export const METAL_PRESETS: MetalPreset[] = [
  { id: "gold-18k-polished", name: "Yellow Gold Polished", metalId: "gold-18k", finishId: "none" },
  {
    id: "gold-18k-hammered",
    name: "Yellow Gold Hammered",
    metalId: "gold-18k",
    finishId: "hammer2",
  },
  {
    id: "gold-18k-florentine",
    name: "Yellow Gold Florentine",
    metalId: "gold-18k",
    finishId: "florentine",
  },
  { id: "rose-18k-polished", name: "Rose Gold Polished", metalId: "rose-18k", finishId: "none" },
  {
    id: "rose-18k-hammered",
    name: "Rose Gold Hammered",
    metalId: "rose-18k",
    finishId: "hammer2",
  },
  {
    id: "white-18k-polished",
    name: "White Gold Polished",
    metalId: "white-18k",
    finishId: "none",
  },
  {
    id: "white-18k-brushed",
    name: "White Gold Brushed",
    metalId: "white-18k",
    finishId: "brushed",
  },
  {
    id: "platinum-polished",
    name: "Platinum Polished",
    metalId: "platinum-950",
    finishId: "none",
  },
  {
    id: "platinum-brushed",
    name: "Platinum Brushed",
    metalId: "platinum-950",
    finishId: "brushed",
  },
  { id: "silver-polished", name: "Silver Polished", metalId: "silver-925", finishId: "none" },
  { id: "silver-brushed", name: "Silver Brushed", metalId: "silver-925", finishId: "brushed" },
  { id: "silver-hammered", name: "Silver Hammered", metalId: "silver-925", finishId: "hammer" },
  /*
   * The catalogue has no plain elemental "copper" — real jewellery alloys in
   * that colour range are red/rose gold or bronze, so antique bronze stands
   * in for "Copper" here rather than inventing a metal the catalogue does
   * not have.
   */
  {
    id: "copper-hammered",
    name: "Copper (Antique Bronze) Hammered",
    metalId: "antique-bronze",
    finishId: "hammer3",
  },
  { id: "titanium-brushed", name: "Titanium Brushed", metalId: "titanium", finishId: "brushed" },
  {
    id: "black-rhodium-sandblast",
    name: "Black Rhodium Sandblast",
    metalId: "black-rhodium",
    finishId: "noise",
  },
];

export function metalPresetById(id: string | undefined): MetalPreset | undefined {
  return id ? METAL_PRESETS.find((p) => p.id === id) : undefined;
}

/** Resolves a preset's two halves back into real catalogue entries, or null
 *  if either id has gone stale (a catalogue entry renamed or removed). */
export function resolveMetalPreset(
  preset: MetalPreset,
): { metal: MetalMaterial; finish: FinishTexture } | null {
  const metal = metalById(preset.metalId);
  const finish = SURFACE_FINISHES.find((f) => f.id === preset.finishId);
  if (!metal || !finish) return null;
  return { metal, finish };
}

/** Every alloy id and finish id referenced by a preset really exists in the
 *  two catalogues — checked once, at module load, rather than per click. */
export function validateMetalPresets(): string[] {
  const problems: string[] = [];
  for (const p of METAL_PRESETS) {
    if (!METALS.some((m) => m.id === p.metalId))
      problems.push(`${p.id}: unknown metal ${p.metalId}`);
    if (!SURFACE_FINISHES.some((f) => f.id === p.finishId))
      problems.push(`${p.id}: unknown finish ${p.finishId}`);
  }
  return problems;
}
