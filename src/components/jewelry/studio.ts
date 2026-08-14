import * as THREE from "three";
import type { Fit } from "./Model";
import { paintBackground, paintForeground, type ResolvedBackground } from "./background";
import { applyAspect, frameFit, type CameraSettings } from "./camera";
import { hideOverlays } from "./selection";
import { DEFAULT_WATERMARK, paintWatermark, type WatermarkSettings } from "./watermark";

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

/**
 * Distance that frames the whole piece for a given aspect ratio.
 *
 * Delegates to the shared framing so an export and the viewport cannot disagree
 * — this maths used to be duplicated here, which was survivable with one
 * projection and would silently break the moment orthographic arrived.
 */
export function fitDistance(fit: Fit, settings: CameraSettings, aspect: number): number {
  return frameFit(fit, settings, aspect).distance;
}

/** Places the camera on a preset, framed for the target aspect ratio. */
export function applyAngle(
  camera: THREE.Camera,
  preset: AnglePreset,
  fit: Fit,
  aspect: number,
  settings: CameraSettings,
) {
  const framing = frameFit(fit, settings, aspect);
  const dist = framing.distance * (preset.zoom ?? 1);
  const dir = new THREE.Vector3(...preset.dir).normalize();
  camera.position.copy(dir).multiplyScalar(dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);

  const cam = camera as unknown as THREE.PerspectiveCamera & THREE.OrthographicCamera;
  cam.near = framing.near;
  cam.far = framing.far;
  /*
   * A preset zoom moves the camera closer, which shrinks nothing under an
   * orthographic projection — the frustum has to shrink instead, or "Macro"
   * exports identically to "Front".
   */
  applyAspect(
    cam,
    aspect,
    framing.orthoHalfHeight !== undefined
      ? framing.orthoHalfHeight * (preset.zoom ?? 1)
      : undefined,
  );
}

export interface CaptureTarget {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** Either projection; `applyAspect` handles the difference. */
  camera: THREE.PerspectiveCamera;
  /**
   * Draws one frame, when the scene is composed rather than rendered directly.
   *
   * Bloom runs through an EffectComposer, and an export that called `gl.render`
   * would quietly produce an unbloomed file while the screen showed bloom. So
   * the caller hands the same renderer both paths use, and `resize` keeps the
   * composer's buffers in step with the export size.
   */
  renderFrame?: { render(): void; setSize(w: number, h: number): void } | null;
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
  { gl, scene, camera, renderFrame }: CaptureTarget,
  width: number,
  height: number,
  /** Frustum half-height when the camera is orthographic. */
  orthoHalfHeight?: number,
  /** How much larger than the output to render. See SUPERSAMPLE. */
  supersample = SUPERSAMPLE.good,
) {
  const prevSize = gl.getSize(new THREE.Vector2());
  const prevRatio = gl.getPixelRatio();
  const ortho = camera as unknown as THREE.OrthographicCamera;
  const prevAspect = ortho.isOrthographicCamera
    ? (ortho.right - ortho.left) / (ortho.top - ortho.bottom)
    : camera.aspect;
  const prevOrthoHalf = ortho.isOrthographicCamera ? ortho.top : undefined;

  /*
   * Supersampling costs the square of the factor and a video pays it on every
   * frame, so the default is gentler here than for a still — 1.5x is 2.25x the
   * work and removes most of the crawling shimmer a rotating pave shows. The
   * caller can turn it off entirely for a long clip.
   */
  const factor = safeFactor(gl, width, height, supersample);
  const renderW = Math.round(width * factor);
  const renderH = Math.round(height * factor);

  const patched: { mat: { resolution: THREE.Vector2 }; prev: THREE.Vector2 }[] = [];
  scene.traverse((obj) => {
    const mat = (obj as THREE.Mesh).material as unknown as { resolution?: THREE.Vector2 };
    if (mat?.resolution instanceof THREE.Vector2) {
      patched.push({ mat: mat as { resolution: THREE.Vector2 }, prev: mat.resolution.clone() });
      mat.resolution = new THREE.Vector2(renderW, renderH);
    }
  });

  // Held down for the whole video, not per frame — a turntable is a photo too.
  const showOverlays = hideOverlays(scene);

  gl.setPixelRatio(1);
  gl.setSize(renderW, renderH, false);
  applyAspect(camera as unknown as THREE.PerspectiveCamera, width / height, orthoHalfHeight);
  renderFrame?.setSize(renderW, renderH);

  return {
    /** Draws one frame at the export size. The camera must already be posed. */
    render(): HTMLCanvasElement {
      if (renderFrame) renderFrame.render();
      else gl.render(scene, camera);
      const frame = gl.domElement as HTMLCanvasElement;
      return factor === 1 ? frame : downscale(frame, width, height);
    },
    end() {
      for (const { mat, prev } of patched) mat.resolution = prev;
      showOverlays();
      gl.setPixelRatio(prevRatio);
      gl.setSize(prevSize.x, prevSize.y, false);
      applyAspect(camera as unknown as THREE.PerspectiveCamera, prevAspect, prevOrthoHalf);
      renderFrame?.setSize(prevSize.x, prevSize.y);
      if (renderFrame) renderFrame.render();
      else gl.render(scene, camera);
    },
  };
}

