/*
 * The surface the piece stands on.
 *
 * Two things here are not cosmetic. "Transparent" keeps the plane and its
 * shadow while hiding the surface, which is the only way to float a piece on a
 * gradient with a real shadow under it. And the mirror is not a style — it is
 * `gl.render(scene, virtualCamera)` plus blur passes every frame, so it roughly
 * doubles the hardest part of the render. Both are stated on screen rather than
 * discovered.
 */
import { RotateCcw } from "lucide-react";
import {
  DEFAULT_GROUND,
  GROUND_PRESETS,
  REFLECTION_RESOLUTIONS,
  clampGround,
  clampResolution,
  groundDimensions,
  maxReflectionResolution,
  reflectionWarning,
  type GroundKind,
  type GroundSettings,
  type GroundShape,
  type GroundStyle,
} from "../ground";
import { NumberField } from "../ui/NumberField";
import { PanelIntro, PanelReset } from "../ui/Panel";
import { Select } from "../Select";

/**
 * A number field that may be left blank.
 *
 * Blank means "work it out from the piece", which is what almost everyone
 * wants; a number means "exactly this", which is what someone sizing a plinth
 * wants. The placeholder shows what auto currently resolves to, so the field is
 * never a mystery — and clearing it is how you get back to auto.
 */
function AutoField({
  label,
  value,
  auto,
  onChange,
  hint,
  step = 0.1,
}: {
  label: string;
  value: number | null;
  auto: number;
  onChange: (v: number | null) => void;
  hint?: string;
  step?: number;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className="text-input"
        type="number"
        inputMode="decimal"
        step={step}
        value={value ?? ""}
        placeholder={`auto — ${auto.toFixed(2)}`}
        onChange={(e) => {
          const raw = e.target.value.trim();
          // Empty is null, not zero: zero is a legitimate value to type, and
          // conflating them would make the field impossible to clear.
          onChange(raw === "" ? null : Number(raw));
        }}
        aria-label={label}
      />
      <span className="field-hint">{hint ?? "Leave blank to fit the piece."}</span>
    </label>
  );
}

