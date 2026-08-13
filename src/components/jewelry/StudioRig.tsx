import { useEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Fit } from "./Model";
import {
  ANGLE_PRESETS,
  applyAngle,
  canvasToBlob,
  fitDistance,
  beginOffscreen,
  renderAtSize,
  type AnglePreset,
} from "./studio";
import { paintBackground, paintForeground, type ResolvedBackground } from "./background";
import { DEFAULT_CAMERA, frameFit, type CameraSettings } from "./camera";
import { DEFAULT_WATERMARK, paintWatermark, type WatermarkSettings } from "./watermark";
import {
  objectPoseAt,
  poseAt,
  posePosition,
  type AnimationPreset,
  type ObjectMove,
} from "./animation";

/**
 * A camera position the user set themselves.
 *
 * Fixed presets cannot know where the interesting part of a given piece is —
 * the clasp of a bracelet, the gallery of a ring, one stone in a pave field.
 * A saved view captures both where the camera sits and what it looks at, so a
 * close-up orbits that detail rather than the centre of the piece.
 */
export interface SavedView {
  id: string;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

export interface StillRequest {
  width: number;
  height: number;
  background: ResolvedBackground;
  watermark?: WatermarkSettings;
}

export interface TurntableRequest {
  width: number;
  height: number;
  frames: number;
  /** Backdrop behind the piece. H.264 has no alpha, so video is never transparent. */
  background: ResolvedBackground;
  watermark?: WatermarkSettings;
  zoom?: number;
  elevation?: number;
  elevationSweep?: number;
  turns?: number;
  /**
   * What the camera circles. Defaults to the centre of the piece; pass a saved
   * view's target to spin around a detail instead.
   */
  view?: SavedView | null;
  /**
   * Two or more saved views turn the clip into a travelling shot through them
   * instead of an orbit. Overrides `view` when present.
   */
  path?: SavedView[] | null;
  /**
   * A named camera move, which overrides the raw orbit.
   *
   * The same preset the viewport previews, so the download is the shot that
   * was watched rather than a second implementation of roughly the same idea.
   */
  preset?: AnimationPreset | null;
  /** A move applied to the piece itself, played alongside the camera. */
  objectMove?: ObjectMove | null;
  /** The group an object move drives. Restored when the export finishes. */
  piece?: THREE.Object3D | null;
}

export interface StudioApi {
  angles: AnglePreset[];
  /** Whatever the user is looking at right now, as a saved view. */
  currentView(): SavedView;
  /**
   * A preset angle expressed as a view, so presets and custom views can share
   * the same "move there" and "orbit that" code paths.
   */
  angleView(angle: AnglePreset): SavedView;
  /** Moves the camera to a saved view. */
  applyView(view: SavedView): void;
  /** Renders a preset angle. */
  captureAngle(angle: AnglePreset, req: StillRequest): Promise<Blob | null>;
  /** Renders a saved view, or the live camera when given null. */
  captureView(view: SavedView | null, req: StillRequest): Promise<Blob | null>;
  beginTurntable(req: TurntableRequest): {
    drawFrame: (index: number) => HTMLCanvasElement;
    finish: () => void;
  };
}

export function StudioRig({
  fit,
  camera: settings = DEFAULT_CAMERA,
  renderFrame,
  apiRef,
  controlsRef,
  piece,
}: {
  fit: Fit | null;
  /** Projection, lens and clipping, so exports match what is on screen. */
  camera?: CameraSettings;
  /** Set while the scene is composed, so exports bloom exactly as the screen does. */
  renderFrame?: { render(): void; setSize(w: number, h: number): void } | null;
  apiRef: React.MutableRefObject<StudioApi | null>;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  /** The group an object move drives, so an export can play one. */
  piece?: React.RefObject<THREE.Group | null>;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const pieceRef = piece;

  useEffect(() => {
    if (!fit) {
      apiRef.current = null;
      return;
    }

    const target = { gl, scene, camera, renderFrame };
    const ORIGIN = new THREE.Vector3();

    const orbitTarget = () => controlsRef.current?.target ?? ORIGIN;

    /** Snapshot enough to put the user's view back afterwards. */
    const save = () => ({
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      up: camera.up.clone(),
      near: camera.near,
      far: camera.far,
      aspect: camera.aspect,
      target: orbitTarget().clone(),
    });
    const restore = (s: ReturnType<typeof save>) => {
      camera.position.copy(s.position);
      camera.quaternion.copy(s.quaternion);
      camera.up.copy(s.up);
      camera.near = s.near;
      camera.far = s.far;
      camera.aspect = s.aspect;
      camera.updateProjectionMatrix();
      if (controlsRef.current) {
        controlsRef.current.target.copy(s.target);
        controlsRef.current.update();
      }
    };

    /** Copies the frame out before the next render overwrites the buffer. */
    const grab = (c: HTMLCanvasElement) => {
      const copy = document.createElement("canvas");
      copy.width = c.width;
      copy.height = c.height;
      copy.getContext("2d")?.drawImage(c, 0, 0);
      return copy;
    };

    apiRef.current = {
      angles: ANGLE_PRESETS,

      currentView() {
        const t = orbitTarget();
        return {
          id: `view-${Date.now()}`,
          label: "View",
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: [t.x, t.y, t.z],
        };
      },

      angleView(angle) {
        const dist = fitDistance(fit, settings, 1) * (angle.zoom ?? 1);
        const p = new THREE.Vector3(...angle.dir).normalize().multiplyScalar(dist);
        return {
          id: angle.id,
          label: angle.label,
          position: [p.x, p.y, p.z],
          target: [0, 0, 0],
        };
      },

      applyView(view) {
        camera.position.set(...view.position);
        camera.up.set(0, 1, 0);
        camera.lookAt(...view.target);
        camera.updateProjectionMatrix();
        if (controlsRef.current) {
          controlsRef.current.target.set(...view.target);
          controlsRef.current.update();
        }
      },

      async captureAngle(angle, { width, height, background, watermark }) {
        const saved = save();
        let blob: Blob | null = null;
        try {
          // Frame for the requested shape, so a 9:16 crop still fits the piece
          // rather than slicing its sides off.
          applyAngle(camera, angle, fit, width / height, settings);
          let frame: HTMLCanvasElement | null = null;
          renderAtSize(target, width, height, (c) => (frame = grab(c)));
          if (frame) blob = await canvasToBlob(frame, background, watermark);
        } finally {
          restore(saved);
        }
        return blob;
      },

      async captureView(view, { width, height, background, watermark }) {
        const saved = save();
        let blob: Blob | null = null;
        try {
          if (view) {
            camera.position.set(...view.position);
            camera.up.set(0, 1, 0);
            camera.lookAt(...view.target);
            camera.updateProjectionMatrix();
          }
          let frame: HTMLCanvasElement | null = null;
          renderAtSize(target, width, height, (c) => (frame = grab(c)));
          if (frame) blob = await canvasToBlob(frame, background, watermark);
        } finally {
          restore(saved);
        }
        return blob;
      },

      beginTurntable({
        width,
        height,
        frames,
        background,
        watermark = DEFAULT_WATERMARK,
        zoom = 1,
        elevation = 0.22,
        elevationSweep = 0,
        turns = 1,
        view = null,
        path = null,
        preset = null,
        objectMove = null,
        // Defaults to the rig's own piece, so a caller only has to say WHICH
        // move to play, not where the geometry lives.
        piece = pieceRef?.current ?? null,
      }) {
        const saved = save();
        const aspect = width / height;

        /*
         * The piece's own transform, so an object move can be undone.
         *
         * A drop leaves the piece wherever the last frame put it, which on a
         * bouncing move is mid-air. Without this the viewport is left showing a
         * necklace hanging in space after every export.
         */
        const savedPiece = piece ? { y: piece.position.y, rot: piece.rotation.clone() } : null;

        /*
         * Travelling shot.
         *
         * Straight lines between views read as a slideshow, so the camera and
         * its aim each follow a Catmull-Rom spline through the saved points —
         * that curve passes exactly through every view while staying smooth in
         * between, which is what makes it look like a camera move rather than a
         * cut. Three or more views close the loop so the clip repeats
         * seamlessly, and the whole traversal is eased so it starts and ends
         * gently instead of snapping into motion.
         */
        const sequence =
          path && path.length >= 2
            ? {
                positions: new THREE.CatmullRomCurve3(
                  path.map((v) => new THREE.Vector3(...v.position)),
                  path.length >= 3,
                  "catmullrom",
                  0.5,
                ),
                targets: new THREE.CatmullRomCurve3(
                  path.map((v) => new THREE.Vector3(...v.target)),
                  path.length >= 3,
                  "catmullrom",
                  0.5,
                ),
              }
            : null;

        /*
         * Orbiting a saved view keeps its own centre and its own distance, so a
         * close-up spins around that detail rather than drifting back to the
         * middle of the piece.
         *
         * The clamp matters. Tap-to-focus puts the target ON the surface, so a
         * view saved while zoomed in can sit a hair from its own target — and a
         * close-up shot then halves that again. Without a floor the camera ends
         * up inside the geometry and the clip renders black, which reads as
         * "the download did nothing".
         */
        const centre = view ? new THREE.Vector3(...view.target) : new THREE.Vector3(0, 0, 0);
        const minDist = Math.max(fit.radius * 0.08, 1e-3);
        const rawDist = view
          ? new THREE.Vector3(...view.position).distanceTo(centre)
          : fitDistance(fit, settings, aspect);
        const dist = Math.max(rawDist * zoom, minDist);

        /*
         * Where the orbit STARTS, taken from the view rather than assumed.
         *
         * A view used to contribute only its centre and its distance: the
         * camera was then placed at azimuth zero and the shot's own elevation,
         * so every clip began square-on to the front at the same height no
         * matter what was framed on screen. Someone would compose a
         * three-quarter view, press download, and get a clip shot from
         * somewhere else — which is what "the position is wrong" meant.
         *
         * With a view, its own angles win and the turn proceeds from there.
         * Without one, the shot preset decides, as before.
         */
        const offset = view ? new THREE.Vector3(...view.position).sub(centre) : null;
        const offsetLength = offset?.length() ?? 0;
        const baseElevation =
          offset && offsetLength > 1e-6
            ? Math.asin(THREE.MathUtils.clamp(offset.y / offsetLength, -1, 1))
            : elevation;
        // atan2(x, z) rather than (z, x): the orbit below measures its angle
        // from +Z, so this has to agree with it or the clip jumps on frame one.
        const baseAzimuth = offset && offsetLength > 1e-6 ? Math.atan2(offset.x, offset.z) : 0;

        const scratch = document.createElement("canvas");
        scratch.width = width;
        scratch.height = height;
        const ctx = scratch.getContext("2d");

        // Enter export size once for the whole clip rather than per frame.
        const offscreen = beginOffscreen(
          target,
          width,
          height,
          // Under an orthographic projection the frustum, not the distance,
          // decides how large the piece renders.
          frameFit(fit, settings, aspect).orthoHalfHeight,
        );

        return {
          drawFrame(index: number) {
            const progress = index / frames;

            if (sequence) {
              // Ease in and out so the move settles rather than stopping dead.
              const eased = progress * progress * (3 - 2 * progress);
              const u = sequence.positions.closed ? progress : eased;
              camera.position.copy(sequence.positions.getPoint(u));
              camera.up.set(0, 1, 0);
              camera.lookAt(sequence.targets.getPoint(u));
              camera.near = Math.max(fit.radius / 1000, 0.001);
              camera.far = fit.radius * 60;
              camera.updateProjectionMatrix();

              const seqFrame = offscreen.render();
              if (ctx) {
                paintBackground(ctx, width, height, background);
                ctx.drawImage(seqFrame, 0, 0);
                paintWatermark(ctx, width, height, watermark);
              }
              return scratch;
            }

            /*
             * A named move wins over the raw turntable maths.
             *
             * This is the same `poseAt` the viewport preview calls, which is
             * the point: the exporter used to carry its own shots, so what was
             * watched and what was downloaded were two pieces of code with no
             * reason to agree.
             */
            if (objectMove && piece) {
              const op = objectPoseAt(objectMove, progress);
              piece.position.y = op.lift * fit.radius;
              piece.rotation.set(op.rotX, op.rotY, op.rotZ);
            }

            if (preset) {
              const framing = frameFit(fit, settings, aspect);
              camera.position.set(...posePosition(poseAt(preset, progress), framing.distance));
              camera.up.set(0, 1, 0);
              camera.lookAt(centre);
              camera.near = framing.near;
              camera.far = framing.far;
              camera.updateProjectionMatrix();

              const moveFrame = offscreen.render();
              if (ctx) {
                paintBackground(ctx, width, height, background);
                ctx.drawImage(moveFrame, 0, 0);
                paintForeground(ctx, width, height, background);
                paintWatermark(ctx, width, height, watermark);
              }
              return scratch;
            }

            // Begins where the framed view was, not square-on to the front.
            const t = baseAzimuth + progress * Math.PI * 2 * turns;
            // Sine sweep returns to the start height, so the clip loops cleanly.
            const el = baseElevation + Math.sin(progress * Math.PI * 2) * elevationSweep;
            const horizontal = Math.cos(el);
            camera.position.set(
              centre.x + Math.sin(t) * dist * horizontal,
              centre.y + Math.sin(el) * dist,
              centre.z + Math.cos(t) * dist * horizontal,
            );
            camera.up.set(0, 1, 0);
            camera.lookAt(centre);
            camera.near = Math.max(dist / 1000, 0.001);
            camera.far = dist * 20 + fit.radius * 4;
            camera.updateProjectionMatrix();

            const frame = offscreen.render();
            if (ctx) {
              paintBackground(ctx, width, height, background);
              ctx.drawImage(frame, 0, 0);
              paintWatermark(ctx, width, height, watermark);
            }
            return scratch;
          },
          finish() {
            offscreen.end();
            restore(saved);
            if (piece && savedPiece) {
              piece.position.y = savedPiece.y;
              piece.rotation.copy(savedPiece.rot);
            }
          },
        };
      },
    };

    return () => {
      apiRef.current = null;
    };
  }, [gl, scene, camera, fit, settings, renderFrame, apiRef, controlsRef, pieceRef]);

  return null;
}
