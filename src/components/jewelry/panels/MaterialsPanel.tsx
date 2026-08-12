/*
 * The Materials panel.
 *
 * Two catalogues over one selection: pick Metals or Gems, pick a material, and
 * it lands on whatever is selected — or on the whole piece when nothing is.
 * That rule lives in `assign.ts` and is stated on screen above the grid, because
 * a panel that silently changes scope is worse than one that asks.
 *
 * The custom editor is deliberately a patch on a named material rather than a
 * blank slate. "18k Yellow Gold, roughened" is something a jeweller can reason
 * about and undo; an anonymous set of five numbers is not.
 */
import { useMemo, useState } from "react";
import { RotateCcw, Sliders, LayoutGrid, List, Brush } from "lucide-react";
import {
  GEMS,
  METALS,
  gemById,
  gemGroups,
  metalById,
  metalGroups,
  type GemMaterial,
  type MaterialPatch,
  type MetalMaterial,
} from "../library";
import { needsOutline, previewUrl } from "../preview";
import {
  applyMaterial,
  clearMaterial,
  commonMaterial,
  commonPatch,
  describeTargets,
  patchMaterial,
  targetsEverything,
  type Assignments,
} from "../assign";
import { applyClick, type Part, type PartKind } from "../selection";
import { NumberField } from "../ui/NumberField";
import { PanelIntro, PanelReset } from "../ui/Panel";

export type MaterialTab = "metals" | "gems";
type Layout = "grid" | "list";

/** The swatch image, shared by both layouts. */
function Preview({ item, size }: { item: MetalMaterial | GemMaterial; size: number }) {
  const url = useMemo(
    () =>
      previewUrl(
        "ior" in item
          ? {
              kind: "gem",
              color: item.color,
              ior: item.ior,
              dispersion: item.dispersion,
              opaque: item.opaque,
            }
          : {
              kind: "metal",
              color: item.color,
              roughness: item.roughness,
              metalness: item.metalness,
            },
        size,
      ),
    [item, size],
  );

  /*
   * A plain background circle stands in during server render and in the frame
   * before the canvas has run, so the grid never lays out empty and then jumps.
   */
  return url ? (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className="mat-orb"
      style={
        needsOutline(item.color)
          ? { boxShadow: "inset 0 0 0 1px rgba(128,128,128,0.45)" }
          : undefined
      }
      draggable={false}
    />
  ) : (
    <span className="mat-orb" style={{ width: size, height: size, background: item.color }} />
  );
}

