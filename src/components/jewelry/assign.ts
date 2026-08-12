/*
 * Which parts a material lands on.
 *
 * Phase 3 made parts selectable; this decides what "apply" means once they are.
 * The rule is one sentence, and it has to be, because the user is holding it in
 * their head while they click:
 *
 *     A material goes on the selected parts it can go on. If none are selected,
 *     it goes on every part of that kind.
 *
 * The second half matters as much as the first. Without it, opening a fresh
 * piece and clicking "18k Rose Gold" would do nothing at all until you first
 * selected something — which is how today's global finish behaves, and nobody
 * would guess they had to select the whole ring to recolour the whole ring.
 *
 * Clicking a gem while only metal is selected also falls to "all gems" rather
 * than doing nothing, on the same grounds: a click on a swatch must always
 * change the render, or the swatch reads as broken.
 */

import type { MaterialPatch } from "./library";
/*
 * The ".js" is deliberate and required. The suites compile these modules with
 * plain tsc and run them on Node, whose ESM loader will not resolve an
 * extensionless specifier; TypeScript maps ".js" back to the ".ts" source and
 * Vite is equally happy, so one spelling satisfies all three.
 */
import { parseId, solidCount, type Part, type PartKind } from "./selection.js";

export interface Assignment {
  /** Library material id. */
  material: string;
  /** What the custom editor moved on top of it. */
  patch?: MaterialPatch;
}

export type Assignments = Record<string, Assignment>;

/**
 * The parts an action applies to, in scene order.
 *
 * Returned as ids rather than parts so callers can compare across reloads —
 * a part object is rebuilt every time the piece is, an id is not.
 */
export function targetIds(parts: Part[], selected: ReadonlySet<string>, kind: PartKind): string[] {
  const ofKind = parts.filter((p) => p.kind === kind);
  const groupIds = new Set(ofKind.map((p) => p.id));
  /*
   * Selected ids are kept exactly as they are, solid suffix and all.
   *
   * A solid id used to be mapped back to its group, because the renderer could
   * only put one material on one mesh — so picking one stone and choosing ruby
   * turned all 140 ruby. It can now split a mesh into draw runs, so the id that
   * was selected is the id that gets the material.
   */
  const picked = [...selected].filter((id) => groupIds.has(parseId(id).group));
  return picked.length ? picked : ofKind.map((p) => p.id);
}

/** True when the action will land on the whole piece rather than a selection. */
export function targetsEverything(
  parts: Part[],
  selected: ReadonlySet<string>,
  kind: PartKind,
): boolean {
  const groups = new Set([...selected].map((id) => parseId(id).group));
  return !parts.some((p) => p.kind === kind && groups.has(p.id));
}

/** Assigns a library material to the target parts. */
export function applyMaterial(
  current: Assignments,
  parts: Part[],
  selected: ReadonlySet<string>,
  kind: PartKind,
  materialId: string,
): Assignments {
  const next = { ...current };
  for (const id of targetIds(parts, selected, kind)) {
    // A new material discards the old patch. Carrying it over would silently
    // apply ruby's hand-tuned IOR to an emerald and look like a bug in the
    // catalogue rather than a leftover edit.
    next[id] = { material: materialId };
  }
  return next;
}

/**
 * Folds custom-editor edits into the target parts.
 *
 * Merged rather than replaced, so moving the roughness slider does not throw
 * away the colour the same panel set a moment ago.
 */
export function patchMaterial(
  current: Assignments,
  parts: Part[],
  selected: ReadonlySet<string>,
  kind: PartKind,
  patch: MaterialPatch,
  fallbackMaterial: string,
): Assignments {
  const next = { ...current };
  for (const id of targetIds(parts, selected, kind)) {
    const existing = next[id];
    next[id] = {
      material: existing?.material ?? fallbackMaterial,
      patch: { ...existing?.patch, ...patch },
    };
  }
  return next;
}

/**
 * Assigns to one named part, ignoring the selection entirely.
 *
 * This is the paint gesture: arm a material in the panel, then click stones on
 * the piece one at a time. Selecting first and applying second is two steps for
 * every stone, and setting a halo one stone at a time is exactly the job where
 * that becomes tiring. Here the click IS the apply.
 */
export function assignToPart(
  current: Assignments,
  partId: string,
  materialId: string,
): Assignments {
  return { ...current, [partId]: { material: materialId } };
}

