/*
 * Model Dimensions.
 *
 * Real size and estimated carat weight, computed from the geometry rather
 * than typed in stone by stone — with one honest exception. See `dimensions.ts`
 * for why millimetres need a calibration and can't just be read off the mesh.
 */
import {
  DEFAULT_DIMENSIONS,
  mmPerUnit,
  summariseGems,
  type DimensionSettings,
  type GemSummary,
} from "../dimensions";
import type { Fit } from "../Model";
import type { Part } from "../selection";
import { NumberField } from "../ui/NumberField";
import { PanelGroup, PanelIntro, PanelReset } from "../ui/Panel";

/** One labelled number, styled the same whether it's mm or a bare multiple. */
function Stat({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="dim-stat">
      <span className="dim-stat-label">{label}</span>
      <span className="dim-stat-value">
        {value}
        {suffix && <span className="dim-stat-suffix"> {suffix}</span>}
      </span>
    </div>
  );
}

export function DimensionsPanel({
  dimensions,
  onDimensions,
  fit,
  parts,
}: {
  dimensions: DimensionSettings;
  onDimensions: (next: DimensionSettings) => void;
  /** Null until the piece has loaded and reported its own extent. */
  fit: Fit | null;
  parts: Part[];
}) {
  const set = (patch: Partial<DimensionSettings>) => onDimensions({ ...dimensions, ...patch });

  const widthUnits = fit?.width ?? 0;
  const scale = mmPerUnit(dimensions.knownWidthMM, widthUnits);
  const suffix = scale ? "mm" : "×";

  const fmt = (units: number) => ((scale ?? 1) * units).toFixed(2);

  const summary: GemSummary = summariseGems(parts, scale);

  return (
    <>
      <PanelIntro>
        The piece's real size and an estimated carat weight, worked out from the geometry itself —
        not typed in stone by stone.
      </PanelIntro>

      {!fit && <p className="field-hint mb-2">Waiting for the piece to finish loading.</p>}

      <PanelGroup title="Calibration">
        <NumberField
          label="Real width"
          value={dimensions.knownWidthMM ?? 0}
          min={0}
          max={500}
          step={0.01}
          precision={2}
          suffix="mm"
          slider={false}
          hint={
            dimensions.knownWidthMM === null
              ? "Not calibrated — this file carries no usable unit (true for .obj and .stl, and for a piece already rescaled before it reached the viewer), so there is nothing to read the real size off. Type the piece's actual width to make every figure below, including carat weight, accurate."
              : scale
                ? dimensions.autoDetected
                  ? "Read automatically from the file's own units — not a guess. Every measurement below is scaled from this; override it any time if it looks wrong."
                  : "Every measurement below is scaled from this. Change it any time — nothing else needs re-entering."
                : "Waiting for the piece to finish loading — this will apply once it does."
          }
          onChange={(v) => set({ knownWidthMM: v > 0 ? v : null, autoDetected: false })}
        />
      </PanelGroup>

      <PanelGroup title="Show">
        <label className="tex-toggle">
          <input
            type="checkbox"
            checked={dimensions.showOnCanvas}
            onChange={(e) => set({ showOnCanvas: e.target.checked })}
          />
          <span>Visualise on canvas</span>
        </label>
        <label className="tex-toggle mt-2">
          <input
            type="checkbox"
            checked={dimensions.showTable}
            onChange={(e) => set({ showTable: e.target.checked })}
          />
          <span>Visualise table</span>
        </label>
      </PanelGroup>

      {dimensions.showTable && fit && (
        <>
          <PanelGroup title="Size">
            <div className="dim-stats">
              <Stat label="Width" value={fmt(fit.width)} suffix={suffix} />
              <Stat label="Height" value={fmt(fit.height)} suffix={suffix} />
              <Stat label="Depth" value={fmt(fit.depth)} suffix={suffix} />
            </div>
          </PanelGroup>

          <PanelGroup title="Gems">
            <div className="dim-stats">
              <Stat label="Count" value={String(summary.totalCount)} />
              <Stat
                label="Total carat wt"
                value={scale ? summary.totalCaratWt.toFixed(3) : "—"}
                suffix={scale ? "ct" : undefined}
              />
            </div>
            {!scale && summary.totalCount > 0 && (
              <p className="field-hint mt-2">
                Carat weight needs a calibrated width — L × W × D means nothing in an unscaled unit.
              </p>
            )}

            {summary.rows.length > 0 && (
              <table className="dim-table mt-2">
                <thead>
                  <tr>
                    <th className="dim-table-cell dim-table-head">Type</th>
                    <th className="dim-table-cell dim-table-head">L × W × D</th>
                    <th className="dim-table-cell dim-table-head">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((row, i) => (
                    <tr key={i}>
                      <td className="dim-table-cell">{row.shape}</td>
                      <td className="dim-table-cell">
                        {scale
                          ? `${row.lengthMM.toFixed(2)} × ${row.widthMM.toFixed(2)} × ${row.depthMM.toFixed(2)} mm`
                          : `${row.lengthMM.toFixed(2)} × ${row.widthMM.toFixed(2)} × ${row.depthMM.toFixed(2)} ×`}
                        {scale && (
                          <span className="dim-table-carat"> ~{row.caratEach.toFixed(3)} ct</span>
                        )}
                      </td>
                      <td className="dim-table-cell">{row.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </PanelGroup>
        </>
      )}

      <PanelReset
        onReset={() => onDimensions({ ...DEFAULT_DIMENSIONS })}
        disabled={JSON.stringify(dimensions) === JSON.stringify(DEFAULT_DIMENSIONS)}
        label="Reset dimensions"
      />
    </>
  );
}
