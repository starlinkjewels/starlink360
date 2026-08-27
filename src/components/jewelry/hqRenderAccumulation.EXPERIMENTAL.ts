/*
 * PHASE 11 EXPERIMENTAL PROTOTYPE — NOT PRODUCTION CODE.
 *
 * Not imported by any production path. Pure pixel-accumulation math, with no
 * dependency on React/Three/R3F — the only thing that touches the live scene
 * is the temporary bridge in `StudioRig.tsx`, which calls `renderAtSize`
 * (the EXISTING, unmodified export renderer from `studio.ts`) once per
 * sample and hands each resulting canvas to this module. Safe to delete
 * entirely with zero effect on the shipped app.
 *
 * Tests a different hypothesis from Phase 9's multi-sample refraction
 * experiment. Phase 9 perturbed the EXIT RAY direction inside the gem
 * shader and averaged multiple environment lookups in one frame — that
 * necessarily trades sparkle for softness, because both come from the same
 * "average over a solid angle" mechanism (see that experiment's own
 * report). This prototype instead perturbs the CAMERA by a sub-pixel
 * amount between whole re-renders of the FULL, unmodified scene — the
 * standard technique behind TAA/supersampling — and accumulates full
 * frames. That anti-aliases geometric facet-to-facet EDGES (where two
 * facets meet is a real triangle edge, and a sub-pixel camera shift moves
 * exactly which facet a boundary pixel's ray actually hits) without
 * touching what a facet's INTERIOR pixels sample at all: an interior pixel
 * is nowhere near an edge, so a sub-pixel camera shift leaves its ray
 * hitting the same facet and (for all practical purposes) the same texel,
 * every sample. This is a mechanistically different, and untested, way of
 * "spending more computation" than Phase 9's.
 */

/** A 2D Halton(2,3) low-discrepancy sequence — deterministic, not random. */
function halton(index: number, base: number): number {
  let result = 0;
  let f = 1 / base;
  let i = index;
  while (i > 0) {
    result += f * (i % base);
    i = Math.floor(i / base);
    f /= base;
  }
  return result;
}

/**
 * Sub-pixel camera jitter for sample `i` of `sampleCount`, in pixel units,
 * range [-0.5, 0.5).
 *
 * Indexed from 1, not 0 — Halton(0, base) is 0 for every base, which would
 * waste one sample on the exact unjittered center (already implicitly
 * covered by every other sample's average tending toward it) instead of
 * spreading all N samples across the pixel footprint.
 */
export function subpixelJitter(i: number, sampleCount: number): { x: number; y: number } {
  if (sampleCount <= 1) return { x: 0, y: 0 };
  return {
    x: halton(i + 1, 2) - 0.5,
    y: halton(i + 1, 3) - 0.5,
  };
}

/**
 * Accumulates N already-rendered canvases (same size) into one averaged
 * canvas.
 *
 * Averages in the SAME (already tone-mapped, sRGB-encoded) space every
 * still image export already works in — `renderAtSize` hands back the
 * canvas exactly as `preserveDrawingBuffer` captured it, post
 * ACESFilmicToneMapping. A physically stricter version would accumulate in
 * linear HDR space before a single tone-map pass; this prototype
 * deliberately does not attempt that (it would mean re-deriving the
 * post-processing chain's own linear buffer, which `studio.ts`'s existing
 * export path does not currently expose — see the Phase 11 report's own
 * note on the export/composer disconnect found during this investigation)
 * — it exists to answer "does accumulation help at all", not to ship a
 * colour-correct implementation.
 */
export function accumulateFrames(frames: HTMLCanvasElement[]): HTMLCanvasElement {
  if (frames.length === 0) throw new Error("accumulateFrames: no frames given");
  const { width, height } = frames[0];
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const sctx = scratch.getContext("2d");
  if (!sctx) throw new Error("accumulateFrames: 2D context unavailable");

  const sum = new Float32Array(width * height * 4);
  for (const frame of frames) {
    sctx.clearRect(0, 0, width, height);
    sctx.drawImage(frame, 0, 0, width, height);
    const data = sctx.getImageData(0, 0, width, height).data;
    for (let i = 0; i < data.length; i++) sum[i] += data[i];
  }

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("accumulateFrames: 2D context unavailable");
  const outData = octx.createImageData(width, height);
  const n = frames.length;
  for (let i = 0; i < sum.length; i++) {
    // Alpha (every 4th byte) stays at full opacity averaging like the rest —
    // a partially-transparent stray sample would otherwise punch holes.
    outData.data[i] = Math.round(sum[i] / n);
  }
  octx.putImageData(outData, 0, 0);
  return out;
}
