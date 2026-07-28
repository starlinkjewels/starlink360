import { finishes, type Finish } from "@/data/finishes";

export function MetalSwatches({
  active,
  onSelect,
  showLabels = false,
}: {
  active: Finish;
  onSelect: (f: Finish) => void;
  /** Name each finish beneath its dot — used inside the control sheet. */
  showLabels?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Metal finish"
      className={showLabels ? "swatch-grid" : "flex items-center justify-center gap-2 sm:gap-3"}
    >
      {finishes.map((f) => {
        const isActive = f.id === active.id;
        return (
          <button
            key={f.id}
            role="radio"
            aria-checked={isActive}
            aria-label={f.name}
            title={f.name}
            onClick={() => onSelect(f)}
            className={showLabels ? "swatch-cell" : "swatch-hit"}
          >
            <span className={`swatch ${isActive ? "swatch-active" : ""}`}>
              <span className="swatch-dot" style={{ background: f.color }} />
            </span>
            {showLabels && <span className="swatch-label">{f.name}</span>}
          </button>
        );
      })}
    </div>
  );
}
