import { useEffect, useRef, type MutableRefObject } from "react";
import { TryOnEngine, type TryOnConfig, type TryOnStatus } from "./engine";

export interface TryOnHandle {
  capture(): Promise<Blob>;
  switchCamera(): Promise<void>;
}

/**
 * The live camera with the jewellery drawn over it.
 *
 * Client-only and lazy-loaded: three.js and MediaPipe never reach the server
 * bundle, and visitors who never open the try-on never download them.
 */
export default function TryOnStage({
  config,
  mode,
  onStatus,
  handle,
}: {
  config: TryOnConfig;
  /** Live camera, or the piece on a turntable. Fixed for the life of the stage. */
  mode: "camera" | "preview";
  onStatus: (s: TryOnStatus) => void;
  handle: MutableRefObject<TryOnHandle | null>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<TryOnEngine | null>(null);
  const statusCb = useRef(onStatus);
  statusCb.current = onStatus;
  const initial = useRef(config);

  useEffect(() => {
    if (!container.current || !video.current || !canvas.current) return;
    const e = new TryOnEngine(
      container.current,
      video.current,
      canvas.current,
      (s) => statusCb.current(s),
      initial.current,
    );
    engine.current = e;
    handle.current = {
      capture: () => e.capture(),
      switchCamera: () => e.switchCamera(),
    };
    void (mode === "preview" ? e.startPreview() : e.start());
    return () => {
      handle.current = null;
      engine.current = null;
      e.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  useEffect(() => {
    engine.current?.setConfig(config);
  }, [config]);

  return (
    <div ref={container} className="absolute inset-0 overflow-hidden bg-black">
      <video
        ref={video}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        muted
        autoPlay
        aria-label="Live camera"
      />
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  );
}
