import { useRef } from "react";

/**
 * Keeps the same object reference across renders as long as its content is
 * unchanged, for a `useMemo` result that legitimately recomputes to a new
 * object (a fresh `{}`, or the same entries rebuilt from scratch) more often
 * than its content actually differs.
 *
 * `gemOverrides`/`effectiveStoneColors`/`metalOverrides` in the studio route
 * are exactly this: each is a `useMemo` over `assignments`/`textures`/
 * `stoneColors`, so clearing those to `{}` on every model load — even when
 * they were already `{}` — produces a brand new (but equally empty) object.
 * `GemRefraction`'s rebuild effect depends on these by reference, so a "empty
 * to equally-empty" transition alone was enough to trigger a full shader
 * recompile of every stone on the piece, on every load, for no visible
 * change. Comparing content here and handing back the previous reference
 * when nothing moved lets React's own dependency check do its job.
 *
 * `JSON.stringify` rather than a hand-rolled walk: every value that reaches
 * this hook is plain, serialisable material/gem-optics data — no functions,
 * no cycles — so it is a correct and (at these map sizes, at most a few
 * hundred entries) cheap equality check, run only when the source state
 * actually changes, not per frame.
 */
export function useStableRecord<T extends Record<string, unknown>>(value: T): T {
  const ref = useRef(value);
  const prevKey = useRef("");
  const nextKey = JSON.stringify(value);
  if (nextKey !== prevKey.current) {
    prevKey.current = nextKey;
    ref.current = value;
  }
  return ref.current;
}
