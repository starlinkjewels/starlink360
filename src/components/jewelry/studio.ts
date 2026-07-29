import * as THREE from "three";
import type { Fit } from "./Model";

/*
 * Studio export.
 *
 * Everything here renders offline — the camera is moved, a frame is drawn at a
 * chosen resolution, the pixels are read back, and the viewport is restored.
 * Because nothing is captured in real time, a slow machine costs time and never
 * quality: a phone that needs two seconds a frame still produces the same
 * pixel-exact 1080p file a fast desktop does.
 */

export interface AnglePreset {
  id: string;
  label: string;
  /** Direction from the piece to the camera; length is ignored. */
  dir: [number, number, number];
  /** Multiplier on the fitted distance — below 1 moves in for a detail shot. */
  zoom?: number;
}

/**
 * The standard set a jeweller shoots. Three-quarter first because it is the
 * shot that actually sells a piece — it shows the face, the depth of the
 * setting and the profile of the shank at once.
 */
export const ANGLE_PRESETS: AnglePreset[] = [
  { id: "three-quarter", label: "Three-quarter", dir: [0.55, 0.42, 1] },
  { id: "front", label: "Front", dir: [0, 0, 1] },
  { id: "left", label: "Left", dir: [-1, 0, 0.02] },
  { id: "right", label: "Right", dir: [1, 0, 0.02] },
  { id: "top", label: "Top", dir: [0, 1, 0.05] },
  { id: "back", label: "Back", dir: [0, 0.12, -1] },
  { id: "macro", label: "Macro", dir: [0.35, 0.3, 1], zoom: 0.45 },
];

/** Leaves the same breathing room the interactive view uses. */
const FIT_MARGIN = 1.12;

/**
 * Distance that frames the whole piece for a given aspect ratio.
 *
 * Mirrors the interactive framing: solve the vertical and horizontal fits and
 * take whichever is tighter, so a wide necklace still fits a portrait frame.
 */
export function fitDistance(fit: Fit, fovDeg: number, aspect: number): number {
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  const forHeight = fit.halfHeight / tanV + fit.radiusXZ;
  const forWidth = fit.radiusXZ / tanH + fit.radiusXZ;
  return Math.max(forHeight, forWidth) * FIT_MARGIN;
}

