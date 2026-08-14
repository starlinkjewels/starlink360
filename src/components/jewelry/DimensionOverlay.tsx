/*
 * The width/height/depth callouts drawn over the piece itself, and the report
 * card that summarises them.
 *
 * Real 3D line segments rather than a hand-rolled 2D projection: a line drawn
 * at the bounding box's own edge tracks the camera for free as the piece
 * turns, which a screen-space overlay would have to recompute every frame to
 * fake. `Html` anchors the millimetre labels to those same world points and
 * only has to worry about facing the camera, not where the number belongs.
 */
import { Line, Html } from "@react-three/drei";
import type { Fit } from "./Model";
import type { GemSummary } from "./dimensions";

interface AxisCalloutProps {
  /** Where the line is actually drawn — may be stretched for legibility, see `depthDrawHalf`. */
  from: [number, number, number];
  to: [number, number, number];
  /** Direction of the little end-ticks, perpendicular to the line itself. */
  tick: [number, number, number];
  /** What the line reads as, independent of how long it was drawn. */
  label: string;
}

const TICK_LENGTH = 1;

function AxisCallout({ from, to, tick, label }: AxisCalloutProps) {
  const [tx, ty, tz] = tick;
  const tickAt = (p: [number, number, number]): [number, number, number][] => [
    [p[0] - tx, p[1] - ty, p[2] - tz],
    [p[0] + tx, p[1] + ty, p[2] + tz],
  ];
  const mid: [number, number, number] = [
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2,
    (from[2] + to[2]) / 2,
  ];

  return (
    <group>
      <Line points={[from, to]} color="#d9b26a" lineWidth={1.25} />
      <Line points={tickAt(from)} color="#d9b26a" lineWidth={1.25} />
      <Line points={tickAt(to)} color="#d9b26a" lineWidth={1.25} />
      {/*
        No `distanceFactor`: it scales the label with the *camera's* distance
        from it, which on a piece normalised to a unit sphere sized the label
        several times larger than the whole necklace. Plain screen-space
        pixels, the same size whether the shot is a ring or a chain, is what
        an actual measurement callout wants anyway.
      */}
      <Html position={mid} center zIndexRange={[10, 0]}>
        <span className="dim-callout">{label}</span>
      </Html>
    </group>
  );
}

/** One row of the floating report card. */
function ReportRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="dim-report-row">
      <span className="dim-report-label">{label}</span>
      <span className="dim-report-value">{value}</span>
    </div>
  );
}

export function DimensionOverlay({
  fit,
  scale,
  summary,
}: {
  fit: Fit;
  /** Millimetres per model unit, or null to show a bare relative multiple. */
  scale: number | null;
  summary: GemSummary;
}) {
  const hx = fit.width / 2;
  const hy = fit.height / 2;
  const hz = fit.depth / 2;
  // Floats the callouts clear of the piece rather than skimming its surface.
  // Kept small: the default framing leaves only a little margin around the
  // piece, and a wider gap pushes the label straight past the edge of frame.
  const gap = Math.max(fit.radius * 0.08, 1e-3);
  const tick = Math.min(TICK_LENGTH, fit.radius * 0.05);
  /*
   * A pendant is often nearly flat, and a depth line drawn to its true length
   * can be a few percent of the piece's own radius — visually indistinguishable
   * from a dot, which is what "the third dimension isn't showing" actually
   * was. The LINE is stretched to a minimum length so there is always
   * something to see; the LABEL still reads the real, unstretched depth.
   */
  const depthDrawHalf = Math.max(hz, fit.radius * 0.12);

  const unit = scale ? "mm" : "×";
  const show = (units: number) =>
    scale ? `${(units * scale).toFixed(2)} mm` : `${units.toFixed(2)} ×`;

  return (
    <group>
      {/* Width — along X, floating below and in front of the piece. */}
      <AxisCallout
        from={[-hx, -hy - gap, hz + gap]}
        to={[hx, -hy - gap, hz + gap]}
        tick={[0, tick, 0]}
        label={show(fit.width)}
      />
      {/* Height — along Y, floating to the right and in front. */}
      <AxisCallout
        from={[hx + gap, -hy, hz + gap]}
        to={[hx + gap, hy, hz + gap]}
        tick={[0, 0, tick]}
        label={show(fit.height)}
      />
      {/*
        Depth — along Z, floating below and to the LEFT rather than sharing
        the width line's own corner. Sharing a corner was the other half of
        "looks 2D": two callouts meeting at one point read as one L-shaped
        line, not as two independent extents.
      */}
      <AxisCallout
        from={[-hx - gap, -hy - gap, -depthDrawHalf]}
        to={[-hx - gap, -hy - gap, depthDrawHalf]}
        tick={[tick, 0, 0]}
        label={show(fit.depth)}
      />

      {/* The report card, off to the side rather than over the piece. */}
      <Html position={[hx + gap * 3.5, hy * 0.4, 0]} center zIndexRange={[10, 0]}>
        <div className="dim-report">
          <p className="dim-report-title">Model Report</p>
          <ReportRow label="Width" value={show(fit.width)} />
          <ReportRow label="Height" value={show(fit.height)} />
          <ReportRow label="Depth" value={show(fit.depth)} />
          <div className="dim-report-rule" />
          <ReportRow label="Total gems" value={String(summary.totalCount)} />
          <ReportRow
            label="Total carat wt"
            value={scale ? `${summary.totalCaratWt.toFixed(3)} ct` : `— (${unit} uncalibrated)`}
          />
        </div>
      </Html>
    </group>
  );
}
