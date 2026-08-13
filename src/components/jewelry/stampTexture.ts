import * as THREE from "three";
import { STAMP_MAP_SIZE, fontCss, stampText, type Stamp } from "./stamps";

/*
 * A hallmark's height field, and the normal map derived from it.
 *
 * Kept apart from `stamps.ts` so the data model stays free of three and of the
 * DOM, which is what lets the suite check the marks, the bounds and the list
 * operations in a few milliseconds on Node.
 *
 * The mark is DISPLACED METAL, never paint. Text is rasterised to a height
 * field, softened, and converted to a normal map; the material's `normalScale`
 * then decides how deep the punch reads and which way it goes. Depth is
 * deliberately NOT baked into the map, so dragging the depth field re-uses the
 * same texture instead of rebuilding it on every frame of the drag.
 */

export interface StampMaps {
  /**
   * How much of the map's height the lettering actually fills, 0..1.
   *
   * The map is square and the text is fitted inside it, so an eight-character
   * word is width-limited and its capitals end up occupying an eighth of the
   * height. Sizing the decal to the MAP then gives a cap height eight times
   * smaller than the panel promised — which is why "@bkpatel" at 1.2mm rendered
   * as an illegible speck while "750" looked right.
   *
   * The caller divides by this to get a decal whose LETTERING measures what was
   * asked for. The empty margin around it is flat normal, so it costs nothing.
   */
  capFraction: number;
  normalMap: THREE.DataTexture;
  /**
   * Struck metal is rougher than the polish around it — the punch breaks the
   * surface. Without this a hallmark reads as a dent in a mirror rather than a
   * mark, and it is the cheapest single thing that sells the effect.
   */
  roughnessMap: THREE.DataTexture;
}

/** How far the punch edge is softened, in pixels of the height map. */
const SOFTEN = 3;

