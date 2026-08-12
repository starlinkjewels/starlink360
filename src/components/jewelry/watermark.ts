/*
 * Studio branding, on screen and in every export.
 *
 * Same shape as the background: one description, two renderers — a DOM overlay
 * for the live view, a 2D canvas for downloads. And the same failure mode if
 * they drift, except worse, because a watermark that looks right on screen and
 * comes out wrong in the file is only discovered by the client.
 *
 * The whole trick is that nothing here is measured in pixels. A 16px watermark
 * is legible on a 900px viewport, invisible in a 4K export, and enormous in a
 * 256px thumbnail. Every size is a fraction of the frame's SHORT edge, so the
 * mark occupies the same proportion of the picture whatever it is rendered at.
 */

export type WatermarkPlacement =
  "top left" | "top right" | "bottom left" | "bottom right" | "centre";

export const WATERMARK_PLACEMENTS: WatermarkPlacement[] = [
  "bottom right",
  "bottom left",
  "top right",
  "top left",
  "centre",
];

export interface WatermarkSettings {
  enabled: boolean;
  text: string;
  /** Height of the type as a fraction of the frame's short edge. */
  scale: number;
  /** Degrees. Negative reads uphill, which is the usual look for a diagonal mark. */
  angle: number;
  opacity: number;
  color: string;
  placement: WatermarkPlacement;
  /**
   * A logo, as a data URL, drawn instead of the text when present.
   *
   * A studio's mark is usually a logotype, not a font it happens to have — and
   * a wordmark set in the browser's serif is not the same wordmark. Kept as a
   * data URL for the same reason the backdrop is: it has to draw into an export
   * canvas without tainting it, and an object URL dies on reload.
   */
  logo: string | null;
  /** Height of the logo as a fraction of the short edge. */
  logoScale: number;
}

export const DEFAULT_WATERMARK: WatermarkSettings = {
  enabled: false,
  text: "",
  scale: 0.035,
  angle: 0,
  opacity: 0.55,
  color: "#ffffff",
  placement: "bottom right",
  logo: null,
  logoScale: 0.08,
};

/** Inset from the edge, also as a fraction of the short edge. */
const MARGIN = 0.04;

/** Type size in pixels for a given frame. */
export function fontSize(shortEdge: number, scale: number): number {
  // Floored so it never disappears entirely in a small thumbnail.
  return Math.max(shortEdge * scale, 8);
}

/**
 * Where the mark's anchor point sits, and how the text should be aligned there.
 *
 * Returned together because they have to agree: a right-placed mark anchored at
 * the right margin must also be right-aligned, or it runs off the frame as the
 * text gets longer.
 */
export function anchor(
  placement: WatermarkPlacement,
  width: number,
  height: number,
  shortEdge: number,
): {
  x: number;
  y: number;
  align: "left" | "right" | "center";
  baseline: "top" | "bottom" | "middle";
} {
  const m = shortEdge * MARGIN;
  switch (placement) {
    case "top left":
      return { x: m, y: m, align: "left", baseline: "top" };
    case "top right":
      return { x: width - m, y: m, align: "right", baseline: "top" };
    case "bottom left":
      return { x: m, y: height - m, align: "left", baseline: "bottom" };
    case "bottom right":
      return { x: width - m, y: height - m, align: "right", baseline: "bottom" };
    case "centre":
      return { x: width / 2, y: height / 2, align: "center", baseline: "middle" };
  }
}

/**
 * Natural size of whatever kind of image source this is.
 *
 * `CanvasImageSource` covers half a dozen types that spell their dimensions
 * differently — an HTMLImageElement has naturalWidth, an ImageBitmap has width,
 * an SVGImageElement has neither as numbers. Reading the wrong one gives NaN
 * and the logo silently fails to draw.
 */
