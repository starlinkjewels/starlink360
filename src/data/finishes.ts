/*
 * Relative, with the ".js", rather than the "@/" alias. tsc does not rewrite
 * path aliases in its output, so a module the Node suites compile has to say
 * where it is going in terms Node can follow — and Vite reads this spelling
 * just as happily.
 */
import { METALS, metalById } from "../components/jewelry/library.js";

/*
 * The metal a piece wears before anything is assigned to a part.
 *
 * This used to be its own list of five, written before the material library
 * existed — and it kept its own ids ("yellow-gold") while the library used
 * others ("gold-18k") for the same five metals with, deliberately, the same
 * colours. Two vocabularies for one thing, and the consequence was visible:
 * opening Materials on a yellow-gold piece lit no swatch at all, because the
 * panel had never heard of the id the piece was actually wearing.
 *
 * So the quick picks are now DERIVED from the library. One vocabulary, one set
 * of numbers, and the grid lights up the metal the piece is really in.
 */

export interface Finish {
  /** Surface texture id from textures.ts. Absent means polished. */
  surface?: string;
  id: string;
  name: string;
  color: string;
  roughness: number;
}

/** The five a jeweller reaches for first, in the order they are asked for. */
const QUICK_PICKS = ["gold-18k", "rose-18k", "white-18k", "platinum-950", "silver-925"];

function toFinish(id: string): Finish {
  // Falls back to the first library metal rather than throwing: a typo here
  // should cost a wrong swatch, not a blank app.
  const m = metalById(id) ?? METALS[0];
  return { id: m.id, name: m.name, color: m.color, roughness: m.roughness };
}

export const finishes: Finish[] = QUICK_PICKS.map(toFinish);

/**
 * Ids the old list used, for anything that stored one.
 *
 * A project saved before the two lists were merged carries "yellow-gold", and
 * dropping it would silently reset that project's metal to the first quick
 * pick. Cheap to keep, and the day it can go is the day nobody has an old file.
 */
const LEGACY_IDS: Record<string, string> = {
  "yellow-gold": "gold-18k",
  "rose-gold": "rose-18k",
  "white-gold": "white-18k",
  platinum: "platinum-950",
  silver: "silver-925",
};

/** Resolves any id — current, legacy, or a full library id — to a finish. */
export function finishById(id: string | undefined): Finish | undefined {
  if (!id) return undefined;
  const resolved = LEGACY_IDS[id] ?? id;
  const m = metalById(resolved);
  return m ? { id: m.id, name: m.name, color: m.color, roughness: m.roughness } : undefined;
}
