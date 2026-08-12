/*
 * The grammar every panel is written in.
 *
 * Eleven phases produced eleven panels, each inventing its own layout: some
 * opened with a sentence and some did not, groups were headed by a bare
 * `field-label` in one and a paragraph in another, and the reset was at the top
 * here and the bottom there. Individually all defensible; together it reads as
 * eleven different products, and someone learning one panel learns nothing
 * about the next.
 *
 * So there are four pieces and an order:
 *
 *   PanelIntro   one sentence on what this section decides
 *   PanelStatus  what a change will apply to, when that is not obvious
 *   PanelGroup   a headed run of controls
 *   PanelReset   last, always, so it is never mistaken for a control
 *
 * None of them are clever. The value is entirely in every panel using the same
 * four.
 */
import { RotateCcw } from "lucide-react";

/** One sentence, at the top. What this section decides, not how to use it. */
export function PanelIntro({ children }: { children: React.ReactNode }) {
  return <p className="panel-intro">{children}</p>;
}

/**
 * A headed run of controls.
 *
 * `hint` sits under the heading rather than beside it: a caption that wraps to
 * a second line beside a heading pushes the first control down unevenly, which
 * is most of why a panel looks untidy at a narrow width.
 */
export function PanelGroup({
  title,
  hint,
  children,
}: {
  title?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel-group">
      {title && <h3 className="panel-group-title">{title}</h3>}
      {hint && <p className="field-hint panel-group-hint">{hint}</p>}
      {children}
    </section>
  );
}

/**
 * What a change is about to affect.
 *
 * Sticky, because it is exactly what you forget while scrolling a long grid —
 * and a panel that silently changes scope is worse than one that asks.
 */
export function PanelStatus({
  children,
  narrowed,
  actions,
}: {
  children: React.ReactNode;
  /** Marks the surprising state: acting on a selection rather than everything. */
  narrowed?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mat-scope">
      <span className={`mat-scope-text ${narrowed ? "mat-scope-narrow" : ""}`}>{children}</span>
      {actions && <span className="mat-scope-actions">{actions}</span>}
    </div>
  );
}

/** Last in every panel, so its position alone says what it is. */
export function PanelReset({
  onReset,
  disabled,
  label = "Reset",
}: {
  onReset: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button className="chip panel-reset" onClick={onReset} disabled={disabled}>
      <RotateCcw className="size-3" />
      {label}
    </button>
  );
}