export function GroundPanel({
  ground,
  onGround,
  radiusXZ,
  coarsePointer,
}: {
  ground: GroundSettings;
  onGround: (next: GroundSettings) => void;
  /** The piece's footprint radius, which "auto" is derived from. */
  radiusXZ: number;
  /** A touch screen, where the mirror is capped harder. */
  coarsePointer: boolean;
}) {
  const set = (patch: Partial<GroundSettings>) => onGround(clampGround({ ...ground, ...patch }));
  const dim = groundDimensions(ground, radiusXZ);
  const warning = reflectionWarning(ground, coarsePointer);
  const mirror = ground.style === "mirror";
  const maxRes = maxReflectionResolution(coarsePointer);

  return (
    <>
      <PanelIntro>
        The surface the piece stands on, and what it reflects. A matte plane is effectively free; a
        reflector draws the whole scene a second time every frame.
      </PanelIntro>

      <label className="tex-toggle">
        <input
          type="checkbox"
          checked={ground.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        <span>Show Ground</span>
      </label>

      {!ground.enabled && (
        <p className="field-hint">
          With no ground there is nothing for a cast shadow to land on. Switch it on and choose
          Transparent to keep the shadow without showing a surface.
        </p>
      )}

      {ground.enabled && (
        <>
          <label className="field">
            <span className="field-label">Type</span>
            <Select
              value={ground.kind}
              options={[
                { value: "standard", label: "Standard", hint: "A visible surface" },
                {
                  value: "transparent",
                  label: "Transparent",
                  hint: "Invisible, but still catches the shadow",
                },
              ]}
              onChange={(v) => set({ kind: v as GroundKind })}
              ariaLabel="Ground type"
            />
            {ground.kind === "transparent" && mirror && (
              <span className="field-hint field-warn">
                A reflector has to be drawn to reflect anything, so Mirror overrides Transparent.
              </span>
            )}
          </label>

          <label className="field">
            <span className="field-label">Shape</span>
            <Select
              value={ground.shape}
              options={[
                { value: "square", label: "Square", hint: "Width and length" },
                { value: "circle", label: "Circle", hint: "Radius and segments" },
              ]}
              onChange={(v) => set({ shape: v as GroundShape })}
              ariaLabel="Ground shape"
            />
          </label>

          {ground.shape === "square" ? (
            <div className="light-pair">
              <AutoField
                label="Width"
                value={ground.width}
                auto={dim.width}
                onChange={(v) => set({ width: v })}
              />
              <AutoField
                label="Length"
                value={ground.length}
                auto={dim.length}
                onChange={(v) => set({ length: v })}
              />
            </div>
          ) : (
            <div className="light-pair">
              <AutoField
                label="Radius"
                value={ground.radius}
                auto={dim.radius}
                onChange={(v) => set({ radius: v })}
              />
              <AutoField
                label="Segments"
                value={ground.segments}
                auto={dim.segments}
                step={1}
                hint="Blank is 64. Below about 24 the rim reads as a polygon."
                onChange={(v) => set({ segments: v })}
              />
            </div>
          )}

          {/* Only meaningful while both dimensions are auto. */}
          {ground.width === null && ground.length === null && ground.radius === null && (
            <NumberField
              label="Size"
              value={ground.sizeScale}
              min={0.5}
              max={60}
              step={0.5}
              precision={1}
              hint="What auto means: a multiple of the piece's own footprint."
              onChange={(v) => set({ sizeScale: v })}
            />
          )}

          {ground.kind === "standard" && (
            <>
              <div className="swatch-grid" role="radiogroup" aria-label="Ground colour">
                {GROUND_PRESETS.map((p) => (
                  <button
                    key={p.hex}
                    role="radio"
                    aria-checked={ground.color === p.hex}
                    aria-label={p.label}
                    className="swatch-cell"
                    onClick={() => set({ color: p.hex })}
                  >
                    <span className={`swatch ${ground.color === p.hex ? "swatch-active" : ""}`}>
                      <span className="swatch-dot" style={{ background: p.hex }} />
                    </span>
                    <span className="swatch-label">{p.label}</span>
                  </button>
                ))}
              </div>
              <label className="field mt-2">
                <span className="field-label">Any other colour</span>
                <input
                  className="stone-colour-input"
                  type="color"
                  value={ground.color}
                  onChange={(e) => set({ color: e.target.value })}
                  aria-label="Ground colour"
                />
              </label>
            </>
          )}

          <NumberField
            label="Roughness"
            value={ground.roughness}
            min={0}
            max={1}
            step={0.01}
            precision={2}
            hint={
              ground.kind === "transparent"
                ? "Drives how dark the caught shadow is, since there is no surface to roughen."
                : "0 is a polish, 1 is fully matte."
            }
            onChange={(v) => set({ roughness: v })}
          />

          <label className="field mt-2">
            <span className="field-label">Surface</span>
            <Select
              value={ground.style}
              options={[
                { value: "matte", label: "Matte", hint: "One extra plane — effectively free" },
                {
                  value: "mirror",
                  label: "Mirror (reflector)",
                  hint: "Draws the whole scene twice per frame",
                },
              ]}
              onChange={(v) => set({ style: v as GroundStyle })}
              ariaLabel="Ground surface"
            />
          </label>

          {warning && <p className="field-hint field-warn">{warning}</p>}

          {mirror && (
            <div className="mat-editor">
              <p className="field-label">Reflector</p>
              <p className="field-hint">
                Twelve parameters, and they are not equal: resolution is the one that costs, the
                blur pair is free, and the depth four decide whether the reflection fades with
                distance or lies flat like a decal.
              </p>

              <label className="field mt-2">
                <span className="field-label">Resolution</span>
                <Select
                  value={String(ground.resolution)}
                  options={REFLECTION_RESOLUTIONS.filter((r) => r <= maxRes).map((r) => ({
                    value: String(r),
                    label: String(r),
                  }))}
                  onChange={(v) => set({ resolution: clampResolution(Number(v), coarsePointer) })}
                  ariaLabel="Reflection resolution"
                />
                <span className="field-hint">
                  {coarsePointer
                    ? `Capped at ${maxRes} on a touch screen — a second full render at 2048 is a dropped frame, not a slow one.`
                    : "The buffer the scene is re-rendered into. This is the expensive dial."}
                </span>
              </label>

              <div className="light-pair">
                <NumberField
                  label="Blur X"
                  value={ground.blurX}
                  min={0}
                  max={2000}
                  step={10}
                  slider={false}
                  onChange={(v) => set({ blurX: v })}
                />
                <NumberField
                  label="Blur Y"
                  value={ground.blurY}
                  min={0}
                  max={2000}
                  step={10}
                  slider={false}
                  onChange={(v) => set({ blurY: v })}
                />
              </div>

              <NumberField
                label="Mix blur"
                value={ground.mixBlur}
                min={0}
                max={10}
                step={0.05}
                precision={2}
                hint="How much of the blurred reflection is used against the sharp one."
                onChange={(v) => set({ mixBlur: v })}
              />
              <NumberField
                label="Mix strength"
                value={ground.mixStrength}
                min={0}
                max={10}
                step={0.05}
                precision={2}
                hint="How strongly the reflection shows through the ground colour."
                onChange={(v) => set({ mixStrength: v })}
              />
              <NumberField
                label="Mix contrast"
                value={ground.mixContrast}
                min={0}
                max={10}
                step={0.05}
                precision={2}
                onChange={(v) => set({ mixContrast: v })}
              />
              <NumberField
                label="Mirror"
                value={ground.mirror}
                min={0}
                max={1}
                step={0.01}
                precision={2}
                hint="0 keeps the ground's own colour, 1 is a perfect mirror."
                onChange={(v) => set({ mirror: v })}
              />

              <p className="field-label mt-2">Depth fade</p>
              <p className="field-hint">
                A real reflection weakens with distance. With Depth scale at 0 it does not, and the
                floor reads as a printed decal rather than a polished surface.
              </p>
              <NumberField
                label="Depth scale"
                value={ground.depthScale}
                min={0}
                max={100}
                step={0.5}
                precision={1}
                onChange={(v) => set({ depthScale: v })}
              />
              <div className="light-pair">
                <NumberField
                  label="Min depth"
                  value={ground.minDepthThreshold}
                  min={0}
                  max={10}
                  step={0.05}
                  precision={2}
                  slider={false}
                  onChange={(v) => set({ minDepthThreshold: v })}
                />
                <NumberField
                  label="Max depth"
                  value={ground.maxDepthThreshold}
                  min={0}
                  max={10}
                  step={0.05}
                  precision={2}
                  slider={false}
                  onChange={(v) => set({ maxDepthThreshold: v })}
                />
              </div>
              <NumberField
                label="Depth/blur bias"
                value={ground.depthToBlurRatioBias}
                min={0}
                max={1}
                step={0.01}
                precision={2}
                hint="How much the depth fade also softens, rather than only dimming."
                onChange={(v) => set({ depthToBlurRatioBias: v })}
              />
              <NumberField
                label="Distortion"
                value={ground.distortion}
                min={0}
                max={10}
                step={0.05}
                precision={2}
                hint="Ripple, for a surface that is not perfectly flat."
                onChange={(v) => set({ distortion: v })}
              />
            </div>
          )}
        </>
      )}

      <PanelReset
        onReset={() => onGround({ ...DEFAULT_GROUND })}
        disabled={JSON.stringify(ground) === JSON.stringify(DEFAULT_GROUND)}
        label="Reset ground"
      />
    </>
  );
}
