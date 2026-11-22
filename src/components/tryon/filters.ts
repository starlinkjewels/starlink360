/*
 * Jitter removal for tracked landmarks.
 *
 * Raw MediaPipe landmarks wobble by a pixel or two every frame even when the
 * hand is perfectly still. On a 20-pixel diamond that wobble reads as the
 * stone vibrating on the finger, which is the single fastest way to make a
 * try-on look cheap. A plain moving average fixes the wobble but makes the
 * piece lag behind a moving hand, which looks worse.
 *
 * The One Euro filter (Casiez et al., CHI 2012) is the standard answer and
 * what production AR uses: a low-pass whose cutoff rises with speed. Still
 * means heavy smoothing, fast means almost none, so the piece is rock steady
 * at rest and still keeps up with a wave.
 *
 * Pure maths with no three.js, so the Node suite can check it.
 */

export interface Pt {
  x: number;
  y: number;
  z: number;
}

export interface OneEuroParams {
  /** Hz. Lower is smoother at rest. */
  minCutoff: number;
  /** How quickly the cutoff opens up with speed. Higher means less lag. */
  beta: number;
  /** Hz. Cutoff for the derivative estimate itself. */
  dCutoff: number;
}

/*
 * Tuned for normalised (0..1) image coordinates, so the same numbers work at
 * any camera resolution. A brisk hand movement is about one frame-width per
 * second, at which beta 6 opens the cutoff by roughly 6 Hz.
 */
export const DEFAULT_ONE_EURO: OneEuroParams = { minCutoff: 1.2, beta: 6, dCutoff: 1.0 };

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  private x: number | undefined;
  private dx = 0;
  private t: number | undefined;

  constructor(private readonly p: OneEuroParams = DEFAULT_ONE_EURO) {}

  reset(): void {
    this.x = undefined;
    this.t = undefined;
    this.dx = 0;
  }

  /** `tSec` is a monotonic timestamp in seconds. */
  filter(value: number, tSec: number): number {
    if (this.x === undefined || this.t === undefined) {
      this.x = value;
      this.t = tSec;
      this.dx = 0;
      return value;
    }
    // A repeated or out-of-order timestamp would divide by zero; treat it as
    // a 1 ms step instead of letting NaN into every downstream pose.
    const dt = Math.max(1e-3, tSec - this.t);
    this.t = tSec;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.p.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.p.minCutoff + this.p.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

/** One filter per coordinate of every landmark in a set. */
export class LandmarkFilter {
  private filters: OneEuroFilter[] = [];

  constructor(private readonly p: OneEuroParams = DEFAULT_ONE_EURO) {}

  reset(): void {
    this.filters = [];
  }

  apply(points: readonly Pt[], tSec: number): Pt[] {
    const need = points.length * 3;
    // A different landmark count means a different model; start over rather
    // than smoothing one model's nose into another's thumb.
    if (this.filters.length !== need) {
      this.filters = Array.from({ length: need }, () => new OneEuroFilter(this.p));
    }
    return points.map((pt, i) => ({
      x: this.filters[i * 3].filter(pt.x, tSec),
      y: this.filters[i * 3 + 1].filter(pt.y, tSec),
      z: this.filters[i * 3 + 2].filter(pt.z, tSec),
    }));
  }
}

/**
 * Sticky left/right decision.
 *
 * MediaPipe's handedness flickers for a frame or two when the hand turns edge
 * on. Flipping it flips which side of the finger the stone sits on, so a
 * single bad frame would make the diamond jump through the finger. This keeps
 * an exponentially weighted vote and only changes its mind on a sustained
 * majority.
 */
export class HandednessVote {
  private score = 0;
  private side: boolean | null = null;

  reset(): void {
    this.score = 0;
    this.side = null;
  }

  /** `vote` is +1 for one side, -1 for the other; `confidence` 0..1. */
  push(vote: 1 | -1, confidence: number): boolean {
    this.score = this.score * 0.9 + vote * Math.max(0.05, Math.min(1, confidence)) * 0.1;
    // The first frame decides outright, so there is never an undecided frame.
    if (this.side === null) this.side = vote > 0;
    // Hysteresis: changing sides needs a clear majority the other way.
    else if (this.side && this.score < -HYSTERESIS) this.side = false;
    else if (!this.side && this.score > HYSTERESIS) this.side = true;
    return this.side;
  }
}

const HYSTERESIS = 0.25;
