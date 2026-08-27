/**
 * The piece's extent, structurally identical to `Fit` in Model.tsx.
 *
 * Declared here rather than imported so this module stays free of JSX: the test
 * suite compiles it standalone, and importing a type out of a .tsx file drags
 * the whole component in with it.
 */
export interface FitExtent {
  /** Bounding-sphere radius. */
  radius: number;
  /** Footprint radius in XZ; the turntable spins about Y. */
  radiusXZ: number;
  /** Half extent in Y. */
  halfHeight: number;
}

/*
 * Framing, in one place.
 *
 * This maths existed twice — once in the viewer for the live camera, once in
 * studio.ts for exports — with the same constants copied into both. That is
 * survivable while there is one projection, and a guaranteed divergence the
 * moment there are two: an orthographic still that does not match the viewport
 * is not obviously wrong until a client lays it beside a perspective one.
 *
 * So both call sites now come here, and the orthographic branch lives next to
 * the perspective branch where the difference is visible.
 */

export type Projection = "perspective" | "orthographic";

export interface CameraSettings {
  projection: Projection;
  /** Vertical field of view, degrees. Perspective only. */
  fov: number;
  /**
   * Clipping planes, as fractions of the distance to the piece.
   *
   * Absolute distances would be meaningless here: every piece is normalised to
   * a unit sphere on load, so a near plane of "11" — what a CAD tool shows —
   * would be far behind the model. As a fraction, raising it slices into the
   * front of the piece, which is what a clipping plane is actually used for.
   */
  nearFactor: number;
  farFactor: number;
  /**
   * Which axis the source file treats as up.
   *
   * Rhino and most CAD exports are Z-up; three.js is Y-up. A piece from an OBJ
   * or STL therefore arrives lying on its side, which reads as a broken import
   * rather than a convention mismatch. Correcting it here rather than at upload
   * matters because nobody knows which convention a file used until they see it
   * on screen.
   */
  upAxis: "y" | "z" | "x";
  /**
   * Exactly where the camera sits, or null to let the framing decide.
   *
   * Null is the normal state: the camera is placed on the standard three-quarter
   * direction at whatever distance frames the piece, and orbiting moves it from
   * there. A number here pins it, which is what a jeweller reproducing a shot
   * across twenty pieces needs — "the same angle" is a position, not a gesture.
   */
  position: [number, number, number] | null;
  /** Shows the bare mesh with no materials, for checking a model before styling. */
  rawGeometry: boolean;
  /** Spins the piece itself, independently of the camera. */
  spinAxis: "none" | "x" | "y" | "z";
  /** Turns per second at 1.0. */
  spinSpeed: number;
}

export const DEFAULT_CAMERA: CameraSettings = {
  projection: "perspective",
  fov: 38,
  nearFactor: 0.001,
  farFactor: 20,
  upAxis: "y",
  // Framed, not pinned — the behaviour every piece has had.
  position: null,
  rawGeometry: false,
  spinAxis: "none",
  spinSpeed: 0.5,
};

/** Breathing room around the piece so it never touches the viewport edge. */
export const FIT_MARGIN = 1.12;

/** Three-quarter view direction, pre-normalised. See the note in Viewer.tsx. */
export const VIEW_DIR: readonly [number, number, number] = [0.2156034, 0.1764028, 0.9604151];

export interface Framing {
  /** How far the camera sits from the centre of the piece. */
  distance: number;
  near: number;
  far: number;
  /**
   * Half-height of the orthographic frustum, in world units. Undefined for a
   * perspective camera, which gets its extent from the field of view instead.
   */
  orthoHalfHeight?: number;
}

/**
 * Where to put the camera, and how deep to make it, to frame the whole piece.
 *
 * `aspect` is width / height of whatever is being rendered into — the viewport
 * live, the export dimensions when downloading. They differ constantly: a 9:16
 * reel taken from a landscape window.
 */
export function frameFit(fit: FitExtent, settings: CameraSettings, aspect: number): Framing {
  if (settings.projection === "orthographic") {
    /*
     * An orthographic camera has no perspective, so distance does not change
     * the size of anything — it only decides what falls inside the clipping
     * planes. Stand off by a fixed multiple of the piece and size the frustum
     * to the piece instead.
     */
    const halfHeight =
      Math.max(fit.halfHeight, aspect > 0 ? fit.radiusXZ / aspect : fit.radiusXZ) * FIT_MARGIN;
    const distance = Math.max(fit.radius * 4, MIN_DISTANCE);
    return {
      distance,
      orthoHalfHeight: halfHeight,
      // Generous either side: the piece must never clip against its own
      // standoff, and depth precision is not a concern without perspective.
      ...clipPlanes(distance, settings, fit.radius),
    };
  }

  /*
   * `fov` is the VERTICAL field of view. A wide necklace in a portrait frame is
   * limited horizontally instead, so solve both and take whichever is tighter.
   *
   * The `+ radiusXZ` clears the half of the footprint nearest the camera, which
   * a centre-only fit would push out of frame.
   */
  const tanV = Math.tan((settings.fov * Math.PI) / 360);
  const tanH = tanV * aspect;
  const forHeight = fit.halfHeight / tanV + fit.radiusXZ;
  const forWidth = (aspect > 0 ? fit.radiusXZ / tanH : 0) + fit.radiusXZ;
  /*
   * Floored, because a degenerate model - every vertex at one point - gives a
   * distance of zero, and a zero distance gives a far plane of zero while near
   * still clamps to 1e-5. That is near > far: not an exception, just a broken
   * projection matrix and a black viewport.
   */
  const distance = Math.max(Math.max(forHeight, forWidth) * FIT_MARGIN, MIN_DISTANCE);

  return { distance, ...clipPlanes(distance, settings, fit.radius) };
}

