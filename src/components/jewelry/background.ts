/*
 * What sits behind the piece.
 *
 * One description drives two very different renderers: CSS for the live stage,
 * and a 2D canvas for anything exported. They have to agree, or a client picks
 * a navy gradient on screen and downloads a black JPEG — which is exactly the
 * kind of thing that destroys trust in an export button.
 *
 * The WebGL canvas itself stays transparent for every kind below except
 * "image3d". Painting the backdrop underneath rather than into the 3D scene
 * means it costs nothing per frame, never picks up the tone mapping meant for
 * metal and stones, and stays perfectly clean at any export resolution instead
 * of being resampled with the render — which is why it is still the default
 * for a flat image.
 *
 * "image3d" is the one exception on purpose: a real Three.js plane, textured
 * with the same uploaded image, that sits behind the piece as an actual scene
 * object rather than a screen-space layer — see `ImageBackdrop3D.tsx`. It
 * shares this file's `image` field rather than a second copy of it; only how
 * that image is rendered differs.
 */

export type BackgroundKind = "stage" | "solid" | "gradient" | "image" | "image3d" | "transparent";

/** Where a linear gradient runs. Matches the CSS keywords one-for-one. */
export type GradientDirection =
  | "to top"
  | "to top right"
  | "to right"
  | "to bottom right"
  | "to bottom"
  | "to bottom left"
  | "to left"
  | "to top left";

export const GRADIENT_DIRECTIONS: GradientDirection[] = [
  "to top",
  "to top right",
  "to right",
  "to bottom right",
  "to bottom",
  "to bottom left",
  "to left",
  "to top left",
];

/** Where a radial gradient is centred. */
export type RadialAt = "center" | "top" | "bottom" | "top left" | "top right";

export const RADIAL_POSITIONS: RadialAt[] = ["center", "top", "bottom", "top left", "top right"];

/** One colour on the gradient bar. `at` is 0..1 across the run. */
export interface GradientStop {
  color: string;
  at: number;
}

/**
 * Eight is the ceiling, and it is not arbitrary.
 *
 * A backdrop with more than a handful of stops stops reading as a sweep and
 * starts reading as banding, and every stop is another thing to keep in sync
 * between the live CSS and the canvas painter.
 */
export const MAX_STOPS = 8;

/** Where an image backdrop sits relative to the piece. */
export type ImagePlacement = "back" | "front";

export interface Background {
  kind: BackgroundKind;
  /** Solid fill. */
  color: string;
  /**
   * Gradient ends.
   *
   * Kept alongside `stops` rather than replaced by it: settings saved before
   * the bar existed only have these two, and dropping them would silently
   * reset every stored backdrop to the default. `gradientStops()` reconciles
   * the two, preferring `stops` when it is present.
   */
  from: string;
  to: string;
  direction: GradientDirection;
  /** The full bar, 2 to 8 stops. Absent means "just from and to". */
  stops?: GradientStop[];
  /** Linear runs along `direction`; radial spreads from `radialAt`. */
  gradientType?: "linear" | "radial";
  radialAt?: RadialAt;
  /** Data URL of an uploaded backdrop, or a generated preset. */
  image: string | null;
  /** 0-1, applied to the image only. */
  imageOpacity: number;
  /** Behind the piece, or over it. */
  imagePlacement?: ImagePlacement;
  /**
   * While on, setting a Solid background colour also writes it onto the
   * ground — one click for a seamless "colour sweep" look. The ground keeps
   * its own `color` field as the only place that value actually lives; this
   * is a one-way write triggered by a background change, not a second copy
   * of it, and the two stay independently editable the moment this is off.
   */
  syncGroundColor?: boolean;
  /**
   * Backdrop blur, in CSS pixels. Applied to the background layer only — it
   * sits in the DOM behind the transparent WebGL canvas (see the file header),
   * so blurring it can never soften the jewellery, which is drawn in a
   * separate layer on top untouched.
   */
  blur?: number;
}

export const DEFAULT_BACKGROUND: Background = {
  kind: "stage",
  color: "#ffffff",
  from: "#2a2333",
  to: "#0b0910",
  direction: "to bottom",
  gradientType: "linear",
  radialAt: "center",
  image: null,
  imageOpacity: 1,
  imagePlacement: "back",
  syncGroundColor: false,
  blur: 0,
};

/**
 * The gradient as a clean, ordered stop list.
 *
 * One place decides what a gradient IS, so the live CSS and the export painter
 * cannot disagree — which is the failure that shows as a download not matching
 * the screen. Sorted, clamped, and never shorter than two, because a gradient
 * with one stop is a solid colour and `addColorStop` on an empty list throws.
 */
