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
// Aliased: `Brush` is the armed-brush state type in this codebase.
import { Brush as BrushIcon, LayoutGrid, Link2, List, RotateCcw } from "lucide-react";
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
import { describeTargets, expandLinked, targetIds, targetsEverything, type Brush } from "../assign";
import { NumberField } from "../ui/NumberField";
import { PanelGroup, PanelIntro, PanelReset } from "../ui/Panel";

export type Textures = Record<string, TextureAssignment>;

/** The name of a finish, for the brush readout. */
function finishLabel(id: string): string {
  return SURFACE_FINISHES.find((f) => f.id === id)?.label ?? id;
}

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
  fallbackFinish = "none",
  onFallbackFinish,
  armed = null,
  onArm,
  linkNames = false,
  onLinkNames,
}: {
  parts: Part[];
  selected: ReadonlySet<string>;
  textures: Textures;
  onTextures: (next: Textures) => void;
  onSelect?: (next: Set<string>) => void;
  /** The finish a part wears when nothing is assigned to it. */
  fallbackFinish?: string;
  onFallbackFinish?: (id: string) => void;
  /**
   * The shared brush. Same slot the Materials panel uses, so arming one
   * disarms the other — a click can only mean one thing.
   */
  armed?: Brush | null;
  onArm?: (brush: Brush | null) => void;
  /** Same "same name" link Materials offers, for a finish instead of a metal. */
  linkNames?: boolean;
  onLinkNames?: (next: boolean) => void;
}) {
  const [layout, setLayout] = useState<"grid" | "list">("grid");

  /*
   * Armed for THIS tool. The material brush also carries `kind: "metal"`, so
   * testing the kind alone would light both panels at once.
   */
  const painting = armed?.tool === "finish";
  const brushFinish = painting ? armed.finish : "";

  const ids = targetIds(parts, selected, "metal");
  const scope = describeTargets(parts, selected, "metal");
  const whole = targetsEverything(parts, selected, "metal");
  const assigned = common(textures, ids);
  /*
   * With nothing assigned, the grid shows the piece's own finish — it IS
   * wearing that, so lighting nothing would be the panel disagreeing with the
   * render. Same rule the Materials grid follows for metal.
   */
  const current =
    assigned.finish === "none" && whole ? { ...assigned, finish: fallbackFinish } : assigned;
  const ofKind = parts.filter((p) => p.kind === "metal");

  const linkedIds = expandLinked(parts, ids, linkNames);

  const write = (patch: Partial<TextureAssignment>) => {
    /*
     * A finish meant for the WHOLE piece sets the global one rather than
     * stamping an assignment onto every part — so it also covers parts that do
     * not exist yet, and the two cannot drift apart.
     */
    if (
      whole &&
      onFallbackFinish &&
      patch.finish !== undefined &&
      Object.keys(patch).length === 1
    ) {
      onFallbackFinish(patch.finish);
      const cleared = { ...textures };
      for (const id of linkedIds) delete cleared[id];
      onTextures(cleared);
      return;
    }
    const next = { ...textures };
    for (const id of linkedIds) next[id] = { ...(next[id] ?? DEFAULT_TEXTURE), ...patch };
    onTextures(next);
  };

  const setChannel = (key: keyof TextureChannels, on: boolean) =>
    write({ channels: { ...current.channels, [key]: on } });

  const reset = () => {
    const next = { ...textures };
    for (const id of linkedIds) delete next[id];
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

      {/* What a click is about to change, always visible, never implied. */}
      <div className="mat-scope">
        <span className={`mat-scope-text ${whole && !painting ? "" : "mat-scope-narrow"}`}>
          {painting ? (
            brushFinish && brushFinish !== "none" ? (
              <>
                Click any metal to apply <strong>{finishLabel(brushFinish)}</strong>
              </>
            ) : (
              <>
                Painting — <strong>pick a finish below</strong>
              </>
            )
          ) : (
            <>
              Applies to <strong>{scope}</strong>
            </>
          )}
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
          {/*
           * The brush, matching Materials exactly. Without it the only way to
           * finish one prong was to select it in the viewport first and then
           * come back here, which is two tools and a round trip for what reads
           * as one action.
           */}
          <button
            className={`icon-toggle ${painting ? "icon-toggle-on" : ""}`}
            onClick={() => onArm?.(painting ? null : { tool: "finish", kind: "metal", finish: "" })}
            aria-label="Paint a finish onto the piece"
            aria-pressed={painting}
            title="Paint a finish onto the piece"
            disabled={!onArm || !ofKind.length}
          >
            <BrushIcon className="size-3.5" />
          </button>
        </span>
      </div>

      {ofKind.length === 0 && (
        <p className="field-hint mb-2">
          This piece has no metal, so there is nothing to texture. Stones are not offered here — a
          diamond is not hammered.
        </p>
      )}

      {onLinkNames && ofKind.length > 1 && (
        <label
          className="tex-toggle mb-2"
          title="Applying a finish to one named part also applies it to every other part with the same name"
        >
          <input
            type="checkbox"
            checked={linkNames}
            onChange={(e) => onLinkNames(e.target.checked)}
          />
          <span>
            <Link2 className="size-3.5 inline-block mr-1 -mt-0.5" />
            Link same names
          </span>
        </label>
      )}

      {/*
       * How to reach a single object, said once, where it is needed.
       *
       * A finish can be given to one prong or one bead — the renderer splits the
       * metal into its 675 separate objects and gives each its own draw run. But
       * a piece whose metal is a single group shows no part chips, so there is
       * nothing on screen to suggest that anything narrower than "all of it" is
       * possible. Shown only while the choice would apply to everything, since
       * once something IS selected the scope line above already says so.
       */}
      {whole && !painting && ofKind.length > 0 && (
        <p className="field-hint mb-2">
          Pick a part in the viewport with the Select tool to give just that one its own finish.
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
          // While painting, the grid lights what is ON THE BRUSH rather than
          // what the selection happens to be wearing.
          const on = f.id === (painting ? brushFinish : current.finish);
          return (
            <button
              key={f.id}
              role="radio"
              aria-checked={on}
              aria-label={f.label}
              title={f.hint}
              className={layout === "grid" ? "mat-cell" : "mat-row"}
              onClick={() =>
                painting
                  ? // Clicking the loaded finish again unloads it, so the brush
                    // can be emptied without leaving paint mode.
                    onArm?.({
                      tool: "finish",
                      kind: "metal",
                      finish: brushFinish === f.id ? "" : f.id,
                    })
                  : write({ finish: f.id })
              }
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