/*
 * Supersampling: render bigger, then shrink.
 *
 * This is THE thing that makes an export look like a product photograph rather
 * than a screenshot, and it is not the same as the MSAA the canvas already has.
 * MSAA antialiases geometry SILHOUETTES — it samples the edges of triangles.
 * The detail that makes jewellery hard is inside the triangles: a pave of 140
 * ray-traced diamonds is high-frequency sparkle computed per fragment, and
 * multisampling does nothing for it. Shrinking a larger render averages those
 * fragments properly, which is the only fix.
 *
 * It costs the square of the factor, so 2x is four times the render. That is
 * the right trade for one still and the wrong one for nine hundred video
 * frames, which is why the caller chooses.
 */
export const SUPERSAMPLE = { none: 1, good: 1.5, best: 2 } as const;

/**
 * The largest render the driver will actually allocate.
 *
 * A supersampled 4K frame is 8192 across, which is at or past the limit on
 * software renderers and older mobile GPUs — and exceeding it does not throw,
 * it silently produces a blank or truncated frame. Better to quietly drop to a
 * smaller factor than to hand back a broken download.
 */
/**
 * The most pixels worth rendering into for one frame.
 *
 * The texture limit is about what the driver will ALLOCATE. This is about what
 * the machine will finish. A 4K still at 2x is 33 million pixels, and on a
 * software renderer — which is what this runs on when there is no GPU — a
 * gem-traced frame at that size is minutes, not seconds. Someone presses
 * Download, nothing happens for long enough to assume it is broken, and they
 * press it again.
 *
 * 24 million keeps 4K at roughly 1.7x, which is most of the benefit: the sharp
 * gain from supersampling is between 1x and 1.5x, and beyond 2x it is barely
 * distinguishable. HD and 2K are unaffected — both fit at the full 2x.
 */
const MAX_RENDER_PIXELS = 24_000_000;

function safeFactor(gl: THREE.WebGLRenderer, width: number, height: number, want: number): number {
  const longest = Math.max(width, height);

  // What the driver can allocate. Exceeding it does not throw — it silently
  // returns a blank or truncated frame.
  const limit = Math.min(gl.capabilities.maxTextureSize || 4096, 8192);
  let factor = longest * want <= limit ? want : limit / longest;

  // ...and what it can finish in a reasonable time.
  const pixels = width * height * factor * factor;
  if (pixels > MAX_RENDER_PIXELS) {
    factor *= Math.sqrt(MAX_RENDER_PIXELS / pixels);
  }

  // Never below 1: rendering SMALLER than the output would be a downgrade
  // dressed as a safeguard.
  return Math.max(1, Math.floor(factor * 100) / 100);
}

/**
 * Shrinks a rendered frame to its output size.
 *
 * Two halvings rather than one jump when the factor is large: a browser's
 * one-shot downscale samples too few source pixels and reintroduces exactly the
 * shimmer supersampling was meant to remove.
 */
