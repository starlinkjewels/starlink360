/*
 * Hallmarks, struck into the metal.
 *
 * A stamp is not decoration and not a watermark. It is part of the product: a
 * purity mark is what makes a piece sellable, a maker's mark is what makes it
 * traceable, and a client commissioning a ring expects to see both in the
 * render before they approve it. So these live on the piece, in its own
 * coordinate space, and they travel with it into every still and every frame of
 * video.
 *
 * CUT, NOT PAINTED. Same rule the surface finishes follow, for the same reason:
 * a hallmark is displaced metal. It is rendered as a height field turned into a
 * normal map, so it catches light along its edges and disappears when the piece
 * turns away from the key light — exactly as a real punch mark does. Painting
 * the text on in dark grey looks convincing in a screenshot and wrong the
 * moment the piece rotates.
 *
 * A NEGATIVE DEPTH RAISES IT. Cast pieces often carry a raised mark from the
 * mould rather than a struck recess, and the difference is one sign in the
 * height field, so there is no reason to make it a separate feature.
 */

/** Where a mark came from, which decides how its height field is built. */
export type StampSource = "hallmark" | "text" | "logo";

export interface Stamp {
  /** Stable across edits and reloads, so a saved project reopens intact. */
  id: string;
  source: StampSource;
  /** The mark itself: a hallmark id, the typed text, or a data URL for a logo. */
  value: string;
  /**
   * Where it sits, in the LOCAL space of the part it was struck into.
   *
   * Local rather than world, because the piece is recentred and scaled to fit
   * on load and rotated by the turntable while rendering. A world position
   * would drift off the metal the first time any of that happened.
   */
  position: [number, number, number];
  /** The surface normal at that point. The mark lies flat against it. */
  normal: [number, number, number];
  /** Which part it was struck into, so it can be reprojected after a reload. */
  partId: string;
  /** Turn about the normal, in degrees. */
  rotation: number;
  /** Cap height of the lettering, in millimetres. */
  size: number;
  /** How deep it is struck, in millimetres. Negative raises it instead. */
  depth: number;
}

export const DEFAULT_STAMP: Omit<Stamp, "id" | "position" | "normal" | "partId"> = {
  source: "hallmark",
  value: "750",
  rotation: 0,
  /*
   * A real purity mark on a ring shank is around a millimetre tall — small
   * enough to be discreet, large enough to read under a loupe. Starting there
   * means the first click usually needs no adjustment at all.
   */
  size: 1.2,
  // About the depth of a struck punch. Deep enough to catch light, shallow
  // enough not to look stamped into wax.
  depth: 0.08,
};

export interface Hallmark {
  id: string;
  /** What is actually struck into the metal. */
  mark: string;
  label: string;
  group: HallmarkGroup;
  hint: string;
}

export type HallmarkGroup = "Gold" | "Silver" | "Platinum & Palladium" | "Trade";

/*
 * The standard marks, by metal.
 *
 * Both spellings of each gold purity are listed separately rather than as one
 * entry with a toggle, because a jeweller picks the one their market uses and
 * would not think to look for a format switch: 14K is what ships to the US,
 * 585 is what ships to Europe, and they are different punches on the bench.
 */
export const HALLMARKS: Hallmark[] = [
  { id: "10k", mark: "10K", label: "10K", group: "Gold", hint: "417 parts per thousand" },
  { id: "417", mark: "417", label: "417", group: "Gold", hint: "10 carat, European" },
  { id: "14k", mark: "14K", label: "14K", group: "Gold", hint: "585 parts per thousand" },
  { id: "585", mark: "585", label: "585", group: "Gold", hint: "14 carat, European" },
  { id: "18k", mark: "18K", label: "18K", group: "Gold", hint: "750 parts per thousand" },
  { id: "750", mark: "750", label: "750", group: "Gold", hint: "18 carat, European" },
  { id: "22k", mark: "22K", label: "22K", group: "Gold", hint: "916 parts per thousand" },
  { id: "916", mark: "916", label: "916", group: "Gold", hint: "22 carat, Indian standard" },
  { id: "24k", mark: "24K", label: "24K", group: "Gold", hint: "999 fine" },

  { id: "925", mark: "925", label: "925", group: "Silver", hint: "Sterling" },
  { id: "sterling", mark: "STERLING", label: "Sterling", group: "Silver", hint: "Written in full" },
  { id: "800", mark: "800", label: "800", group: "Silver", hint: "Continental" },
  { id: "999s", mark: "999", label: "999", group: "Silver", hint: "Fine silver" },

  { id: "pt950", mark: "PT950", label: "PT950", group: "Platinum & Palladium", hint: "Platinum" },
  { id: "pt900", mark: "PT900", label: "PT900", group: "Platinum & Palladium", hint: "Platinum" },
  { id: "plat", mark: "PLAT", label: "PLAT", group: "Platinum & Palladium", hint: "Written short" },
  { id: "pd950", mark: "PD950", label: "PD950", group: "Platinum & Palladium", hint: "Palladium" },

  { id: "handmade", mark: "HANDMADE", label: "Handmade", group: "Trade", hint: "Bench-made" },
  { id: "cw", mark: "CW", label: "CW", group: "Trade", hint: "Carat weight follows" },
  { id: "copyright", mark: "©", label: "Copyright", group: "Trade", hint: "Registered design" },
];

export const HALLMARK_BY_ID = new Map(HALLMARKS.map((h) => [h.id, h]));

