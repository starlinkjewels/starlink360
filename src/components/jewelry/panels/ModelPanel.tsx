/*
 * The Model panel.
 *
 * Two independent controls, both genuinely new geometry-level adjustments —
 * not a render parameter — grouped here because both are about placing the
 * piece itself rather than styling it:
 *
 *  - Orientation: a live rotation on the whole piece, on top of whatever the
 *    file's own up-axis correction already did. Lives on its own transform
 *    node in Model.tsx specifically so it can't be clobbered by the
 *    turntable spin or overwritten by a format change — see the comment
 *    there for why that took a third group in the hierarchy, not two.
 *  - Part transform: scale and X/Y/Z offset on ONE selected whole part (a
 *    named CAD layer — "Shank", "Head", "Bail"). Deliberately not per-solid:
 *    moving one stone out of a pave, or one prong, is a real vertex edit the
 *    way Prongs is, and this panel does not fake that by quietly moving the
 *    whole group a solid belongs to instead.
 */
import {
  DEFAULT_MODEL_ORIENTATION,
  ROTATION_PRESETS,
  putHorizontal,
  type ModelOrientation,
} from "../modelOrientation";
import {
  IDENTITY_PART_TRANSFORM,
  PART_OFFSET_LIMIT,
  PART_SCALE_MAX,
  PART_SCALE_MIN,
  resetPartPosition,
  resetPartScale,
  setPartOffset,
  setPartScale,
  type PartTransforms,
} from "../partTransform";
import type { Part } from "../selection";
import { NumberField } from "../ui/NumberField";
import { PanelGroup, PanelIntro, PanelReset } from "../ui/Panel";

const ROTATION_AXES: { axis: keyof ModelOrientation; label: string }[] = [
  { axis: "rotationX", label: "Rotate X" },
  { axis: "rotationY", label: "Rotate Y" },
  { axis: "rotationZ", label: "Rotate Z" },
];

function OrientationSection({
  orientation,
  onOrientation,
}: {
  orientation: ModelOrientation;
  onOrientation: (next: ModelOrientation) => void;
}) {
  const changed =
    orientation.rotationX !== 0 || orientation.rotationY !== 0 || orientation.rotationZ !== 0;

  return (
    <PanelGroup
      title="Orientation"
      hint="Turns the whole piece. Independent of the turntable and the file's own up-axis fix."
    >
      <div className="model-row mb-2">
        <button
          className="chip"
          onClick={() => onOrientation(putHorizontal())}
          title="A common starting rotation for a piece that loaded upright but on edge — not a detected answer, nudge from there"
        >
          Put horizontal
        </button>
      </div>

      {ROTATION_AXES.map(({ axis, label }) => (
        <div key={axis} className="mb-2">
          <NumberField
            label={label}
            value={orientation[axis]}
            min={0}
            max={360}
            step={1}
            suffix="°"
            onChange={(v) => onOrientation({ ...orientation, [axis]: v })}
          />
          <div className="model-row">
            {ROTATION_PRESETS.map((deg) => (
              <button
                key={deg}
                className={`chip ${orientation[axis] === deg ? "chip-active" : ""}`}
                onClick={() => onOrientation({ ...orientation, [axis]: deg })}
              >
                {deg}°
              </button>
            ))}
          </div>
        </div>
      ))}

      <PanelReset
        onReset={() => onOrientation({ ...DEFAULT_MODEL_ORIENTATION })}
        disabled={!changed}
        label="Reset orientation"
      />
    </PanelGroup>
  );
}

function PartTransformSection({
  parts,
  selected,
  transforms,
  onTransforms,
}: {
  parts: Part[];
  selected: ReadonlySet<string>;
  transforms: PartTransforms;
  onTransforms: (next: PartTransforms) => void;
}) {
  const ids = [...selected];
  const isSolid = ids.length === 1 && ids[0].includes("#solid");
  const targetId = ids.length === 1 && !isSolid ? ids[0] : null;
  const part = targetId ? parts.find((p) => p.id === targetId) : undefined;
  const t = (targetId && transforms[targetId]) || IDENTITY_PART_TRANSFORM;
  const changedScale = t.scale !== 1;
  const changedOffset = t.offsetX !== 0 || t.offsetY !== 0 || t.offsetZ !== 0;

  return (
    <PanelGroup
      title="Part transform"
      hint="Scale and move one whole part. Select exactly one in Objects, or on the piece."
    >
      {!part && (
        <p className="field-hint mb-2">
          {isSolid
            ? "A single stone or solid is selected — this moves whole parts only. Use Prongs for a claw, or Materials for one stone's own properties."
            : ids.length > 1
              ? "Select exactly one part — a transform on several at once would mean something different for each."
              : "Select a part in Objects, or on the piece, to scale or move it."}
        </p>
      )}

      <NumberField
        label="Scale"
        value={t.scale}
        min={PART_SCALE_MIN}
        max={PART_SCALE_MAX}
        step={0.02}
        precision={2}
        suffix="×"
        disabled={!part}
        onChange={(v) => targetId && onTransforms(setPartScale(transforms, targetId, v))}
      />

      {(["offsetX", "offsetY", "offsetZ"] as const).map((axis, i) => (
        <NumberField
          key={axis}
          label={["X offset", "Y offset", "Z offset"][i]}
          value={t[axis]}
          min={-PART_OFFSET_LIMIT}
          max={PART_OFFSET_LIMIT}
          step={0.01}
          precision={3}
          disabled={!part}
          onChange={(v) => targetId && onTransforms(setPartOffset(transforms, targetId, axis, v))}
        />
      ))}

      <div className="model-row">
        <PanelReset
          onReset={() => targetId && onTransforms(resetPartScale(transforms, targetId))}
          disabled={!part || !changedScale}
          label="Reset scale"
        />
        <PanelReset
          onReset={() => targetId && onTransforms(resetPartPosition(transforms, targetId))}
          disabled={!part || !changedOffset}
          label="Reset position"
        />
      </div>
    </PanelGroup>
  );
}

export function ModelPanel({
  orientation,
  onOrientation,
  parts,
  selected,
  transforms,
  onTransforms,
}: {
  orientation: ModelOrientation;
  onOrientation: (next: ModelOrientation) => void;
  parts: Part[];
  selected: ReadonlySet<string>;
  transforms: PartTransforms;
  onTransforms: (next: PartTransforms) => void;
}) {
  return (
    <>
      <PanelIntro>
        Adjust the piece itself — its orientation, and one selected part's scale or position. Not
        materials, lighting or the camera.
      </PanelIntro>

      <OrientationSection orientation={orientation} onOrientation={onOrientation} />
      <PartTransformSection
        parts={parts}
        selected={selected}
        transforms={transforms}
        onTransforms={onTransforms}
      />
    </>
  );
}
