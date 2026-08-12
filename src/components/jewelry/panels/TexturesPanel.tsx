/*
 * The Textures panel.
 *
 * Same shape as Materials, deliberately: a grid of previews over the current
 * selection, with the scope stated above it. A finish is a property of a part —
 * a brushed shank with polished prongs is an ordinary piece — so it is assigned
 * the same way a metal is, and the two panels behave identically.
 *
 * Stones are excluded. A diamond is not hammered, and offering it would be a
 * control that cannot do anything.
 */
import { LayoutGrid, List, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import {
  DEFAULT_TEXTURE,
  SURFACE_FINISHES,
  finishThumbnail,
  isColourTexture,
  type TextureAssignment,
  type TextureChannels,
} from "../textures";
import { applyClick, type Part } from "../selection";
import { describeTargets, targetIds, targetsEverything } from "../assign";
import { NumberField } from "../ui/NumberField";
import { PanelGroup, PanelIntro, PanelReset } from "../ui/Panel";

export type Textures = Record<string, TextureAssignment>;

/** The one setting shown, when every target agrees on it. */
function common(textures: Textures, ids: string[]): TextureAssignment {
  if (!ids.length) return DEFAULT_TEXTURE;
  const first = textures[ids[0]] ?? DEFAULT_TEXTURE;
  const same = ids.every(
    (id) => JSON.stringify(textures[id] ?? DEFAULT_TEXTURE) === JSON.stringify(first),
  );
  // Parts wearing different finishes show the default rather than one of them,
  // because lighting one swatch would claim the piece is uniform when it is not.
  return same ? first : DEFAULT_TEXTURE;
}

function Thumb({ finish, size }: { finish: string; size: number }) {
  const url = useMemo(() => finishThumbnail(finish, size), [finish, size]);
  return url ? (
    <img src={url} alt="" width={size} height={size} className="tex-thumb" draggable={false} />
  ) : (
    <span className="tex-thumb" style={{ width: size, height: size }} />
  );
}

export function TexturesPanel({
  parts,
  selected,
  textures,
  onTextures,
  onSelect,
}: {
  parts: Part[];
  selected: ReadonlySet<string>;
  textures: Textures;
  onTextures: (next: Textures) => void;
  onSelect?: (next: Set<string>) => void;
}) {
  const [layout, setLayout] = useState<"grid" | "list">("grid");

  const ids = targetIds(parts, selected, "metal");
  const scope = describeTargets(parts, selected, "metal");
  const whole = targetsEverything(parts, selected, "metal");
  const current = common(textures, ids);
  const ofKind = parts.filter((p) => p.kind === "metal");

  const write = (patch: Partial<TextureAssignment>) => {
    const next = { ...textures };
    for (const id of ids) next[id] = { ...(next[id] ?? DEFAULT_TEXTURE), ...patch };
    onTextures(next);
  };

  const setChannel = (key: keyof TextureChannels, on: boolean) =>
    write({ channels: { ...current.channels, [key]: on } });

  const reset = () => {
    const next = { ...textures };
    for (const id of ids) delete next[id];
    onTextures(next);
  };

  const size = layout === "grid" ? 44 : 30;
  const colourChosen = isColourTexture(current.finish);

  return (
    <>
      <PanelIntro>
        Worked metal finishes, chosen per part — a brushed shank with polished prongs is an ordinary
        piece. Stones are not offered: a diamond is not hammered.
      </PanelIntro>

      <div className="mat-scope">
        <span className={`mat-scope-text ${whole ? "" : "mat-scope-narrow"}`}>
          Applies to <strong>{scope}</strong>
        </span>
        <span className="mat-scope-actions">
          <button
            className={`icon-toggle ${layout === "grid" ? "icon-toggle-on" : ""}`}
            onClick={() => setLayout("grid")}
            aria-label="Grid"
            aria-pressed={layout === "grid"}
          >
            <LayoutGrid className="size-3.5" />
          </button>
          <button
            className={`icon-toggle ${layout === "list" ? "icon-toggle-on" : ""}`}
            onClick={() => setLayout("list")}
            aria-label="List"
            aria-pressed={layout === "list"}
          >
            <List className="size-3.5" />
          </button>
        </span>
      </div>

      {ofKind.length === 0 && (
        <p className="field-hint mb-2">
          This piece has no metal, so there is nothing to texture. Stones are not offered here — a
          diamond is not hammered.
        </p>
      )}

      {ofKind.length > 1 && onSelect && (
        <div className="part-chips" role="group" aria-label="Metal parts">
          {ofKind.map((p) => {
            const on = selected.has(p.id);
            return (
              <button
                key={p.id}
                className={`part-chip ${on ? "part-chip-on" : ""}`}
                aria-pressed={on}
                onClick={() => onSelect(applyClick(selected, p.id, false))}
              >
                {textures[p.id] && textures[p.id].finish !== "none" && (
                  <span className="part-chip-dot" />
                )}
                {p.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Keeps the chosen finish while switching it off, so it can come back. */}
      <label className="tex-toggle">
        <input
          type="checkbox"
          checked={current.enabled}
          onChange={(e) => write({ enabled: e.target.checked })}
        />
        <span>Enable Texture</span>
      </label>

      <div
        className={layout === "grid" ? "mat-grid" : "mat-list"}
        role="radiogroup"
        aria-label="Surface finish"
      >
        {SURFACE_FINISHES.map((f) => {
          const on = f.id === current.finish;
          return (
            <button
              key={f.id}
              role="radio"
              aria-checked={on}
              aria-label={f.label}
              title={f.hint}
              className={layout === "grid" ? "mat-cell" : "mat-row"}
              onClick={() => write({ finish: f.id })}
            >
              <span className={`mat-orb-ring tex-ring ${on ? "mat-orb-on" : ""}`}>
                {f.id === "none" ? (
                  <span className="tex-thumb tex-none" style={{ width: size, height: size }} />
                ) : (
                  <Thumb finish={f.id} size={size} />
                )}
              </span>
              <span className="mat-name">{f.label}</span>
              {layout === "list" && <span className="mat-meta">{f.hint}</span>}
            </button>
          );
        })}
      </div>

      {current.finish !== "none" && (
        <div className="mat-editor">
          <p className="field-label">Texture Channels</p>
          <p className="field-hint">
            {colourChosen
              ? "This one is a surface in its own right, so it paints colour as well."
              : "A worked metal finish changes how light is caught. It never paints the metal, which would tint gold grey."}
          </p>

          <div className="tex-channels">
            {(
              [
                ["color", "Colour"],
                ["roughness", "Roughness"],
                ["normal", "Normal"],
                ["bump", "Bump"],
              ] as [keyof TextureChannels, string][]
            ).map(([key, label]) => {
              // Colour is only meaningful for a colour texture; offering it on
              // a hammer would be a switch that does nothing.
              const dead = key === "color" && !colourChosen;
              return (
                <label key={key} className={`tex-channel ${dead ? "tex-channel-off" : ""}`}>
                  <input
                    type="checkbox"
                    checked={current.channels[key] && !dead}
                    disabled={dead}
                    onChange={(e) => setChannel(key, e.target.checked)}
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>

          <NumberField
            label="Scale"
            value={current.scale}
            min={0.5}
            max={64}
            step={0.5}
            precision={1}
            hint="How many times the pattern repeats across the piece."
            onChange={(v) => write({ scale: v })}
          />
          <NumberField
            label="Strength"
            value={current.strength}
            min={0}
            max={3}
            step={0.05}
            precision={2}
            hint="Depth of the relief. 0 is flat."
            onChange={(v) => write({ strength: v })}
          />
        </div>
      )}

      <PanelReset onReset={reset} disabled={!ofKind.length} label="Back to polished" />
    </>
  );
}
