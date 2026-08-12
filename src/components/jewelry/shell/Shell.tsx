import { FolderOpen, RotateCcw, Save, Upload, X } from "lucide-react";
import { SECTIONS, sectionById } from "./sections";

/*
 * The application frame.
 *
 * Three pieces, deliberately dumb: a top bar, a vertical icon rail, and a panel
 * that shows whichever section the rail has selected. None of them know what a
 * section contains — they take children — so a later phase can rewrite a panel
 * body without touching the frame.
 *
 * On a narrow screen the rail becomes a horizontal strip and the panel becomes
 * a sheet. Sixty per cent of this product's traffic is phones, and the
 * competitor's layout is desktop-only; matching it on desktop must not cost the
 * majority of our users their app.
 */

export function TopBar({
  onReset,
  onSave,
  onOpen,
  onUpload,
  canUpload,
  saving,
}: {
  onReset: () => void;
  onSave?: () => void;
  onOpen?: () => void;
  onUpload?: () => void;
  canUpload: boolean;
  saving?: boolean;
}) {
  return (
    <header className="topbar">
      <span className="brand">
        RenderGod<span className="brand-mark">✦</span>
      </span>

      <div className="topbar-actions">
        <button className="tb-btn" onClick={onReset} title="Back to the default view">
          <RotateCcw className="size-3.5" />
          <span className="tb-label">Reset Scene</span>
        </button>

        <button
          className="tb-btn"
          onClick={onSave}
          disabled={!onSave}
          title="Download this whole setup as a file"
        >
          <Save className="size-3.5" />
          <span className="tb-label">{saving ? "Saving…" : "Save Project"}</span>
        </button>

        {/*
         * Loading sits beside saving rather than in a panel: a project is
         * opened before anything else is touched, so burying it three sections
         * deep would mean navigating past the settings it is about to replace.
         */}
        {onOpen && (
          <button className="tb-btn" onClick={onOpen} title="Open a saved project">
            <FolderOpen className="size-3.5" />
            <span className="tb-label">Open</span>
          </button>
        )}

        {canUpload && (
          <button className="tb-btn tb-btn-primary" onClick={onUpload} title="Load a model">
            <Upload className="size-3.5" />
            <span className="tb-label">Upload</span>
          </button>
        )}
      </div>
    </header>
  );
}

export function IconRail({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  return (
    <nav className="rail" aria-label="Studio sections">
      {SECTIONS.map((s) => {
        const Icon = s.icon;
        return (
          <button
            key={s.id}
            className={`rail-btn ${active === s.id ? "rail-btn-on" : ""}`}
            onClick={() => onSelect(s.id)}
            title={`${s.title} — ${s.hint}`}
            aria-label={s.title}
            aria-current={active === s.id}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </nav>
  );
}

export function SectionPanel({
  active,
  open,
  onClose,
  children,
}: {
  active: string;
  /** Whether the sheet is showing. Ignored once the panel is docked. */
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  /*
   * Always mounted; CSS decides whether it is docked beside the viewport or a
   * dismissible sheet over it. Gating the mount on a JS-measured breakpoint
   * costs a frame on every load and shows the desktop app briefly panel-less.
   */
  return (
    <aside className={`panel ${open ? "panel-open" : ""}`} aria-label={sectionById(active).title}>
      <div className="panel-head">
        <h2 className="panel-title">{sectionById(active).title}</h2>
        <button className="sheet-close lg:hidden" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <div className="panel-body">{children}</div>
    </aside>
  );
}
