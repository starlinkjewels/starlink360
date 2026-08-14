/*
 * The material library.
 *
 * Two catalogues — metals and gemstones — written as plain data so they can be
 * checked without a browser, and so adding a house alloy is an edit to a table
 * rather than a change to a component.
 *
 * The numbers are not invented. Metal colours are the sRGB an alloy reflects at
 * normal incidence, and each karat sits where it actually sits: 24k is nearly
 * saturated yellow, 9k is pale because it is mostly not gold. Gem refractive
 * indices and dispersions are the published mineral values, which is what makes
 * moissanite throw more fire than diamond in the render for the same reason it
 * does on a bench — 0.104 against 0.044.
 */

export type MetalGroup = "Gold" | "White" | "Silver" | "Speciality";

export interface MetalMaterial {
  id: string;
  name: string;
  group: MetalGroup;
  /** Base reflectance colour. */
  color: string;
  /** 0 = mirror, 1 = fully diffuse. Polish level, not alloy. */
  roughness: number;
  /**
   * Real metal is 1. Below that only for coated or oxidised surfaces, where the
   * top layer is a dielectric and the metal underneath barely shows.
   */
  metalness: number;
}

/**
 * Eighteen alloys a jeweller would actually quote.
 *
 * Karat drives colour: gold is diluted with copper and silver, so 9k is a long
 * way from 24k and a client can tell at a glance. Ordered by group so the grid
 * reads down a family rather than jumping between them.
 *
 * Every polishable metal below (Gold, White, Silver) shares one roughness,
 * 0.02 — a jeweller's final finish, not a per-karat property. The spread these
 * used to carry (0.16 to 0.27) was never a real difference between alloys —
 * roughness is documented on the type itself as "polish level, not alloy" —
 * it was just never pushed as low as an actual mirror polish goes, which is
 * what a piece looks like fresh from a jeweller's buffing wheel and what read
 * as "real metal" against "CG" once it was tried. Speciality below keeps its
 * own, different values on purpose: titanium is brushed, black rhodium plates
 * with a satin sheen, and antique bronze is deliberately patinated — none of
 * the three is ever a mirror in real life, so defaulting them to one would be
 * wrong in the other direction.
 */
export const METALS: MetalMaterial[] = [
  {
    id: "gold-24k",
    name: "24k Yellow Gold",
    group: "Gold",
    color: "#ffd75e",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "gold-22k",
    name: "22k Yellow Gold",
    group: "Gold",
    color: "#fcd070",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "gold-18k",
    name: "18k Yellow Gold",
    group: "Gold",
    color: "#f2cf76",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "gold-14k",
    name: "14k Yellow Gold",
    group: "Gold",
    color: "#eed08d",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "gold-9k",
    name: "9k Yellow Gold",
    group: "Gold",
    color: "#e6d2a6",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "rose-18k",
    name: "18k Rose Gold",
    group: "Gold",
    color: "#f0b79c",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "rose-14k",
    name: "14k Rose Gold",
    group: "Gold",
    color: "#eebda8",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "red-18k",
    name: "18k Red Gold",
    group: "Gold",
    color: "#e79c7d",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "green-18k",
    name: "18k Green Gold",
    group: "Gold",
    color: "#dcd694",
    roughness: 0.02,
    metalness: 1,
  },

  {
    id: "white-18k",
    name: "18k White Gold",
    group: "White",
    color: "#ecebe6",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "white-14k",
    name: "14k White Gold",
    group: "White",
    color: "#e8e6df",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "platinum-950",
    name: "Platinum 950",
    group: "White",
    color: "#dadbe0",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "palladium-950",
    name: "Palladium 950",
    group: "White",
    color: "#d3d4d6",
    roughness: 0.02,
    metalness: 1,
  },

  {
    id: "silver-925",
    name: "Sterling Silver",
    group: "Silver",
    color: "#cfd0d4",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "silver-999",
    name: "Fine Silver",
    group: "Silver",
    color: "#dcdde0",
    roughness: 0.02,
    metalness: 1,
  },

  {
    id: "titanium",
    name: "Titanium",
    group: "Speciality",
    color: "#b6b3ae",
    roughness: 0.35,
    metalness: 1,
  },
  {
    id: "black-rhodium",
    name: "Black Rhodium",
    group: "Speciality",
    color: "#2b2b2e",
    roughness: 0.3,
    // Plated, not solid: the black layer is a dielectric over metal, so a
    // pure-metal response makes it read as dark chrome rather than as plating.
    metalness: 0.85,
  },
  {
    id: "antique-bronze",
    name: "Antique Bronze",
    group: "Speciality",
    color: "#9a6f43",
    roughness: 0.45,
    metalness: 1,
  },
];

