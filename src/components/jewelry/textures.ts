import * as THREE from "three";

/*
 * Surface finishes, generated rather than downloaded.
 *
 * Two decisions worth stating, because both look like shortcuts and are not.
 *
 * GENERATED, NOT SHIPPED. A hammered or brushed finish is a regular pattern
 * described in a few lines of arithmetic. Shipping ten tileable PNGs would add
 * megabytes to a product whose whole premise is that it runs with no backend on
 * a phone, and they would still need generating at some size or other. These
 * are built once, cached, and tile seamlessly by construction — which a
 * photographed texture does not.
 *
 * HEIGHT, NOT COLOUR. On jewellery these are FINISHES, not decals: hammering
 * and brushing change how metal catches light, they do not paint it. So each
 * pattern is a height field, converted to a normal map and a roughness map.
 * Applying them as colour would tint gold grey, which is the obvious wrong
 * answer that looks plausible in a screenshot.
 */

export interface FinishTexture {
  id: string;
  label: string;
  hint: string;
  /**
   * "height" finishes are worked metal — they change how light is caught and
   * must never tint the base colour. "colour" ones are surfaces in their own
   * right, where the pattern IS the colour: velvet and wood are not gold with
   * a bumpy surface, and rendering them as height alone produces grey velvet.
   */
  kind?: "height" | "colour";
}

export const SURFACE_FINISHES: FinishTexture[] = [
  { id: "none", label: "Polished", hint: "No texture — the default" },
  { id: "brushed", label: "Brushed", hint: "Fine parallel grain" },
  // Three planishing weights. A jeweller picks by hammer face, so they are
  // separate entries rather than one entry with a size slider.
  { id: "hammer", label: "Hammer 1", hint: "Fine planishing, small face" },
  { id: "hammer2", label: "Hammer 2", hint: "Medium planishing" },
  { id: "hammer3", label: "Hammer 3", hint: "Heavy planishing, wide face" },
  { id: "florentine", label: "Florentine", hint: "Engraved crosshatch" },
  { id: "scratch", label: "Scratched", hint: "Worn, directionless" },
  { id: "noise", label: "Sandblast", hint: "Even matte grain" },
  { id: "snakeskin", label: "Snakeskin", hint: "Overlapping scales" },
  { id: "plate", label: "Metal plate", hint: "Panelled, riveted" },
  { id: "velvet", label: "Velour", hint: "Soft directional sheen" },
  { id: "opal", label: "Opal", hint: "Mottled, cloudy" },
  /*
   * The two that carry colour. Neither is a metal finish — they are the
   * surfaces a piece is photographed ON, and a jeweller reaches for them for
   * the ground plane and for prop trays.
   */
  {
    id: "velour-velvet",
    label: "Velour Velvet",
    hint: "Deep pile, colour and sheen",
    kind: "colour",
  },
  { id: "oak-veneer", label: "Oak Veneer", hint: "Open-grain wood", kind: "colour" },
];

/** Colour textures paint the base colour; height ones must never touch it. */
export function isColourTexture(finish: string): boolean {
  return SURFACE_FINISHES.find((f) => f.id === finish)?.kind === "colour";
}

const SIZE = 256;

