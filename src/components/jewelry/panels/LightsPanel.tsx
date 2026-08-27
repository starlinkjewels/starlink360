/*
 * The lights manager.
 *
 * A list, not a set of sliders. The four lights that used to be hardcoded were
 * a fixed rig, and the first thing anyone does on a real set is kill the fill to
 * see what the key is doing alone — which needed each light to be a thing you
 * can point at, hide, copy and move.
 */
import {
  Copy,
  Eye,
  EyeOff,
  Lightbulb,
  Plus,
  RotateCcw,
  Sun,
  SunDim,
  Trash2,
  Zap,
} from "lucide-react";
import { useState } from "react";
import {
  LIGHT_RIGS,
  addLight,
  applyLightRig,
  deleteLight,
  describeLights,
  duplicateLight,
  fieldsFor,
  isDefaultRig,
  matchingRig,
  resetLights,
  setCaster,
  updateLight,
  type LightDef,
  type LightType,
} from "../lights";
import type { LucideIcon } from "lucide-react";
import { NumberField } from "../ui/NumberField";
import { PanelStatus } from "../ui/Panel";
import { Select } from "../Select";

/*
 * The type as an icon rather than a word.
 *
 * Every row used to carry its type as text — "SPOT", "DIRECTIONAL" — which is
 * a different width on every row, so the badge and the three action buttons
 * after it landed at a different place each time and the list read as ragged.
 * An icon is one width, so the row becomes a fixed grid and everything after
 * the name lines up. The type is still spelled out in the expanded editor.
 */
const TYPE_ICON: Record<LightType, LucideIcon> = {
  spot: Zap,
  directional: Sun,
  point: Lightbulb,
  ambient: SunDim,
};

const TYPES: { value: LightType; label: string; hint: string }[] = [
  { value: "spot", label: "Spot", hint: "A cone, like a jeweller's lamp" },
  { value: "directional", label: "Directional", hint: "Parallel rays, like the sun" },
  { value: "point", label: "Point", hint: "A bulb, throwing light every way" },
  { value: "ambient", label: "Ambient", hint: "Flat fill with no direction" },
];