/** Smallest camera standoff that still yields a usable frustum. */
const MIN_DISTANCE = 1e-4;

/** Clipping planes for a camera already at `distance`, without re-framing. */
export function clipPlanes(
  distance: number,
  settings: CameraSettings,
  fitRadius: number,
): { near: number; far: number } {
  const near = Math.max(
    settings.projection === "orthographic"
      ? distance - fitRadius * 4
      : distance * settings.nearFactor,
    1e-5,
  );
  const far =
    settings.projection === "orthographic"
      ? distance + fitRadius * 4
      : distance * settings.farFactor;
  // far must clear near even for a degenerate model, or the depth buffer is
  // undefined and nothing draws.
  return { near, far: Math.max(far, near * 1000) };
}

/**
 * Rotation, in radians, that brings a file's up-axis onto three's Y.
 *
 * Returned as a tuple rather than applied, so the caller can set it on the
 * group and let the existing bounding-box fit re-measure the rotated piece —
 * rotating after the fit would leave the camera framing the old orientation.
 */
export function upAxisRotation(axis: CameraSettings["upAxis"]): [number, number, number] {
  switch (axis) {
    case "z":
      // Z-up to Y-up: tip the model backwards a quarter turn about X.
      return [-Math.PI / 2, 0, 0];
    case "x":
      return [0, 0, Math.PI / 2];
    default:
      return [0, 0, 0];
  }
}

/** Minimal shape of the two camera types, so this module needs no three import. */
export interface CameraLike {
  isOrthographicCamera?: boolean;
  fov?: number;
  aspect?: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  near: number;
  far: number;
  updateProjectionMatrix(): void;
}

/**
 * Reshapes a camera for a given output aspect ratio.
 *
 * A perspective camera takes the ratio directly; an orthographic one has no
 * concept of it and needs its frustum rebuilt. Getting this wrong is invisible
 * on screen and obvious in a downloaded file, which is why it lives here rather
 * than being written out at each call site.
 */
export function applyAspect(camera: CameraLike, aspect: number, orthoHalfHeight?: number): void {
  if (camera.isOrthographicCamera) {
    const halfH = orthoHalfHeight ?? camera.top ?? 1;
    const halfW = halfH * aspect;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
  } else {
    camera.aspect = aspect;
  }
  camera.updateProjectionMatrix();
}

/**
 * Where the camera should be, given a framing and any explicit override.
 *
 * One function answers this so the viewport and an export cannot disagree about
 * a pinned camera — the failure being a download taken from the framed angle
 * while the screen shows the pinned one.
 *
 * A pinned position at the origin is rejected rather than honoured: the camera
 * would be inside the piece looking at itself, `lookAt` would have no direction
 * to work with, and the result is a blank frame that looks like a broken render.
 */
export function cameraPosition(
  settings: CameraSettings,
  distance: number,
): [number, number, number] {
  const p = settings.position;
  if (p && (p[0] !== 0 || p[1] !== 0 || p[2] !== 0)) return [p[0], p[1], p[2]];
  return [VIEW_DIR[0] * distance, VIEW_DIR[1] * distance, VIEW_DIR[2] * distance];
}

/** True when the camera is pinned rather than framed. */
export function isPinned(settings: CameraSettings): boolean {
  const p = settings.position;
  return !!p && (p[0] !== 0 || p[1] !== 0 || p[2] !== 0);
}

/**
 * Which way up a file's contents will stand, described rather than drawn.
 *
 * Used by the import prompt. The point of asking at all is that nobody knows
 * which convention a file used until they see it: Rhino and most CAD exports
 * are Z-up, three is Y-up, so a Z-up piece arrives lying on its side and reads
 * as a broken import rather than a convention mismatch.
 */
export const UP_AXES: { value: CameraSettings["upAxis"]; label: string; hint: string }[] = [
  { value: "y", label: "Y up", hint: "Already upright — GLB, and most web formats" },
  { value: "z", label: "Z up", hint: "Rhino, and most CAD exports" },
  { value: "x", label: "X up", hint: "Rare; try it if the piece lies on its side the other way" },
];

/**
 * The up-axis a file most likely uses, from its extension.
 *
 * A guess, and offered as one. It is right often enough to save the common case
 * and cheap enough to be worth making, but the prompt still shows the choice
 * rather than silently rotating someone's model.
 */
export function guessUpAxis(fileName: string): CameraSettings["upAxis"] {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  // .3dm is decoded to Y-up by our own worker; the CAD interchange formats are
  // written by tools that are almost all Z-up. FBX genuinely varies by which
  // tool wrote it (Maya's own convention is Y-up, but the CAD/jewellery tools
  // this app actually sees FBX from are typically Z-up) — grouped with
  // obj/stl as the better default for this audience, not a claim that FBX
  // itself has one true convention. The import prompt still asks either way.
  return ext === "obj" || ext === "stl" || ext === "fbx" ? "z" : "y";
}
