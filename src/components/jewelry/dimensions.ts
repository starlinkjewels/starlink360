/*
 * Model dimensions: the piece's own size, and what it's actually set with.
 *
 * Two numbers this whole feature depends on, and neither comes for free:
 *
 *  - Real millimetres. Every piece this viewer shows has already been
 *    recentred and reframed by the time it gets here, and the bundled demo
 *    product's own bounding sphere measures almost exactly 1.0 — it was
 *    normalised to a unit sphere before it ever reached this codebase, by
 *    whatever produced the file. There is no original scale left in the
 *    geometry to recover for a piece like that; a freshly uploaded file is
 *    no better off once `loadJewelryFile` has done the same thing to make
 *    unrelated files behave consistently. So real-world size is not derived,
 *    it is told: the one thing a jeweller always knows about their own piece
 *    is its actual width, and typing it in is what turns "1.00" into "31.26
 *    mm" for everything else on the piece, including the gems.
 *
 *  - Carat weight. There is no cut-angle data in a render mesh, so this is
 *    the same estimate a jeweller reaches for without a certificate: length
 *    times width times depth times a constant, standard for a round
 *    brilliant and used here for every shape since nothing in this file
 *    format says otherwise. It is exactly the formula the reference tool
 *    this was modelled on uses — checked against its own worked numbers
 *    (11.10 x 11.10 x 6.91 mm -> 5.19 ct) before relying on it.
 */
import * as THREE from "three";
/*
 * The ".js" is deliberate and required. The suites compile these modules with
 * plain tsc and run them on Node, whose ESM loader will not resolve an
 * extensionless specifier; TypeScript maps ".js" back to the ".ts" source and
 * Vite is equally happy, so one spelling satisfies all three.
 */
import { solidCount, solidRange, type Part } from "./selection.js";
import { drawableCount } from "./plan.js";

export interface DimensionSettings {
  /** Draws the width/height/depth callouts over the piece in the viewport. */
  showOnCanvas: boolean;
  /** Shows the stats and per-stone breakdown in the panel. */
  showTable: boolean;
  /**
   * The piece's real width, in millimetres.
   *
   * Starts uncalibrated (null) rather than guessing a plausible figure: a
   * made-up starting width silently scales every mm figure and the carat
   * weight to match it, which reads as a real measurement even though it
   * isn't. Null means the panel honestly shows "uncalibrated" until a real
   * width is known, either read automatically from the file (see
   * `autoDetected`) or typed in by hand.
   */
  knownWidthMM: number | null;
  /**
   * True when `knownWidthMM` came from the file's own units (Rhino's
   * document unit, or glTF's guaranteed metre) rather than a hand-typed
   * figure — worth surfacing, since one is a measurement and the other is
   * only as good as whoever typed it. Cleared the moment someone edits the
   * field, since a manual edit is no longer the file's own number.
   */
  autoDetected: boolean;
}

export const DEFAULT_DIMENSIONS: DimensionSettings = {
  showOnCanvas: false,
  showTable: false,
  knownWidthMM: null,
  autoDetected: false,
};

/** Round brilliant, published estimate. Applied to every shape — see file header. */
const CARAT_FACTOR = 0.0061;

/**
 * How much a model unit is actually worth, in millimetres.
 *
 * `widthUnits` is the piece's own bounding width, in whatever units its
 * geometry happens to be in. Null propagates: nothing downstream can show a
 * real figure without a calibration, and nothing here should guess one.
 */
export function mmPerUnit(knownWidthMM: number | null, widthUnits: number): number | null {
  if (knownWidthMM === null || widthUnits <= 0) return null;
  return knownWidthMM / widthUnits;
}

export interface StoneMeasurement {
  /** The two largest extents, in that order — the girdle plane. */
  length: number;
  width: number;
  /** The smallest extent — crown to culet, whichever axis that turns out to be. */
  depth: number;
  shape: "Round" | "Fancy";
}

/**
 * Reads a solid's true size off its own triangles, in world space.
 *
 * World space, not local: the piece is recentred and the up-axis rotated
 * once for the whole model, and a stone's own mesh carries no compensating
 * transform of its own — measuring in local space would silently rotate
 * some pieces' axes relative to others.
 */