/** Deterministic hash noise — no Math.random, so a finish is always identical. */
function hash(x: number, y: number, seed: number): number {
  /*
   * Every constant stays inside 32 bits on purpose. A larger multiplier reads
   * fine and is a lie: it exceeds Number.MAX_SAFE_INTEGER, so the value the
   * engine uses is not the one written, and the hash quietly loses entropy.
   * `| 0` keeps each step in integer range rather than drifting into floats.
   */
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1597334677);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth value noise, tiling on `period` so the map has no visible seam. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = (i: number, j: number) =>
    hash(((i % period) + period) % period, ((j % period) + period) % period, seed);
  const a = w(xi, yi);
  const b = w(xi + 1, yi);
  const c = w(xi, yi + 1);
  const d = w(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/** Several octaves, for grain that has both coarse and fine structure. */
function fbm(x: number, y: number, base: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = base;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq, y * freq, Math.round(freq), seed + o) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Height field for one finish, in 0..1.
 *
 * `u` and `v` are 0..1 across the tile. Every pattern is written so that its
 * value at u=0 equals its value at u=1 — otherwise the seam shows as a line
 * running round the band.
 */
export function heightAt(finish: string, u: number, v: number): number {
  const TAU = Math.PI * 2;
  switch (finish) {
    case "brushed":
      // Long streaks along u, with fine break-up across v.
      return 0.5 + (fbm(u * 2, v * 64, 4, 11) - 0.5) * 0.55 + Math.sin(v * TAU * 90) * 0.05;

    case "hammer":
    case "hammer2":
    case "hammer3": {
      /*
       * Overlapping dimples on a jittered grid — the look of planished metal.
       * Fewer cells means a wider hammer face and a deeper dish, which is the
       * physical difference between the three weights.
       */
      const cells = finish === "hammer" ? 10 : finish === "hammer2" ? 7 : 4;
      const depth = finish === "hammer" ? 0.5 : finish === "hammer2" ? 0.65 : 0.8;
      let best = 1;
      /*
       * The jitter is hashed on the WRAPPED cell index, so the dimple in cell
       * -1 is the same dimple as the one in cell 6. Hashing the raw index gives
       * the two sides of the tile different offsets, and the mismatch shows as
       * a line of half-dimples running round the band.
       */
      const wrap = (n: number) => ((n % cells) + cells) % cells;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = Math.floor(u * cells) + dx;
          const cy = Math.floor(v * cells) + dy;
          const jx = (cx + hash(wrap(cx), wrap(cy), 3)) / cells;
          const jy = (cy + hash(wrap(cx), wrap(cy), 7)) / cells;
          // Wrap the distance so dimples continue across the seam.
          let ddx = u - jx;
          let ddy = v - jy;
          if (ddx > 0.5) ddx -= 1;
          if (ddx < -0.5) ddx += 1;
          if (ddy > 0.5) ddy -= 1;
          if (ddy < -0.5) ddy += 1;
          best = Math.min(best, Math.hypot(ddx, ddy) * cells);
        }
      }
      return 1 - depth + Math.min(best, 1) * depth;
    }

    case "florentine": {
      // Two sets of fine engraved lines crossing at an angle.
      const a = Math.sin((u + v) * TAU * 40);
      const b = Math.sin((u - v) * TAU * 40);
      return 0.5 + (a * 0.25 + b * 0.25) * 0.5;
    }

    case "scratch": {
      // Sparse directionless wear over a near-flat surface.
      const s = fbm(u * 3, v * 3, 3, 23, 5);
      const line = Math.abs(Math.sin((u * 13 + v * 7 + s * 6) * TAU));
      return 0.85 - Math.pow(1 - line, 26) * 0.7;
    }

    case "noise":
      return 0.4 + fbm(u, v, 48, 5, 3) * 0.6;

    case "snakeskin": {
      // Offset rows of rounded scales.
      const rows = 16;
      const row = Math.floor(v * rows);
      const offset = row % 2 === 0 ? 0 : 0.5;
      const sx = ((u * rows + offset) % 1) - 0.5;
      const sy = ((v * rows) % 1) - 0.5;
      const d = Math.hypot(sx, sy * 1.4);
      return 0.35 + Math.max(0, 1 - d * 2.2) * 0.65;
    }

    case "plate": {
      // Flat panels with a groove between them and a rivet at each corner.
      const cells = 4;
      const gx = Math.abs(((u * cells) % 1) - 0.5);
      const gy = Math.abs(((v * cells) % 1) - 0.5);
      const groove = Math.min(gx, gy) < 0.06 ? 0.35 : 0.85;
      const rx = ((u * cells) % 1) - 0.15;
      const ry = ((v * cells) % 1) - 0.15;
      const rivet = Math.hypot(rx, ry) < 0.07 ? 1 : 0;
      return Math.max(groove, rivet);
    }

    case "velour-velvet":
      // Pile depth, which drives the sheen. The colour comes from colourAt.
      return 0.5 + (fbm(u * 70, v * 70, 32, 61, 3) - 0.5) * 0.35;

    case "oak-veneer": {
      // Growth rings stretched along the grain, with fine pores across it.
      const rings = Math.sin((v * 7 + fbm(u * 2, v * 9, 4, 71, 3) * 2.2) * TAU);
      const pores = fbm(u * 60, v * 8, 32, 73, 2);
      return 0.55 + rings * 0.18 + (pores - 0.5) * 0.22;
    }

    case "velvet":
      // Very fine directional fibre; almost flat, all in the sheen.
      return 0.5 + (fbm(u * 90, v * 6, 32, 31, 2) - 0.5) * 0.3;

    case "opal":
      // Broad soft cloud structure.
      return 0.35 + fbm(u, v, 4, 41, 5) * 0.65;

    default:
      return 1;
  }
}

/**
 * The colour of a colour texture at one point, as 0..255 sRGB.
 *
 * Only the "colour" finishes have one. Asking a height finish for its colour
 * returns null rather than a grey, because a caller that then painted that grey
 * onto gold would produce exactly the tinted-metal bug the height/colour split
 * exists to prevent.
 */