export function gradientStops(bg: Background): GradientStop[] {
  const raw = bg.stops?.length
    ? bg.stops
    : [
        { color: bg.from, at: 0 },
        { color: bg.to, at: 1 },
      ];
  const clean = raw
    .slice(0, MAX_STOPS)
    .map((s) => ({ color: s.color, at: Math.min(1, Math.max(0, s.at)) }))
    .sort((a, b) => a.at - b.at);

  if (clean.length === 0)
    return [
      { color: bg.from, at: 0 },
      { color: bg.to, at: 1 },
    ];
  if (clean.length === 1) return [clean[0], { color: clean[0].color, at: 1 }];
  return clean;
}

/** Inserts a stop at a position, keeping the list sorted and within the cap. */
export function addStop(stops: GradientStop[], at: number, color: string): GradientStop[] {
  if (stops.length >= MAX_STOPS) return stops;
  return [...stops, { color, at: Math.min(1, Math.max(0, at)) }].sort((a, b) => a.at - b.at);
}

/** Removes a stop, refusing to go below two — one stop is not a gradient. */
export function removeStop(stops: GradientStop[], index: number): GradientStop[] {
  if (stops.length <= 2 || index < 0 || index >= stops.length) return stops;
  return stops.filter((_, i) => i !== index);
}

/**
 * Moves or recolours one stop.
 *
 * The list is NOT re-sorted here. Dragging a stop past its neighbour would
 * renumber the array mid-drag, so the pointer would suddenly be moving a
 * different stop — the classic gradient-editor bug. Order is resolved when the
 * gradient is read instead.
 */
export function updateStop(
  stops: GradientStop[],
  index: number,
  patch: Partial<GradientStop>,
): GradientStop[] {
  return stops.map((s, i) =>
    i === index ? { color: patch.color ?? s.color, at: patch.at ?? s.at } : s,
  );
}

/** The stage's own look, kept in one place so CSS and canvas cannot drift. */
const STAGE_FROM = "#1b1420";
const STAGE_TO = "#06050a";

export const SOLID_PRESETS = [
  { label: "White", hex: "#ffffff" },
  { label: "Soft grey", hex: "#f1f1f3" },
  { label: "Black", hex: "#000000" },
  { label: "Charcoal", hex: "#141419" },
  { label: "Navy", hex: "#101a33" },
  { label: "Deep red", hex: "#3a0f14" },
  { label: "Ivory", hex: "#f6f1e7" },
  { label: "Blush", hex: "#f2e0e2" },
];

export const GRADIENT_PRESETS = [
  { label: "Atelier", from: "#2a2333", to: "#0b0910" },
  { label: "Studio grey", from: "#ffffff", to: "#d8d8dd" },
  { label: "Champagne", from: "#f7ecd9", to: "#d8bb8a" },
  { label: "Midnight", from: "#1d2a4a", to: "#05070f" },
  { label: "Rose", from: "#f7e2e4", to: "#d9a7ad" },
  { label: "Emerald", from: "#123b2c", to: "#04100c" },
];

/** CSS for the live stage. `null` means "leave the stage's own styling alone". */
export function backgroundCss(bg: Background): string | null {
  switch (bg.kind) {
    case "solid":
      return bg.color;
    case "gradient": {
      // One source for the stops, so the stage and the download agree.
      const list = gradientStops(bg)
        .map((st) => `${st.color} ${(st.at * 100).toFixed(2)}%`)
        .join(", ");
      return bg.gradientType === "radial"
        ? `radial-gradient(circle at ${bg.radialAt ?? "center"}, ${list})`
        : `linear-gradient(${bg.direction}, ${list})`;
    }
    case "image":
      return bg.image ? `#000 center / cover no-repeat url(${JSON.stringify(bg.image)})` : null;
    case "image3d":
      /*
       * The CSS layer paints nothing here on purpose — the backdrop is a real
       * plane in the Three.js scene instead (see `ImageBackdrop3D.tsx`). Falling
       * through to `default` would show the dark stage gradient behind it
       * instead of nothing, which would read as a border around the 3D plane
       * on any frame where it does not exactly fill the view.
       */
      return "transparent";
    case "transparent":
      return "transparent";
    default:
      return null;
  }
}

/**
 * Gradient endpoints in canvas coordinates.
 *
 * CSS names a direction; canvas wants two points. The diagonals deliberately
 * run corner to corner rather than using the CSS "magic angle", which is close
 * enough for a two-stop backdrop and keeps the maths readable.
 */