function downscale(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  let current: HTMLCanvasElement = source;
  let w = source.width;
  let h = source.height;

  while (w / 2 >= width && h / 2 >= height) {
    const step = document.createElement("canvas");
    step.width = Math.round(w / 2);
    step.height = Math.round(h / 2);
    const sctx = step.getContext("2d");
    if (!sctx) break;
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(current, 0, 0, step.width, step.height);
    current = step;
    w = step.width;
    h = step.height;
  }

  if (w === width && h === height) return current;

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) return current;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(current, 0, 0, width, height);
  return out;
}

export function renderAtSize(
  { gl, scene, camera, renderFrame }: CaptureTarget,
  width: number,
  height: number,
  onFrame: (canvas: HTMLCanvasElement) => void,
  /** How much larger than the output to render. See SUPERSAMPLE. */
  supersample = SUPERSAMPLE.best,
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
  const factor = safeFactor(gl, width, height, supersample);
  const renderW = Math.round(width * factor);
  const renderH = Math.round(height * factor);

  const resolutionUniforms: { mat: { resolution: THREE.Vector2 }; prev: THREE.Vector2 }[] = [];
  scene.traverse((obj) => {
    const mat = (obj as THREE.Mesh).material as unknown as { resolution?: THREE.Vector2 };
    if (mat?.resolution instanceof THREE.Vector2) {
      resolutionUniforms.push({
        mat: mat as { resolution: THREE.Vector2 },
        prev: mat.resolution.clone(),
      });
      // The size actually being RENDERED, not the output size — the gem shader
      // divides gl_FragCoord by this, so the supersampled frame would sample at
      // the wrong coordinates and every stone would come out wrong.
      mat.resolution = new THREE.Vector2(renderW, renderH);
    }
  });

  // An export is a photo of the piece, not a screenshot of the editor.
  const showOverlays = hideOverlays(scene);

  try {
    // Pixel ratio 1: the dimensions here are already real pixels.
    gl.setPixelRatio(1);
    gl.setSize(renderW, renderH, false);
    // Aspect from the OUTPUT, which the supersample preserves exactly — taking
    // it from the rounded render size would shift the framing by a hair.
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderFrame?.setSize(renderW, renderH);
    if (renderFrame) renderFrame.render();
    else gl.render(scene, camera);
    const frame = gl.domElement as HTMLCanvasElement;
    onFrame(factor === 1 ? frame : downscale(frame, width, height));
  } finally {
    for (const { mat, prev } of resolutionUniforms) mat.resolution = prev;
    // Restored before the re-render below, so the viewport gets its tint back.
    showOverlays();
    gl.setPixelRatio(prevRatio);
    gl.setSize(prevSize.x, prevSize.y, false);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    renderFrame?.setSize(prevSize.x, prevSize.y);
    if (renderFrame) renderFrame.render();
    else gl.render(scene, camera);
  }
}

/**
 * Composites the frame onto the scene's backdrop.
 *
 * Returns the frame untouched for a transparent backdrop, so the alpha channel
 * survives into a PNG.
 */
