/*
 * What can be tried on, and which tracker each piece needs.
 *
 * Hand pieces ride on the MediaPipe Hand Landmarker, earrings on the Face
 * Landmarker, necklaces on the Pose Landmarker (shoulders). Only the tracker
 * for the current category runs, so switching from rings to necklaces costs
 * one model download, once.
 */

export type Category = "ring" | "bracelet" | "bangle" | "earrings" | "necklace";
export type TrackerKind = "hand" | "face" | "pose";

export interface StoneRange {
  /** What the number means for this style. */
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface StyleDef {
  id: string;
  name: string;
  blurb: string;
  /** Absent for pieces with no stones. */
  stone?: StoneRange;
}

export interface CategoryDef {
  id: Category;
  name: string;
  tracker: TrackerKind;
  /** Shown until the body part is found. */
  prompt: string;
  styles: StyleDef[];
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: "ring",
    name: "Rings",
    tracker: "hand",
    prompt: "Hold up your hand, back toward the camera, fingers relaxed",
    styles: [
      {
        id: "solitaire",
        name: "Solitaire",
        blurb: "Six-claw round brilliant on a comfort-fit court band",
        stone: { label: "Centre stone", min: 0.3, max: 3, step: 0.05, value: 1 },
      },
      {
        id: "halo",
        name: "Halo Pavé",
        blurb: "Centre stone framed by a halo, pavé down both shoulders",
        stone: { label: "Centre stone", min: 0.3, max: 2.5, step: 0.05, value: 0.8 },
      },
      {
        id: "eternity",
        name: "Eternity",
        blurb: "Brilliants set all the way around the band",
        stone: { label: "Each stone", min: 0.03, max: 0.25, step: 0.01, value: 0.08 },
      },
    ],
  },
  {
    id: "bracelet",
    name: "Bracelets",
    tracker: "hand",
    prompt: "Show your wrist and hand to the camera",
    styles: [
      {
        id: "tennis",
        name: "Tennis",
        blurb: "Four-claw line bracelet, every link a brilliant",
        stone: { label: "Each stone", min: 0.05, max: 0.3, step: 0.01, value: 0.1 },
      },
      {
        id: "bezel",
        name: "Bezel Line",
        blurb: "Rub-over set brilliants in polished collets",
        stone: { label: "Each stone", min: 0.05, max: 0.3, step: 0.01, value: 0.12 },
      },
    ],
  },
  {
    id: "bangle",
    name: "Bangles",
    tracker: "hand",
    prompt: "Show your wrist and hand to the camera",
    styles: [
      {
        id: "line",
        name: "Diamond Line",
        blurb: "Channel-set brilliants across the front of the bangle",
        stone: { label: "Each stone", min: 0.03, max: 0.15, step: 0.01, value: 0.07 },
      },
      {
        id: "eternity",
        name: "Eternity Bangle",
        blurb: "Channel-set all the way round",
        stone: { label: "Each stone", min: 0.03, max: 0.15, step: 0.01, value: 0.06 },
      },
      { id: "classic", name: "Classic Kada", blurb: "Heavy polished bangle with engraved lines" },
    ],
  },
  {
    id: "earrings",
    name: "Earrings",
    tracker: "face",
    prompt: "Face the camera, tuck your hair behind your ears",
    styles: [
      {
        id: "stud",
        name: "Solitaire Studs",
        blurb: "Six-claw studs, a matched pair",
        stone: { label: "Each stud", min: 0.1, max: 2, step: 0.05, value: 0.5 },
      },
      {
        id: "drop",
        name: "Halo Drops",
        blurb: "Halo drops that swing as you move",
        stone: { label: "Drop stone", min: 0.25, max: 2, step: 0.05, value: 0.7 },
      },
      {
        id: "hoop",
        name: "Diamond Huggies",
        blurb: "Small hoops set along the front",
        stone: { label: "Each stone", min: 0.03, max: 0.12, step: 0.01, value: 0.06 },
      },
    ],
  },
  {
    id: "necklace",
    name: "Necklaces",
    tracker: "pose",
    prompt: "Step back until your shoulders are in view",
    styles: [
      {
        id: "solitaire",
        name: "Solitaire Pendant",
        blurb: "A single brilliant on a fine cable chain",
        stone: { label: "Pendant stone", min: 0.25, max: 4, step: 0.05, value: 1 },
      },
      {
        id: "halo",
        name: "Halo Pendant",
        blurb: "Pendant framed by a diamond halo",
        stone: { label: "Pendant stone", min: 0.25, max: 3, step: 0.05, value: 0.8 },
      },
      {
        id: "riviere",
        name: "Rivière",
        blurb: "Graduated line of brilliants around the neck",
        stone: { label: "Largest stone", min: 0.1, max: 0.8, step: 0.01, value: 0.3 },
      },
    ],
  },
];

export const categoryById = (id: Category): CategoryDef =>
  CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];

export function styleById(category: Category, id: string): StyleDef {
  const c = categoryById(category);
  return c.styles.find((s) => s.id === id) ?? c.styles[0];
}

/** Stones offered for the feature stone; accents stay colourless diamond. */
export const TRYON_GEMS = [
  "diamond",
  "moissanite",
  "ruby",
  "blue-sapphire",
  "emerald",
  "pink-sapphire",
  "black-diamond",
];

/** Metals offered, from the studio's material library. */
export const TRYON_METALS = ["gold-18k", "rose-18k", "white-18k", "platinum-950", "gold-22k"];
