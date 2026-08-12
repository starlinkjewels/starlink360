import { Contrast, Grid3x3, Lock, Maximize2, Unlock, RotateCcw, X } from "lucide-react";
import { TOOLS, type ToolMode } from "./tools";

/*
 * The furniture that sits on the viewport.
 *
 * Half of these tools need an object to act on, and object selection is the
 * next phase. Rather than hide them — which would leave the toolbar changing
 * shape later — they render disabled with the reason in the tooltip. A control
 * that says why it is unavailable is honest; one that silently does nothing is
 * a bug report.
 */

export interface CanvasToolsState {
  mode: ToolMode;
  grid: boolean;
  locked: boolean;
}

export function CanvasToolbar({
  state,
  onMode,
  onGrid,
  onLock,
  onContrast,
}: {
  state: CanvasToolsState;
  onMode: (m: ToolMode) => void;
  onGrid: () => void;
  onLock: () => void;
  onContrast: () => void;
}) {
  return (
    <div className="ctools" role="toolbar" aria-label="Viewport tools">
      {TOOLS.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            /*
             * A blocked tool is optional furniture on a phone: it cannot be
             * used, and eight buttons plus the gizmo and the viewport actions
             * do not fit across 360px without overlapping.
             */
            className={`ctool ${t.blocked ? "ctool-optional" : ""} ${
              state.mode === t.id ? "ctool-on" : ""
            }`}
            onClick={() => onMode(t.id)}
            disabled={!!t.blocked}
            title={t.blocked ? `${t.label} — ${t.blocked}` : `${t.label} — ${t.hint}`}
            aria-label={t.label}
            aria-pressed={state.mode === t.id}
          >
            <Icon className="size-4" />
          </button>
        );
      })}

      <span className="ctool-sep" aria-hidden="true" />

      <button
        className={`ctool ${state.grid ? "ctool-on" : ""}`}
        onClick={onGrid}
        title="Show a ground grid"
        aria-label="Grid"
        aria-pressed={state.grid}
      >
        <Grid3x3 className="size-4" />
      </button>

      <button
        className={`ctool ${state.locked ? "ctool-on" : ""}`}
        onClick={onLock}
        title={state.locked ? "Camera locked — click to unlock" : "Lock the camera in place"}
        aria-label="Lock camera"
        aria-pressed={state.locked}
      >
        {state.locked ? <Lock className="size-4" /> : <Unlock className="size-4" />}
      </button>

      <button
        className="ctool"
        onClick={onContrast}
        title="Switch light and dark"
        aria-label="Contrast"
      >
        <Contrast className="size-4" />
      </button>
    </div>
  );
}

export function ViewportActions({
  onResetView,
  viewportRef,
}: {
  onResetView: () => void;
  viewportRef: React.RefObject<HTMLElement | null>;
}) {
  const toggleFullscreen = () => {
    const el = viewportRef.current;
    if (!el) return;
    // Fullscreen can be refused — an iframe without `allow="fullscreen"`, or a
    // browser that requires a more direct gesture. Failing quietly is right
    // here; there is nothing useful to tell someone who clicked a button.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="vactions">
      <button
        className="vaction"
        onClick={onResetView}
        title="Back to the fitted view"
        aria-label="Reset view"
      >
        <RotateCcw className="size-4" />
      </button>
      <button
        className="vaction"
        onClick={toggleFullscreen}
        title="Fullscreen"
        aria-label="Fullscreen"
      >
        <Maximize2 className="size-4" />
      </button>
    </div>
  );
}

/**
 * What is currently selected, and how to change it.
 *
 * Shown whenever something is selected, and on hover of the select tool — a
 * permanent panel of keyboard hints is noise once you know them.
 */
export function SelectionHud({
  count,
  label,
  onClear,
}: {
  count: number;
  label?: string;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="shud" role="status">
      <div className="shud-head">
        <span className="shud-count">
          Selected: {count} {count === 1 ? "set" : "sets"}
          {label ? ` · ${label}` : ""}
        </span>
        <button className="shud-x" onClick={onClear} aria-label="Clear selection">
          <X className="size-3" />
        </button>
      </div>
      <p className="shud-help">Click a stone to select · ESC to clear</p>
    </div>
  );
}
