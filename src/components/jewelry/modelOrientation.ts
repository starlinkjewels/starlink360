/*
 * Model orientation — turning the piece itself into place.
 *
 * Distinct from `camera.ts`'s `upAxis`: that corrects a FORMAT convention
 * (Rhino/CAD exports are Z-up, three is Y-up) and is baked into the inner
 * `root` group once, at scene-build time, because it depends on which file
 * format loaded. This is a live, user-adjustable rotation on top of that
 * correction — for the case the file loaded upright but not in the pose
 * someone wants to work in, or a piece that needs a specific fixed angle for
 * a whole editing session. It lives on the OUTER wrapper group in `Model.tsx`
 * so the two never fight over the same transform.
 */

export interface ModelOrientation {
  /** Degrees, applied in X, Y, Z order after the file's own up-axis fix. */
  rotationX: number;
  rotationY: number;
  rotationZ: number;
}

export const DEFAULT_MODEL_ORIENTATION: ModelOrientation = {
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
};

/** Common angles offered as one-click buttons, alongside the free-form fields. */
export const ROTATION_PRESETS: number[] = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * "Put Horizontal" — a starting rotation, not a detected one.
 *
 * There is no reliable way to know from geometry alone which way a piece
 * "should" lie — that reads as jewellery-specific semantic understanding this
 * app does not have and should not pretend to. What this offers instead is
 * the single most common correction needed on a piece that loaded upright by
 * file convention but standing on an edge rather than lying flat: tipping it
 * -90° about X. It is exactly the same kind of one-click convenience as a
 * rotation preset, named for the case it is most often reached for, not a
 * claim that the result is correct for every piece — nudge from there with
 * the free-form fields, the same as any other preset.
 */
export function putHorizontal(): ModelOrientation {
  return { rotationX: -90, rotationY: 0, rotationZ: 0 };
}

export function clampDegrees(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const wrapped = n % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}
