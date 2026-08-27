/*
 * Diamond Optics.
 *
 * Global shader tuning — bounces, fresnel, trace quality — as opposed to which
 * gem is assigned where (Stones) or that gem's own colour/IOR/fire (also
 * Stones, in its per-part editor). These apply to every refractive stone at
 * once, so they get their own section rather than living inside a per-part
 * panel that has no way to mean "all of them".
 */
import { DEFAULT_DIAMOND_OPTICS, type DiamondOpticsSettings } from "../diamondOptics";
import { NumberField } from "../ui/NumberField";
import { PanelIntro, PanelReset } from "../ui/Panel";

export function DiamondPanel({
  diamondOptics,
  onDiamondOptics,
}: {
  diamondOptics: DiamondOpticsSettings;
  onDiamondOptics: (next: DiamondOpticsSettings) => void;
}) {
  const set = (patch: Partial<DiamondOpticsSettings>) =>
    onDiamondOptics({ ...diamondOptics, ...patch });

  return (
    <>
      <PanelIntro>
        How every diamond is traced, not which stone is which — that's set per part in Stones, along
        with that stone's own colour, IOR and fire.
      </PanelIntro>

      <label className="field">
        <span className="field-label">Refractive Index (IOR)</span>
        <input className="text-input" value="2.417 — diamond, fixed" disabled />
        <span className="field-hint">
          Diamond's real IOR. A stone-specific override, if you need one, is in Stones.
        </span>
      </label>

      <NumberField
        label="Bounces"
        value={diamondOptics.bounces}
        min={3}
        max={8}
        step={1}
        hint="Internal reflections traced per ray. More is closer to a real pavilion's brilliance; each one costs a shader pass."
        onChange={(v) => set({ bounces: Math.round(v) })}
      />
      <NumberField
        label="Fresnel"
        value={diamondOptics.fresnelScale}
        min={0}
        max={1}
        step={0.05}
        precision={2}
        hint="Edge brightness where a facet turns mirror-like. Lower keeps facet contrast at grazing angles instead of reading as glass."
        onChange={(v) => set({ fresnelScale: v })}
      />

      <label className="tex-toggle mt-2">
        <input
          type="checkbox"
          checked={diamondOptics.fastChroma}
          onChange={(e) => set({ fastChroma: e.target.checked })}
        />
        <span>Fast preview (lower fire quality)</span>
      </label>
      <p className="field-hint">
        Approximates dispersion instead of tracing it per colour channel. Recompiles every diamond's
        shader when toggled, so expect a brief stall rather than a live update.
      </p>

      <PanelReset
        onReset={() => onDiamondOptics({ ...DEFAULT_DIAMOND_OPTICS })}
        disabled={JSON.stringify(diamondOptics) === JSON.stringify(DEFAULT_DIAMOND_OPTICS)}
        label="Reset diamond optics"
      />
    </>
  );
}
