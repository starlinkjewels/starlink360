/*
 * Turning per-solid assignments into draw calls.
 *
 * A group is one mesh with one material, so "make THIS stone ruby" has nowhere
 * to go — until the mesh is allowed more than one material. Three supports that
 * through `geometry.groups`: each group is an index range with a material slot,
 * and the renderer issues one draw call per group.
 *
 * The decoder already reordered every group's triangles so each solid is a
 * contiguous run, which is what makes this cheap. Recolouring 3 stones out of
 * 140 produces at most 7 runs, not 140 — the untouched stretches between them
 * stay merged into one call each.
 *
 * That property is the whole point, so it is what the tests here check: the
 * number of draw calls has to track how many stones were CUSTOMISED, never how
 * many exist.
 */

/*
 * Generic over what an "assignment" is, because two callers need this with
 * different payloads: the panel reasons about library ids and patches, while
 * the renderers have already resolved those into colours and numbers. The
 * run-merging logic is identical either way, and having one copy of it means
 * metal and stones cannot drift apart.
 */

export interface Run<T> {
  /** Offset into the index buffer. */
  start: number;
  count: number;
  /** Null means "whatever this part's default is". */
  assignment: T | null;
}

/**
 * Two assignments render identically, so their runs can be merged.
 *
 * Compared by value, not identity: these objects are rebuilt on every render,
 * so identity would merge nothing and every stone would cost its own draw call.
 */
export function sameAssignment<T>(a: T | null, b: T | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * How many elements a geometry draws, indexed or not.
 *
 * Stones are de-indexed by the faceting pass, so `index` is null on every one
 * of them and reading `index.count` gives zero — which plans no runs at all and
 * leaves the stone with no material. Both forms count in the same units here:
 * a solid's offsets are 3 per triangle either way, because `toNonIndexed`
 * expands vertices in index order.
 */
export function drawableCount(geometry: {
  index?: { count: number } | null;
  attributes: { position?: { count: number } };
}): number {
  return geometry.index ? geometry.index.count : (geometry.attributes.position?.count ?? 0);
}

/**
 * The draw runs for one mesh.
 *
 * `base` is the assignment on the whole group, `perSolid` the ones on
 * individual solids. A solid with its own assignment wins over the group's.
 *
 * Returns a single full-length run whenever nothing is customised per solid,
 * so the common case stays exactly the one-material mesh it was.
 */
export function planRuns<T>(
  solids: ArrayLike<number> | undefined,
  indexCount: number,
  base: T | null,
  perSolid: ReadonlyMap<number, T>,
): Run<T>[] {
  if (!solids || solids.length < 2 || perSolid.size === 0) {
    return indexCount > 0 ? [{ start: 0, count: indexCount, assignment: base }] : [];
  }

  const runs: Run<T>[] = [];
  const count = solids.length - 1;

  for (let i = 0; i < count; i++) {
    const start = solids[i];
    const end = solids[i + 1];
    if (end <= start) continue;

    const assignment = perSolid.get(i) ?? base;
    const last = runs[runs.length - 1];
    // Merge with the previous run when it renders the same way. This is what
    // keeps 140 stones at a handful of draw calls.
    if (last && last.start + last.count === start && sameAssignment(last.assignment, assignment)) {
      last.count += end - start;
    } else {
      runs.push({ start, count: end - start, assignment });
    }
  }

  /*
   * Anything past the last solid boundary.
   *
   * Should not happen — the decoder's offsets cover the buffer — but a run that
   * is silently dropped is geometry that stops drawing, which is a far worse
   * failure than an extra draw call.
   */
  const covered = runs.length ? runs[runs.length - 1].start + runs[runs.length - 1].count : 0;
  if (covered < indexCount) {
    runs.push({ start: covered, count: indexCount - covered, assignment: base });
  }

  return runs;
}

/**
 * Splits the assignments that apply to one group into its base and its solids.
 *
 * Ids arrive as one flat map for the whole piece, because that is what the
 * panel writes and what a saved project would store.
 */
export function assignmentsFor<T>(
  all: Record<string, T>,
  groupId: string,
  parse: (id: string) => { group: string; solid: number | null },
): { base: T | null; perSolid: Map<number, T> } {
  let base: T | null = null;
  const perSolid = new Map<number, T>();

  for (const id of Object.keys(all)) {
    const { group, solid } = parse(id);
    if (group !== groupId) continue;
    if (solid === null) base = all[id];
    else perSolid.set(solid, all[id]);
  }
  return { base, perSolid };
}

/** Distinct assignments across a run list, in first-appearance order. */
export function runMaterials<T>(runs: Run<T>[]): (T | null)[] {
  const out: (T | null)[] = [];
  for (const run of runs) {
    if (!out.some((a) => sameAssignment(a, run.assignment))) out.push(run.assignment);
  }
  return out;
}

/** The material slot each run should use, given `runMaterials` order. */
export function runSlots<T>(runs: Run<T>[], materials: (T | null)[]): number[] {
  return runs.map((run) => {
    const at = materials.findIndex((a) => sameAssignment(a, run.assignment));
    return at < 0 ? 0 : at;
  });
}