export type GemGroup = "Colourless" | "Red & Pink" | "Blue" | "Green" | "Warm" | "Purple" | "Dark";

export interface GemMaterial {
  id: string;
  name: string;
  group: GemGroup;
  /** Body colour. Absorption deepens it with path length at render time. */
  color: string;
  /** Refractive index. Diamond 2.417, quartz 1.55. */
  ior: number;
  /**
   * Dispersion — the published B-G interval. This is "fire": how far red and
   * blue separate on the way through. Moissanite's 0.104 against diamond's
   * 0.044 is why it throws visibly more colour.
   */
  dispersion: number;
  /** Opaque stones are lit rather than traced; nothing passes through onyx. */
  opaque?: boolean;
}

/** Twenty-four stones, with their real optics. */
export const GEMS: GemMaterial[] = [
  {
    id: "diamond",
    name: "Diamond",
    group: "Colourless",
    color: "#ffffff",
    ior: 2.417,
    dispersion: 0.044,
  },
  {
    id: "white-sapphire",
    name: "White Sapphire",
    group: "Colourless",
    color: "#fbfcfd",
    ior: 1.77,
    dispersion: 0.018,
  },
  {
    id: "moissanite",
    name: "Moissanite",
    group: "Colourless",
    color: "#fdfdf6",
    ior: 2.65,
    dispersion: 0.104,
  },

  { id: "ruby", name: "Ruby", group: "Red & Pink", color: "#a5182b", ior: 1.77, dispersion: 0.018 },
  {
    id: "pink-sapphire",
    name: "Pink Sapphire",
    group: "Red & Pink",
    color: "#e8799c",
    ior: 1.77,
    dispersion: 0.018,
  },
  {
    id: "rubellite",
    name: "Rubellite",
    group: "Red & Pink",
    color: "#c0325e",
    ior: 1.62,
    dispersion: 0.017,
  },
  {
    id: "morganite",
    name: "Morganite",
    group: "Red & Pink",
    color: "#efc0b6",
    ior: 1.577,
    dispersion: 0.014,
  },
  {
    id: "garnet",
    name: "Garnet",
    group: "Red & Pink",
    color: "#7b2233",
    ior: 1.79,
    dispersion: 0.024,
  },
  {
    id: "rhodolite",
    name: "Rhodolite",
    group: "Red & Pink",
    color: "#9c2f5a",
    ior: 1.76,
    dispersion: 0.026,
  },

  {
    id: "blue-sapphire",
    name: "Blue Sapphire",
    group: "Blue",
    color: "#12409b",
    ior: 1.77,
    dispersion: 0.018,
  },
  {
    id: "aquamarine",
    name: "Aquamarine",
    group: "Blue",
    color: "#a2d8e2",
    ior: 1.577,
    dispersion: 0.014,
  },
  {
    id: "tanzanite",
    name: "Tanzanite",
    group: "Blue",
    color: "#4b5ec4",
    ior: 1.69,
    dispersion: 0.021,
  },
  {
    id: "london-topaz",
    name: "London Blue Topaz",
    group: "Blue",
    color: "#2e6982",
    ior: 1.62,
    dispersion: 0.014,
  },
  {
    id: "sky-topaz",
    name: "Sky Blue Topaz",
    group: "Blue",
    color: "#9fd4e8",
    ior: 1.62,
    dispersion: 0.014,
  },

  {
    id: "emerald",
    name: "Emerald",
    group: "Green",
    color: "#0d7a45",
    ior: 1.577,
    dispersion: 0.014,
  },
  {
    id: "tsavorite",
    name: "Tsavorite",
    group: "Green",
    color: "#1e8f4e",
    ior: 1.74,
    dispersion: 0.028,
  },
  { id: "peridot", name: "Peridot", group: "Green", color: "#adc523", ior: 1.65, dispersion: 0.02 },
  {
    id: "green-tourmaline",
    name: "Green Tourmaline",
    group: "Green",
    color: "#3f8a63",
    ior: 1.62,
    dispersion: 0.017,
  },

  { id: "citrine", name: "Citrine", group: "Warm", color: "#e6c33c", ior: 1.55, dispersion: 0.013 },
  {
    id: "yellow-sapphire",
    name: "Yellow Sapphire",
    group: "Warm",
    color: "#e8c65a",
    ior: 1.77,
    dispersion: 0.018,
  },
  {
    id: "spessartite",
    name: "Spessartite",
    group: "Warm",
    color: "#e0691f",
    ior: 1.81,
    dispersion: 0.027,
  },

  {
    id: "amethyst",
    name: "Amethyst",
    group: "Purple",
    color: "#8f5cc0",
    ior: 1.55,
    dispersion: 0.013,
  },

  {
    id: "black-diamond",
    name: "Black Diamond",
    group: "Dark",
    color: "#26262b",
    ior: 2.417,
    dispersion: 0.044,
  },
  {
    id: "onyx",
    name: "Black Onyx",
    group: "Dark",
    color: "#141419",
    ior: 1.53,
    dispersion: 0.013,
    opaque: true,
  },
];

