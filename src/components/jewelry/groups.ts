/*
 * Groups the user makes, as opposed to the ones the file came with.
 *
 * A .3dm arrives with layers and the decoder turns them into parts, but those
 * are the modeller's divisions, not the jeweller's. "The twelve stones in the
 * centre cluster" is a real thing to want to recolour as one, and no layer in
 * the file corresponds to it. So a group here is nothing more than a NAMED SET
 * OF IDS the user picked by clicking.
 *
 * That is deliberately the whole design. Per-solid selection already exists and
 * every renderer already resolves an id to a draw run, so a group needs no new
 * machinery in either — it only needs expanding back into its members before
 * the assignment maps see it. Anything cleverer would duplicate a mechanism
 * that took three attempts to get right.
 */

import type { PartKind } from "./selection.js";

export interface PartGroup {
  /** Always prefixed, so a group can never be mistaken for a part. */
  id: string;
  name: string;
  /** Part ids or solid ids, exactly as selection produced them. */
  memberIds: string[];
  /**
   * Metal or stone, never both.
   *
   * A material is assigned per kind — the metal renderer ignores stone ids and
   * the gem renderer ignores metal ones — so a mixed group could be given a
   * gold that silently applied to half of it. Better to refuse the mixture than
   * to explain the result.
   */
  kind: PartKind;
}

/**
 * The prefix that keeps group ids out of the part namespace.
 *
 * Selection, assignments and stamps are all keyed by id in flat maps. Without a
 * reserved prefix a group called the same thing as a layer would quietly
 * overwrite that layer's material.
 */
export const GROUP_PREFIX = "group:";

export function isGroupId(id: string): boolean {
  return id.startsWith(GROUP_PREFIX);
}

/**
 * Counter-based, like stamps. `Math.random` is unavailable in the suites by
 * design, and a group id needs to be unique within one piece, not unguessable.
 */
let counter = 0;

export function nextGroupId(): string {
  counter += 1;
  return `${GROUP_PREFIX}${counter}`;
}

/** Restarts numbering, so a fresh piece does not begin at group:97. */
export function resetGroupIds(): void {
  counter = 0;
}

/**
 * A name that is not already taken.
 *
 * Two groups called "Centre" is not an error the renderer would notice, and is
 * exactly the sort of thing that makes a list unusable an hour later.
 */
export function uniqueGroupName(wanted: string, taken: readonly PartGroup[]): string {
  const base = wanted.trim() || "Group";
  const names = new Set(taken.map((g) => g.name));
  if (!names.has(base)) return base;
  for (let n = 2; n < 999; n++) {
    const candidate = `${base} ${n}`;
    if (!names.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

/* ------------------------------------------------------------------ the list */

export function createGroup(
  list: readonly PartGroup[],
  name: string,
  memberIds: readonly string[],
  kind: PartKind,
): PartGroup[] {
  /*
   * Members are de-duplicated and groups are never nested.
   *
   * Selecting a group and then grouping the selection would otherwise produce a
   * group containing a group, and `expandIds` would have to recurse — with a
   * cycle to guard against. Flattening at the point of creation means the
   * structure cannot express the problem.
   */
  const flat = [...new Set(memberIds.filter((id) => !isGroupId(id)))];
  if (!flat.length) return [...list];
  return [...list, { id: nextGroupId(), name: uniqueGroupName(name, list), memberIds: flat, kind }];
}

export function renameGroup(list: readonly PartGroup[], id: string, name: string): PartGroup[] {
  return list.map((g) =>
    g.id === id
      ? {
          ...g,
          name: uniqueGroupName(
            name,
            list.filter((o) => o.id !== id),
          ),
        }
      : g,
  );
}

export function removeGroup(list: readonly PartGroup[], id: string): PartGroup[] {
  return list.filter((g) => g.id !== id);
}

export function setMembers(
  list: readonly PartGroup[],
  id: string,
  memberIds: readonly string[],
): PartGroup[] {
  const flat = [...new Set(memberIds.filter((m) => !isGroupId(m)))];
  return list.map((g) => (g.id === id ? { ...g, memberIds: flat } : g));
}

export function groupById(list: readonly PartGroup[], id: string): PartGroup | undefined {
  return list.find((g) => g.id === id);
}

/**
 * Replaces any group id with the ids it stands for.
 *
 * This is the whole integration point. Selection, the material panels and the
 * renderers all keep working on part ids exactly as before; a group is expanded
 * away before any of them sees it, so none of them needs to know groups exist.
 *
 * Order is preserved and duplicates are dropped: selecting a group AND one of
 * its members must not assign that member twice, which would cost a draw call
 * and, in the run planner, split one solid into two identical runs.
 */
export function expandIds(list: readonly PartGroup[], ids: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const members = isGroupId(id) ? (groupById(list, id)?.memberIds ?? []) : [id];
    for (const m of members) {
      if (seen.has(m)) continue;
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

/**
 * Drops members whose part no longer exists, and any group left empty.
 *
 * Loading a different piece keeps the panel state, and a group pointing at ids
 * from the last model would sit in the list selecting nothing — visible, named,
 * and inert. Members are checked by their GROUP part, so `Metal 01#solid7`
 * survives as long as `Metal 01` does; solid numbering is stable for a given
 * file but the suffix is not worth matching literally.
 */
export function pruneGroups(
  list: readonly PartGroup[],
  partIds: ReadonlySet<string>,
  parseId: (id: string) => { group: string },
): PartGroup[] {
  return list
    .map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => partIds.has(parseId(m).group)) }))
    .filter((g) => g.memberIds.length > 0);
}

/** What to call a group in a list, with its size — "Centre cluster · 12". */
export function describeGroup(group: PartGroup): string {
  return `${group.name} · ${group.memberIds.length}`;
}

/**
 * The kind a set of selected ids belongs to, or null when they disagree.
 *
 * Offered to the panel so "Group selection" can be disabled with a reason
 * rather than silently creating something that cannot take a material.
 */
export function kindOf(
  ids: Iterable<string>,
  kindById: (id: string) => PartKind | undefined,
): PartKind | null {
  let found: PartKind | null = null;
  for (const id of ids) {
    const kind = kindById(id);
    if (!kind) continue;
    if (found && kind !== found) return null;
    found = kind;
  }
  return found;
}
