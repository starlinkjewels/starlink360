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

/*
 * H.264 levels, and why the codec string cannot be a constant.
 *
 * "avc1.640028" is High profile at Level 4.0, which is capped at 8192
 * macroblocks per frame and 245,760 per second — 1080p30 and no more. Ask it
 * for 4K, or for 1080p60, and `isConfigSupported` returns false. The old code
 * then fell through to the WebM branch, so choosing 4K silently produced a
 * real-time WebM instead of the frame-by-frame MP4 that was the whole point.
 *
 * So the level is chosen from the actual frame size and rate. Limits are from
 * the spec: MaxFS in macroblocks, MaxMBPS per second.
 */
const H264_LEVELS = [
  { name: "4.0", hex: "28", maxFrame: 8192, maxRate: 245760 },
  { name: "4.2", hex: "2a", maxFrame: 8704, maxRate: 522240 },
  { name: "5.0", hex: "32", maxFrame: 22080, maxRate: 589824 },
  { name: "5.1", hex: "33", maxFrame: 36864, maxRate: 983040 },
  { name: "5.2", hex: "34", maxFrame: 36864, maxRate: 2073600 },
] as const;

/** Lowest H.264 level that can carry this frame size and rate. */
export function h264Codec(width: number, height: number, fps: number): string {
  // A macroblock is 16x16, rounded up on both axes.
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const perSecond = macroblocks * fps;
  const level =
    H264_LEVELS.find((l) => macroblocks <= l.maxFrame && perSecond <= l.maxRate) ??
    H264_LEVELS[H264_LEVELS.length - 1];
  return `avc1.6400${level.hex}`;
}

/**
 * Bitrate for a given frame size and rate.
 *
 * Jewellery is all fine specular detail, and a low bitrate turns sparkle into
 * mush — so this is generous. Scaled by pixel count rather than fixed, because
 * 20 Mbps is right for 1080p and starves 4K badly.
 */
export function bitrateFor(width: number, height: number, fps: number): number {
  /*
   * Jewellery is the worst case a video encoder ever sees.
   *
   * Compression works by predicting the next frame from the last one, and a
   * turning pave breaks that completely: every stone is high-frequency sparkle
   * that changes entirely between frames, so there is almost nothing to
   * predict. The old 0.11 bits per pixel per frame — around 8 Mbps at 1080p —
   * is a sensible number for ordinary footage and turns diamonds into a
   * shimmering mush of blocks. The client called it "not clear" and they were
   * describing exactly this.
   *
   * 0.28 puts 1080p30 near 18 Mbps, which is where a rotating stone holds
   * together. Well above what a talking head would need, and the right order
   * for the content.
   */
  const perPixelPerFrame = 0.28;
  const raw = width * height * fps * perPixelPerFrame;
  // Floor keeps small exports crisp; ceiling keeps a 4K60 file openable.
  return Math.round(Math.min(Math.max(raw, 12_000_000), 120_000_000));
}

/** What this browser can actually produce, best first. */
export async function bestAvailableFormat(
  width: number,
  height: number,
  fps = 30,
): Promise<VideoFormat> {
  if (typeof VideoEncoder === "undefined") return "png-sequence";
  try {
    const support = await VideoEncoder.isConfigSupported({
      codec: h264Codec(width, height, fps),
      width,
      height,
      bitrate: bitrateFor(width, height, fps),
      framerate: fps,
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
    codec: h264Codec(width, height, fps),
    width,
    height,
    bitrate: bitrateFor(width, height, fps),
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
    videoBitsPerSecond: bitrateFor(width, height, fps),
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
