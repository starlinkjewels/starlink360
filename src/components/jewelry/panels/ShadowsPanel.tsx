/*
 * Shadows.
 *
 * Two mechanisms, chosen explicitly rather than swapped underneath anyone. See
 * `shadows.ts` for why contact stays the default — the short version is that
 * changing it restyles every render already approved, and that is the user's
 * call.
 */
import { RotateCcw } from "lucide-react";
import {
  DEFAULT_SHADOWS,
  SHADOW_MAP_SIZES,
  clampShadows,
  shadowWarning,
  type ShadowMode,
  type ShadowSettings,
} from "../shadows";
import { NumberField } from "../ui/NumberField";
import { PanelIntro, PanelReset } from "../ui/Panel";
import { Select } from "../Select";

export function ShadowsPanel({
  shadows,
  onShadows,
  radius,
  hasCaster,
}: {
  shadows: ShadowSettings;
  onShadows: (next: ShadowSettings) => void;
  /** The piece's bounding radius, which the frustum is expressed relative to. */
  radius: number;
  /** False when no visible light is set to cast. */
  hasCaster: boolean;
}) {
  const set = (patch: Partial<ShadowSettings>) => onShadows(clampShadows({ ...shadows, ...patch }));

  const warning = shadowWarning(shadows, radius);
  const directional = shadows.mode === "directional";

  return (
    <>
      <PanelIntro>
        Two mechanisms, and they are different things. Contact is a soft pool under the piece and
        shows no shape; a shadow camera throws the real outline of the piece across the ground.
      </PanelIntro>

      <label className="tex-toggle">
        <input
          type="checkbox"
          checked={shadows.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        <span>Cast shadows</span>
      </label>

      <label className="field">
        <span className="field-label">Type</span>
        <Select
          value={shadows.mode}
          options={[
            {
              value: "contact",
              label: "Contact (soft pool)",
              hint: "Cheap, always plausible, shows no shape",
            },
            {
              value: "directional",
              label: "Directional (real camera)",
              hint: "Throws the actual outline of the piece",
            },
          ]}
          onChange={(v) => set({ mode: v as ShadowMode })}
          disabled={!shadows.enabled}
          ariaLabel="Shadow type"
        />
        <span className="field-hint">
          {directional
            ? "A real shadow camera, rendered from the casting light. Slower, and it shows the shape of the piece."
            : "A blurred silhouette from below. This is what every render so far has used."}
        </span>
      </label>

      {shadows.enabled && directional && !hasCaster && (
        <p className="field-hint field-warn">
          No light is casting. Open Lights, expand a spot or directional light, and choose
          &ldquo;Cast the shadow&rdquo; — until then there is nothing to render.
        </p>
      )}

      {warning && <p className="field-hint field-warn">{warning}</p>}

      {shadows.enabled && !directional && (
        <>
          <NumberField
            label="Opacity"
            value={shadows.opacity}
            min={0}
            max={1}
            step={0.01}
            precision={2}
            onChange={(v) => set({ opacity: v })}
          />
          <NumberField
            label="Blur"
            value={shadows.blur}
            min={0}
            max={20}
            step={0.1}
            precision={1}
            onChange={(v) => set({ blur: v })}
          />
          <NumberField
            label="Spread"
            value={shadows.spread}
            min={0.5}
            max={40}
            step={0.1}
            precision={1}
            hint="Footprint relative to the piece."
            onChange={(v) => set({ spread: v })}
          />
        </>
      )}

      {shadows.enabled && directional && (
        <>
          <NumberField
            label="Size"
            value={shadows.size}
            min={0.5}
            max={40}
            step={0.1}
            precision={1}
            hint="How much ground the shadow camera covers, relative to the piece. Larger stretches the same map further."
            onChange={(v) => set({ size: v })}
          />
          <NumberField
            label="Focus"
            value={shadows.focus}
            min={0.1}
            max={10}
            step={0.05}
            precision={2}
            hint="Concentrates a spot's map near the subject."
            onChange={(v) => set({ focus: v })}
          />
          <NumberField
            label="Samples"
            value={shadows.samples}
            min={1}
            max={64}
            step={1}
            hint="Softness of the edge. Cost rises with it and the look stops improving around 16."
            onChange={(v) => set({ samples: v })}
          />
          <NumberField
            label="Opacity"
            value={shadows.opacity}
            min={0}
            max={1}
            step={0.01}
            precision={2}
            hint="Only affects the stand-in floor, when no ground plane is switched on."
            onChange={(v) => set({ opacity: v })}
          />

          <div className="light-pair">
            <label className="field">
              <span className="field-label">Map width</span>
              <Select
                value={String(shadows.mapWidth)}
                options={SHADOW_MAP_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
                onChange={(v) => set({ mapWidth: Number(v) })}
                ariaLabel="Shadow map width"
              />
            </label>
            <label className="field">
              <span className="field-label">Map height</span>
              <Select
                value={String(shadows.mapHeight)}
                options={SHADOW_MAP_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
                onChange={(v) => set({ mapHeight: Number(v) })}
                ariaLabel="Shadow map height"
              />
            </label>
          </div>

          <p className="field-label mt-2">Shadow camera</p>
          <p className="field-hint">
            The frustum, in multiples of the piece&rsquo;s own size — so it does not need re-tuning
            for every ring.
          </p>
          <div className="light-pair">
            <NumberField
              label="Near"
              value={shadows.near}
              min={0.01}
              max={100}
              step={0.05}
              precision={2}
              slider={false}
              onChange={(v) => set({ near: v })}
            />
            <NumberField
              label="Far"
              value={shadows.far}
              min={0.02}
              max={500}
              step={0.5}
              precision={2}
              slider={false}
              onChange={(v) => set({ far: v })}
            />
          </div>
          <div className="light-pair">
            <NumberField
              label="Left"
              value={shadows.left}
              min={-100}
              max={0}
              step={0.1}
              precision={2}
              slider={false}
              onChange={(v) => set({ left: v })}
            />
            <NumberField
              label="Right"
              value={shadows.right}
              min={0}
              max={100}
              step={0.1}
              precision={2}
              slider={false}
              onChange={(v) => set({ right: v })}
            />
          </div>
          <div className="light-pair">
            <NumberField
              label="Top"
              value={shadows.top}
              min={0}
              max={100}
              step={0.1}
              precision={2}
              slider={false}
              onChange={(v) => set({ top: v })}
            />
            <NumberField
              label="Bottom"
              value={shadows.bottom}
              min={-100}
              max={0}
              step={0.1}
              precision={2}
              slider={false}
              onChange={(v) => set({ bottom: v })}
            />
          </div>

          <NumberField
            label="Bias"
            value={shadows.bias}
            min={-0.01}
            max={0.01}
            step={0.0001}
            precision={4}
            hint="Nudges the shadow off the surface. Raise it if the piece is striped with dark bands."
            onChange={(v) => set({ bias: v })}
          />
          <NumberField
            label="Radius"
            value={shadows.radius}
            min={0}
            max={25}
            step={0.5}
            precision={1}
            hint="Blur width in texels."
            onChange={(v) => set({ radius: v })}
          />
        </>
      )}

      <PanelReset
        onReset={() => onShadows({ ...DEFAULT_SHADOWS })}
        disabled={JSON.stringify(shadows) === JSON.stringify(DEFAULT_SHADOWS)}
        label="Reset shadows"
      />
    </>
  );
}