export function LightsPanel({
  lights,
  onLights,
  debug,
  onDebug,
  canCast,
}: {
  lights: LightDef[];
  onLights: (next: LightDef[]) => void;
  debug: boolean;
  onDebug: (on: boolean) => void;
  /** False while shadows are off or in contact mode, where no light casts. */
  canCast: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const activeRig = matchingRig(lights);

  return (
    <>
      {/*
        Whole-rig starting points, above the per-light editor rather than
        replacing it — pick a look, then fine-tune exactly as before. Only
        highlighted when the rig still matches one exactly, the same rule
        Reset uses, so this cannot claim a look survived hand-editing it.
      */}
      <div className="model-row mb-2" role="radiogroup" aria-label="Scene lighting">
        {LIGHT_RIGS.map((rig) => (
          <button
            key={rig.id}
            className={`chip ${activeRig === rig.id ? "chip-active" : ""}`}
            aria-pressed={activeRig === rig.id}
            title={rig.hint}
            onClick={() => onLights(applyLightRig(rig.id))}
          >
            {rig.label}
          </button>
        ))}
      </div>

      <div className="mat-scope">
        <span className="mat-scope-text">
          <strong>{describeLights(lights)}</strong>
        </span>
        <span className="mat-scope-actions">
          <button
            className={`icon-toggle ${debug ? "icon-toggle-on" : ""}`}
            onClick={() => onDebug(!debug)}
            aria-pressed={debug}
            title="Debug Helpers — show where each light is"
            aria-label="Debug Helpers"
          >
            <Eye className="size-3.5" />
          </button>
          <button
            className="icon-toggle"
            onClick={() => onLights(resetLights())}
            disabled={isDefaultRig(lights)}
            title="Reset defaults"
            aria-label="Reset defaults"
          >
            <RotateCcw className="size-3.5" />
          </button>
        </span>
      </div>

      <ul className="light-list">
        {lights.map((l) => {
          const has = fieldsFor(l.type);
          const expanded = open === l.id;
          return (
            <li key={l.id} className={`light-row ${l.visible ? "" : "light-row-off"}`}>
              <div className="light-head">
                <button
                  className="light-name"
                  onClick={() => setOpen(expanded ? null : l.id)}
                  aria-expanded={expanded}
                  title={`${l.label} — ${l.type}${l.castShadow && canCast ? ", casts the shadow" : ""}`}
                >
                  {/* Tinted with the light's own colour, so the swatch and the
                      type are one mark rather than two competing for the row. */}
                  <span className="light-icon" style={{ color: l.color }}>
                    {(() => {
                      const TypeIcon = TYPE_ICON[l.type];
                      return <TypeIcon className="size-3.5" />;
                    })()}
                  </span>
                  <span className="light-label">{l.label}</span>
                  {l.castShadow && canCast && (
                    <span
                      className="light-casts"
                      title="Casts the shadow"
                      aria-label="Casts the shadow"
                    />
                  )}
                </button>
                <span className="light-actions">
                  <button
                    className="icon-toggle"
                    onClick={() => onLights(updateLight(lights, l.id, { visible: !l.visible }))}
                    title={l.visible ? "Hide" : "Show"}
                    aria-label={l.visible ? `Hide ${l.label}` : `Show ${l.label}`}
                  >
                    {l.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                  </button>
                  <button
                    className="icon-toggle"
                    onClick={() => onLights(duplicateLight(lights, l.id))}
                    title="Duplicate"
                    aria-label={`Duplicate ${l.label}`}
                  >
                    <Copy className="size-3.5" />
                  </button>
                  <button
                    className="icon-toggle"
                    onClick={() => onLights(deleteLight(lights, l.id))}
                    disabled={lights.length <= 1}
                    title="Delete"
                    aria-label={`Delete ${l.label}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              </div>

              {expanded && (
                <div className="light-body">
                  <label className="field">
                    <span className="field-label">Name</span>
                    <input
                      className="text-input"
                      value={l.label}
                      onChange={(e) =>
                        onLights(updateLight(lights, l.id, { label: e.target.value }))
                      }
                    />
                  </label>

                  <label className="field">
                    <span className="field-label">Type</span>
                    <Select
                      value={l.type}
                      options={TYPES}
                      onChange={(v) =>
                        onLights(updateLight(lights, l.id, { type: v as LightType }))
                      }
                      ariaLabel="Light type"
                    />
                  </label>

                  <label className="field">
                    <span className="field-label">Colour</span>
                    <input
                      className="stone-colour-input"
                      type="color"
                      value={l.color}
                      onChange={(e) =>
                        onLights(updateLight(lights, l.id, { color: e.target.value }))
                      }
                      aria-label="Light colour"
                    />
                  </label>

                  <NumberField
                    label="Intensity"
                    value={l.intensity}
                    min={0}
                    max={30}
                    step={0.1}
                    precision={2}
                    onChange={(v) => onLights(updateLight(lights, l.id, { intensity: v }))}
                  />

                  {has.position && (
                    <div className="light-xyz">
                      {(["X", "Y", "Z"] as const).map((axis, i) => (
                        <NumberField
                          key={axis}
                          label={axis}
                          value={l.position[i]}
                          min={-40}
                          max={40}
                          step={0.1}
                          precision={2}
                          slider={false}
                          onChange={(v) => {
                            const p = [...l.position] as [number, number, number];
                            p[i] = v;
                            onLights(updateLight(lights, l.id, { position: p }));
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {has.angle && (
                    <>
                      <NumberField
                        label="Cone"
                        value={l.angle ?? 0.4}
                        min={0.05}
                        max={1.5}
                        step={0.01}
                        precision={2}
                        hint="Half-angle in radians. 1.57 is a hemisphere."
                        onChange={(v) => onLights(updateLight(lights, l.id, { angle: v }))}
                      />
                      <NumberField
                        label="Penumbra"
                        value={l.penumbra ?? 0.5}
                        min={0}
                        max={1}
                        step={0.01}
                        precision={2}
                        hint="0 is a hard-edged circle, 1 fades all the way in."
                        onChange={(v) => onLights(updateLight(lights, l.id, { penumbra: v }))}
                      />
                    </>
                  )}

                  {has.distance && (
                    <NumberField
                      label="Falloff"
                      value={l.distance ?? 0}
                      min={0}
                      max={100}
                      step={0.5}
                      precision={1}
                      hint="Distance at which it reaches nothing. 0 never falls off."
                      onChange={(v) => onLights(updateLight(lights, l.id, { distance: v }))}
                    />
                  )}

                  {has.shadow && (
                    <label className="tex-toggle">
                      <input
                        type="radio"
                        name="shadow-caster"
                        checked={!!l.castShadow}
                        disabled={!canCast}
                        onChange={() => onLights(setCaster(lights, l.id))}
                      />
                      <span>
                        Cast the shadow
                        {!canCast && " — switch Shadows to Directional first"}
                      </span>
                    </label>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/*
        Only one light casts. Every caster is a full extra render of the piece
        into a depth map, and two of them on a jewellery shot cross into a
        double shadow that reads as a fault rather than as lighting.
      */}
      <p className="field-hint mt-2">
        One light casts the shadow — a second would render the whole piece again and cross into a
        double shadow.
      </p>

      <div className="light-add">
        {TYPES.map((t) => (
          <button
            key={t.value}
            className="chip"
            onClick={() => onLights(addLight(lights, t.value))}
            title={t.hint}
          >
            <Plus className="size-3" />
            {t.label}
          </button>
        ))}
      </div>
    </>
  );
}