export function colourAt(
  finish: string,
  u: number,
  v: number,
): { r: number; g: number; b: number } | null {
  const TAU = Math.PI * 2;

  if (finish === "velour-velvet") {
    /*
     * A deep saturated pile. Velvet's look is the sheen, so the base is dark
     * and the variation is in brightness rather than hue — a velvet that
     * changes colour across the cloth reads as printed fabric.
     */
    const pile = fbm(u * 70, v * 70, 32, 61, 3);
    const sheen = 0.55 + pile * 0.45;
    return { r: Math.round(38 * sheen), g: Math.round(22 * sheen), b: Math.round(58 * sheen) };
  }

  if (finish === "oak-veneer") {
    // Rings run across the grain, so they modulate towards the darker latewood.
    const rings = Math.sin((v * 7 + fbm(u * 2, v * 9, 4, 71, 3) * 2.2) * TAU) * 0.5 + 0.5;
    const pores = fbm(u * 60, v * 8, 32, 73, 2);
    const t = rings * 0.7 + pores * 0.3;
    return {
      r: Math.round(150 - t * 58),
      g: Math.round(112 - t * 50),
      b: Math.round(72 - t * 34),
    };
  }

  return null;
}

/** Which maps a finish drives. Every one can be turned off independently. */
export interface TextureChannels {
  /** Base colour. Only meaningful for a colour texture. */
  color: boolean;
  roughness: boolean;
  normal: boolean;
  /** True height displacement of the shading, alongside the normal. */
  bump: boolean;
}

export const DEFAULT_CHANNELS: TextureChannels = {
  color: true,
  roughness: true,
  normal: true,
  bump: false,
};

/**
 * Builds the normal and roughness maps for a finish.
 *
 * The normal map is derived from the height field by central difference — the
 * slope in each direction becomes the tilt of the surface — rather than being
 * authored separately, so the two can never disagree.
 */
export interface FinishMaps {
  normalMap: THREE.DataTexture | null;
  roughnessMap: THREE.DataTexture | null;
  bumpMap: THREE.DataTexture | null;
  /** Present only for a colour texture with its colour channel on. */
  map: THREE.DataTexture | null;
}

export function createFinishMaps(
  finish: string,
  strength = 1,
  channels: TextureChannels = DEFAULT_CHANNELS,
): FinishMaps | null {
  if (finish === "none") return null;

  const h = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      h[y * SIZE + x] = heightAt(finish, x / SIZE, y / SIZE);
    }
  }

  const normal = new Uint8Array(SIZE * SIZE * 4);
  const rough = new Uint8Array(SIZE * SIZE * 4);
  const bump = new Uint8Array(SIZE * SIZE * 4);
  // Only allocated when there is actually a colour to store.
  const wantsColour = channels.color && isColourTexture(finish);
  const colour = wantsColour ? new Uint8Array(SIZE * SIZE * 4) : null;
  // Wrapped lookups keep the derivative continuous across the seam.
  const at = (x: number, y: number) =>
    h[(((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE)];

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength * 4;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength * 4;
      // Tangent-space normal of the slope, packed into 0..255.
      const len = Math.hypot(-dx, -dy, 1);
      const i = (y * SIZE + x) * 4;
      normal[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      normal[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      normal[i + 2] = Math.round((1 / len) * 0.5 * 255 + 127);
      normal[i + 3] = 255;

      /*
       * Low ground is rougher than high ground: a hammer dimple or a scratch
       * scatters light where the polish has been broken, which is what makes
       * the finish read as worked metal rather than a bumpy mirror.
       */
      const r = Math.round((1 - at(x, y)) * 180 + 20);
      rough[i] = r;
      rough[i + 1] = r;
      rough[i + 2] = r;
      rough[i + 3] = 255;

      // Bump is the height itself, greyscale.
      const b = Math.round(at(x, y) * 255);
      bump[i] = b;
      bump[i + 1] = b;
      bump[i + 2] = b;
      bump[i + 3] = 255;

      if (colour) {
        const c = colourAt(finish, x / SIZE, y / SIZE) ?? { r: 128, g: 128, b: 128 };
        colour[i] = c.r;
        colour[i + 1] = c.g;
        colour[i + 2] = c.b;
        colour[i + 3] = 255;
      }
    }
  }

  const make = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    // Normal and roughness are data, not colour — an sRGB decode would bend
    // both, tilting every normal and lightening every roughness value.
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };

  return {
    normalMap: channels.normal ? make(normal, false) : null,
    roughnessMap: channels.roughness ? make(rough, false) : null,
    bumpMap: channels.bump ? make(bump, false) : null,
    // Colour IS colour, so this one is decoded as sRGB while the others are
    // data — decoding a normal map as sRGB tilts every normal in it.
    map: colour ? make(colour, true) : null,
  };
}

const cache = new Map<string, FinishMaps | null>();

/**
 * Built once per finish and channel set, then shared by every mesh using it.
 *
 * Keyed on the channels as well as the finish: two parts wearing the same
 * hammer with different channels enabled are different textures, and returning
 * the first one for both would silently ignore the second part's settings.
 */
