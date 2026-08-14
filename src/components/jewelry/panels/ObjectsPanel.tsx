/*
 * The Objects panel — what is actually in the piece.
 *
 * Everything else in this studio asks you to find something by clicking it on
 * the render. That works for a solitaire and fails completely on the real work:
 * a client says "the prong on the left is too long" and you are hunting for one
 * object among 675 on a model too dense to orbit smoothly. Every professional
 * 3D tool answers this with an outliner, and this is ours.
 *
 * TWO TARGETS PER ROW, which is how every outliner resolves this.
 *
 * The two things people want are in direct conflict. Building "metal 1, 5 and
 * 8, plus stones 3, 6 and 9" needs clicks that ACCUMULATE. Pressing All and
 * then one object needs a click that REPLACES — that is the convention every
 * file manager has taught, and anything else feels stuck.
 *
 * Making the click mean one of them and a held modifier mean the other fails
 * both: on a phone there is no modifier, and most of this audience is on a
 * phone. So the row carries both. The BOX toggles that object in and out; the
 * NAME selects it alone. Neither needs a keyboard, and which is which is
 * visible rather than remembered.
 *
 * It invents nothing. `collectParts` already reports every part with its kind,
 * and the decoder already split the metal into its separate solids and the pave
 * into its individual stones. The structure exists; it has simply never been
 * shown. So this is a view, not a model — selection stays exactly the set of ids
 * it has always been, which is what lets a row here feed the material panels,
 * the stamp tool and `groups.ts` without any of them changing.
 */
