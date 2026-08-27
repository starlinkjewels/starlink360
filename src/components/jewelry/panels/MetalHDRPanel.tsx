/*
 * Metal HDR & Material Selection.
 *
 * A gallery of combined (alloy, finish) presets — see `metalPresets.ts` for
 * why this is a thin layer over the existing Metals and Textures systems
 * rather than a third material system. Clicking a thumbnail here writes into
 * the exact same `assignments`/`textures` maps those two panels already own;
 * this panel holds no material state of its own.
 */
import { useEffect, useMemo, useState } from "react";
import { METAL_PRESETS, resolveMetalPreset, type MetalPreset } from "../metalPresets";
import { previewUrl } from "../preview";
import {
  applyMaterial,
  clearMaterial,
  expandLinked,
  targetIds,
  targetsEverything,
  type Assignments,
} from "../assign";
import type { Textures } from "./TexturesPanel";
import { DEFAULT_TEXTURE } from "../textures";
import type { Part } from "../selection";
import { PanelGroup, PanelReset } from "../ui/Panel";

/** The swatch image. A local `mounted` gate for the same reason
 *  `MaterialsPanel`'s `Preview` has one — see there for the hydration note. */
function PresetThumb({ preset, size }: { preset: MetalPreset; size: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const resolved = resolveMetalPreset(preset);
  const url = useMemo(
    () =>
      !mounted || !resolved
        ? ""
        : previewUrl(
            {
              kind: "metal",
              color: resolved.metal.color,
              roughness: resolved.metal.roughness,
              metalness: resolved.metal.metalness,
              finish: resolved.finish.id,
            },
            size,
          ),
    [mounted, resolved, size],
  );
  return url ? (
    <img src={url} alt="" width={size} height={size} className="mat-orb" draggable={false} />
  ) : (
    <span
      className="mat-orb"
      style={{ width: size, height: size, background: resolved?.metal.color ?? "#888" }}
    />
  );
}

export function MetalHDRPanel({
  parts,
  selected,
  assignments,
  onAssignments,
  textures,
  onTextures,
  fallbackMetal,
  fallbackFinish,
  onWholePiecePreset,
  linkNames = false,
}: {
  parts: Part[];
  selected: ReadonlySet<string>;
  assignments: Assignments;
  onAssignments: (next: Assignments) => void;
  textures: Textures;
  onTextures: (next: Textures) => void;
  fallbackMetal?: string;
  fallbackFinish?: string;
  /**
   * Sets the whole-piece metal AND finish in one call. Deliberately not two
   * separate `onFallbackMetal`/`onFallbackFinish` callbacks called back to
   * back: both of those, in StudioPanel, build their next value from the
   * same `finish` prop — calling them in sequence in one handler means the
   * second call still reads the pre-update `finish`, so it silently
   * overwrites the first call's metal change. One atomic setter avoids that
   * stale-closure trap entirely.
   */
  onWholePiecePreset?: (metalId: string, finishId: string) => void;
  linkNames?: boolean;
}) {
  const ofKind = parts.filter((p) => p.kind === "metal");
  const has = ofKind.length > 0;
  const whole = targetsEverything(parts, selected, "metal");

  /*
   * Which preset — if any — the current selection exactly matches, so the
   * gallery can show what's active rather than always looking unselected.
   * Only lit when every target agrees on both halves, the same rule
   * `commonMaterial` uses for the plain alloy grid.
   */
  const activePreset = useMemo(() => {
    const ids = expandLinked(parts, targetIds(parts, selected, "metal"), linkNames);
    if (!ids.length) return null;
    const metalOf = (id: string) =>
      assignments[id]?.material ?? (whole ? fallbackMetal : undefined);
    const finishOf = (id: string) => textures[id]?.finish ?? (whole ? fallbackFinish : "none");
    const firstMetal = metalOf(ids[0]);
    const firstFinish = finishOf(ids[0]) ?? "none";
    if (!ids.every((id) => metalOf(id) === firstMetal && (finishOf(id) ?? "none") === firstFinish))
      return null;
    return (
      METAL_PRESETS.find((p) => p.metalId === firstMetal && p.finishId === firstFinish) ?? null
    );
  }, [parts, selected, linkNames, assignments, textures, whole, fallbackMetal, fallbackFinish]);

  const choose = (preset: MetalPreset) => {
    const resolved = resolveMetalPreset(preset);
    if (!resolved) return;

    if (whole && onWholePiecePreset) {
      onWholePiecePreset(preset.metalId, preset.finishId);
      // Whole-piece choices clear any per-part overrides, the same rule
      // Metals and Textures each already follow for their own swatches.
      onAssignments(clearMaterial(assignments, parts, selected, "metal", linkNames));
      const clearedTextures = { ...textures };
      for (const id of expandLinked(parts, targetIds(parts, selected, "metal"), linkNames)) {
        delete clearedTextures[id];
      }
      onTextures(clearedTextures);
      return;
    }

    onAssignments(applyMaterial(assignments, parts, selected, "metal", preset.metalId, linkNames));

    const ids = expandLinked(parts, targetIds(parts, selected, "metal"), linkNames);
    const nextTextures = { ...textures };
    for (const id of ids) {
      nextTextures[id] = { ...(nextTextures[id] ?? DEFAULT_TEXTURE), finish: preset.finishId };
    }
    onTextures(nextTextures);
  };

  const reset = () => {
    onAssignments(clearMaterial(assignments, parts, selected, "metal", linkNames));
    const next = { ...textures };
    for (const id of expandLinked(parts, targetIds(parts, selected, "metal"), linkNames)) {
      delete next[id];
    }
    onTextures(next);
  };

  return (
    <PanelGroup
      title="Metal HDR & Material Selection"
      hint="A combined look — alloy and finish together in one click. Picking one sets both; the grids below still work independently afterward."
    >
      {!has && (
        <p className="field-hint mb-2">Nothing here to change yet — this piece has no metal.</p>
      )}
      <div className="mat-grid" role="radiogroup" aria-label="Metal HDR presets">
        {METAL_PRESETS.map((preset) => {
          const on = activePreset?.id === preset.id;
          return (
            <button
              key={preset.id}
              role="radio"
              aria-checked={on}
              aria-label={preset.name}
              title={preset.name}
              className="mat-cell"
              onClick={() => choose(preset)}
            >
              <span className={`mat-orb-ring ${on ? "mat-orb-on" : ""}`}>
                <PresetThumb preset={preset} size={44} />
              </span>
              <span className="mat-name">{preset.name}</span>
            </button>
          );
        })}
      </div>
      {/*
        Always enabled whenever there is metal to reset, the same rule the
        alloy grid's own reset uses below — resetting when nothing has
        actually changed is harmless, and matching a preset exactly is a
        fragile thing to gate a button's usability on (a hand-tuned Custom
        edit, for instance, is real state but matches no preset at all).
      */}
      <PanelReset onReset={reset} disabled={!has} label="Back to the file's own metal" />
    </PanelGroup>
  );
}