/**
 * What the user changed by hand, on top of a library entry.
 *
 * Kept as a sparse patch rather than a full material so "custom" always means
 * "this library stone, with these bits moved" — the name still shows, and
 * clearing one field returns it to the catalogue value rather than to a default.
 */
export interface MaterialPatch {
  color?: string;
  roughness?: number;
  metalness?: number;
  ior?: number;
  /** Gems only. 0 is a solid stone, 1 is fully see-through. */
  transmission?: number;
  /**
   * Gems only. Overrides the dispersion-derived default from `aberrationFor` —
   * the rainbow flash a stone throws, not how bright it is. Diamond's fire is
   * real but genuinely subtle at 0.035; a jeweller wanting a stone to look
   * more alive reaches for this, the same way Smoothness is metal's version
   * of "make it look like a real photograph" rather than "make it a fantasy."
   */
  aberration?: number;
}

export const METAL_BY_ID = new Map(METALS.map((m) => [m.id, m]));
export const GEM_BY_ID = new Map(GEMS.map((g) => [g.id, g]));

export function metalById(id: string | undefined): MetalMaterial | undefined {
  return id ? METAL_BY_ID.get(id) : undefined;
}

export function gemById(id: string | undefined): GemMaterial | undefined {
  return id ? GEM_BY_ID.get(id) : undefined;
}

/** Catalogue order, grouped, for a panel that lists families rather than a flat wall. */
export function metalGroups(): { group: MetalGroup; items: MetalMaterial[] }[] {
  return groupBy(METALS, (m) => m.group);
}

export function gemGroups(): { group: GemGroup; items: GemMaterial[] }[] {
  return groupBy(GEMS, (g) => g.group);
}

function groupBy<T, K extends string>(items: T[], key: (t: T) => K): { group: K; items: T[] }[] {
  const out: { group: K; items: T[] }[] = [];
  for (const item of items) {
    const k = key(item);
    const bucket = out.find((b) => b.group === k);
    if (bucket) bucket.items.push(item);
    else out.push({ group: k, items: [item] });
  }
  return out;
}

/*
 * Dispersion is a physical constant; the shader's aberration is a look control.
 * Diamond is the anchor — its 0.044 has always rendered at 0.035 here and that
 * is the image everyone has already signed off — so every other stone is scaled
 * against it rather than tuned by eye.
 */
const DIAMOND_DISPERSION = 0.044;
const DIAMOND_ABERRATION = 0.035;

/**
 * Floor keeps a low-dispersion stone from going glassy-dead; the ceiling
 * stops moissanite's real 0.104 from tearing into rainbow fringing. This is a
 * property of the shader at any input, not just of a catalogue lookup, so a
 * hand-set Fire patch is clamped to the same range rather than a wider one.
 */
const ABERRATION_FLOOR = 0.008;
const ABERRATION_CEILING = 0.09;

export function aberrationFor(dispersion: number): number {
  const scaled = (dispersion / DIAMOND_DISPERSION) * DIAMOND_ABERRATION;
  return clamp(scaled, ABERRATION_FLOOR, ABERRATION_CEILING);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** A library gem with the user's edits folded in, ready for the shader. */
export function resolveGem(
  gem: GemMaterial,
  patch?: MaterialPatch,
): { color: string; ior: number; aberration: number; transmission: number } {
  return {
    color: patch?.color ?? gem.color,
    // An opaque stone starts solid; anything else starts fully transmissive.
    // The patch is what lets a jeweller take a stone the other way.
    transmission: clamp(patch?.transmission ?? (gem.opaque ? 0 : 1), 0, 1),
    // Below 1 light bends the wrong way and the stone inverts; 3 is past
    // anything that occurs in nature and already looks like an error.
    ior: clamp(patch?.ior ?? gem.ior, 1, 3),
    aberration:
      patch?.aberration !== undefined
        ? clamp(patch.aberration, ABERRATION_FLOOR, ABERRATION_CEILING)
        : aberrationFor(gem.dispersion),
  };
}

/** A library metal with the user's edits folded in. */
export function resolveMetal(
  metal: MetalMaterial,
  patch?: MaterialPatch,
): { color: string; roughness: number; metalness: number } {
  return {
    color: patch?.color ?? metal.color,
    roughness: clamp(patch?.roughness ?? metal.roughness, 0, 1),
    metalness: clamp(patch?.metalness ?? metal.metalness, 0, 1),
  };
}