function logoSize(src: CanvasImageSource): { width: number; height: number } {
  const any = src as {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  const width = any.naturalWidth || (typeof any.width === "number" ? any.width : 0);
  const height = any.naturalHeight || (typeof any.height === "number" ? any.height : 0);
  return { width: width || 1, height: height || 1 };
}

/** True when a logo is set, in which case it replaces the text. */
export function usesLogo(settings: WatermarkSettings): boolean {
  return settings.enabled && !!settings.logo && settings.opacity > 0;
}

export function isVisible(settings: WatermarkSettings): boolean {
  if (!settings.enabled || settings.opacity <= 0.01) return false;
  // A logo needs no text: the mark IS the image.
  return !!settings.logo || settings.text.trim().length > 0;
}

/**
 * Paints the mark into an export frame.
 *
 * Called after the piece is composited, so the mark sits on top of everything.
 */
export function paintWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings: WatermarkSettings,
  /**
   * The decoded logo, when there is one.
   *
   * Passed in rather than loaded here: this runs inside a per-frame export loop
   * and cannot await anything, so the caller decodes once and hands it over —
   * the same arrangement the backdrop image uses.
   */
  logo?: CanvasImageSource | null,
): void {
  if (!isVisible(settings)) return;

  const shortEdge = Math.min(width, height);

  /*
   * A logo replaces the text entirely rather than sitting beside it. Two marks
   * in one corner is not a design anyone asks for, and the placement and angle
   * controls would then mean two different things at once.
   */
  if (settings.logo && logo) {
    const target = shortEdge * Math.max(0.01, Math.min(0.6, settings.logoScale));
    const natural = logoSize(logo);
    const scale = target / Math.max(1, natural.height);
    const w = natural.width * scale;
    const h = target;
    const at = anchor(settings.placement, width, height, shortEdge);

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, settings.opacity));
    ctx.translate(at.x, at.y);
    if (settings.angle) ctx.rotate((settings.angle * Math.PI) / 180);
    // Drawn from the same anchor point the text uses, so switching between them
    // does not move the mark.
    const dx = at.align === "right" ? -w : at.align === "center" ? -w / 2 : 0;
    const dy = at.baseline === "bottom" ? -h : at.baseline === "middle" ? -h / 2 : 0;
    ctx.drawImage(logo, dx, dy, w, h);
    ctx.restore();
    return;
  }
  const size = fontSize(shortEdge, settings.scale);
  const at = anchor(settings.placement, width, height, shortEdge);

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, settings.opacity));
  ctx.fillStyle = settings.color;
  // The same stack the panel uses, so the export matches the preview.
  ctx.font = `500 ${size}px "Inter", system-ui, sans-serif`;
  ctx.textAlign = at.align;
  ctx.textBaseline = at.baseline;

  /*
   * Rotate about the anchor rather than the frame, so turning the mark does not
   * also walk it across the picture — and so a corner mark stays in its corner.
   */
  ctx.translate(at.x, at.y);
  if (settings.angle !== 0) ctx.rotate((settings.angle * Math.PI) / 180);

  /*
   * A soft shadow, so white type stays legible over a white background. Cheaper
   * and less fussy than an outline, and it disappears against dark backdrops
   * where it is not needed.
   */
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = size * 0.25;
  ctx.fillText(settings.text.trim(), 0, 0);
  ctx.restore();
}

/**
 * The same mark as CSS, for the live overlay.
 *
 * Uses the viewport's short edge so the on-screen proportions match what an
 * export will produce, rather than matching its pixel size.
 */
export function watermarkStyle(
  settings: WatermarkSettings,
  width: number,
  height: number,
): React.CSSProperties | null {
  if (!isVisible(settings)) return null;

  const shortEdge = Math.min(width, height);
  const size = fontSize(shortEdge, settings.scale);
  const at = anchor(settings.placement, width, height, shortEdge);
  const m = shortEdge * MARGIN;

  // Translate is what centres a rotated mark on its own anchor, matching the
  // canvas path where rotation happens about the anchor point.
  const shiftX = at.align === "right" ? "-100%" : at.align === "center" ? "-50%" : "0";
  const shiftY = at.baseline === "bottom" ? "-100%" : at.baseline === "middle" ? "-50%" : "0";

  return {
    position: "absolute",
    left: at.align === "right" ? undefined : at.x,
    right: at.align === "right" ? m : undefined,
    top: at.baseline === "bottom" ? undefined : at.y,
    bottom: at.baseline === "bottom" ? m : undefined,
    transform: `translate(${shiftX}, ${shiftY}) rotate(${settings.angle}deg)`,
    transformOrigin: "center",
    fontSize: `${size}px`,
    fontWeight: 500,
    color: settings.color,
    opacity: settings.opacity,
    textShadow: `0 0 ${size * 0.25}px rgba(0,0,0,0.45)`,
    pointerEvents: "none",
    whiteSpace: "nowrap",
    zIndex: 25,
  };
}