/** Rasterises the mark into a 0..1 height field, or null off the main thread. */
async function heightField(
  stamp: Stamp,
  font: string,
): Promise<{ data: Float32Array; capFraction: number } | null> {
  if (typeof document === "undefined") return null;

  const size = STAMP_MAP_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  // Ground is zero, the mark is one. Inverted later if the punch is raised.
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#fff";

  const inset = size * 0.12;
  const box = size - inset * 2;
  // What share of the map the ink ends up filling vertically. Set by whichever
  // branch runs below; the default is the box itself, for a mark that fills it.
  let capFraction = box / size;

  if (stamp.source === "logo") {
    const image = await loadImage(stamp.value);
    if (!image) return null;
    /*
     * Fitted, never stretched. A maker's punch is a registered mark and
     * distorting it is not a cosmetic problem — it is the wrong mark.
     */
    const scale = Math.min(box / image.width, box / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
    capFraction = h / size;
  } else {
    const text = stampText(stamp);
    if (!text) return null;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = fontCss(font);

    /*
     * Scaled to the box by measurement rather than by guessing a point size.
     * "©" and "STERLING" differ by a factor of eight in width, and a fixed
     * size would either overflow the decal or leave the short marks tiny.
     */
    const m = ctx.measureText(text);
    const textW = m.width;
    const textH =
      m.actualBoundingBoxAscent + m.actualBoundingBoxDescent || Number.parseInt(ctx.font, 10);
    /*
     * Still fitted by the smaller ratio, so a long word cannot overflow the
     * map. What changes is that the resulting cap height is REPORTED rather
     * than assumed, so the decal can be cut to suit it.
     */
    const fit = Math.min(box / textW, box / textH);
    capFraction = (textH * fit) / size;
    ctx.setTransform(fit, 0, 0, fit, size / 2, size / 2);
    // Centred on the glyph's own ink, not on its line box — a font's ascent
    // and descent are generous and would sit the mark high in the decal.
    ctx.fillText(text, 0, (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 / fit);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  const pixels = ctx.getImageData(0, 0, size, size).data;
  const raw = new Float32Array(size * size);
  /*
   * Straight through, no flip.
   *
   * A horizontal reverse was added here to cure mirrored lettering, on the
   * evidence of a screenshot where the mark was also blue-tinted and badly
   * distorted — it was unreadable, and I read the wrong fault out of it. With
   * the projection working the marks came out mirrored BECAUSE of that flip.
   * The projector along the outward normal already gives the right handedness.
   *
   * Red alone: the mark was drawn white on black, so all three channels agree.
   */
  for (let i = 0; i < raw.length; i++) raw[i] = pixels[i * 4] / 255;

  return { data: soften(raw, size), capFraction };
}

/**
 * A rounded punch rather than a razor edge.
 *
 * A rasterised glyph is a cliff one pixel wide, and the normal map derived from
 * it is a hard black-and-white outline that aliases badly the moment the piece
 * moves. Real struck metal has a shoulder where it was displaced. Two passes of
 * a separable box blur are enough and are far cheaper than a gaussian.
 */
function soften(src: Float32Array, size: number): Float32Array {
  const out = new Float32Array(src);
  const tmp = new Float32Array(src.length);
  // Two passes of a separable box, which is close enough to a gaussian at this
  // radius and a fraction of the cost.
  for (let pass = 0; pass < 2; pass++) {
    blur(out, tmp, size, true);
    blur(tmp, out, size, false);
  }
  return out;
}

/** One axis of the box blur, from `src` into `dst`. */
function blur(src: Float32Array, dst: Float32Array, size: number, horizontal: boolean): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let n = 0;
      for (let k = -SOFTEN; k <= SOFTEN; k++) {
        const sx = horizontal ? x + k : x;
        const sy = horizontal ? y : y + k;
        if (sx < 0 || sx >= size || sy < 0 || sy >= size) continue;
        sum += src[sy * size + sx];
        n++;
      }
      dst[y * size + x] = sum / n;
    }
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    // A logo that fails to decode leaves the stamp unrendered rather than
    // throwing inside an effect and taking the canvas down with it.
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function toTexture(data: Uint8Array, size: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  // Clamped, not repeated: a decal is a single stamp of the mark, and wrapping
  // would tile the hallmark across the shank.
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  // Data, not colour. An sRGB decode would tilt every normal in the map.
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * Built once per mark and reused.
 *
 * Keyed on what the map actually depends on — the mark, its source and its face
 * — and deliberately NOT on size, rotation or depth. Those are handled by the
 * decal's own geometry and the material's `normalScale`, so nudging a slider
 * re-uses the texture rather than rasterising a fresh one on every pointer
 * move.
 */
const cache = new Map<string, Promise<StampMaps | null>>();

export function stampMapKey(stamp: Stamp, font: string): string {
  return `${stamp.source}|${font}|${stamp.value}`;
}

export function stampMaps(stamp: Stamp, font: string): Promise<StampMaps | null> {
  const key = stampMapKey(stamp, font);
  const hit = cache.get(key);
  if (hit) return hit;

  const built = heightField(stamp, font).then((height) => {
    if (!height) return null;
    const size = STAMP_MAP_SIZE;
    const normal = new Uint8Array(size * size * 4);
    const rough = new Uint8Array(size * size * 4);

    const at = (x: number, y: number) =>
      height.data[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;

        // Central differences, which is the slope of the displaced metal.
        const dx = at(x + 1, y) - at(x - 1, y);
        const dy = at(x, y + 1) - at(x, y - 1);
        const len = Math.hypot(dx, dy, 1) || 1;
        normal[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
        normal[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
        normal[i + 2] = Math.round((1 / len) * 255);
        normal[i + 3] = 255;

        /*
         * Rougher inside the mark than outside it. A punch breaks the polish,
         * and without this the hallmark reads as a dent in a mirror rather
         * than as struck metal.
         */
        const r = Math.round(255 - at(x, y) * 150);
        rough[i] = r;
        rough[i + 1] = r;
        rough[i + 2] = r;
        rough[i + 3] = 255;
      }
    }

    return {
      capFraction: height.capFraction,
      normalMap: toTexture(normal, size),
      roughnessMap: toTexture(rough, size),
    };
  });

  cache.set(key, built);
  return built;
}

/** Frees every generated map. Called when the piece is replaced. */
export function clearStampMaps(): void {
  for (const pending of cache.values()) {
    void pending.then((maps) => {
      maps?.normalMap.dispose();
      maps?.roughnessMap.dispose();
    });
  }
  cache.clear();
}