function gradientLine(
  direction: GradientDirection,
  w: number,
  h: number,
): [number, number, number, number] {
  switch (direction) {
    case "to top":
      return [0, h, 0, 0];
    case "to bottom":
      return [0, 0, 0, h];
    case "to left":
      return [w, 0, 0, 0];
    case "to right":
      return [0, 0, w, 0];
    case "to top right":
      return [0, h, w, 0];
    case "to bottom right":
      return [0, 0, w, h];
    case "to bottom left":
      return [w, 0, 0, h];
    case "to top left":
      return [w, h, 0, 0];
  }
}

/**
 * Draws a front-placed image OVER the finished frame.
 *
 * Called after the render is composited, which is the whole difference between
 * a backdrop and a prop in front of the piece — a jeweller shooting through a
 * gauze or a lit edge wants the latter, and there was no way to express it.
 *
 * Does nothing for any other placement, so callers can always call it.
 */
export function paintForeground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bg: ResolvedBackground,
): void {
  if (bg.kind !== "image" || bg.imagePlacement !== "front" || !bg.bitmap) return;

  // Cover, matching the backdrop path, so switching Back/Front reframes nothing.
  const scale = Math.max(w / bg.bitmap.width, h / bg.bitmap.height);
  const dw = bg.bitmap.width * scale;
  const dh = bg.bitmap.height * scale;
  ctx.globalAlpha = Math.max(0, Math.min(1, bg.imageOpacity));
  ctx.drawImage(bg.bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.globalAlpha = 1;
}

/** Where a radial gradient's centre falls, in canvas pixels. */
function radialCentre(at: RadialAt, w: number, h: number): { x: number; y: number } {
  switch (at) {
    case "top":
      return { x: w / 2, y: 0 };
    case "bottom":
      return { x: w / 2, y: h };
    case "top left":
      return { x: 0, y: 0 };
    case "top right":
      return { x: w, y: 0 };
    default:
      return { x: w / 2, y: h / 2 };
  }
}

export interface ResolvedBackground extends Background {
  /** Decoded backdrop, or null when there is none or it failed to load. */
  bitmap: HTMLImageElement | null;
}

const imageCache = new Map<string, HTMLImageElement | null>();

/**
 * Decodes the backdrop once, so painting stays synchronous.
 *
 * A video export paints hundreds of frames and cannot await anything per frame,
 * so the decode has to happen before the run starts.
 */
export async function resolveBackground(bg: Background): Promise<ResolvedBackground> {
  if ((bg.kind !== "image" && bg.kind !== "image3d") || !bg.image) return { ...bg, bitmap: null };

  const cached = imageCache.get(bg.image);
  if (cached !== undefined) return { ...bg, bitmap: cached };

  const bitmap = await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = bg.image as string;
  });
  imageCache.set(bg.image, bitmap);
  return { ...bg, bitmap };
}

/**
 * Paints the backdrop into an export frame.
 *
 * Returns false for a transparent backdrop, which is the caller's signal to
 * keep the alpha channel and write a PNG instead of flattening to JPEG.
 */
export function paintBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bg: ResolvedBackground,
): boolean {
  switch (bg.kind) {
    case "transparent":
      return false;

    case "solid":
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, w, h);
      return true;

    case "gradient":
    case "stage": {
      const stops =
        bg.kind === "stage"
          ? [
              { color: STAGE_FROM, at: 0 },
              { color: STAGE_TO, at: 1 },
            ]
          : gradientStops(bg);

      const radial = bg.kind === "gradient" && bg.gradientType === "radial";
      const grad = radial
        ? (() => {
            const c = radialCentre(bg.radialAt ?? "center", w, h);
            // Reaches the furthest corner, which is what CSS's default
            // farthest-corner does — anything shorter leaves a flat ring of the
            // last colour around the edge of the frame.
            const r = Math.max(
              Math.hypot(c.x, c.y),
              Math.hypot(w - c.x, c.y),
              Math.hypot(c.x, h - c.y),
              Math.hypot(w - c.x, h - c.y),
            );
            return ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
          })()
        : ctx.createLinearGradient(
            ...gradientLine(bg.kind === "stage" ? "to bottom" : bg.direction, w, h),
          );

      for (const st of stops) grad.addColorStop(st.at, st.color);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      return true;
    }

    /*
     * Exported as the flat cover-fit image, same as "image" — not the
     * perspective-correct 3D plane the live view shows.
     *
     * The export pipeline is a 2D canvas painter with no camera or scene of
     * its own, and re-deriving the plane's exact on-screen projection here
     * would mean duplicating the 3D framing math into 2D canvas terms. That
     * is real work belonging to the later Export phase, out of scope for this
     * one; painting the flat image is an honest degradation — the export
     * still shows the chosen picture, just without the depth/orbit framing —
     * rather than a silent gap or a wrongly-composited frame.
     */
    case "image3d":
    case "image": {
      /*
       * A FRONT image is not a backdrop, so nothing is painted here — the piece
       * is drawn first and `paintForeground` lays the image over it afterwards.
       * Painting it now would put it behind the jewellery, which is the one
       * thing "front" means it must not be.
       */
      if (bg.imagePlacement === "front") {
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, w, h);
        return true;
      }

      // Black underneath: an image that does not cover the frame, or one drawn
      // at reduced opacity, would otherwise composite onto whatever the canvas
      // happened to hold.
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);
      if (!bg.bitmap) return true;

      /*
       * Cover, not stretch. A backdrop squashed to the export's aspect ratio
       * looks wrong immediately, and the export is often a different shape from
       * the screen — a 9:16 reel from a landscape window.
       */
      const scale = Math.max(w / bg.bitmap.width, h / bg.bitmap.height);
      const dw = bg.bitmap.width * scale;
      const dh = bg.bitmap.height * scale;
      ctx.globalAlpha = Math.max(0, Math.min(1, bg.imageOpacity));
      ctx.drawImage(bg.bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.globalAlpha = 1;
      return true;
    }
  }
}

