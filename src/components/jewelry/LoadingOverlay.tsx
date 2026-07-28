export function LoadingOverlay({
  label = "Setting the stones",
  percent,
  detail,
}: {
  label?: string;
  percent?: number | null;
  /** Secondary line — file name, size, elapsed time. */
  detail?: string | null;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-6">
      {/* Brand mark */}
      <div className="loader-brand">
        <span className="loader-star">✦</span>
      </div>

      <div className="flex flex-col items-center gap-3">
        <p className="font-serif text-sm tracking-[0.32em] uppercase text-accent">{label}</p>

        {/* Progress bar */}
        <div className="loader-bar-track">
          <div
            className="loader-bar-fill"
            style={{
              width: percent != null ? `${percent}%` : "0%",
              // Linear, not eased: the value already advances every frame, and
              // an ease-out on top of that reads as repeated stalling.
              transition: percent != null ? "width 0.25s linear" : "none",
              animation:
                percent == null ? "loader-indeterminate 1.6s ease-in-out infinite" : "none",
            }}
          />
        </div>

        {detail && <p className="loader-detail">{detail}</p>}
      </div>
    </div>
  );
}
