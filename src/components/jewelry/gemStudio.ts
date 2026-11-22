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
  { az: 0, el: -62, hw: 30, hh: 30, radiance: 0.9, feather: 10, round: true },
  // The camera and the person behind it: the arrows in a face-up stone.
  { az: 0, el: 6, hw: 22, hh: 22, radiance: 0.004, feather: 6, round: true },
  // Pinpoint sources: one facet, one flash.
  { az: -32, el: 38, hw: 2.2, hh: 2.2, radiance: 40, feather: 1, round: true },
  { az: 38, el: 30, hw: 2, hh: 2, radiance: 36, feather: 1, round: true },
  { az: -140, el: 44, hw: 2, hh: 2, radiance: 30, feather: 1, round: true },
  { az: 115, el: 52, hw: 2, hh: 2, radiance: 30, feather: 1, round: true },
  { az: 8, el: 66, hw: 2.4, hh: 2.4, radiance: 34, feather: 1, round: true },
];

/** The studio itself, by elevation, before any light: dark, never black. */
function shell(elDeg: number): number {
  if (elDeg > 40) return 0.22;
  if (elDeg > 0) return 0.06 + (elDeg / 40) * 0.16;
  if (elDeg > -30) return 0.06;
  return 0.12;
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
