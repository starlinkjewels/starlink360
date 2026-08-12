/*
 * Export options.
 *
 * Image, Video and Watermark as tabs — the settings that apply to a download
 * rather than to the render. They were scattered across three sections, which
 * meant naming a file in one place, setting its size in another, and finding
 * the mark somewhere else again.
 */
import { useRef } from "react";
import { Image as ImageIcon, RotateCcw, Trash2 } from "lucide-react";
import {
  DPI_CHOICES,
  ROTATION_MODES,
  loopsCleanly,
  printSize,
  type ExportOptions,
  type RotationMode,
} from "../exportOptions";
import { DEFAULT_WATERMARK, WATERMARK_PLACEMENTS, type WatermarkSettings } from "../watermark";
import { NumberField } from "../ui/NumberField";
import { PanelIntro, PanelReset } from "../ui/Panel";
import { Select } from "../Select";
import { TabRow } from "../ui/Tabs";

type ExportTab = "image" | "video" | "watermark";

export type { ExportTab };

export function ExportOptionsPanel({
  tab,
  onTab,
  options,
  onOptions,
  watermark,
  onWatermark,
  /** Longest edge of the current image export, so print size can be shown. */
  imagePixels,
  turns,
}: {
  tab: ExportTab;
  onTab: (t: ExportTab) => void;
  options: ExportOptions;
  onOptions: (next: ExportOptions) => void;
  watermark: WatermarkSettings;
  onWatermark: (next: WatermarkSettings) => void;
  imagePixels: number;
  turns: number;
}) {
  const logoFile = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<ExportOptions>) => onOptions({ ...options, ...patch });
  const mark = (patch: Partial<WatermarkSettings>) => onWatermark({ ...watermark, ...patch });

  const size = printSize(imagePixels, options.dpi);
  const loops = loopsCleanly(options.rotationMode, turns, options.customDegrees);

  return (
    <>
      <PanelIntro>
        Settings that apply to a download rather than to the render — what the file is called, what
        size it opens at, and the mark burned into it.
      </PanelIntro>

      <TabRow
        ariaLabel="Export options"
        active={tab}
        onSelect={onTab}
        tabs={[
          { id: "image" as const, label: "Image" },
          { id: "video" as const, label: "Video" },
          { id: "watermark" as const, label: "Watermark" },
        ]}
      />

      {tab === "image" && (
        <>
          <label className="field">
            <span className="field-label">File Name</span>
            <input
              className="text-input"
              value={options.imageName}
              placeholder="auto — LP-043_front_2048.jpg"
              onChange={(e) => set({ imageName: e.target.value })}
              aria-label="Image file name"
            />
            <span className="field-hint">
              Blank names it from the piece, the angle and the size, which is a name a client can
              file without renaming.
            </span>
          </label>

          <label className="field">
            <span className="field-label">DPI</span>
            <Select
              value={String(options.dpi)}
              options={DPI_CHOICES.map((d) => ({
                value: String(d),
                label: `${d}`,
                hint: d === 300 ? "Print" : d === 72 || d === 96 ? "Screen" : undefined,
              }))}
              onChange={(v) => set({ dpi: Number(v) })}
              ariaLabel="DPI"
            />
            <span className="field-hint">
              {/*
                The pixels do not change — only the metadata. Saying so avoids
                the reasonable assumption that a higher DPI is a bigger render.
              */}
              Written into the file, so it opens at the right physical size.{" "}
              {imagePixels > 0 && (
                <>
                  {imagePixels}px is{" "}
                  <strong>
                    {size.inches.toFixed(1)}in / {Math.round(size.mm)}mm
                  </strong>{" "}
                  wide at this setting.
                </>
              )}{" "}
              It does not change the number of pixels rendered — Quality does that.
            </span>
          </label>
        </>
      )}

      {tab === "video" && (
        <>
          <label className="field">
            <span className="field-label">File Name</span>
            <input
              className="text-input"
              value={options.videoName}
              placeholder="auto — LP-043_turntable_1080.mp4"
              onChange={(e) => set({ videoName: e.target.value })}
              aria-label="Video file name"
            />
          </label>

          <label className="field">
            <span className="field-label">Rotation Mode</span>
            <Select
              value={options.rotationMode}
              options={ROTATION_MODES.map((m) => ({
                value: m.value,
                label: m.label,
                hint: m.hint,
              }))}
              onChange={(v) => set({ rotationMode: v as RotationMode })}
              ariaLabel="Rotation mode"
            />
          </label>

          {options.rotationMode === "custom" && (
            <NumberField
              label="Degrees"
              value={options.customDegrees}
              min={0}
              max={3600}
              step={5}
              suffix="°"
              hint="Above 360 is more than one turn, which is allowed."
              onChange={(v) => set({ customDegrees: v })}
            />
          )}

          {/*
            A clip that stops part-way visibly jumps when it repeats, and social
            platforms loop everything. Worth saying before the export, not after.
          */}
          {!loops && (
            <p className="field-hint field-warn">
              This sweep does not end where it started, so the clip will jump when it loops. 360°,
              or a whole number of turns, closes cleanly.
            </p>
          )}
        </>
      )}

      {tab === "watermark" && (
        <>
          <label className="tex-toggle">
            <input
              type="checkbox"
              checked={watermark.enabled}
              onChange={(e) => mark({ enabled: e.target.checked })}
            />
            <span>Watermark exports</span>
          </label>

          {watermark.enabled && (
            <>
              <p className="field-label mt-2">Logo</p>
              <p className="field-hint">
                A studio&rsquo;s mark is usually a logotype, not a font the browser happens to have.
                A logo replaces the text rather than sitting beside it.
              </p>

              {watermark.logo ? (
                <div className="mark-logo">
                  <img src={watermark.logo} alt="" className="mark-logo-img" />
                  <button
                    className="chip"
                    onClick={() => mark({ logo: null })}
                    aria-label="Remove logo"
                  >
                    <Trash2 className="size-3" />
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  className="dock-btn dock-btn-lg w-full mt-2"
                  onClick={() => logoFile.current?.click()}
                >
                  <ImageIcon className="size-3.5" />
                  Upload a logo
                </button>
              )}
              <input
                ref={logoFile}
                type="file"
                accept="image/png,image/svg+xml,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  /*
                   * A data URL, not an object URL: the mark is drawn into an
                   * export canvas and must not taint it, and an object URL dies
                   * on reload while a saved project expects the logo to persist.
                   */
                  const reader = new FileReader();
                  reader.onload = () => mark({ logo: String(reader.result) });
                  reader.readAsDataURL(file);
                  e.target.value = "";
                }}
              />

              {watermark.logo ? (
                <NumberField
                  label="Logo size"
                  value={watermark.logoScale}
                  min={0.01}
                  max={0.6}
                  step={0.005}
                  precision={3}
                  hint="Height as a fraction of the frame's short edge, so it is the same relative size at every export resolution."
                  onChange={(v) => mark({ logoScale: v })}
                />
              ) : (
                <label className="field mt-2">
                  <span className="field-label">Text</span>
                  <input
                    className="text-input"
                    value={watermark.text}
                    placeholder="Your studio"
                    onChange={(e) => mark({ text: e.target.value })}
                    aria-label="Watermark text"
                  />
                </label>
              )}

              <label className="field mt-2">
                <span className="field-label">Placement</span>
                <Select
                  value={watermark.placement}
                  options={WATERMARK_PLACEMENTS.map((p) => ({ value: p, label: p }))}
                  onChange={(v) => mark({ placement: v as WatermarkSettings["placement"] })}
                  ariaLabel="Watermark placement"
                />
              </label>

              <NumberField
                label="Opacity"
                value={watermark.opacity}
                min={0}
                max={1}
                step={0.01}
                precision={2}
                onChange={(v) => mark({ opacity: v })}
              />
              <NumberField
                label="Angle"
                value={watermark.angle}
                min={-90}
                max={90}
                step={1}
                suffix="°"
                onChange={(v) => mark({ angle: v })}
              />

              {!watermark.logo && (
                <label className="field mt-2">
                  <span className="field-label">Colour</span>
                  <input
                    className="stone-colour-input"
                    type="color"
                    value={watermark.color}
                    onChange={(e) => mark({ color: e.target.value })}
                    aria-label="Watermark colour"
                  />
                </label>
              )}

              <PanelReset
                onReset={() => onWatermark({ ...DEFAULT_WATERMARK, enabled: true })}
                label="Reset watermark"
              />
            </>
          )}
        </>
      )}
    </>
  );
}
