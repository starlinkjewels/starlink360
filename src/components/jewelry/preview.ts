/*
 * Preview spheres for the material grid.
 *
 * Drawn with a 2D canvas, not rendered with WebGL, and that is a deliberate
 * choice rather than a shortcut. Forty-two swatches rendered as real spheres
 * means forty-two scenes, each needing the current environment map to look
 * right, all re-rendered whenever the environment changes. On a machine without
 * a GPU that is seconds of stall every time the panel opens — and the thing it
 * buys is a 44-pixel circle.
 *
 * What a swatch has to do is let someone tell 18k from 14k and ruby from
 * rhodolite at a glance. A shaded circle does that, costs microseconds, and
 * cannot lose its WebGL context.
 *
 * Everything here is pure and deterministic so it can be checked without a
 * canvas: `sphereSpec` does the shading maths, `paintSphere` only draws it.
 */

/*
 * Deliberately imports nothing. The suites compile each module on its own with
 * plain tsc, and Node's ESM loader will not resolve the extensionless specifier
 * tsc emits — so a one-line helper is cheaper here than a build step.
 */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export interface SphereStop {
  /** 0 at the highlight, 1 at the silhouette. */
  at: number;
  color: string;
}

export interface SphereSpec {
  /** Radial gradient from the light spot outward. */
  stops: SphereStop[];
  /** Where the light spot sits, as a fraction of the diameter. */
  light: { x: number; y: number };
  /** Tight specular dot. Absent on a surface too rough to form one. */
  specular: { x: number; y: number; r: number; alpha: number } | null;
  /** Bounce light coming back off the ground into the lower edge. */
  rim: string;
  /** Facet glints, for stones. Empty for metal. */
  sparkles: { x: number; y: number; r: number }[];
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (v: number) =>
    Math.round(clamp(v, 0, 255))
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Towards white by `t`, which is what a highlight does to a base colour. */
export function lighten(hex: string, t: number): string {
  const { r, g, b } = hexToRgb(hex);
  const k = clamp(t, 0, 1);
  return rgbToHex({ r: r + (255 - r) * k, g: g + (255 - g) * k, b: b + (255 - b) * k });
}

/** Towards black by `t`. */
export function darken(hex: string, t: number): string {
  const { r, g, b } = hexToRgb(hex);
  const k = 1 - clamp(t, 0, 1);
  return rgbToHex({ r: r * k, g: g * k, b: b * k });
}

/** Relative luminance, for deciding whether a swatch needs an outline. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/*
 * A near-black swatch on a dark panel is a hole rather than a sphere, and a
 * near-white one on a light panel is the same problem inverted. Both need a
 * hairline so the shape survives.
 */
export function needsOutline(hex: string): boolean {
  const l = luminance(hex);
  return l < 0.12 || l > 0.9;
}

export interface MetalSpecInput {
  kind: "metal";
  color: string;
  roughness: number;
  metalness: number;
}

export interface GemSpecInput {
  kind: "gem";
  color: string;
  ior: number;
  dispersion: number;
  opaque?: boolean;
}

export type SpecInput = MetalSpecInput | GemSpecInput;

/**
 * Turns material parameters into the shading of one sphere.
 *
 * Metal and stone are shaded differently because they fail differently. A metal
 * sphere is its environment reflected, so it runs bright at the light and dark
 * at the silhouette with almost no mid-tone — the thing that separates polished
 * from brushed is how far the highlight spreads. A stone is lit from behind as
 * much as in front, so it stays luminous at the centre and picks up saturation
 * where the path through it is longest, which is the edge.
 */
export function sphereSpec(input: SpecInput): SphereSpec {
  const light = { x: 0.34, y: 0.3 };

  if (input.kind === "metal") {
    const rough = clamp(input.roughness, 0, 1);
    const metal = clamp(input.metalness, 0, 1);
    /*
     * Polished metal has almost no diffuse term: it is dark except where it
     * reflects something. Roughness spreads that reflection out, which is why a
     * brushed finish reads flatter and lighter overall.
     */
    const spread = 0.18 + rough * 0.55;
    const hot = lighten(input.color, 0.65 - rough * 0.35);
    const body = input.color;
    const edge = darken(input.color, 0.35 + metal * 0.25);

    return {
      light,
      stops: [
        { at: 0, color: hot },
        { at: spread, color: body },
        { at: 0.82, color: darken(input.color, 0.15 + rough * 0.1) },
        { at: 1, color: edge },
      ],
      // A rough surface cannot form a tight specular dot — that is the whole
      // visual difference between polished and matte.
      specular:
        rough < 0.34 ? { x: 0.3, y: 0.25, r: 0.1 - rough * 0.14, alpha: 0.9 - rough * 1.6 } : null,
      rim: lighten(input.color, 0.22),
      sparkles: [],
    };
  }

  const { color, ior, dispersion, opaque } = input;

  if (opaque) {
    // Nothing passes through, so this is a polished dielectric: dark body, one
    // hard highlight. Shading it like a gem would make onyx glow.
    return {
      light,
      stops: [
        { at: 0, color: lighten(color, 0.3) },
        { at: 0.3, color: color },
        { at: 1, color: darken(color, 0.45) },
      ],
      specular: { x: 0.3, y: 0.24, r: 0.09, alpha: 0.85 },
      rim: lighten(color, 0.14),
      sparkles: [],
    };
  }

  /*
   * A transmissive stone is pale where it is thin and saturated where it is
   * thick, so the gradient runs the opposite way to metal: light in the middle,
   * full colour at the rim. Higher IOR bends light harder and holds more of it
   * inside, which reads as a brighter, tighter core.
   */
  const core = clamp((ior - 1.5) / 1.2, 0, 1);
  return {
    light,
    stops: [
      { at: 0, color: lighten(color, 0.55 + core * 0.3) },
      { at: 0.22 + core * 0.1, color: lighten(color, 0.2) },
      { at: 0.72, color },
      { at: 1, color: darken(color, 0.3) },
    ],
    specular: { x: 0.31, y: 0.24, r: 0.085, alpha: 0.95 },
    rim: lighten(color, 0.35),
    // Fire, as glints. More dispersion, more of them — the honest visual
    // shorthand for the number, and the reason moissanite reads busier.
    sparkles: sparklePositions(dispersion),
  };
}

/**
 * Deterministic glint placement.
 *
 * A fixed hash rather than Math.random, so a swatch looks the same on every
 * render and in every test run — a sparkle that moves when React re-renders
 * reads as a rendering bug.
 */
export function sparklePositions(dispersion: number): { x: number; y: number; r: number }[] {
  const count = clamp(Math.round(dispersion * 90), 0, 7);
  const out: { x: number; y: number; r: number }[] = [];
  let h = 0x9e3779b1;
  for (let i = 0; i < count; i++) {
    h = Math.imul(h ^ (i + 1), 0x85ebca6b) >>> 0 || 1;
    const a = ((h >>> 8) % 360) * (Math.PI / 180);
    const d = 0.16 + (((h >>> 3) % 100) / 100) * 0.5;
    out.push({
      x: 0.5 + Math.cos(a) * d * 0.5,
      y: 0.5 + Math.sin(a) * d * 0.5,
      r: 0.018 + (((h >>> 17) % 100) / 100) * 0.022,
    });
  }
  return out;
}

/** Draws a spec into a square 2D context of side `size`. */
export function paintSphere(
  ctx: CanvasRenderingContext2D,
  spec: SphereSpec,
  size: number,
  outlineColor?: string,
) {
  const r = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r - 0.5, 0, Math.PI * 2);
  ctx.clip();

