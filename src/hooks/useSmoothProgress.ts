import { useEffect, useRef, useState } from "react";

/** Measured desktop cost of the .3dm pipeline; see scripts/bench-upload-flow.mjs. */
const SECONDS_PER_MB = 0.19;
/** Phones run the same WASM perhaps 3x slower, so assume the worse case. */
const MOBILE_PENALTY = 3;

/** Rough wall-clock estimate for decoding a file of this size, in ms. */
export function estimateDecodeMs(bytes: number): number {
  const seconds = (bytes / 1048576) * SECONDS_PER_MB * MOBILE_PENALTY;
  return Math.min(Math.max(seconds * 1000, 1200), 120_000);
}

/**
 * A progress value that always moves.
 *
 * `Rhino3dmLoader.parse()` exposes no progress — only `load()` does — and that
 * one opaque phase is the bulk of the wait. Leaving the bar parked at its last
 * phase percentage for ten seconds reads as a hang, so ease toward an asymptote
 * on a size-derived estimate and let any real phase percentage overtake it.
 *
 * Monotonic and capped below 100: it can run long without ever lying about
 * being finished, and never jumps backwards if the estimate was pessimistic.
 */
export function useSmoothProgress(active: boolean, floor: number, estimatedMs: number): number {
  const [value, setValue] = useState(0);
  const floorRef = useRef(floor);

  useEffect(() => {
    floorRef.current = floor;
  }, [floor]);

  useEffect(() => {
    if (!active) {
      setValue(0);
      return;
    }
    const start = performance.now();
    // Reaches ~92% at the estimate, then crawls the remainder.
    const tau = Math.max(estimatedMs, 400) / 2.5;
    let shown = 0;
    let raf = 0;

    const tick = () => {
      const elapsed = performance.now() - start;
      const eased = 95 * (1 - Math.exp(-elapsed / tau));
      const next = Math.min(99.5, Math.max(shown, eased, floorRef.current));
      // Only re-render on a visible change — this runs every frame.
      if (next - shown > 0.25) {
        shown = next;
        setValue(next);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, estimatedMs]);

  return value;
}
