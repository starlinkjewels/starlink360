/*
 * Part visibility.
 *
 * Absent means visible — the state a piece has always had — so a freshly
 * opened file never carries an explicit "true" for every part it contains,
 * and a saved project from before this existed loads with nothing hidden.
 * `false` is the only meaningful value, which is also what keeps a reset
 * this cheap: dropping the key IS the reset.
 */
export type PartVisibility = Record<string, boolean>;

export function isPartVisible(visibility: PartVisibility, id: string): boolean {
  return visibility[id] !== false;
}

export function setPartVisible(
  visibility: PartVisibility,
  ids: string[],
  visible: boolean,
): PartVisibility {
  const next = { ...visibility };
  for (const id of ids) {
    if (visible) delete next[id];
    else next[id] = false;
  }
  return next;
}
