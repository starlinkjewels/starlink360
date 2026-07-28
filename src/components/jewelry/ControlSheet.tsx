import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { finishes, type Finish } from "@/data/finishes";
import { MetalSwatches } from "./MetalSwatches";
import { Toolbar } from "./Toolbar";

export interface ControlSheetProps {
  open: boolean;
  onClose: () => void;
  finish: Finish;
  onSelectFinish: (f: Finish) => void;
  autoRotate: boolean;
  onToggleRotate: () => void;
  onReset: () => void;
}

/**
 * Bottom sheet on phones, floating card from `sm` up. Everything that used to
 * sit permanently over the canvas lives in here, so the piece gets the whole
 * screen until the user asks for controls.
 */
export function ControlSheet({
  open,
  onClose,
  finish,
  onSelectFinish,
  autoRotate,
  onToggleRotate,
  onReset,
}: ControlSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape to dismiss, and move focus into the sheet so keyboard and screen
  // reader users aren't left behind on the trigger.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Finish and view controls"
      >
        <div className="sheet-grabber" aria-hidden="true" />

        <div className="sheet-head">
          <h2 className="sheet-title">Finish</h2>
          <button
            ref={closeRef}
            className="sheet-close"
            onClick={onClose}
            aria-label="Close controls"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <MetalSwatches active={finish} onSelect={onSelectFinish} showLabels />

        <div className="sheet-divider" />

        <h2 className="sheet-title">View</h2>
        <Toolbar
          autoRotate={autoRotate}
          onToggleRotate={onToggleRotate}
          onReset={onReset}
          stacked
        />

        <p className="sheet-hint">
          <span className="hint-touch">
            Tap the pendant to focus it · Drag to rotate · Pinch to zoom
          </span>
          <span className="hint-pointer">
            Click a detail to focus it · Drag to rotate · Scroll to zoom
          </span>
        </p>
      </div>
    </>
  );
}

/** Pill that opens the sheet, previewing the active finish so state is visible while closed. */
export function ControlTrigger({ finish, onClick }: { finish: Finish; onClick: () => void }) {
  const index = finishes.findIndex((f) => f.id === finish.id) + 1;
  return (
    <button
      className="control-trigger"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={`Open controls — current finish ${finish.name}, ${index} of ${finishes.length}`}
    >
      <span
        className="swatch-dot swatch-dot-sm"
        style={{ background: finish.color }}
        aria-hidden="true"
      />
      <span className="control-trigger-label">{finish.name}</span>
      <svg
        className="size-3 opacity-60"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <polyline points="18 15 12 9 6 15" />
      </svg>
    </button>
  );
}
