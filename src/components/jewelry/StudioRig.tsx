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
  type StillBackground,
} from "./studio";

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
  background: StillBackground;
}

export interface TurntableRequest {
  width: number;
  height: number;
  frames: number;
  /** Solid fill behind the piece. H.264 has no alpha, so video is never transparent. */
  background: string;
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
  apiRef,
  controlsRef,
}: {
  fit: Fit | null;
  apiRef: React.MutableRefObject<StudioApi | null>;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;

  useEffect(() => {
    if (!fit) {
      apiRef.current = null;
      return;
    }

    const target = { gl, scene, camera };
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
        const dist = fitDistance(fit, camera.fov, 1) * (angle.zoom ?? 1);
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

      async captureAngle(angle, { width, height, background }) {
        const saved = save();
        let blob: Blob | null = null;
        try {
          // Frame for the requested shape, so a 9:16 crop still fits the piece
          // rather than slicing its sides off.
          applyAngle(camera, angle, fit, width / height);
          let frame: HTMLCanvasElement | null = null;
          renderAtSize(target, width, height, (c) => (frame = grab(c)));
          if (frame) blob = await canvasToBlob(frame, background);
        } finally {
          restore(saved);
        }
        return blob;
      },

      async captureView(view, { width, height, background }) {
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
          if (frame) blob = await canvasToBlob(frame, background);
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
        zoom = 1,
        elevation = 0.22,
        elevationSweep = 0,
        turns = 1,
        view = null,
        path = null,
      }) {
        const saved = save();
        const aspect = width / height;

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
          : fitDistance(fit, camera.fov, aspect);
        const dist = Math.max(rawDist * zoom, minDist);

        const scratch = document.createElement("canvas");
        scratch.width = width;
        scratch.height = height;
        const ctx = scratch.getContext("2d");

        // Enter export size once for the whole clip rather than per frame.
        const offscreen = beginOffscreen(target, width, height);

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
                ctx.fillStyle = background;
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(seqFrame, 0, 0);
              }
              return scratch;
            }

            const t = progress * Math.PI * 2 * turns;
            // Sine sweep returns to the start height, so the clip loops cleanly.
            const el = elevation + Math.sin(progress * Math.PI * 2) * elevationSweep;
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
              ctx.fillStyle = background;
              ctx.fillRect(0, 0, width, height);
              ctx.drawImage(frame, 0, 0);
            }
            return scratch;
          },
          finish() {
            offscreen.end();
            restore(saved);
          },
        };
      },
    };

    return () => {
      apiRef.current = null;
    };
  }, [gl, scene, camera, fit, apiRef, controlsRef]);

  return null;
}
