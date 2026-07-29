import { Muxer, ArrayBufferTarget } from "mp4-muxer";

/*
 * Turntable video, encoded in the browser.
 *
 * Deliberately NOT MediaRecorder + captureStream. That records the canvas in
 * real time, so a frame that takes 400ms to draw is simply a dropped frame:
 * heavy scenes come out stuttering and short. WebCodecs encodes frame by frame
 * and waits for us, so a slow machine takes longer and produces the identical
 * file. That property is the whole reason this works without a GPU.
 */

export type VideoFormat = "mp4" | "webm" | "png-sequence";

/** What this browser can actually produce, best first. */
export async function bestAvailableFormat(width: number, height: number): Promise<VideoFormat> {
  if (typeof VideoEncoder === "undefined") return "png-sequence";
  try {
    const support = await VideoEncoder.isConfigSupported({
      codec: "avc1.640028", // H.264 High 4.0
      width,
      height,
      bitrate: 20_000_000,
    });
    if (support.supported) return "mp4";
  } catch {
    /* fall through */
  }
  return typeof MediaRecorder !== "undefined" ? "webm" : "png-sequence";
}

export interface EncodeOptions {
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  /** Draws frame `i` and returns the canvas holding it. */
  drawFrame: (index: number) => HTMLCanvasElement;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Encodes an H.264 MP4.
 *
 * Frames are pushed one at a time and the encoder queue is drained as we go —
 * without that back-pressure a 240-frame 1080p run queues hundreds of megabytes
 * of raw YUV and gets the tab killed, which is exactly the failure mode on
 * phones.
 */
export async function encodeMp4(opts: EncodeOptions): Promise<Blob> {
  const { width, height, frameCount, fps, drawFrame, onProgress, signal } = opts;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height },
    fastStart: "in-memory", // metadata up front, so it streams/scrubs immediately
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      throw e;
    },
  });

  encoder.configure({
    codec: "avc1.640028",
    width,
    height,
    // Generous for 1080p — jewellery is all fine specular detail, and a low
    // bitrate turns sparkle into mush.
    bitrate: 20_000_000,
    framerate: fps,
  });

  const frameDuration = 1e6 / fps; // microseconds

  for (let i = 0; i < frameCount; i++) {
    if (signal?.aborted) {
      encoder.close();
      throw new DOMException("Export cancelled", "AbortError");
    }

    const canvas = drawFrame(i);
    const frame = new VideoFrame(canvas, {
      timestamp: i * frameDuration,
      duration: frameDuration,
    });
    // Keyframe every second keeps the file seekable.
    encoder.encode(frame, { keyFrame: i % fps === 0 });
    frame.close();

    // Back-pressure: never let raw frames pile up in memory.
    if (encoder.encodeQueueSize > 2) {
      await new Promise<void>((resolve) => {
        const check = () => (encoder.encodeQueueSize <= 2 ? resolve() : setTimeout(check, 4));
        check();
      });
    }

    onProgress?.(i + 1, frameCount);
    /*
     * Yield to the compositor, not just the task queue.
     *
     * setTimeout(0) hands back to the event loop but the browser can run the
     * whole macrotask queue before it paints, so the progress bar froze and the
     * page felt hung. Waiting for a frame guarantees a paint between renders,
     * which is what keeps the UI answering during a long export.
     */
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();

  const { buffer } = muxer.target as ArrayBufferTarget;
  return new Blob([buffer], { type: "video/mp4" });
}

/**
 * WebM via MediaRecorder, for browsers without VideoEncoder.
 *
 * This one *is* real-time, so frames are paced to the clock and a slow renderer
 * will show. Offered only as a fallback for that reason.
 */
export async function encodeWebm(opts: EncodeOptions): Promise<Blob> {
  const { width, height, frameCount, fps, drawFrame, onProgress, signal } = opts;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a canvas to record.");

  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm",
    videoBitsPerSecond: 20_000_000,
  });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  recorder.start();

  for (let i = 0; i < frameCount; i++) {
    if (signal?.aborted) {
      recorder.stop();
      throw new DOMException("Export cancelled", "AbortError");
    }
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(drawFrame(i), 0, 0, width, height);
    track.requestFrame();
    onProgress?.(i + 1, frameCount);
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }

  recorder.stop();
  await done;
  return new Blob(chunks, { type: "video/webm" });
}