export function composite(
  source: HTMLCanvasElement,
  background: ResolvedBackground,
  watermark: WatermarkSettings = DEFAULT_WATERMARK,
): { canvas: HTMLCanvasElement; opaque: boolean } {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext("2d");
  if (!ctx) return { canvas: source, opaque: false };

  const opaque = paintBackground(ctx, out.width, out.height, background);
  if (!opaque) {
    /*
     * A transparent export keeps its alpha, so the frame cannot be flattened —
     * but the mark still has to be burned in, or a cut-out PNG would be the one
     * download that leaves the studio unbranded.
     */
    const marked = document.createElement("canvas");
    marked.width = source.width;
    marked.height = source.height;
    const mctx = marked.getContext("2d");
    if (!mctx) return { canvas: source, opaque: false };
    mctx.drawImage(source, 0, 0);
    paintWatermark(mctx, marked.width, marked.height, watermark);
    return { canvas: marked, opaque: false };
  }

  ctx.drawImage(source, 0, 0);
  /*
   * A front-placed image goes on after the piece and before the mark. That
   * order is the point: the prop covers the jewellery, and the studio's mark
   * still sits on top of everything.
   */
  paintForeground(ctx, out.width, out.height, background);
  paintWatermark(ctx, out.width, out.height, watermark);
  return { canvas: out, opaque: true };
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

/**
 * Where the file is going, in the words the person sending it would use.
 *
 * Shape, size and frame rate are one decision, not three. Nobody choosing
 * between 9:16 and 4:5 is thinking about ratios — they are thinking "this goes
 * on Instagram", and every platform has one right answer for all three. Asking
 * for them separately is asking someone to derive what we already know, and
 * getting any one of them wrong spoils the file.
 *
 * `base` is the SHORT edge, matching `dimensionsFor`.
 */
export interface Destination {
  id: string;
  label: string;
  hint: string;
  aspect: string;
  /** Short edge, in pixels. */
  base: number;
  fps: number;
  /** Seconds, where the platform has a limit worth respecting. */
  seconds?: number;
}

export const DESTINATIONS: Destination[] = [
  {
    id: "instagram",
    label: "Instagram",
    hint: "Vertical reel, 1080×1920",
    aspect: "9x16",
    base: 1080,
    fps: 30,
    seconds: 8,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    hint: "Square and small enough to send",
    aspect: "1x1",
    base: 720,
    fps: 30,
    seconds: 5,
  },
  {
    id: "website",
    label: "Website",
    hint: "Widescreen 1080p",
    aspect: "16x9",
    base: 1080,
    fps: 30,
  },
  {
    id: "best",
    label: "Best quality",
    hint: "4K, 60fps — large file",
    aspect: "16x9",
    base: 2160,
    fps: 60,
  },
];

/** Print and screen sizes for a still, same idea as DESTINATIONS. */
export const PHOTO_DESTINATIONS: Destination[] = [
  {
    id: "instagram",
    label: "Instagram",
    hint: "Square, 2160px",
    aspect: "1x1",
    base: 2160,
    fps: 0,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    hint: "Square, quick to send",
    aspect: "1x1",
    base: 1440,
    fps: 0,
  },
  { id: "website", label: "Website", hint: "Widescreen, 4K", aspect: "16x9", base: 2160, fps: 0 },
  { id: "print", label: "Print", hint: "4K at 300dpi", aspect: "3x2", base: 2160, fps: 0 },
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

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  background: ResolvedBackground,
  watermark?: WatermarkSettings,
): Promise<Blob | null> {
  // JPEG has no alpha, so a transparent backdrop has to stay PNG.
  const { canvas: src, opaque } = composite(canvas, background, watermark);
  return new Promise((resolve) =>
    src.toBlob(resolve, opaque ? "image/jpeg" : "image/png", opaque ? 0.95 : undefined),
  );
}

/**
 * Hands a finished export to the user: the OS share sheet on a phone, a
 * plain `<a download>` everywhere else.
 *
 * Every export here runs an async render or encode first — seconds for a
 * photo, up to minutes for a long video — so by the time the blob exists,
 * the tap that started it is long over. Mobile Safari (and, more quietly,
 * mobile Chrome) only allows an `<a download>` click to actually save a
 * file when it happens synchronously inside the gesture that triggered it;
 * fired from async code afterwards, it is silently ignored — the render
 * completes, the code runs, and nothing lands in Photos or Files. That is
 * "nothing downloads," and no exception is ever thrown for it, so the old
 * code had nothing to catch. The Web Share API exists specifically for a
 * file produced after the fact: it is allowed well outside the originating
 * gesture, and its target genuinely is a save when the user picks
 * "Save to Files"/"Save Video", not just another tab showing the file.
 *
 * Scoped to touch devices only. Several desktop browsers now implement
 * `share()` too, but without asking first would replace a one-click download
 * anyone is used to with an OS picker nobody asked for, for a platform where
 * the plain link already works every time.
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const isMobile =
    typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

  if (isMobile && typeof navigator !== "undefined" && navigator.share && navigator.canShare) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        // The user dismissing the share sheet is a "no", not a failure to
        // recover from — anything else falls through to the plain download.
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
  }

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
