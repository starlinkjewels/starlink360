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

/*
 * Split the way a jeweller's own picker is split — Yellow, White and Rose as
 * three separate families a client chooses between, not one "Gold" bucket
 * that happens to contain all three. Platinum gets its own group rather than
 * folding into White: it is a different metal, not a colour of gold, and a
 * buyer choosing "Platinum" is making a different decision than one choosing
 * "White Gold" even though the two can render similarly pale.
 */
export type MetalGroup =
  "Yellow Gold" | "Rose Gold" | "White Gold" | "Platinum" | "Silver" | "Speciality";

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
    group: "Yellow Gold",
    color: "#ffd75e",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "gold-22k",
    name: "22k Yellow Gold",
    group: "Yellow Gold",
    color: "#fcd070",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "gold-18k",
    name: "18k Yellow Gold",
    group: "Yellow Gold",
    color: "#f2cf76",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "gold-14k",
    name: "14k Yellow Gold",
    group: "Yellow Gold",
    color: "#eed08d",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "gold-9k",
    name: "9k Yellow Gold",
    group: "Yellow Gold",
    color: "#e6d2a6",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "rose-18k",
    name: "18k Rose Gold",
    group: "Rose Gold",
    color: "#f0b79c",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "rose-14k",
    name: "14k Rose Gold",
    group: "Rose Gold",
    color: "#eebda8",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "red-18k",
    name: "18k Red Gold",
    group: "Rose Gold",
    color: "#e79c7d",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "green-18k",
    name: "18k Green Gold",
    group: "Speciality",
    color: "#dcd694",
    roughness: 0.02,
    metalness: 1,
  },

  {
    id: "white-18k",
    name: "18k White Gold",
    group: "White Gold",
    color: "#ecebe6",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "white-14k",
    name: "14k White Gold",
    group: "White Gold",
    color: "#e8e6df",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "platinum-950",
    name: "Platinum 950",
    group: "Platinum",
    color: "#dadbe0",
    roughness: 0.02,
    metalness: 1,
  },
  {
    id: "palladium-950",
    name: "Palladium 950",
    group: "Platinum",
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

export type GemGroup =
  "Colourless" | "Red & Pink" | "Blue" | "Green" | "Warm" | "Purple" | "Dark" | "Pearl";

export interface GemMaterial {
  id: string;
  name: string;
  group: GemGroup;
  /** Body colour. Absorption deepens it with path length at render time. */
  color: string;
  /** Refractive index. Diamond 2.417, quartz 1.55. Nacre (pearl) 1.53. */
  ior: number;
  /**
   * Dispersion — the published B-G interval. This is "fire": how far red and
   * blue separate on the way through. Moissanite's 0.104 against diamond's
   * 0.044 is why it throws visibly more colour. Zero for a pearl: nacre does
   * not throw fire, its optics are entirely surface lustre.
   */
  dispersion: number;
  /** Opaque stones are lit rather than traced; nothing passes through onyx. */
  opaque?: boolean;
  /*
   * ── Opaque-only appearance ───────────────────────────────────────────────
   * Read solely by GemRefraction's `transmission < 0.5` branch. Undefined
   * means "use that branch's own hardcoded default", which is exactly the
   * onyx/black-diamond values it always used — so adding these fields changes
   * nothing for a gem that does not set them. Pearl is the one catalogue
   * entry that does, because a pearl's whole appearance IS this branch: it is
   * never traced, its colour comes from a lustrous coated surface.
   */
  /** Luster, in `MeshPhysicalMaterial` terms. A pearl is not a metal, but a
   *  nacre coating catches an environment the same way a satin metal does. */
  metalness?: number;
  roughness?: number;
  /** Shine — the coating's own clearcoat. */
  clearcoat?: number;
  clearcoatRoughness?: number;
  envMapIntensity?: number;
  /** Dielectric reflectance at normal incidence. Three's own default is 0.5. */
  reflectivity?: number;
}

/** Twenty-nine stones, with their real optics — twenty-four traced gems plus five pearl colours. */
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

  /*
   * Five pearl colours, matching i3D's own reference set — a jeweller's usual
   * spread from Akoya white through to Tahitian black. Luster/Roughness/
   * Clearcoat below are i3D's own observed defaults for the family (0.85,
   * 0.10, 1.00); Environment Intensity is kept closer to this renderer's own
   * tuned onyx default (1.6) rather than i3D's 3.5, since that number was
   * read off a different tone-mapping pipeline — the custom editor's own
   * range still reaches 3.5 for anyone who wants that punchier look.
   */
  {
    id: "pearl-white",
    name: "White Pearl",
    group: "Pearl",
    color: "#f5f1e6",
    ior: 1.53,
    dispersion: 0,
    opaque: true,
    metalness: 0.85,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.8,
  },
  {
    id: "pearl-cream",
    name: "Cream Pearl",
    group: "Pearl",
    color: "#ece0c4",
    ior: 1.53,
    dispersion: 0,
    opaque: true,
    metalness: 0.85,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.8,
  },
  {
    id: "pearl-pink",
    name: "Pink Pearl",
    group: "Pearl",
    color: "#eccfd2",
    ior: 1.53,
    dispersion: 0,
    opaque: true,
    metalness: 0.85,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.8,
  },
  {
    id: "pearl-grey",
    name: "Grey Pearl",
    group: "Pearl",
    color: "#9a9a9e",
    ior: 1.53,
    dispersion: 0,
    opaque: true,
    metalness: 0.85,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.8,
  },
  {
    id: "pearl-black",
    name: "Black Pearl (Tahitian)",
    group: "Pearl",
    color: "#2e2e33",
    ior: 1.53,
    dispersion: 0,
    opaque: true,
    metalness: 0.85,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.8,
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
  /**
   * Pearl (opaque gems) only — see `GemMaterial`. Shine, the coating's own
   * clearcoat, and how strongly the environment shows in it.
   */
  clearcoat?: number;
  clearcoatRoughness?: number;
  envMapIntensity?: number;
  /**
   * Transparent gems: overrides the diamond-wide Fresnel scale
   * (`diamondOptics.fresnelScale`) for this one gem, using the exact same
   * `gemFresnel` formula and the exact same shader uniform — see
   * `GemRefraction.tsx`. Opaque gems (Pearl/onyx): `MeshPhysicalMaterial`'s
   * own reflectance. Same field name, two different — but each already
   * real and connected — renderer properties, chosen by which branch a gem
   * currently renders through.
   */
  reflectivity?: number;
  /**
   * Gems only, transparent stones. Scales the path length `gemAbsorption.ts`
   * measures against, without touching that file: a factor above 1 shortens
   * the reference length so the same physical path reaches a higher
   * exponent sooner — more saturated, faster. 1 leaves the geometry-derived
   * default exactly as it always was.
   */
  absorptionFactor?: number;
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
 * Diamond is the anchor, so every other stone is scaled against it rather than
 * tuned by eye. Lowered three times now, each time against a real market
 * reference render rather than by eye alone: 0.035 read as an artificial
 * rainbow effect; 0.015 still threw visible pink/green fringe across many
 * facets once the gold wash that had been partly masking it was fixed; 0.005
 * was closer but still showed a visible multicolour sprinkle spread across
 * many small facets once bounces (see `diamondOptics.ts`) was separately
 * lowered and the facets themselves got larger and easier to read
 * individually. 0.002 removes that sprinkle down to the faint cool/blue tint
 * the reference itself shows in one or two facets, without going fully
 * colourless — true zero was tested and rejected, since the reference is not
 * actually colourless, only restrained.
 *
 * Raised slightly to 0.003 in one pass (a competitor reference showed more
 * visible multi-hued fire than this stone had) and reverted back to 0.002
 * in the very next one, once a separate "foggy, lacks clarity/purity"
 * complaint arrived: more dispersion means the R/G/B rays diverge more at
 * EVERY facet edge, not just deliberate "fire" spots, which softens the
 * clean white boundary a crisp facet edge needs — in tension with
 * "purity" in the literal, colourless sense. Checked directly: reverting
 * this alone barely changed the diamond visually (the real fogginess fix
 * was `feather`/`buildStudioArray`'s count, in `lighting.ts`), so 0.002
 * was kept as the safer default rather than paying a clarity cost for a
 * fire increase that wasn't the actual lever.
 *
 * Raised again, this time to 0.004, once the fogginess fix above was
 * shipped and a SEPARATE complaint arrived: the diamond's real fire was
 * technically present (matched a pixel-level colour-spread scan) but
 * imperceptible in practice — scattered as thin, single-pixel-wide specks
 * rather than the reference's visibly larger colour patches. Traced this
 * to an interaction with `lighting.ts`'s own recent changes: with panels
 * now dense (150+, via `buildStudioArray`) and each one's edge sharpened
 * (`feather` lowered for the fogginess fix), the "sensitive zone" where a
 * tiny per-channel IOR difference crosses a panel boundary got narrower —
 * so fire persisted but shrank to threads. `aberrationStrength` controls
 * how far the R/G/B rays actually diverge, independent of edge sharpness,
 * so widening it (not the now-correctly-tuned feather) is what widens
 * each fire patch back out. Checked directly in the running app at both
 * camera angles: reads as genuine, visible pink/magenta/green colour
 * patches, not a rainbow sprinkle — comparable in restraint to 0.003's
 * own earlier visual check, one step further. Colour-spread prevalence
 * moved proportionately (>20/255: 3.02% -> 4.82%; >40/255: 2.04% -> 2.71%;
 * >80/255: 1.46% -> 1.56%, the extreme end barely moved), consistent with
 * patches widening rather than new extreme outliers appearing. Gold/pave
 * pixel-identical.
 *
 * Halved back to 0.002 on direct user feedback: the diamond had picked up
 * enough other real improvements by this point (the gray-dominant
 * rebalance in `diamondOptics.ts`, denser panels) that 0.004's fire read
 * as too much specifically when rotating the piece — checked directly,
 * colour-spread prevalence dropped roughly in half at every threshold
 * (>20/255: 11.06% -> 5.85%) while remaining visibly present, not
 * eliminated, at both camera angles.
 *
 * Still visibly too much at 0.002, though — the user reported no
 * perceptible change, and looking again at a second camera angle
 * (specifically, not just the aggregate whole-stone stat) found why: a
 * large, obvious multi-colour band across several facets, not a scatter
 * of small specks the averaged colour-spread number was diluting. Traced
 * to the SAME-turn `buildStudioArray` "standout" sparkle boost (see that
 * function's own doc in `lighting.ts`) — a bigger brightness jump at a
 * panel's edge produces a bigger dispersion band there even at a lower
 * aberration setting, since fire severity depends on the brightness
 * DELTA at a boundary, not the dispersion constant alone. Halved again,
 * intending 0.001: the large band shrank to a small hint at that same
 * angle, checked directly, not inferred from the stat, and confirmed
 * clean across a full rotation sweep (8 angles). Gold/pave
 * pixel-identical.
 *
 * Nearly mis-set to 0.0015 here: `aberrationFor()` clamps its OWN return
 * value to a floor of 0.0015 (`ABERRATION_FLOOR`), which briefly looked
 * like it applied to this constant too. It does not, for the one stone
 * this whole investigation was about — `GemRefraction.tsx` reads this
 * constant directly as its untraced fallback (`const ABERRATION =
 * DIAMOND_ABERRATION`), never through `aberrationFor()`, so the main
 * diamond genuinely renders at 0.001, unclamped. `aberrationFor()`'s
 * floor is a separate, real guarantee for a DIFFERENT consumer — other
 * stones whose dispersion is scaled relative to this same anchor, so a
 * colourless-adjacent stone never goes all the way to dead, fireless
 * glass. Confirmed by re-capturing the actual screenshot after briefly
 * raising this constant to 0.0015 to match that floor: the large colour
 * band partially returned, proving 0.001 (not 0.0015) is what the
 * verified fix above actually depended on.
 *
 * Exported so `GemRefraction`'s untraced fallback stays anchored to the same
 * number instead of carrying its own copy that can drift out of sync.
 */
const DIAMOND_DISPERSION = 0.044;
export const DIAMOND_ABERRATION = 0.001;

/**
 * Floor keeps a low-dispersion stone from going glassy-dead; the ceiling
 * stops moissanite's real 0.104 from tearing into rainbow fringing. This is a
 * property of the shader at any input, not just of a catalogue lookup, so a
 * hand-set Fire patch is clamped to the same range rather than a wider one.
 * Moved down twice in step with `DIAMOND_ABERRATION` so it never clamps the
 * diamond's own default back up.
 */
const ABERRATION_FLOOR = 0.0015;
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
): {
  color: string;
  ior: number;
  aberration: number;
  transmission: number;
  metalness?: number;
  roughness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  envMapIntensity?: number;
  reflectivity?: number;
  absorptionFactor: number;
} {
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
    // Opaque-only appearance, undefined unless the catalogue entry or a patch
    // actually sets one — see `GemMaterial` for why that has to stay true.
    metalness: patch?.metalness ?? gem.metalness,
    roughness: patch?.roughness ?? gem.roughness,
    clearcoat: patch?.clearcoat ?? gem.clearcoat,
    clearcoatRoughness: patch?.clearcoatRoughness ?? gem.clearcoatRoughness,
    envMapIntensity: patch?.envMapIntensity ?? gem.envMapIntensity,
    reflectivity: patch?.reflectivity ?? gem.reflectivity,
    // 1 is "unchanged" rather than undefined, unlike the opaque-only fields
    // above: every transparent gem already has a real path length to scale,
    // so there is no "not applicable" case to preserve by leaving it unset.
    absorptionFactor: clamp(patch?.absorptionFactor ?? 1, 0.1, 10),
  };
}

/**
 * Eleven quick colours, matching i3D's own flat swatch row — a fast recolour
 * that does not require first picking a catalogue gem. Deliberately a
 * separate, simpler mechanism from the gem catalogue and the Custom editor's
 * colour field: it writes to `stoneColors`, not to an assignment's patch, so
 * clicking one works even on a stone nothing has been assigned to yet.
 */
export const GEM_QUICK_COLORS: { label: string; hex: string }[] = [
  { label: "White", hex: "#ffffff" },
  { label: "Red", hex: "#a5182b" },
  { label: "Blue", hex: "#12409b" },
  { label: "Pink", hex: "#c02f6e" },
  { label: "Green", hex: "#0d7a45" },
  { label: "Olive", hex: "#b6a71e" },
  { label: "Black", hex: "#141419" },
  { label: "Purple", hex: "#6a2f9e" },
  { label: "Orange", hex: "#d1631c" },
  { label: "Teal", hex: "#149a92" },
  { label: "Magenta", hex: "#d61fb0" },
];

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