export function getFinishMaps(
  finish: string,
  channels: TextureChannels = DEFAULT_CHANNELS,
  repeat = 1,
) {
  /*
   * `repeat` is part of the key, not something the caller sets afterwards.
   *
   * These textures are shared by every mesh using the finish, and `repeat`
   * lives on the texture rather than the material — so a caller that set it
   * after the fact would be changing it for every other part too, and the last
   * part to render would decide the scale for all of them.
   */
  const r = Math.max(0.05, Math.min(64, repeat));
  const key = `${finish}|${channels.color ? 1 : 0}${channels.roughness ? 1 : 0}${
    channels.normal ? 1 : 0
  }${channels.bump ? 1 : 0}|${r.toFixed(3)}`;

  if (!cache.has(key)) {
    const maps = createFinishMaps(finish, 1, channels);
    for (const map of [maps?.normalMap, maps?.roughnessMap, maps?.bumpMap, maps?.map]) {
      map?.repeat.set(r, r);
    }
    cache.set(key, maps);
  }
  return cache.get(key) ?? null;
}

/**
 * Gives geometry a UV set derived from position, when it has none.
 *
 * Rhino render meshes almost never carry UVs, and a texture lookup without them
 * samples one texel for the whole mesh — a flat tint that looks like the
 * texture simply failed. This box-projects onto whichever axis each triangle
 * most faces, which tiles a repeating finish correctly on the curved bands and
 * flat faces that jewellery is made of.
 *
 * Returns false when the geometry already had UVs, which are always better.
 */
export function ensureProjectedUVs(geometry: THREE.BufferGeometry, scale: number): boolean {
  if (geometry.attributes.uv) return false;
  const pos = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  if (!pos || !nrm) return false;

  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const nz = Math.abs(nrm.getZ(i));
    let u: number;
    let v: number;
    if (nx >= ny && nx >= nz) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else if (ny >= nz) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return true;
}

/*
 * ── A texture as a per-part setting ─────────────────────────────────────────
 *
 * The surface finish used to be one global choice on the metal. It is a
 * property of a part, the same way its metal is: a brushed shank with polished
 * prongs is an ordinary piece, and expressing it needed the finish to move onto
 * the part alongside the material.
 */

export interface TextureAssignment {
  /** Finish id, or "none". */
  finish: string;
  /** Off keeps the choice without applying it, so it can be toggled back. */
  enabled: boolean;
  channels: TextureChannels;
  /** How many times the pattern repeats across the piece. */
  scale: number;
  /** Depth of the normal and bump response. */
  strength: number;
}

export const DEFAULT_TEXTURE: TextureAssignment = {
  finish: "none",
  enabled: true,
  channels: DEFAULT_CHANNELS,
  scale: 8,
  strength: 1,
};

/** Nothing to draw: no finish chosen, switched off, or every channel off. */
export function isTextureInert(t: TextureAssignment | undefined): boolean {
  if (!t || !t.enabled || t.finish === "none") return true;
  const c = t.channels;
  return !c.color && !c.roughness && !c.normal && !c.bump;
}

/**
 * A thumbnail of a finish, as a data URL.
 *
 * Drawn from the same height and colour fields the real maps come from, so the
 * swatch cannot drift from what it previews — the usual failure with a grid of
 * hand-made preview images. Small and cached; a 2D canvas, for the same reason
 * the material spheres are.
 */
const THUMBS = new Map<string, string>();

export function finishThumbnail(finish: string, size = 44): string {
  const key = `${finish}|${size}`;
  const hit = THUMBS.get(key);
  if (hit !== undefined) return hit;
  if (typeof document === "undefined") return "";

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const img = ctx.createImageData(size, size);
  const colour = isColourTexture(finish);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = (y * size + x) * 4;
      if (colour) {
        const c = colourAt(finish, u, v) ?? { r: 128, g: 128, b: 128 };
        img.data[i] = c.r;
        img.data[i + 1] = c.g;
        img.data[i + 2] = c.b;
      } else {
        /*
         * A height field shown as flat grey is unreadable — every finish looks
         * like the same mid tone. Lit from the top left instead, using the same
         * slope the normal map is built from, so a hammer dimple reads as a
         * dimple and brushing reads as grain.
         */
        const h = heightAt(finish, u, v);
        const dx = heightAt(finish, u + 1 / size, v) - h;
        const dy = heightAt(finish, u, v + 1 / size) - h;
        const lit = Math.max(0, Math.min(1, 0.62 + (-dx - dy) * 9));
        const g = Math.round(lit * 205 + 30);
        img.data[i] = g;
        img.data[i + 1] = g;
        img.data[i + 2] = g;
      }
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const url = canvas.toDataURL("image/png");
  THUMBS.set(key, url);
  return url;
}
