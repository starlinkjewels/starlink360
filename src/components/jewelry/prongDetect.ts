import * as THREE from "three";
/*
 * The ".js" below is deliberate and required — the same rule assign.ts states.
 * The suites compile this with plain tsc and run it on Node, whose ESM loader
 * will not resolve an extensionless specifier.
 */
import { solidCount, solidId, solidRange, type Part } from "./selection.js";

/*
 * Finding the claws.
 *
 * `prongs.ts` deliberately does NOT do this: an earlier version guessed prongs
 * from shape and was wrong on unusual settings, so which solid gets adjusted
 * became a person's own click. That decision stands. What this adds is a
 * STARTING POINT for that person — a selection they then correct — never a
 * claim about what the file contains.
 *
 * The first attempt at it reused `isReasonablySized`, which asks whether a
 * solid is small relative to the whole PIECE. On a 182mm necklace every chain
 * link is small relative to the whole piece, so it returned 666 of 675 objects
 * and was worse than useless. That function is a rejection filter for the
 * brush — "do not let a click land on the shank" — and answers a different
 * question entirely.
 *
 * Size is not the discriminator. A chain link and a claw are genuinely similar
 * in size; what separates them is that a claw HOLDS A STONE:
 *
 *   1. It sits within about one stone-radius of that stone's centre.
 *   2. It is small relative to THAT STONE, not to the piece.
 *   3. It has company — 2 to 8 similar solids around the same stone.
 *
 * A chain link fails the first outright, wherever it sits on the chain. That
 * one test does most of the work; the other two separate a claw from a bezel
 * wall or a bail that happens to pass near a stone.
 */

/** One solid, reduced to what the tests below need. */
interface Blob {
  centre: THREE.Vector3;
  /** Half the bounding-box diagonal — a size that does not care about shape. */
  radius: number;
}

export interface ProngCandidate {
  /** The full selectable id, ready to hand to selection. */
  id: string;
  partId: string;
  solid: number;
  /**
   * `likely` when it has company around the same stone, `unsure` when it is
   * alone. A lone solid beside a stone is as often a bezel or a bail as a claw,
   * and saying so is more useful than a confident wrong answer.
   */
  confidence: "likely" | "unsure";
  /** Which stone it appears to hold, for grouping and for review. */
  stone: number;
}

/** Centre and size of every solid in a part. */
function blobs(part: Part): Blob[] {
  const geometry = part.mesh.geometry;
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const solids = part.solids;
  const out: Blob[] = [];
  if (!position) return out;

  const n = solidCount(part);
  /*
   * A part with no split is one solid spanning the whole buffer. Faceting
   * leaves stones non-indexed, so the vertex is read through the index only
   * when there is one — the same rule the rest of this codebase follows.
   */
  for (let s = 0; s < n; s++) {
    const range = solids && solids.length > 1 ? solidRange(solids, s) : null;
    const start = range ? range.start : 0;
    const end = range ? range.start + range.count : (index?.count ?? position.count);

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (let i = start; i < end; i++) {
      const v = index ? index.getX(i) : i;
      const x = position.getX(v);
      const y = position.getY(v);
      const z = position.getZ(v);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    if (minX > maxX) continue;
    out.push({
      centre: new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2),
      radius: Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2,
    });
  }
  return out;
}

/**
 * How far from a stone's centre a claw may sit, as a multiple of its radius.
 *
 * A bead sits ON the girdle line between neighbouring stones, not tucked inside
 * the stone's own silhouette, so its centre lands a little beyond the radius.
 * 1.15 clipped the interior beads of a pave and kept only the border claws.
 */
const REACH = 1.45;
/** How large a claw may be beside the stone it holds. */
const RELATIVE_SIZE = 1.1;
/** Company promotes a candidate; being alone only demotes it. */
const MIN_CLUSTER = 2;

/**
 * Metal solids that look like they hold a stone.
 *
 * Returns nothing rather than guessing when a piece has no stones: without
 * something to hold, "prong" has no meaning here and any answer would be a
 * size heuristic wearing a better name.
 */
export function findProngs(parts: Part[]): ProngCandidate[] {
  const stones: Blob[] = [];
  for (const part of parts) {
    if (part.kind === "stone") stones.push(...blobs(part));
  }
  if (!stones.length) return [];

  const near: (ProngCandidate & { d: number })[] = [];

  for (const part of parts) {
    if (part.kind !== "metal") continue;
    const metal = blobs(part);

    for (let s = 0; s < metal.length; s++) {
      const m = metal[s];

      /*
       * Nearest stone by SURFACE proximity, not centre distance. A pave is
       * dense enough that a claw between two stones is nearly equidistant from
       * both centres while clearly belonging to the smaller gap.
       */
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < stones.length; i++) {
        const d = m.centre.distanceTo(stones[i].centre);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best < 0) continue;

      const stone = stones[best];
      // Within reach of the stone, and not larger than the stone it holds.
      if (bestD > stone.radius * REACH) continue;
      if (m.radius > stone.radius * RELATIVE_SIZE) continue;

      near.push({
        id: solidId(part.id, s),
        partId: part.id,
        solid: s,
        confidence: "unsure",
        stone: best,
        d: bestD,
      });
    }
  }

  /*
   * Company promotes a candidate; it never removes one.
   *
   * A busy stone used to be discarded entirely, on the theory that a huge
   * cluster meant a pierced plate rather than claws. On a pave that is exactly
   * backwards: beads are SHARED between neighbours, so each stone is credited
   * with every bead nearest to it and the interior of a dense field tallies
   * well past any sensible cluster size. The filter therefore deleted the
   * middle of the pave and kept only the border — which is precisely what it
   * looked like on screen.
   *
   * Cluster size now only decides confidence. Nothing that passed the two
   * geometric tests is thrown away.
   */
  const perStone = new Map<number, number>();
  for (const c of near) perStone.set(c.stone, (perStone.get(c.stone) ?? 0) + 1);

  return near.map(({ d: _d, ...c }) => ({
    ...c,
    confidence: (perStone.get(c.stone) ?? 0) >= MIN_CLUSTER ? "likely" : "unsure",
  }));
}

/** Just the ids, for handing straight to selection. */
export function prongIds(candidates: ProngCandidate[], onlyLikely = true): string[] {
  return candidates.filter((c) => !onlyLikely || c.confidence === "likely").map((c) => c.id);
}