export function MaterialsPanel({
  parts,
  selected,
  assignments,
  onAssignments,
  tab,
  onSelect,
  armed = null,
  onArm,
  fallbackMetal,
  onFallbackMetal,
  surface,
}: {
  parts: Part[];
  selected: ReadonlySet<string>;
  assignments: Assignments;
  onAssignments: (next: Assignments) => void;
  /** Which catalogue this section shows. Fixed by the caller — Metals and
   *  Stones are separate rail sections, not two tabs of one. */
  tab: MaterialTab;
  /** Lets a part be selected by name, for anything hard to hit on screen. */
  onSelect?: (next: Set<string>) => void;
  /**
   * The material armed for painting, or null when off. While armed, clicking
   * the piece applies it to whatever was clicked instead of selecting.
   */
  armed?: string | null;
  onArm?: (brush: { material: string; kind: PartKind } | null) => void;
  /**
   * The metal the piece wears where nothing is assigned.
   *
   * Without this the grid lit nothing on a fresh piece — the metal was real and
   * visible on screen, but no swatch claimed it, which reads as the panel not
   * knowing what it is looking at.
   */
  fallbackMetal?: string;
  /** Sets that global metal, when a choice is meant for the whole piece. */
  onFallbackMetal?: (id: string) => void;
  /** The surface-finish control, which is global and belongs above the tabs. */
  surface?: React.ReactNode;
}) {
  const [layout, setLayout] = useState<Layout>("grid");
  const [editing, setEditing] = useState(false);

  const kind = tab === "metals" ? "metal" : "stone";
  const groups = tab === "metals" ? metalGroups() : gemGroups();
  const scope = describeTargets(parts, selected, kind);
  const whole = targetsEverything(parts, selected, kind);
  /*
   * What the grid shows as chosen.
   *
   * An assignment wins. With none, metals fall back to the global finish — the
   * piece IS in that metal, so lighting nothing would be the panel disagreeing
   * with the render. Stones have no such fallback: their colour comes from the
   * file, and claiming a catalogue entry for it would be a guess.
   */
  const assigned = commonMaterial(assignments, parts, selected, kind);
  const active = assigned ?? (kind === "metal" ? (fallbackMetal ?? null) : null);
  const patch = commonPatch(assignments, parts, selected, kind);
  const ofKind = parts.filter((p) => p.kind === kind);
  const has = ofKind.length > 0;

  /*
   * Two ways to apply, and the mode decides which.
   *
   * Off: the swatch applies immediately, to the selection or to the whole
   * piece. On: the swatch is loaded onto the brush and nothing changes until
   * the piece is clicked — which is the workflow for setting a halo stone by
   * stone, where select-then-apply is two steps per stone.
   */
  const painting = armed !== null;
  const choose = (id: string) => {
    if (painting) {
      onArm?.(armed === id ? { material: "", kind } : { material: id, kind });
      return;
    }
    /*
     * A choice meant for the WHOLE piece moves the global metal rather than
     * writing an assignment onto every part.
     *
     * Same pixels either way, but not the same meaning: the global metal is
     * what an unassigned part wears, so it also covers parts that do not exist
     * yet — a piece loaded afterwards, or a group the decoder splits
     * differently. Writing N assignments instead would leave the header naming
     * one metal while the grid lit another.
     */
    if (kind === "metal" && whole && onFallbackMetal) {
      onFallbackMetal(id);
      onAssignments(clearMaterial(assignments, parts, selected, kind));
      return;
    }
    onAssignments(applyMaterial(assignments, parts, selected, kind, id));
  };

  const edit = (next: MaterialPatch) =>
    onAssignments(
      patchMaterial(
        assignments,
        parts,
        selected,
        kind,
        next,
        // Editing before choosing starts from the catalogue's first entry, so
        // the patch always has a named material under it.
        active ?? (tab === "metals" ? METALS[0].id : GEMS[0].id),
      ),
    );

  const reset = () => onAssignments(clearMaterial(assignments, parts, selected, kind));

  const size = layout === "grid" ? 44 : 30;
  const chosen = tab === "metals" ? metalById(active ?? undefined) : gemById(active ?? undefined);
  // While painting, the grid highlights what is on the brush, not what the
  // selection happens to be wearing.
  const lit = painting ? armed : active;
  const brushName =
    (metalById(armed ?? undefined) ?? gemById(armed ?? undefined))?.name ?? "nothing";

  return (
    <>
      {surface}

      {/* What a click is about to change, always visible, never implied. */}
      <div className="mat-scope">
        <span className={`mat-scope-text ${whole && !painting ? "" : "mat-scope-narrow"}`}>
          {painting ? (
            armed ? (
              <>
                Click {kind === "metal" ? "any metal" : "any stone"} to paint{" "}
                <strong>{brushName}</strong>
              </>
            ) : (
              <>
                Painting — <strong>pick a {kind === "metal" ? "metal" : "gem"} below</strong>
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
            title="Grid"
          >
            <LayoutGrid className="size-3.5" />
          </button>
          <button
            className={`icon-toggle ${layout === "list" ? "icon-toggle-on" : ""}`}
            onClick={() => setLayout("list")}
            aria-label="List"
            aria-pressed={layout === "list"}
            title="List"
          >
            <List className="size-3.5" />
          </button>
          <button
            className={`icon-toggle ${painting ? "icon-toggle-on" : ""}`}
            onClick={() => onArm?.(painting ? null : { material: "", kind })}
            aria-label="Paint onto the piece"
            aria-pressed={painting}
            title="Paint onto the piece"
            disabled={!onArm}
          >
            <Brush className="size-3.5" />
          </button>
          <button
            className={`icon-toggle ${editing ? "icon-toggle-on" : ""}`}
            onClick={() => setEditing((v) => !v)}
            aria-label="Custom material"
            aria-pressed={editing}
            title="Custom material"
          >
            <Sliders className="size-3.5" />
          </button>
        </span>
      </div>

      {!has && (
        <p className="field-hint mb-2">
          Nothing here to change yet — this piece has no {tab === "metals" ? "metal" : "stones"}.
          Choosing a material will do nothing until one is loaded.
        </p>
      )}

      {/*
        The parts of this kind, by name.

        Clicking the piece selects too, but only for something you can see and
        hit. A prong hidden behind the shank, or a stone set that is entirely
        under a halo, has no reachable pixel — this is how those get selected.
      */}
      {ofKind.length > 1 && onSelect && (
        <div className="part-chips" role="group" aria-label="Parts">
          {ofKind.map((p) => {
            const on = selected.has(p.id);
            return (
              <button
                key={p.id}
                className={`part-chip ${on ? "part-chip-on" : ""}`}
                aria-pressed={on}
                onClick={() => onSelect(applyClick(selected, p.id, false))}
                title={p.label}
              >
                {assignments[p.id] && <span className="part-chip-dot" />}
                {p.label}
              </button>
            );
          })}
        </div>
      )}

      {groups.map(({ group, items }) => (
        <div key={group} className="mat-group">
          <p className="mat-group-head">{group}</p>
          <div
            className={layout === "grid" ? "mat-grid" : "mat-list"}
            role="radiogroup"
            aria-label={group}
          >
            {items.map((item) => {
              const on = item.id === lit;
              return (
                <button
                  key={item.id}
                  role="radio"
                  aria-checked={on}
                  aria-label={item.name}
                  title={
                    "ior" in item
                      ? `${item.name} — IOR ${item.ior}, dispersion ${item.dispersion}`
                      : item.name
                  }
                  className={layout === "grid" ? "mat-cell" : "mat-row"}
                  onClick={() => choose(item.id)}
                >
                  <span className={`mat-orb-ring ${on ? "mat-orb-on" : ""}`}>
                    <Preview item={item} size={size} />
                  </span>
                  <span className="mat-name">{item.name}</span>
                  {layout === "list" && "ior" in item && (
                    <span className="mat-meta">IOR {item.ior.toFixed(2)}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {editing && (
        <div className="mat-editor">
          <p className="field-label">Custom{chosen ? ` — ${chosen.name}` : ""}</p>
          <p className="field-hint">
            Edits sit on top of the chosen material, so the name still means something and picking
            another one starts clean.
          </p>

          <label className="field mt-2">
            <span className="field-label">Base colour</span>
            <input
              className="stone-colour-input"
              type="color"
              value={patch.color ?? chosen?.color ?? "#ffffff"}
              onChange={(e) => edit({ color: e.target.value })}
              aria-label="Base colour"
            />
          </label>

          {tab === "metals" ? (
            <>
              <NumberField
                label="Roughness"
                value={patch.roughness ?? (chosen as MetalMaterial | undefined)?.roughness ?? 0.25}
                min={0}
                max={1}
                step={0.01}
                precision={2}
                hint="0 is a mirror polish, 1 is fully matte."
                onChange={(v) => edit({ roughness: v })}
              />
              <NumberField
                label="Metalness"
                value={patch.metalness ?? (chosen as MetalMaterial | undefined)?.metalness ?? 1}
                min={0}
                max={1}
                step={0.01}
                precision={2}
                hint="Solid metal is 1. Lower it only for plating or oxide."
                onChange={(v) => edit({ metalness: v })}
              />
            </>
          ) : (
            <>
              <NumberField
                label="IOR"
                value={patch.ior ?? (chosen as GemMaterial | undefined)?.ior ?? 2.417}
                min={1}
                max={3}
                step={0.001}
                precision={3}
                hint="Diamond 2.417, sapphire 1.77, quartz 1.55."
                onChange={(v) => edit({ ior: v })}
              />
              <NumberField
                label="Transmission"
                value={patch.transmission ?? ((chosen as GemMaterial | undefined)?.opaque ? 0 : 1)}
                min={0}
                max={1}
                step={0.01}
                precision={2}
                hint="Below 0.5 the stone stops being traced and renders solid, like onyx."
                onChange={(v) => edit({ transmission: v })}
              />
            </>
          )}
        </div>
      )}

      <PanelReset
        onReset={reset}
        disabled={!has}
        label={`Back to the file's own ${tab === "metals" ? "metal" : "stones"}`}
      />
    </>
  );
}
