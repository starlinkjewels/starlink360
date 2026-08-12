/*
 * The tab row Phase 1 deliberately did not build.
 *
 * It was left out then because nothing needed tabs and the shape would have
 * been a guess. Materials is the first real caller — Gems and Metals are two
 * catalogues over one selection — so the interface is designed against a use
 * rather than imagined.
 */

export interface TabDef<T extends string> {
  id: T;
  label: string;
  /** Shown as a count beside the label. Omit where a count means nothing. */
  badge?: number;
}

export function TabRow<T extends string>({
  tabs,
  active,
  onSelect,
  ariaLabel,
}: {
  tabs: TabDef<T>[];
  active: T;
  onSelect: (id: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="tab-row" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const on = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={on}
            className={`tab ${on ? "tab-on" : ""}`}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
            {tab.badge !== undefined && <span className="tab-badge">{tab.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