/**
 * What is loaded onto the brush.
 *
 * Two tools share one piece of state, deliberately: arming the finish brush has
 * to disarm the material brush, because a click can only mean one thing. A
 * single slot makes that impossible to get wrong, where two booleans would
 * eventually both be true.
 *
 * `tool` rather than sniffing which field is set. Both tools can carry
 * `kind: "metal"`, so without it the Materials panel lights up when the
 * Textures brush is armed and both panels claim the same click.
 *
 * The payload is empty until a swatch is chosen — arming the brush and picking
 * what it holds are two separate steps, and the panel says which one you are on.
 */
export type Brush =
  | { tool: "material"; kind: PartKind; material: string }
  | { tool: "finish"; kind: "metal"; finish: string };

/** Puts a surface finish on one part, leaving its other texture settings be. */
export function finishToPart<T extends { finish: string }>(
  current: Record<string, T>,
  partId: string,
  finish: string,
  fallback: T,
): Record<string, T> {
  return { ...current, [partId]: { ...(current[partId] ?? fallback), finish } };
}

/**
 * Whether a brush may paint a part.
 *
 * A metal brush must not paint a stone and a gem brush must not paint metal.
 * Allowing it was not merely untidy: the assignment landed in the map keyed by
 * a stone id holding a metal material, so the metal renderer skipped it (wrong
 * group) and the gem renderer skipped it (not a gem) — the click did nothing at
 * all, with nothing on screen to say why. Now the cursor and the part list say
 * up front what this brush can touch.
 */
export function canPaint(kind: PartKind, brushKind: PartKind | null): boolean {
  return brushKind !== null && kind === brushKind;
}

/** Drops the assignment, returning those parts to what the file specified. */
export function clearMaterial(
  current: Assignments,
  parts: Part[],
  selected: ReadonlySet<string>,
  kind: PartKind,
): Assignments {
  const next = { ...current };
  for (const id of targetIds(parts, selected, kind)) delete next[id];
  return next;
}

/**
 * The one material shown as active in the grid.
 *
 * Only when every target agrees. Two parts in different metals must not light
 * a swatch, because that would claim the piece is in one metal when it is not.
 */
export function commonMaterial(
  assignments: Assignments,
  parts: Part[],
  selected: ReadonlySet<string>,
  kind: PartKind,
): string | null {
  const ids = targetIds(parts, selected, kind);
  if (!ids.length) return null;
  const first = assignments[ids[0]]?.material ?? null;
  if (!first) return null;
  return ids.every((id) => assignments[id]?.material === first) ? first : null;
}

/** The patch shown in the editor — likewise only when the targets agree. */
export function commonPatch(
  assignments: Assignments,
  parts: Part[],
  selected: ReadonlySet<string>,
  kind: PartKind,
): MaterialPatch {
  const ids = targetIds(parts, selected, kind);
  if (!ids.length) return {};
  const first = assignments[ids[0]]?.patch ?? {};
  const same = ids.every((id) => {
    const p = assignments[id]?.patch ?? {};
    return JSON.stringify(p) === JSON.stringify(first);
  });
  return same ? first : {};
}

/** What the panel says it is about to change. */
export function describeTargets(
  parts: Part[],
  selected: ReadonlySet<string>,
  kind: PartKind,
): string {
  const ofKind = parts.filter((p) => p.kind === kind);
  if (!ofKind.length)
    return kind === "metal" ? "no metal in this piece" : "no stones in this piece";

  const groupIds = new Set(ofKind.map((p) => p.id));
  const picked = [...selected].filter((id) => groupIds.has(parseId(id).group));
  if (!picked.length) {
    const noun = kind === "metal" ? "metal part" : "stone set";
    return ofKind.length === 1 ? `the ${noun}` : `all ${ofKind.length} ${noun}s`;
  }

  const byId = new Map(ofKind.map((p) => [p.id, p]));
  const solids = picked.filter((id) => parseId(id).solid !== null);

  // One stone out of a hundred and forty is the case worth naming precisely.
  if (solids.length === picked.length) {
    if (picked.length === 1) {
      const { group, solid } = parseId(picked[0]);
      return `${byId.get(group)?.label ?? "part"} · ${(solid ?? 0) + 1}`;
    }
    return `${picked.length} selected`;
  }

  /*
   * A whole group still says how many solids that is, because "Gem 03" reads
   * as one stone and is in fact 140 — changing all of them while the label
   * implies one is exactly the surprise this avoids.
   */
  if (picked.length === 1) {
    const part = byId.get(parseId(picked[0]).group);
    const n = part ? solidCount(part) : 1;
    return n > 1 ? `${part?.label} — all ${n}` : (part?.label ?? "part");
  }
  return `${picked.length} selected`;
}