/** The marks in each group, in rail order, skipping empty groups. */
export function hallmarkGroups(): { group: HallmarkGroup; items: Hallmark[] }[] {
  const order: HallmarkGroup[] = ["Gold", "Silver", "Platinum & Palladium", "Trade"];
  return order
    .map((group) => ({ group, items: HALLMARKS.filter((h) => h.group === group) }))
    .filter((g) => g.items.length > 0);
}

/**
 * The characters actually struck, whatever the mark came from.
 *
 * A logo has none — it is an image — and returning its data URL here would put
 * a kilobyte of base64 into a tooltip.
 */
export function stampText(stamp: Pick<Stamp, "source" | "value">): string {
  if (stamp.source === "logo") return "";
  if (stamp.source === "hallmark") return HALLMARK_BY_ID.get(stamp.value)?.mark ?? stamp.value;
  return stamp.value;
}

/** What to call a stamp in a list, without ever printing a data URL. */
export function stampLabel(stamp: Pick<Stamp, "source" | "value">): string {
  if (stamp.source === "logo") return "Logo";
  const text = stampText(stamp);
  return text.length > 18 ? `${text.slice(0, 17)}…` : text || "Empty";
}

/**
 * Whether a stamp would render anything.
 *
 * An empty text field is the ordinary state between clicking "custom" and
 * typing, so it is not an error — but placing it would leave an invisible mark
 * in the list that cannot be found on the piece, so the panel keeps the button
 * disabled until there is something to strike.
 */
export function stampIsEmpty(stamp: Pick<Stamp, "source" | "value">): boolean {
  if (stamp.source === "logo") return !stamp.value.startsWith("data:");
  return stampText(stamp).trim().length === 0;
}

/*
 * Bounds, chosen from the bench rather than from what the renderer tolerates.
 *
 * The smallest mark anyone strikes is about a third of a millimetre — below
 * that it will not read, on metal or on screen. The largest that still looks
 * like a hallmark rather than an engraving is around six.
 */
export const MIN_SIZE = 0.3;
export const MAX_SIZE = 6;
/** A punch deeper than a quarter millimetre would pierce a thin shank. */
export const MAX_DEPTH = 0.25;

export function clampStamp(stamp: Stamp): Stamp {
  return {
    ...stamp,
    size: Math.min(MAX_SIZE, Math.max(MIN_SIZE, stamp.size)),
    depth: Math.min(MAX_DEPTH, Math.max(-MAX_DEPTH, stamp.depth)),
    // Kept in 0..360 so the field reads sensibly after repeated nudges rather
    // than climbing to 720.
    rotation: ((stamp.rotation % 360) + 360) % 360,
  };
}

/**
 * A new id.
 *
 * Counter-based rather than random: `Math.random` is unavailable in the test
 * suites by design, and a stamp id has no need to be unguessable — only unique
 * within one piece.
 */
let counter = 0;
export function nextStampId(): string {
  counter += 1;
  return `stamp-${counter}`;
}

/** Restarts numbering, so a fresh piece does not begin at stamp-97. */
export function resetStampIds(): void {
  counter = 0;
}

/* --------------------------------------------------------------- the surface */

/**
 * The face a mark is struck in.
 *
 * A serif face is what a real punch looks like and it is what a client expects
 * on a hallmark, but a thin serif at 0.3mm disappears — so a heavy grotesque is
 * offered alongside it for small marks and for anything that has to read on a
 * phone screen.
 */
export const STAMP_FONTS = [
  { id: "serif", label: "Serif", css: '600 128px "Cormorant Garamond", Georgia, serif' },
  { id: "sans", label: "Sans", css: '700 128px Inter, "Helvetica Neue", Arial, sans-serif' },
  { id: "mono", label: "Mono", css: '700 128px "SF Mono", Menlo, Consolas, monospace' },
] as const;

export type StampFont = (typeof STAMP_FONTS)[number]["id"];

export function fontCss(id: string): string {
  return (STAMP_FONTS.find((f) => f.id === id) ?? STAMP_FONTS[0]).css;
}

/**
 * Resolution of a stamp's height field.
 *
 * Generous, because a hallmark is read close up — this is the one thing on the
 * piece a client will zoom into — and because it is built once per stamp rather
 * than per frame. 512 keeps the edges of a 0.3mm mark clean without the memory
 * cost of a full 1k map for something a couple of millimetres across.
 */
export const STAMP_MAP_SIZE = 512;

/**
 * Padding around the mark, as a fraction of the map.
 *
 * The normal map is derived from neighbouring pixels, so a glyph touching the
 * edge has no ground beside it to slope down to and comes out with a hard bevel
 * along the border of the decal — a visible rectangle around the hallmark.
 */
const PADDING = 0.12;

/* ------------------------------------------------------------------ the list */

export function addStamp(list: Stamp[], stamp: Stamp): Stamp[] {
  return [...list, clampStamp(stamp)];
}

export function removeStamp(list: Stamp[], id: string): Stamp[] {
  return list.filter((s) => s.id !== id);
}

export function updateStamp(list: Stamp[], id: string, patch: Partial<Stamp>): Stamp[] {
  return list.map((s) => (s.id === id ? clampStamp({ ...s, ...patch }) : s));
}

/**
 * Drops stamps whose part is no longer in the piece.
 *
 * Loading a different model keeps the panel state, and a stamp pinned to a part
 * id that no longer exists would sit in the list for ever with nothing on
 * screen to match it.
 */
export function pruneStamps(list: Stamp[], partIds: ReadonlySet<string>): Stamp[] {
  return list.filter((s) => partIds.has(s.partId));
}
