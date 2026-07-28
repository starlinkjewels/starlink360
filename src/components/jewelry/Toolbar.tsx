import { RotateCcw, Play, Pause } from "lucide-react";

export function Toolbar({
  autoRotate,
  onToggleRotate,
  onReset,
  stacked = false,
}: {
  autoRotate: boolean;
  onToggleRotate: () => void;
  onReset: () => void;
  /** Equal-width rows with touch-sized targets — used inside the sheet. */
  stacked?: boolean;
}) {
  const cls = stacked ? "dock-btn dock-btn-lg" : "dock-btn";
  return (
    <div className={stacked ? "grid grid-cols-2 gap-2" : "flex items-center justify-center gap-2"}>
      <button className={cls} onClick={onToggleRotate} aria-pressed={autoRotate}>
        {autoRotate ? (
          <Pause className="size-3.5" aria-hidden="true" />
        ) : (
          <Play className="size-3.5" aria-hidden="true" />
        )}
        Turntable
      </button>
      <button className={cls} onClick={onReset}>
        <RotateCcw className="size-3.5" aria-hidden="true" />
        Reset view
      </button>
    </div>
  );
}
