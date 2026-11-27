import * as THREE from "three";

/*
 * The room a diamond is photographed in, for the try-on's stones.
 *
 * A diamond has no look of its own: every facet is a mirror onto some part of
 * the room, bent through the stone. So "looks real" is decided here, not in
 * the shader. Product photographers shoot stones in a white light box and then
 * deliberately put DARK things around it, because an all-white room makes a
 * diamond a white blob, and it is the crisp alternation of white, grey and
 * black facets that the eye reads as a cut diamond. That is the look of the
 * best commercial renders, and it comes from:
 *
 *  - a bright overhead diffuser and a white sweep below,
 *  - black flags standing between the softboxes, each one a dark wedge of
 *    facets as the stone turns,
 *  - a darker band at the horizon, which outlines the girdle,
 *  - the camera itself: a dark disc straight in front of the stone. Looking
 *    face-up into a well cut brilliant you see your own dark reflection broken
 *    into the eight arrows of the pavilion mains. Leave it out and the table
 *    reads as flat glass.
 *  - a few pinpoint sources, tiny and very bright, which are what a facet
 *    catches as a single sparkling flash.
 *
 * Directions follow the scene: +Y up, +Z toward the camera. Built by hand as
 * a plain equirectangular map, because drei's refraction shader samples with
 * equirectUv and needs exactly that (see the light tent in lighting.ts).
 */

const DEG = Math.PI / 180;

interface Patch {
  /** Azimuth from +Z (toward the camera), degrees; +90 is +X. */
  az: number;
  /** Elevation, degrees. */
  el: number;
  /** Half width / half height in degrees of arc. */
  hw: number;
  hh: number;
  radiance: number;
  /** Soft edge, degrees. */
  feather: number;
  /** Round (disc) instead of rectangular. */
  round?: boolean;
}

/*
 * A dark studio lit by many separate strip lights: the gem photographer's
 * mosaic. With light leaving a stone at every internal bounce, each pixel
 * blends several directions, so a room that is bright almost everywhere
 * averages to milky white. Here most of the sphere is dark and the light
 * comes from discrete strips, so each facet path lands on either a light or
 * a gap, and the stone breaks into the crisp white, grey and black mosaic of
 * a real diamond. Arranged irregularly on purpose: a regular ring of lights
 * prints a regular pattern into the stone, which reads as computer-made.
 */
const PATCHES: Patch[] = [
  // Overhead softbox, the key light, offset forward a little.
  { az: 0, el: 74, hw: 16, hh: 16, radiance: 4.2, feather: 6, round: true },
  // Tall strip lights around the stone, unevenly spaced and sized.
  { az: 28, el: 22, hw: 7, hh: 22, radiance: 5, feather: 3 },
  { az: 72, el: 14, hw: 10, hh: 18, radiance: 4.2, feather: 3 },
  { az: 118, el: 26, hw: 6, hh: 20, radiance: 3.6, feather: 3 },
  { az: 160, el: 16, hw: 9, hh: 16, radiance: 3.2, feather: 3 },
  { az: -150, el: 24, hw: 7, hh: 20, radiance: 3.4, feather: 3 },
  { az: -104, el: 15, hw: 11, hh: 17, radiance: 4.4, feather: 3 },
  { az: -58, el: 26, hw: 6, hh: 21, radiance: 4.8, feather: 3 },
  { az: -22, el: 12, hw: 5, hh: 10, radiance: 3, feather: 3 },
  // Smaller cards higher up, for the crown and star facets.
  { az: 45, el: 52, hw: 8, hh: 6, radiance: 3, feather: 3 },
  { az: 135, el: 48, hw: 7, hh: 6, radiance: 2.6, feather: 3 },
  { az: -135, el: 54, hw: 9, hh: 5, radiance: 2.8, feather: 3 },
  { az: -45, el: 46, hw: 7, hh: 7, radiance: 3.2, feather: 3 },
  // Bounce card under the piece.
  { az: 0, el: -62, hw: 30, hh: 30, radiance: 1.2, feather: 10, round: true },
  // The camera and the person behind it: the arrows in a face-up stone. Dark
  // grey, not black: black arrows read as a hole in the stone on screen.
  { az: 0, el: 6, hw: 18, hh: 18, radiance: 0.07, feather: 8, round: true },
  // Pinpoint sources: one facet, one flash.
  { az: -32, el: 38, hw: 2.2, hh: 2.2, radiance: 40, feather: 1, round: true },
  { az: 38, el: 30, hw: 2, hh: 2, radiance: 36, feather: 1, round: true },
  { az: -140, el: 44, hw: 2, hh: 2, radiance: 30, feather: 1, round: true },
  { az: 115, el: 52, hw: 2, hh: 2, radiance: 30, feather: 1, round: true },
  { az: 8, el: 66, hw: 2.4, hh: 2.4, radiance: 34, feather: 1, round: true },
];

/** The studio itself, by elevation, before any light: dark, never black. */
/*
 * Light grey walls, never dark. Tuned against the leading commercial viewer's
 * stones, which read as bright white and light grey with soft mid-grey
 * structure and almost no true black: the strip lights still give the facet
 * mosaic (about 8:1 against these walls), but a facet that misses a light
 * lands on pale grey instead of black, which is what keeps the stone "icy".
 */
function shell(elDeg: number): number {
  if (elDeg > 40) return 0.42;
  if (elDeg > 0) return 0.22 + (elDeg / 40) * 0.2;
  if (elDeg > -30) return 0.17;
  return 0.3;
}