/** Places the camera on a preset, framed for the target aspect ratio. */
export function applyAngle(
  camera: THREE.PerspectiveCamera,
  preset: AnglePreset,
  fit: Fit,
  aspect: number,
) {
  const dist = fitDistance(fit, camera.fov, aspect) * (preset.zoom ?? 1);
  const dir = new THREE.Vector3(...preset.dir).normalize();
  camera.position.copy(dir).multiplyScalar(dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.near = Math.max(dist / 1000, 0.001);
  camera.far = dist * 20;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

export interface CaptureTarget {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

/**
 * Renders one frame at an arbitrary size and hands back the canvas.
 *
 * The on-screen renderer is resized rather than a separate render target being
 * used, because the transmission pass and the gem shader both key off the
 * renderer's own size — rendering into a foreign target makes the stones
 * disagree with what the viewport shows. Everything is restored afterwards.
 *
 * Requires `preserveDrawingBuffer: true`, otherwise the buffer is already
 * cleared by the time we read it.
 */
/**
 * Holds the renderer at an export size across many frames.
 *
 * `renderAtSize` resizes, renders, reads back, resizes again and re-renders —
 * two full renders and two reallocations per frame. Fine for one still; for a
 * 900-frame video it doubles the work and makes the live viewport thrash
 * between sizes, which is what reads as the page hanging. A video export enters
 * this mode once, draws every frame, then leaves once.
 */
export function beginOffscreen(
  { gl, scene, camera }: CaptureTarget,
  width: number,
  height: number,
) {
  const prevSize = gl.getSize(new THREE.Vector2());
  const prevRatio = gl.getPixelRatio();
  const prevAspect = camera.aspect;

  const patched: { mat: { resolution: THREE.Vector2 }; prev: THREE.Vector2 }[] = [];
  scene.traverse((obj) => {
    const mat = (obj as THREE.Mesh).material as unknown as { resolution?: THREE.Vector2 };
    if (mat?.resolution instanceof THREE.Vector2) {
      patched.push({ mat: mat as { resolution: THREE.Vector2 }, prev: mat.resolution.clone() });
      mat.resolution = new THREE.Vector2(width, height);
    }
  });

  gl.setPixelRatio(1);
  gl.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  return {
    /** Draws one frame at the export size. The camera must already be posed. */
    render(): HTMLCanvasElement {
      gl.render(scene, camera);
      return gl.domElement as HTMLCanvasElement;
    },
    end() {
      for (const { mat, prev } of patched) mat.resolution = prev;
      gl.setPixelRatio(prevRatio);
      gl.setSize(prevSize.x, prevSize.y, false);
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
      gl.render(scene, camera);
    },
  };
}

export function renderAtSize(
  { gl, scene, camera }: CaptureTarget,
  width: number,
  height: number,
  onFrame: (canvas: HTMLCanvasElement) => void,
) {
  const prevSize = gl.getSize(new THREE.Vector2());
  const prevRatio = gl.getPixelRatio();
  const prevAspect = camera.aspect;

  /*
   * The gem shader computes `gl_FragCoord.xy / resolution`, so any material
   * carrying a resolution uniform has to be told the render size or every stone
   * samples at the wrong coordinates and the export comes out corrupted while
   * the on-screen view looks fine.
   */
  const resolutionUniforms: { mat: { resolution: THREE.Vector2 }; prev: THREE.Vector2 }[] = [];
  scene.traverse((obj) => {
    const mat = (obj as THREE.Mesh).material as unknown as { resolution?: THREE.Vector2 };
    if (mat?.resolution instanceof THREE.Vector2) {
      resolutionUniforms.push({
        mat: mat as { resolution: THREE.Vector2 },
        prev: mat.resolution.clone(),
      });
      mat.resolution = new THREE.Vector2(width, height);
    }
  });

  try {
    // Pixel ratio 1: `width`/`height` are already the real output pixels.
    gl.setPixelRatio(1);
    gl.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    gl.render(scene, camera);
    onFrame(gl.domElement as HTMLCanvasElement);
  } finally {
    for (const { mat, prev } of resolutionUniforms) mat.resolution = prev;
    gl.setPixelRatio(prevRatio);
    gl.setSize(prevSize.x, prevSize.y, false);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    gl.render(scene, camera);
  }
}

/** Composites the frame onto a solid colour, for formats without alpha. */
function flatten(source: HTMLCanvasElement, background: string): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext("2d");
  if (!ctx) return source;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, 0, 0);
  return out;
}

/**
 * Output shapes.
 *
 * `base` is the SHORT edge, so "1080" means 1080x1920 vertical and 1920x1080
 * landscape — which is how people actually talk about 1080p reels versus 1080p
 * widescreen. Deriving both dimensions from one number keeps a chosen quality
 * consistent whichever way the frame is turned.
 */
export interface AspectPreset {
  id: string;
  label: string;
  hint: string;
  w: number;
  h: number;
}

export const ASPECTS: AspectPreset[] = [
  { id: "1x1", label: "1:1", hint: "Square · catalogue", w: 1, h: 1 },
  { id: "4x5", label: "4:5", hint: "Portrait · feed", w: 4, h: 5 },
  { id: "9x16", label: "9:16", hint: "Vertical · reels, stories", w: 9, h: 16 },
  { id: "16x9", label: "16:9", hint: "Widescreen · web, presentation", w: 16, h: 9 },
  { id: "3x2", label: "3:2", hint: "Classic photo", w: 3, h: 2 },
];

/** Pixel dimensions for an aspect at a given short-edge size, rounded even for H.264. */
export function dimensionsFor(
  aspect: AspectPreset,
  base: number,
): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return aspect.w >= aspect.h
    ? { width: even((base * aspect.w) / aspect.h), height: even(base) }
    : { width: even(base), height: even((base * aspect.h) / aspect.w) };
}

export type StillBackground = "transparent" | "white" | "black";

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  background: StillBackground,
): Promise<Blob | null> {
  // JPEG has no alpha, so a transparent request has to stay PNG.
  const useJpeg = background !== "transparent";
  const src = useJpeg ? flatten(canvas, background === "white" ? "#ffffff" : "#000000") : canvas;
  return new Promise((resolve) =>
    src.toBlob(resolve, useJpeg ? "image/jpeg" : "image/png", useJpeg ? 0.95 : undefined),
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Filenames a client can file without renaming: LP-043_three-quarter_2048.png */
export function exportName(ref: string, part: string, size: number, ext: string) {
  const slug = ref
    .replace(/^ref\.?\s*/i, "")
    .trim()
    .replace(/[^\w-]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "piece"}_${part}_${size}.${ext}`;
}
