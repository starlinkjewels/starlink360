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
import { useEffect, useMemo, useState } from "react";
// Aliased: `Brush` is the armed-brush state type in this codebase.
import { RotateCcw, Sliders, LayoutGrid, List, Link2, Brush as BrushIcon } from "lucide-react";
import {
  GEMS,
  GEM_QUICK_COLORS,
  METALS,
  aberrationFor,
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
  expandLinked,
  patchMaterial,
  targetIds,
  targetsEverything,
  type Assignments,
  type Brush,
} from "../assign";
import { applyClick, type Part, type PartKind } from "../selection";
import { DEFAULT_DIAMOND_OPTICS } from "../diamondOptics";
import { NumberField } from "../ui/NumberField";
import { PanelIntro, PanelReset } from "../ui/Panel";

export type MaterialTab = "metals" | "gems";
type Layout = "grid" | "list";

/** The swatch image, shared by both layouts. */
function Preview({ item, size }: { item: MetalMaterial | GemMaterial; size: number }) {
  /*
   * `previewUrl` returns "" on the server (no canvas) but a real data URL on
   * the client, computed synchronously in the same render pass hydration
   * uses — so without this gate, the client's hydration render already picks
   * <img> while the server sent <span>, a structural mismatch React cannot
   * patch in place. It discards and fully re-renders the affected subtree to
   * recover, which on this page means the whole 3D scene underneath —
   * GLB reload, every gem material rebuilt and recompiled a second time —
   * for every user, every load. `mounted` starts false on both sides so the
   * very first client render matches SSR exactly; the real swatch appears a
   * tick later, from an ordinary update rather than a hydration correction.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const url = useMemo(
    () =>
      !mounted
        ? ""
        : previewUrl(
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
    [mounted, item, size],
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
  linkNames = false,
  onLinkNames,
  stoneColors,
  onStoneColor,
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
   * The brush, or null when off. While armed, clicking the piece applies the
   * material to whatever was clicked instead of selecting it.
   *
   * Carries its KIND, and this panel only considers itself armed when that
   * kind is its own. The brush is one piece of state shared by the Metals and
   * Stones sections, so a bare id lit the brush in both at once — arm it in
   * Stones and Metals claimed to be painting too.
   */
  armed?: Brush | null;
  onArm?: (brush: Brush | null) => void;
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
  /**
   * When on, applying a material to one named part also applies it to every
   * other part sharing that base name — "Prong" catching all of them rather
   * than only the one that was clicked. The caller hands each tab its own
   * preference (Metals and Stones are separate rail sections), so this is
   * meaningful for either kind.
   */
  linkNames?: boolean;
  onLinkNames?: (next: boolean) => void;
  /**
   * Gems only — the i3D-style "Gemstone Colors" quick swatches write here
   * rather than into an assignment's patch, so a fast recolour works even on
   * a stone nothing has been assigned to yet. Layered on top of whatever the
   * catalogue/assignment resolves to; see `effectiveStoneColors` in
   * routes/index.tsx for the merge order.
   */
  stoneColors?: Record<string, string>;
  onStoneColor?: (id: string, hex: string | null) => void;
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
  /*
   * Armed for THIS panel's tool, not merely armed.
   *
   * The finish brush in Textures also carries `kind: "metal"`, so testing the
   * kind alone lit this panel up whenever that one was armed and both claimed
   * the same click.
   */
  const painting = armed?.tool === "material" && armed.kind === kind;
  const brushMaterial = painting ? armed.material : "";
  /*
   * Each tab is handed its OWN `linkNames`/`onLinkNames` (Metals and Stones
   * are separate rail sections with separate preferences — see StudioPanel),
   * so this can read it directly rather than gating by kind the way it used
   * to when only Metals offered the checkbox.
   */
  const linked = linkNames;
  const choose = (id: string) => {
    if (painting) {
      onArm?.(
        brushMaterial === id
          ? { tool: "material", kind, material: "" }
          : { tool: "material", kind, material: id },
      );
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
      onAssignments(clearMaterial(assignments, parts, selected, kind, linked));
      return;
    }
    onAssignments(applyMaterial(assignments, parts, selected, kind, id, linked));
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
        linked,
      ),
    );

  const reset = () => {
    onAssignments(clearMaterial(assignments, parts, selected, kind, linked));
    // A quick-colour override is separate storage (`stoneColors`), not part
    // of `assignments` — clearing only the assignment would leave the
    // colour behind and reset would stop being a reset.
    if (kind === "stone" && onStoneColor) {
      for (const id of stoneTargetIds) onStoneColor(id, null);
    }
  };

  /** Targets for the quick-colour swatches — always "stone" regardless of
   *  `kind`, since they only exist on the gems tab. */
  const stoneTargetIds = useMemo(
    () => expandLinked(parts, targetIds(parts, selected, "stone"), linked),
    [parts, selected, linked],
  );
  const commonStoneColor = useMemo(() => {
    if (!stoneColors || !stoneTargetIds.length) return null;
    const first = stoneColors[stoneTargetIds[0]];
    if (!first) return null;
    return stoneTargetIds.every((id) => stoneColors[id] === first) ? first : null;
  }, [stoneColors, stoneTargetIds]);
  const chooseStoneColor = (hex: string) => {
    if (!onStoneColor) return;
    const clearing = commonStoneColor === hex;
    for (const id of stoneTargetIds) onStoneColor(id, clearing ? null : hex);
  };

  const size = layout === "grid" ? 44 : 30;
  const chosen = tab === "metals" ? metalById(active ?? undefined) : gemById(active ?? undefined);
  /*
   * Which controls this gem actually uses.
   *
   * Mirrors the exact condition GemRefraction's own material branch uses
   * (`transmission < 0.5`), not just the catalogue's `opaque` flag — a custom
   * edit can push either kind of stone across that line, and the panel has to
   * follow the same rule the renderer does or it will offer IOR/Fire on a
   * stone that is currently rendering as a polished solid, or hide Pearl's
   * controls from a diamond someone has dragged the other way.
   */
  const gemChosen = tab === "gems" ? (chosen as GemMaterial | undefined) : undefined;
  const resolvedTransmission = patch.transmission ?? (gemChosen?.opaque ? 0 : 1);
  const isOpaqueGem = tab === "gems" && has && resolvedTransmission < 0.5;
  // While painting, the grid highlights what is on the brush, not what the
  // selection happens to be wearing.
  const lit = painting ? brushMaterial : active;
  const brushName =
    (metalById(brushMaterial || undefined) ?? gemById(brushMaterial || undefined))?.name ??
    "nothing";

  return (
    <>
      {/* What a click is about to change, always visible, never implied. */}
      <div className="mat-scope">
        <span className={`mat-scope-text ${whole && !painting ? "" : "mat-scope-narrow"}`}>
          {painting ? (
            brushMaterial ? (
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
            onClick={() => onArm?.(painting ? null : { tool: "material", kind, material: "" })}
            aria-label="Paint onto the piece"
            aria-pressed={painting}
            title="Paint onto the piece"
            disabled={!onArm}
          >
            <BrushIcon className="size-3.5" />
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

      {onLinkNames && ofKind.length > 1 && (
        <label
          className="tex-toggle mb-2"
          title={`Applying a ${kind === "metal" ? "metal" : "gem"} to one named part also applies it to every other part with the same name`}
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
        Always visible rather than behind the Custom toggle below: this is the
        single biggest lever on whether the metal reads as a mirror-polished
        photograph or a satin-finished render, and it should not take finding
        a small icon to reach. Framed as smoothness rather than roughness —
        up means smoother — because that is the direction a jeweller thinks
        in, even though the material underneath still stores roughness.
      */}
      {tab === "metals" && has && (
        <NumberField
          label="Smoothness"
          value={1 - (patch.roughness ?? (chosen as MetalMaterial | undefined)?.roughness ?? 0.02)}
          min={0}
          max={1}
          step={0.01}
          precision={2}
          hint="All the way up is a mirror polish; down is brushed or satin. This is what a highlight looks like — tight and bright at the top, soft and spread at the bottom."
          onChange={(v) => edit({ roughness: 1 - v })}
        />
      )}

      {/*
        Metal's equivalent for stones. A diamond's fire — the rainbow flash,
        not its brightness — is real here (a traced dispersion, not a filter)
        but genuinely subtle at the physically-accurate default, the same way
        metal's roughness was accurate but never pushed to an actual mirror.
        Capped at the same ceiling the shader itself uses, not a wider one:
        past it the fire stops looking like a diamond and starts looking like
        a shader bug (moissanite's real dispersion already sits at that wall).
      */}
      {tab === "gems" && has && !isOpaqueGem && (
        <NumberField
          label="Fire"
          value={
            patch.aberration ??
            aberrationFor((chosen as GemMaterial | undefined)?.dispersion ?? 0.044)
          }
          min={0.008}
          max={0.09}
          step={0.001}
          precision={3}
          hint="The rainbow flash a stone throws as it turns, not how bright it is. Diamond is genuinely subtle here; this is how far it can go before the flash stops reading as a stone and starts reading as a glitch."
          onChange={(v) => edit({ aberration: v })}
        />
      )}

      {/*
        Pearl's own controls — a pearl is never traced, so IOR and Fire above
        mean nothing to it; what actually reaches the render is this branch's
        own MeshPhysicalMaterial spec (see GemRefraction's `transmission < 0.5`
        path). Shown for any gem currently rendering solid, not only the
        Pearl catalogue entries — onyx and a custom-edited stone share the
        exact same render path and the exact same controls apply.
      */}
      {isOpaqueGem && (
        <>
          <NumberField
            label="Luster"
            value={patch.metalness ?? gemChosen?.metalness ?? 0}
            min={0}
            max={1}
            step={0.01}
            precision={2}
            hint="How much the coating catches the room, the way a satin metal does. 0 is a chalky matte, 1 is a full lustre."
            onChange={(v) => edit({ metalness: v })}
          />
          <NumberField
            label="Surface Roughness"
            value={patch.roughness ?? gemChosen?.roughness ?? 0.08}
            min={0}
            max={1}
            step={0.01}
            precision={2}
            hint="0 is a polish, 1 is fully matte."
            onChange={(v) => edit({ roughness: v })}
          />
          <NumberField
            label="Shine"
            value={patch.clearcoat ?? gemChosen?.clearcoat ?? 1}
            min={0}
            max={1}
            step={0.01}
            precision={2}
            hint="The coating's own clear top layer — a pearl's characteristic gloss over the luster beneath."
            onChange={(v) => edit({ clearcoat: v })}
          />
          <NumberField
            label="Environment Intensity"
            value={patch.envMapIntensity ?? gemChosen?.envMapIntensity ?? 1.6}
            min={0}
            max={5}
            step={0.05}
            precision={2}
            hint="Multiplies how strongly the room shows in the surface. Brighter is not automatically better past what the lustre itself can sell."
            onChange={(v) => edit({ envMapIntensity: v })}
          />
        </>
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

      {/*
        Gemstone Colors — a fast recolour that does not require first picking
        a catalogue gem, and does not touch that gem's IOR/dispersion/
        absorption/reflectivity/environment when one IS picked. Separate
        storage (`stoneColors`) from the catalogue pick on purpose: preset and
        colour are two different decisions here, the same way i3D keeps them
        as two different controls rather than one replacing the other.
      */}
      {tab === "gems" && has && onStoneColor && (
        <div className="mat-group">
          <p className="mat-group-head">Gemstone Colors</p>
          <div className="swatch-grid" role="radiogroup" aria-label="Gemstone quick colours">
            {GEM_QUICK_COLORS.map((c) => {
              const on = commonStoneColor === c.hex;
              return (
                <button
                  key={c.hex}
                  role="radio"
                  aria-checked={on}
                  aria-label={c.label}
                  className="swatch-cell"
                  onClick={() => chooseStoneColor(c.hex)}
                >
                  <span className={`swatch ${on ? "swatch-active" : ""}`}>
                    <span className="swatch-dot" style={{ background: c.hex }} />
                  </span>
                  <span className="swatch-label">{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

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
              {/* Smoothness (roughness) lives above, always visible — it did
                  not belong hidden behind this toggle. */}
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
              {/* Meaningless once the stone is not being traced — see
                  `isOpaqueGem`. */}
              {!isOpaqueGem && (
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
              )}
              {!isOpaqueGem && (
                <>
                  <NumberField
                    label="Absorption Factor"
                    value={patch.absorptionFactor ?? 1}
                    min={0.1}
                    max={10}
                    step={0.1}
                    precision={2}
                    hint="How much darker/more saturated the stone gets with distance through it. 1 is the geometry's own real path length; above it shortens that path so colour builds up sooner."
                    onChange={(v) => edit({ absorptionFactor: v })}
                  />
                  <NumberField
                    label="Reflectivity"
                    value={patch.reflectivity ?? DEFAULT_DIAMOND_OPTICS.fresnelScale}
                    min={0}
                    max={1}
                    step={0.05}
                    precision={2}
                    hint="Overrides Diamond Optics' Fresnel scale for this one stone only. Leave alone to keep following whatever Diamond Optics is set to."
                    onChange={(v) => edit({ reflectivity: v })}
                  />
                </>
              )}
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
              {isOpaqueGem && (
                <NumberField
                  label="Reflectivity"
                  value={patch.reflectivity ?? gemChosen?.reflectivity ?? 0.5}
                  min={0}
                  max={1}
                  step={0.01}
                  precision={2}
                  hint="The surface's own reflectance, independent of the Environment Intensity above. 0.5 is glass-like and is what an unedited pearl or onyx uses."
                  onChange={(v) => edit({ reflectivity: v })}
                />
              )}
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