function wrap180(a: number): number {
  let x = ((a + 180) % 360) - 180;
  if (x < -180) x += 360;
  return x;
}

function radiance(azDeg: number, elDeg: number): number {
  let r = shell(elDeg);
  for (const p of PATCHES) {
    const dAz = wrap180(azDeg - p.az) * Math.cos(elDeg * DEG); // arc length across
    const dEl = elDeg - p.el;
    let edge: number;
    if (p.round) {
      edge = Math.hypot(dAz, dEl) - p.hw;
    } else {
      edge = Math.max(Math.abs(dAz) - p.hw, Math.abs(dEl) - p.hh);
    }
    if (edge >= p.feather) continue;
    const w = edge <= 0 ? 1 : 1 - edge / p.feather;
    const s = w * w * (3 - 2 * w); // smoothstep
    r = r * (1 - s) + p.radiance * s;
  }
  return r;
}

const WIDTH = 1024;
const HEIGHT = 512;

let cached: THREE.DataTexture | null = null;

/** The diamond photography environment, baked once per page. */
export function getGemStudio(): THREE.DataTexture {
  if (cached) return cached;
  const data = new Uint16Array(WIDTH * HEIGHT * 4);
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let y = 0; y < HEIGHT; y++) {
    // Row 0 is v = 0, straight down (DataTexture is not flipped).
    const el = ((y + 0.5) / HEIGHT - 0.5) * 180;
    for (let x = 0; x < WIDTH; x++) {
      /*
       * Inverse of equirectUv: u = atan2(z, x) / 2π + 0.5, so the column gives
       * the angle from +X toward +Z. Azimuth here is measured from +Z toward
       * +X, i.e. 90° minus that.
       */
      const lon = ((x + 0.5) / WIDTH - 0.5) * 360;
      const az = wrap180(90 - lon);
      const h = THREE.DataUtils.toHalfFloat(radiance(az, el));
      const i = (y * WIDTH + x) * 4;
      data[i] = h;
      data[i + 1] = h;
      data[i + 2] = h;
      data[i + 3] = one;
    }
  }
  const tex = new THREE.DataTexture(data, WIDTH, HEIGHT, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}

/*
 * A real studio photograph, prepared for the STONES.
 *
 * The same HDRI the metal reflects, but the stones get their own copy: half
 * size (1024 x 512) and half-float, box-filtered down on the CPU once. Handing
 * the diamond shader the full-size map drei loads for the metal reliably made
 * an integrated Intel GPU drop the WebGL context in the studio (the try-on,
 * which loads its own copy, never did). Half size is also a quarter of the
 * memory on a phone, and a stone is far too small for the difference to show.
 */
/** The camera lens painted into a photographed gem room; see loadGemPhoto. */
const LENS = { el: 4, radius: 20, feather: 9, floor: 0.06 };

const photoCache = new Map<string, Promise<THREE.DataTexture>>();

export function loadGemPhoto(url: string): Promise<THREE.DataTexture> {
  const hit = photoCache.get(url);
  if (hit) return hit;
  const p = (async () => {
    const { HDRLoader } = await import("three/examples/jsm/loaders/HDRLoader.js");
    const src = await new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(url);
    const sw = src.image.width as number;
    const sh = src.image.height as number;
    const sd = src.image.data as Uint16Array;
    const w = Math.max(1, sw >> 1);
    const h = Math.max(1, sh >> 1);
    const out = new Uint16Array(w * h * 4);
    const from = THREE.DataUtils.fromHalfFloat;
    const to = THREE.DataUtils.toHalfFloat;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const i = ((y * 2 + dy) * sw + (x * 2 + dx)) * 4 + c;
              sum += from(sd[i]);
            }
          }
          // Clamped: a lamp in a real HDR can sit far past what half-float
          // post effects survive (bloom turns it into Inf and the GPU resets).
          out[(y * w + x) * 4 + c] = to(Math.min(sum / 4, 64));
        }
        out[(y * w + x) * 4 + 3] = to(1);
      }
    }
    /*
     * The photographer's camera: a dark disc straight in front of the stone.
     *
     * Looking down into a real diamond you see your own dark lens reflected
     * and split by the pavilion mains into the eight dark arrows; that crisp
     * pattern is most of what reads as "real diamond" face-up. A bright, even
     * studio photo has light where the camera would be, so the arrows never
     * form and the stone reads as white glass. The stones look into their
     * room camera-locked (GemRefraction viewLocked), so +Z is always the
     * camera and the arrows hold from every angle.
     */
    const flip = src.flipY; // HDR rows run top to bottom when flipped
    for (let y = 0; y < h; y++) {
      const t = (y + 0.5) / h;
      const el = flip ? 90 - t * 180 : t * 180 - 90;
      for (let x = 0; x < w; x++) {
        const lon = ((x + 0.5) / w - 0.5) * 360;
        const az = wrap180(90 - lon);
        const d = Math.hypot(az * Math.cos(el * DEG), el - LENS.el) - LENS.radius;
        if (d >= LENS.feather) continue;
        const k = d <= 0 ? 1 : 1 - d / LENS.feather;
        const s = k * k * (3 - 2 * k);
        const keep = 1 - s * (1 - LENS.floor);
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) out[i + c] = to(from(out[i + c]) * keep);
      }
    }
    src.dispose();
    const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    // Same orientation HDRLoader gives the metal's map, so the two agree.
    tex.flipY = src.flipY;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  })();
  p.catch(() => photoCache.delete(url));
  photoCache.set(url, p);
  return p;
}
