/*
 * The control idiom that makes a panel read as a tool.
 *
 * A slider showing "50" tells you nothing about what 50 means. `Samples
 * (1 - 100)` with a typeable box tells you the scale, the current value, and
 * that you may set it exactly — which is what separates a piece of software
 * from a toy, and is most of why the competitor's panels look professional.
 *
 * The box is the primary control and the slider is optional. Typing is allowed
 * mid-edit even when the text is not yet a valid number, because forcing a
 * clamp on every keystroke makes it impossible to type "0.05" — the "0." stage
 * would snap to the minimum. The value is only committed on blur or Enter.
 */
import { useEffect, useState } from "react";

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  precision = 0,
  slider = true,
  suffix,
  hint,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Decimal places shown in the box. */
  precision?: number;
  slider?: boolean;
  suffix?: string;
  hint?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(() => value.toFixed(precision));

  // Follow the value when something else changes it — a preset, a reset —
  // but never while the field is being typed into.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(value.toFixed(precision));
  }, [value, precision, editing]);

  const commit = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setText(value.toFixed(precision));
      return;
    }
    const clamped = Math.min(max, Math.max(min, n));
    setText(clamped.toFixed(precision));
    if (clamped !== value) onChange(clamped);
  };

  /*
   * The range is only spelled out when the field is full width.
   *
   * "X (-40 - 40)" in a three-column row wraps onto three lines and shoves the
   * last column off the edge — which is exactly what it was doing to the light
   * position row. In a compact field the range lives in the tooltip and in the
   * input's own min/max instead, where it is still available and costs no
   * layout. `slider` is the right signal for this because a field with a slider
   * is always full width; one without is always in a grid.
   */
  const compact = !slider;

  return (
    <div className={`nf ${compact ? "nf-compact" : ""}`}>
      <div className="nf-head">
        <span className="nf-label" title={`${label} (${min} to ${max})`}>
          {label}
          {!compact && (
            <>
              {" "}
              <span className="nf-range">
                ({min} - {max})
              </span>
            </>
          )}
        </span>
        <span className="nf-box">
          <input
            type="text"
            inputMode="decimal"
            value={text}
            disabled={disabled}
            onFocus={() => setEditing(true)}
            onChange={(e) => setText(e.target.value)}
            onBlur={(e) => {
              setEditing(false);
              commit(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setText(value.toFixed(precision));
                (e.target as HTMLInputElement).blur();
              }
            }}
            aria-label={`${label}, ${min} to ${max}`}
            // Native validation as a second line of defence, and it is what a
            // screen reader announces for the bounds.
            min={min}
            max={max}
          />
          {suffix && <span className="nf-suffix">{suffix}</span>}
        </span>
      </div>

      {slider && (
        <input
          className="nf-slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`${label} slider`}
        />
      )}

      {hint && <span className="nf-hint">{hint}</span>}
    </div>
  );
}