export function boundsOfSolid(mesh: THREE.Mesh, start: number, count: number): THREE.Box3 {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  const index = geometry.index;
  const box = new THREE.Box3();
  if (!position) return box;
  mesh.updateWorldMatrix(true, false);
  const v = new THREE.Vector3();
  const end = Math.min(start + count, index ? index.count : position.count);
  for (let i = start; i < end; i++) {
    const vertexIndex = index ? index.getX(i) : i;
    v.fromBufferAttribute(position, vertexIndex).applyMatrix4(mesh.matrixWorld);
    box.expandByPoint(v);
  }
  return box;
}

/**
 * Sorts a box's extents into length/width/depth rather than trusting X/Y/Z.
 *
 * A brilliant cut is flatter on one axis than the other two regardless of how
 * the stone happens to sit in its setting, so the smallest extent is always
 * the depth — this holds under any rotation, which raw X/Y/Z would not.
 */
export function measureStone(box: THREE.Box3): StoneMeasurement {
  const size = box.getSize(new THREE.Vector3());
  const [length, width, depth] = [size.x, size.y, size.z].sort((a, b) => b - a);
  const shape = width > 0 && Math.abs(length - width) / width < 0.12 ? "Round" : "Fancy";
  return { length, width, depth, shape };
}

/** Round brilliant approximation, applied uniformly — see file header. */
export function estimateCaratWeight(lengthMM: number, widthMM: number, depthMM: number): number {
  return lengthMM * widthMM * depthMM * CARAT_FACTOR;
}

export interface GemTypeRow {
  shape: "Round" | "Fancy";
  lengthMM: number;
  widthMM: number;
  depthMM: number;
  caratEach: number;
  qty: number;
}

export interface GemSummary {
  rows: GemTypeRow[];
  totalCount: number;
  totalCaratWt: number;
}

/** Same size to the nearest 1/100 mm reads as "the same stone" for grouping. */
const GROUP_PRECISION = 2;

/**
 * Every stone on the piece, measured and grouped into the rows a jeweller
 * actually wants to see — "8 round melee at 1.89 mm", not 313 separate lines.
 *
 * `unitToMM` is `mmPerUnit` for the piece, or null when it isn't calibrated —
 * in which case every figure here is still in the model's own units, which is
 * enough to group and count by, just not to show as millimetres.
 */
export function summariseGems(parts: Part[], unitToMM: number | null): GemSummary {
  const scale = unitToMM ?? 1;
  const rows = new Map<string, GemTypeRow>();
  let totalCount = 0;
  let totalCaratWt = 0;

  for (const part of parts) {
    if (part.kind !== "stone") continue;
    const count = solidCount(part);
    const hasSolids = !!part.solids && part.solids.length > 1;

    for (let i = 0; i < count; i++) {
      const range = hasSolids
        ? solidRange(part.solids, i)
        : { start: 0, count: drawableCount(part.mesh.geometry) };
      if (!range) continue;

      const box = boundsOfSolid(part.mesh, range.start, range.count);
      if (box.isEmpty()) continue;
      const { length, width, depth, shape } = measureStone(box);
      const lengthMM = length * scale;
      const widthMM = width * scale;
      const depthMM = depth * scale;
      // Only meaningful once calibrated — an uncalibrated "carat" in bare
      // model units would be a number with no relationship to a real stone.
      const caratEach = unitToMM ? estimateCaratWeight(lengthMM, widthMM, depthMM) : 0;

      const key = `${shape}|${lengthMM.toFixed(GROUP_PRECISION)}|${widthMM.toFixed(GROUP_PRECISION)}|${depthMM.toFixed(GROUP_PRECISION)}`;
      const existing = rows.get(key);
      if (existing) existing.qty += 1;
      else rows.set(key, { shape, lengthMM, widthMM, depthMM, caratEach, qty: 1 });

      totalCount += 1;
      totalCaratWt += caratEach;
    }
  }

  return {
    rows: [...rows.values()].sort((a, b) => b.qty - a.qty || b.caratEach - a.caratEach),
    totalCount,
    totalCaratWt,
  };
}
