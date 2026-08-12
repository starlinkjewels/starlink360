/*
 * Which way up did this file mean?
 *
 * Rhino and most CAD exports are Z-up; three.js is Y-up. A Z-up piece therefore
 * arrives lying on its side, and that reads as a broken import rather than a
 * convention mismatch — people conclude the viewer cannot open their file.
 *
 * The setting existed, buried in the Camera panel, which is no use to someone
 * who has just watched their ring load sideways and does not know the word
 * "up-axis". So it is asked at the moment it matters, with a picture, and the
 * guess from the file extension pre-selected.
 */
import { X } from "lucide-react";
import { UP_AXES, type CameraSettings } from "./camera";

type Axis = CameraSettings["upAxis"];

/**
 * A ring, drawn as it will stand under each axis.
 *
 * Deliberately a diagram rather than a render: a real preview would need a
 * second WebGL context per option, and the thing being previewed is the
 * ORIENTATION, which a silhouette says more plainly than a shaded model.
 */
function Orientation({ axis, on }: { axis: Axis; on: boolean }) {
  // Upright, tipped back, tipped sideways — matching upAxisRotation exactly.
  const transform =
    axis === "y" ? "" : axis === "z" ? "rotate(90 32 32) scale(1 0.42)" : "rotate(90 32 32)";
  const stroke = on ? "var(--gold)" : "var(--color-muted-foreground)";

  return (
    <svg viewBox="0 0 64 64" width={64} height={64} aria-hidden="true" className="orient-svg">
      {/* The ground, so "lying down" is legible as lying on something. */}
      <line x1="6" y1="56" x2="58" y2="56" stroke="var(--color-border)" strokeWidth="1.5" />
      <g transform={transform} style={{ transformOrigin: "32px 32px" }}>
        {/* Band */}
        <ellipse cx="32" cy="36" rx="15" ry="17" fill="none" stroke={stroke} strokeWidth="3.5" />
        {/* Stone, so which end is the top is unambiguous. */}
        <path d="M32 10 l6 6 -6 6 -6 -6 z" fill={stroke} />
      </g>
    </svg>
  );
}

export function ImportOrientation({
  fileName,
  value,
  onChange,
  onClose,
}: {
  fileName: string;
  value: Axis;
  onChange: (axis: Axis) => void;
  onClose: () => void;
}) {
  return (
    <div className="orient-backdrop" role="dialog" aria-modal="true" aria-label="Model orientation">
      <div className="orient-card">
        <div className="orient-head">
          <div>
            <p className="orient-title">Which way is up?</p>
            <p className="field-hint">{fileName}</p>
          </div>
          <button className="icon-toggle" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <p className="field-hint">
          Rhino and most CAD exports treat Z as up; the viewer uses Y. If the piece is lying on its
          side, that is why. Pick the one that looks right — it changes on the stage as you choose.
        </p>

        <div className="orient-grid" role="radiogroup" aria-label="Up axis">
          {UP_AXES.map((a) => {
            const on = a.value === value;
            return (
              <button
                key={a.value}
                role="radio"
                aria-checked={on}
                className={`orient-cell ${on ? "orient-cell-on" : ""}`}
                onClick={() => onChange(a.value)}
                title={a.hint}
              >
                <Orientation axis={a.value} on={on} />
                <span className="mat-name">{a.label}</span>
                <span className="orient-hint">{a.hint}</span>
              </button>
            );
          })}
        </div>

        <button className="dock-btn dock-btn-lg w-full mt-3" onClick={onClose}>
          Looks right
        </button>
        <p className="field-hint mt-2">
          It stays changeable in the Camera panel afterwards, so this is not a decision to get right
          now.
        </p>
      </div>
    </div>
  );
}