import { Check, ChevronRight, FolderPlus, Layers, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { applyClick, solidCount, solidId, type Part, type PartKind } from "../selection";
import { PanelGroup, PanelIntro } from "../ui/Panel";
import { createGroup, kindOf, removeGroup, renameGroup, type PartGroup } from "../groups";

/**
 * How many individual objects a part lists before it stops.
 *
 * 675 rows is not a list anyone reads, and rendering them all makes opening a
 * group stutter on the machine least able to afford it. The cap is generous
 * enough that a real pave fits and is stated in the row that replaces the rest,
 * because a list that silently stops is worse than one that admits it.
 */
const VISIBLE_SOLIDS = 120;

const KINDS: { kind: PartKind; label: string; unit: string }[] = [
  { kind: "metal", label: "Metal", unit: "object" },
  { kind: "stone", label: "Stones", unit: "stone" },
];

export function ObjectsPanel({
  parts,
  selected,
  onSelect,
  groups = [],
  onGroups,
}: {
  parts: Part[];
  selected: ReadonlySet<string>;
  onSelect: (next: Set<string>) => void;
  /** Named sets the user has saved. */
  groups?: PartGroup[];
  onGroups?: (next: PartGroup[]) => void;
}) {
  /** Which parts are showing their individual objects. */
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  /** The name the next set will be saved under. */
  const [draftName, setDraftName] = useState("");

  const byKind = useMemo(
    () => KINDS.map((k) => ({ ...k, items: parts.filter((p) => p.kind === k.kind) })),
    [parts],
  );

  /*
   * Which kind the selection is, or null when it mixes. Computed from the
   * parts list rather than from the id, because a solid id carries no kind.
   */
  const kindById = useMemo(() => {
    const map = new Map(parts.map((p) => [p.id, p.kind]));
    return (id: string) => map.get(id.split("#solid")[0]);
  }, [parts]);
  const selectionKind = useMemo(() => kindOf(selected, kindById), [selected, kindById]);

  const toggleOpen = (id: string) => {
    const next = new Set(open);
    if (!next.delete(id)) next.add(id);
    setOpen(next);
  };

  /** Every id a part covers: the part itself, or each of its solids. */
  const idsOf = (part: Part): string[] => {
    const n = solidCount(part);
    if (n <= 1) return [part.id];
    return Array.from({ length: n }, (_, i) => solidId(part.id, i));
  };

  /*
   * Selecting a whole part means its GROUP id, not every solid id.
   *
   * Both would render identically, but the group id is one entry where the
   * expansion is hundreds — and the run planner merges a whole-part assignment
   * into a single draw call, which it cannot do for 675 separately named
   * solids that happen to agree.
   */
  const selectAll = (kind: PartKind) =>
    onSelect(new Set(parts.filter((p) => p.kind === kind).map((p) => p.id)));

  return (
    <>
      {/*
       * One line. The original explained both gestures in four, which is a
       * paragraph of instructions above a list that demonstrates them — read
       * once, then permanent clutter at the top of the panel.
       */}
      <PanelIntro>
        Tap a <strong>name</strong> to select it alone, or its <strong>box</strong> to add it.
      </PanelIntro>

      {parts.length === 0 && <p className="field-hint">Nothing loaded yet.</p>}

      {/*
       * Saved sets.
       *
       * A group SELECTS ITS MEMBERS rather than being a thing the renderers
       * understand. That is the whole trick: choosing one is identical to
       * having clicked those rows by hand, so every material panel, the stamp
       * tool and the export path keep working with no knowledge that groups
       * exist. Nothing downstream changed to support this.
       */}
      {onGroups && parts.length > 0 && (selected.size > 0 || groups.length > 0) && (
        <PanelGroup title="Saved sets">
          {/*
           * Named on the way in. A list of "Set 1, Set 2, Set 3" is a list
           * nobody can use an hour later, and asking for the name afterwards
           * means everyone skips it.
           */}
          {/*
           * Only while something is selected. A naming field and a full-width
           * button sitting above an empty list is the panel asking a question
           * nobody posed.
           */}
          {selected.size > 0 && (
            <div className="set-save">
              <input
                className="text-field"
                value={draftName}
                maxLength={40}
                placeholder="Centre cluster, Prongs, Bail…"
                aria-label="Name for this set"
                onChange={(e) => setDraftName(e.target.value)}
              />
              <button
                className="btn-ghost"
                disabled={selected.size === 0 || selectionKind === null}
                title={
                  selected.size === 0
                    ? "Select some objects first"
                    : selectionKind === null
                      ? "A set is metal or stones, not both — a material only applies to one"
                      : "Save the current selection as a named set"
                }
                onClick={() => {
                  if (!selectionKind) return;
                  onGroups(
                    createGroup(groups, `Set ${groups.length + 1}`, [...selected], selectionKind),
                  );
                }}
              >
                <FolderPlus className="size-3.5" />
                Save {selected.size}
              </button>
            </div>
          )}

          {/*
           * Refused rather than allowed, and said out loud. The metal renderer
           * ignores stone ids and the gem renderer ignores metal ones, so a
           * mixed set given a gold would apply to half of it with nothing on
           * screen to explain the rest.
           */}
          {selected.size > 0 && selectionKind === null && (
            <p className="field-hint">
              This selection mixes metal and stones. A set has to be one or the other.
            </p>
          )}

          {groups.length > 0 && (
            <ul className="obj-list">
              {groups.map((g) => (
                <li key={g.id} className="obj-row">
                  <button
                    className="obj-pick"
                    onClick={() => onSelect(new Set(g.memberIds))}
                    title={`Select the ${g.memberIds.length} objects in ${g.name}`}
                    aria-label={`Select ${g.name}`}
                  >
                    <Check className="size-3" />
                  </button>
                  {/*
                   * Renamed in place. A separate dialog for one short string is
                   * more ceremony than the thing is worth.
                   */}
                  <input
                    className="obj-rename"
                    value={g.name}
                    maxLength={40}
                    aria-label={`Rename ${g.name}`}
                    onChange={(e) => onGroups(renameGroup(groups, g.id, e.target.value))}
                  />
                  <span className="obj-count">{g.memberIds.length}</span>
                  <button
                    className="obj-del"
                    onClick={() => onGroups(removeGroup(groups, g.id))}
                    aria-label={`Delete ${g.name}`}
                    title="Delete"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PanelGroup>
      )}

      {byKind.map(({ kind, label, unit, items }) => {
        if (!items.length) return null;
        const total = items.reduce((n, p) => n + solidCount(p), 0);
        const allSelected = items.every((p) => selected.has(p.id));

        return (
          <div key={kind} className="obj-kind">
            <div className="obj-kind-head">
              <span className="obj-kind-name">
                <Layers className="size-3.5" />
                {label}
              </span>
              <span className="obj-kind-count">
                {total} {total === 1 ? unit : `${unit}s`}
              </span>
              {/*
               * "All" selects the parts rather than toggling every solid: the
               * common request is "make the whole thing rose gold", and that
               * should be one click whatever the piece is made of.
               */}
              <button
                className={`obj-all ${allSelected ? "obj-all-on" : ""}`}
                onClick={() => (allSelected ? onSelect(new Set()) : selectAll(kind))}
                aria-pressed={allSelected}
              >
                {allSelected ? "None" : "All"}
              </button>
            </div>

            <ul className="obj-list">
              {items.map((part) => {
                const n = solidCount(part);
                const expanded = open.has(part.id);
                const partSelected = selected.has(part.id);

                return (
                  <li key={part.id}>
                    <div className={`obj-row ${partSelected ? "obj-row-on" : ""}`}>
                      {/*
                       * The expander is its own control. Clicking a part's NAME
                       * must select it — that is the whole point of the list —
                       * so opening it cannot share the same target.
                       */}
                      {n > 1 ? (
                        <button
                          className={`obj-twist ${expanded ? "obj-twist-open" : ""}`}
                          onClick={() => toggleOpen(part.id)}
                          aria-expanded={expanded}
                          aria-label={expanded ? `Collapse ${part.label}` : `Expand ${part.label}`}
                        >
                          <ChevronRight className="size-3" />
                        </button>
                      ) : (
                        <span className="obj-twist obj-twist-none" />
                      )}

                      <button
                        className={`obj-box ${partSelected ? "obj-box-on" : ""}`}
                        onClick={() => onSelect(applyClick(selected, part.id, true))}
                        aria-pressed={partSelected}
                        aria-label={`${partSelected ? "Remove" : "Add"} ${part.label}`}
                        title={partSelected ? "Remove from selection" : "Add to selection"}
                      >
                        {partSelected && <Check className="size-3" />}
                      </button>
                      <button
                        className="obj-name"
                        onClick={() => onSelect(new Set([part.id]))}
                        title={`Select only ${part.label}`}
                      >
                        {part.label}
                      </button>
                      {n > 1 && <span className="obj-count">{n}</span>}
                    </div>

                    {expanded && n > 1 && (
                      <ul className="obj-sub">
                        {idsOf(part)
                          .slice(0, VISIBLE_SOLIDS)
                          .map((id, i) => (
                            <li key={id}>
                              <div className={`obj-row ${selected.has(id) ? "obj-row-on" : ""}`}>
                                <button
                                  className={`obj-box ${selected.has(id) ? "obj-box-on" : ""}`}
                                  onClick={() => onSelect(applyClick(selected, id, true))}
                                  aria-pressed={selected.has(id)}
                                  aria-label={`${selected.has(id) ? "Remove" : "Add"} object ${i + 1}`}
                                  title={
                                    selected.has(id) ? "Remove from selection" : "Add to selection"
                                  }
                                >
                                  {selected.has(id) && <Check className="size-3" />}
                                </button>
                                <button
                                  className="obj-name obj-sub-row"
                                  onClick={() => onSelect(new Set([id]))}
                                  title={`Select only ${part.label} ${i + 1}`}
                                >
                                  {/* Numbered from 1: nobody counts objects from zero. */}
                                  {part.label} · {i + 1}
                                </button>
                              </div>
                            </li>
                          ))}
                        {n > VISIBLE_SOLIDS && (
                          <li className="obj-more">
                            {n - VISIBLE_SOLIDS} more — click them on the piece, or use All
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}
