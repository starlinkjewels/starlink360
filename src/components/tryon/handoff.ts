import type { StudioPieceSource } from "./studioFit";
import type { ProceduralSpec } from "./studioPieces";

/*
 * The piece on the studio's stage, handed to the try-on.
 *
 * In memory, because a loaded or uploaded piece exists nowhere else: an
 * upload has no URL to pass in a link. The studio keeps this up to date
 * as its piece changes; the try-on reads it when it opens. A full page load
 * of the try-on starts with nothing here, which is why the Try On link
 * also carries a `?file=` when the piece came from one.
 */
export type TryOnHandoff =
  /** A loaded file. */
  | { kind: "studio"; piece: StudioPieceSource; fileUrl?: string }
  /** The built-in piece, which is one of the try-on's own catalogue pieces. */
  | { kind: "catalogue"; spec: ProceduralSpec };

let current: TryOnHandoff | null = null;

export function setTryOnHandoff(handoff: TryOnHandoff | null): void {
  current = handoff;
}

export function getTryOnHandoff(): TryOnHandoff | null {
  return current;
}