  const g = ctx.createRadialGradient(
    spec.light.x * size,
    spec.light.y * size,
    0,
    spec.light.x * size,
    spec.light.y * size,
    size,
  );
  for (const stop of spec.stops) g.addColorStop(clamp(stop.at, 0, 1), stop.color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // Bounce off the ground, along the bottom edge.
  const bounce = ctx.createRadialGradient(r, size * 0.96, 0, r, size * 0.96, size * 0.55);
  bounce.addColorStop(0, spec.rim);
  bounce.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = bounce;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 1;

  for (const s of spec.sparkles) {
    const sg = ctx.createRadialGradient(
      s.x * size,
      s.y * size,
      0,
      s.x * size,
      s.y * size,
      s.r * size,
    );
    sg.addColorStop(0, "rgba(255,255,255,0.95)");
    sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, size, size);
  }

  if (spec.specular) {
    const s = spec.specular;
    const sg = ctx.createRadialGradient(
      s.x * size,
      s.y * size,
      0,
      s.x * size,
      s.y * size,
      s.r * size,
    );
    sg.addColorStop(0, `rgba(255,255,255,${clamp(s.alpha, 0, 1)})`);
    sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, size, size);
  }

  ctx.restore();

  if (outlineColor) {
    ctx.beginPath();
    ctx.arc(r, r, r - 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/*
 * Cached by every input that affects the pixels, size included. A custom
 * material changes as a slider moves, so the key has to carry the values and
 * not just an id — keying on id alone would freeze the preview at the first
 * value the slider ever had.
 */
const cache = new Map<string, string>();

export function previewKey(input: SpecInput, size: number): string {
  return input.kind === "metal"
    ? `m|${size}|${input.color}|${input.roughness.toFixed(3)}|${input.metalness.toFixed(3)}`
    : `g|${size}|${input.color}|${input.ior.toFixed(3)}|${input.dispersion.toFixed(3)}|${input.opaque ? 1 : 0}`;
}

/** A data URL for one swatch. Returns "" where there is no canvas (SSR). */
export function previewUrl(input: SpecInput, size = 44): string {
  const key = previewKey(input, size);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (typeof document === "undefined") return "";

  const dpr = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(dpr, dpr);

  paintSphere(
    ctx,
    sphereSpec(input),
    size,
    needsOutline(input.color) ? "rgba(128,128,128,0.45)" : undefined,
  );
  const url = canvas.toDataURL("image/png");
  cache.set(key, url);
  return url;
}
