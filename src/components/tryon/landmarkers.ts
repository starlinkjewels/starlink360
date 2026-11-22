/*
 * Google MediaPipe Tasks, loaded on demand.
 *
 * The npm package carries the JavaScript; the WebAssembly runtime and the
 * .task model files are fetched at runtime. Both default to Google's own
 * hosting, pinned to the installed package version, and both can be
 * self-hosted for production with environment variables:
 *
 *   VITE_MEDIAPIPE_WASM_BASE   folder holding vision_wasm_internal.{js,wasm}
 *   VITE_MEDIAPIPE_MODEL_BASE  folder holding hand_landmarker.task,
 *                              face_landmarker.task, pose_landmarker_lite.task
 *
 * The WASM version MUST match the JS version, which is why it is pinned here
 * rather than taken from "latest".
 *
 * Inference runs entirely in the browser. No camera frame leaves the device.
 */

import type { FaceLandmarker, HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { TrackerKind } from "./catalog";

const TASKS_VERSION = "0.10.17";

const WASM_BASE =
  (import.meta.env.VITE_MEDIAPIPE_WASM_BASE as string | undefined) ??
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;

const MODEL_BASE = import.meta.env.VITE_MEDIAPIPE_MODEL_BASE as string | undefined;

const MODEL_URL: Record<TrackerKind, string> = {
  hand: MODEL_BASE
    ? `${MODEL_BASE}/hand_landmarker.task`
    : "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  face: MODEL_BASE
    ? `${MODEL_BASE}/face_landmarker.task`
    : "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  pose: MODEL_BASE
    ? `${MODEL_BASE}/pose_landmarker_lite.task`
    : "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
};

export type Tracker =
  | { kind: "hand"; task: HandLandmarker }
  | { kind: "face"; task: FaceLandmarker }
  | { kind: "pose"; task: PoseLandmarker };

type Vision = typeof import("@mediapipe/tasks-vision");
let vision: Promise<{
  lib: Vision;
  fileset: Awaited<ReturnType<Vision["FilesetResolver"]["forVisionTasks"]>>;
}> | null = null;

function loadVision() {
  vision ??= (async () => {
    const lib = await import("@mediapipe/tasks-vision");
    const fileset = await lib.FilesetResolver.forVisionTasks(WASM_BASE);
    return { lib, fileset };
  })().catch((e) => {
    vision = null; // let a retry start clean
    throw e;
  });
  return vision;
}

const cache = new Map<TrackerKind, Promise<Tracker>>();

/**
 * GPU first, CPU if the GPU delegate cannot start. Some Android WebViews and
 * older iOS builds expose WebGL2 but fail inside MediaPipe's GPU path.
 */
async function withDelegates<T>(make: (delegate: "GPU" | "CPU") => Promise<T>): Promise<T> {
  try {
    return await make("GPU");
  } catch (gpuError) {
    console.warn("[try-on] GPU delegate unavailable, falling back to CPU", gpuError);
    return make("CPU");
  }
}

export function loadTracker(kind: TrackerKind): Promise<Tracker> {
  const hit = cache.get(kind);
  if (hit) return hit;
  const p = (async (): Promise<Tracker> => {
    const { lib, fileset } = await loadVision();
    const base = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: MODEL_URL[kind], delegate },
      runningMode: "VIDEO" as const,
    });
    if (kind === "hand") {
      const task = await withDelegates((d) =>
        lib.HandLandmarker.createFromOptions(fileset, {
          ...base(d),
          numHands: 1,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.5,
        }),
      );
      return { kind, task };
    }
    if (kind === "face") {
      const task = await withDelegates((d) =>
        lib.FaceLandmarker.createFromOptions(fileset, {
          ...base(d),
          numFaces: 1,
          minFaceDetectionConfidence: 0.6,
          minFacePresenceConfidence: 0.6,
          minTrackingConfidence: 0.5,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        }),
      );
      return { kind, task };
    }
    const task = await withDelegates((d) =>
      lib.PoseLandmarker.createFromOptions(fileset, {
        ...base(d),
        numPoses: 1,
        minPoseDetectionConfidence: 0.6,
        minPosePresenceConfidence: 0.6,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      }),
    );
    return { kind, task };
  })();
  p.catch(() => cache.delete(kind));
  cache.set(kind, p);
  return p;
}
