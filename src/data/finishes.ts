export interface Finish {
  id: string;
  name: string;
  color: string;
  roughness: number;
}

/*
 * Metal colours are F0 — the specular reflectance of the real alloy at normal
 * incidence — measured values converted to the sRGB three expects.
 *
 * The previous palette was hand-picked and read as painted yellow rather than
 * metal: its gold sat at linear (0.888, 0.624, 0.181) against a true 18k
 * (1.000, 0.782, 0.409). A blue channel 2.3x too low is what made it look like
 * a saturated cartoon yellow, and the whole set ran dark — silver in particular
 * was grey (0.624 linear) where real silver is 0.972.
 *
 * Correct values look paler in isolation. That is expected: polished metal is
 * almost entirely a reflection of its surroundings, so the richness comes from
 * a high-contrast studio environment, not from over-saturating the base colour.
 * These are tuned together with the Environment preset and envMapIntensity in
 * Viewer.tsx — changing one without the others will look wrong.
 *
 * Roughness is a polished jewellery finish (0.08-0.14). The old 0.18-0.26 is
 * closer to satin and blurred away the crisp reflections that read as metal.
 */
export const finishes: Finish[] = [
  { id: "yellow-gold", name: "Yellow Gold", color: "#ffe5ab", roughness: 0.13 },
  { id: "rose-gold", name: "Rose Gold", color: "#fddac2", roughness: 0.14 },
  { id: "white-gold", name: "White Gold", color: "#f4f2ef", roughness: 0.1 },
  { id: "platinum", name: "Platinum", color: "#d7d2ca", roughness: 0.12 },
  { id: "silver", name: "Silver", color: "#fcfaf5", roughness: 0.08 },
];