/*
 * ── Built-in backdrops ──────────────────────────────────────────────────────
 *
 * Generated, not shipped, for the same reason the surface finishes are: this is
 * a product with no backend that has to load on a phone, and four photographic
 * backdrops would be megabytes for something a gradient and some noise can
 * express. They are also resolution-independent, so an export renders its own
 * rather than upscaling a JPEG.
 */

export interface BackdropPreset {
  id: string;
  label: string;
  hint: string;
}

export const IMAGE_PRESETS: BackdropPreset[] = [
  { id: "sweep", label: "Studio sweep", hint: "Seamless curve, lit from above" },
  { id: "marble", label: "Marble slab", hint: "Cool stone with veining" },
  { id: "linen", label: "Linen", hint: "Woven cloth, soft and warm" },
  { id: "vignette", label: "Dark vignette", hint: "Black, with a pool of light" },
];

/** Deterministic hash noise, so a backdrop is identical on every render. */
function noise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1597334677);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const backdrops = new Map<string, string>();

/**
 * A built-in backdrop as a data URL.
 *
 * Drawn at a fixed 512 and then covered over the frame — these are all soft,
 * low-frequency surfaces, so they carry the scale-up without showing it, and a
 * 4K allocation per preset to browse a list would not.
 */
export function backdropImage(id: string, size = 512): string {
  const key = `${id}|${size}`;
  const hit = backdrops.get(key);
  if (hit !== undefined) return hit;
  if (typeof document === "undefined") return "";

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  if (id === "sweep") {
    // A cyclorama: light at the top, curving into shadow at the base.
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, "#f2f2f4");
    g.addColorStop(0.55, "#dcdce1");
    g.addColorStop(1, "#a8a8b0");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  } else if (id === "marble") {
    ctx.fillStyle = "#e8e9ec";
    ctx.fillRect(0, 0, size, size);
    // Veins, as a few wandering strokes rather than a noise field — marble
    // veining is directional and sparse, and noise reads as concrete.
    ctx.lineWidth = 1.4;
    for (let v = 0; v < 14; v++) {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(120,124,134,${0.1 + noise(v, 0, 3) * 0.16})`;
      let x = noise(v, 1, 5) * size;
      for (let y = 0; y <= size; y += 8) {
        x += (noise(v, y, 7) - 0.5) * 12;
        if (y === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (id === "linen") {
    ctx.fillStyle = "#d9cfbe";
    ctx.fillRect(0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Warp and weft, crossing.
        const weave = (Math.sin(x * 0.9) + Math.sin(y * 0.9)) * 5;
        const grain = (noise(x, y, 11) - 0.5) * 14;
        const i = (y * size + x) * 4;
        img.data[i] = Math.max(0, Math.min(255, img.data[i] + weave + grain));
        img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + weave + grain));
        img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + weave + grain));
      }
    }
    ctx.putImageData(img, 0, 0);
  } else {
    ctx.fillStyle = "#07070a";
    ctx.fillRect(0, 0, size, size);
    const g = ctx.createRadialGradient(
      size / 2,
      size * 0.42,
      0,
      size / 2,
      size * 0.42,
      size * 0.62,
    );
    g.addColorStop(0, "rgba(90,86,96,0.85)");
    g.addColorStop(1, "rgba(7,7,10,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  const url = canvas.toDataURL("image/png");
  backdrops.set(key, url);
  return url;
}
