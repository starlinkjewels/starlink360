/*
 * The Prongs panel.
 *
 * Everything else in this app adjusts how the piece is lit or shown; this
 * adjusts the piece itself. There is deliberately no "whole piece" mode the
 * way Materials has one — nothing here reads as "every prong" the way a
 * Rhino layer does, and no automatic "find them all" either: an earlier
 * version tried to guess every prong on the piece from shape and stone
 * proximity, and repeated tuning against a real piece never got past
 * "either everything or nothing." Picking a prong is a person's own click.
 */
import { Brush as BrushIcon, Wand2 } from "lucide-react";
import { useMemo } from "react";
import { findProngs, prongIds } from "../prongDetect";
import {
  PRONG_HEIGHT_MAX,
  PRONG_HEIGHT_MIN,
  commonProngHeight,
  describeProngTargets,
  resetProngHeights,
  setProngHeights,
  targetProngIds,
  type ProngHeights,
} from "../prongs";
import type { Part } from "../selection";
import type { Brush } from "../assign";
import { NumberField } from "../ui/NumberField";
import { PanelIntro, PanelReset, PanelStatus } from "../ui/Panel";

export function ProngsPanel({
  parts,
  selected,
  prongHeights,
  onProngHeights,
  onSelect,
  armed = null,
  onArm,
}: {
  parts: Part[];
  selected: ReadonlySet<string>;
  prongHeights: ProngHeights;
  onProngHeights: (next: ProngHeights) => void;
  onSelect?: (next: Set<string>) => void;
  /** The shared brush slot — arming this here disarms any material/finish/
   *  stamp brush elsewhere, the same as arming one of those disarms this. */
  armed?: Brush | null;
  onArm?: (brush: Brush | null) => void;
}) {
  const hasMetal = parts.some((p) => p.kind === "metal");
  const picking = armed?.tool === "prong";
  const targets = targetProngIds(parts, selected);
  const common = commonProngHeight(prongHeights, targets);
  const changed = targets.some((id) => (prongHeights[id] ?? 1) !== 1);

  /*
   * A starting point, not an answer.
   *
   * Claws are found by what they HOLD — within a stone's own radius of it,
   * smaller than that stone, and with two to eight companions around the same
   * one. Size alone cannot do this: a first attempt used the brush's own size
   * filter and returned 666 of 675 objects on a necklace, because every chain
   * link is small relative to a 182mm chain.
   *
   * EVERYTHING that passes those tests is offered, including the ones marked
   * unsure. They were only demoted for sitting alone by their nearest stone,
   * having already cleared both geometric tests — and for a select-all the
   * trade runs the other way round: a claw left out costs a hunt through the
   * piece to find, an extra one costs a click to drop.
   *
   * What this cannot reach is a bead modelled as part of the plate rather than
   * as its own solid. There is no separate object to select, so no amount of
   * detection will find it; those stay a click on the piece.
   */
  const suggested = useMemo(() => prongIds(findProngs(parts), false), [parts]);

  return (
    <>
      <PanelIntro>
        Raises or lowers a claw along its own length. Arm the brush, then click metal on the piece —
        each click adds one solid, clicking an already-picked one drops it. A stone, the backdrop,
        or anything clearly too large to be a claw — a shank, or a plate a whole field of stones is
        set into — does nothing.
      </PanelIntro>

      {onSelect && suggested.length > 0 && (
        <div className="prong-suggest">
          <button
            className="btn-ghost"
            onClick={() => onSelect(new Set(suggested))}
            title="Select the metal that appears to hold a stone"
          >
            <Wand2 className="size-3.5" />
            Select all prongs ({suggested.length})
          </button>
          <p className="field-hint">
            Found by what they hold, so check them before adjusting. Click any prong on the piece to
            add one it missed, or click a selected one to drop it. Save the result in Objects to
            reuse it later.
          </p>
        </div>
      )}

      <PanelStatus
        narrowed={targets.length > 0}
        actions={
          <button
            className={`icon-toggle ${picking ? "icon-toggle-on" : ""}`}
            onClick={() => onArm?.(picking ? null : { tool: "prong", kind: "metal" })}
            aria-label="Pick prongs on the piece"
            aria-pressed={picking}
            title="Pick prongs on the piece — nothing else selects while this is on"
            disabled={!onArm}
          >
            <BrushIcon className="size-3.5" />
          </button>
        }
      >
        {targets.length ? (
          <>
            Applies to <strong>{describeProngTargets(parts, selected)}</strong>
          </>
        ) : picking ? (
          "Armed — click a prong on the piece"
        ) : (
          "Arm the brush to pick a prong on the piece"
        )}
      </PanelStatus>

      {!hasMetal && (
        <p className="field-hint mb-2">Nothing here to change yet — this piece has no metal.</p>
      )}

      <NumberField
        label="Height"
        value={common ?? 1}
        min={PRONG_HEIGHT_MIN}
        max={PRONG_HEIGHT_MAX}
        step={0.02}
        precision={2}
        suffix="×"
        disabled={!targets.length}
        hint={
          common === null && targets.length
            ? "Mixed — the selected prongs are not all the same height."
            : "1.00 is the height the file was modelled with."
        }
        onChange={(v) => onProngHeights(setProngHeights(prongHeights, targets, v))}
      />

      <PanelReset
        onReset={() => onProngHeights(resetProngHeights(prongHeights, targets))}
        disabled={!targets.length || !changed}
        label="Reset height"
      />
    </>
  );
}
