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
import { Brush as BrushIcon } from "lucide-react";
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

  return (
    <>
      <PanelIntro>
        Raises or lowers a claw along its own length. Arm the brush, then click metal on the piece —
        each click adds one solid, clicking an already-picked one drops it. A stone, the backdrop,
        or anything clearly too large to be a claw — a shank, or a plate a whole field of stones is
        set into — does nothing.
      </PanelIntro>

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
