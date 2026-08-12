/*
 * The Stamping panel.
 *
 * A hallmark is part of the product, not decoration: the purity mark is what
 * makes a piece sellable and the maker's mark is what makes it traceable, so a
 * client approving a render expects to see both. The flow is therefore the one
 * a jeweller already knows from the bench — choose the punch, then strike it
 * where it goes — and it is the same flow the Metals and Textures panels use:
 * load the brush, click the piece.
 *
 * Stones are not offered. Nothing is struck into a diamond.
 */
// Aliased: `Brush` is the armed-brush state type in this codebase.
import { Brush as BrushIcon, Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import type { Brush } from "../assign";
import type { Part } from "../selection";
import {
  MAX_DEPTH,
  MAX_SIZE,
  MIN_SIZE,
  STAMP_FONTS,
  hallmarkGroups,
  removeStamp,
  stampIsEmpty,
  stampLabel,
  updateStamp,
  type Stamp,
  type StampSource,
} from "../stamps";
import { NumberField } from "../ui/NumberField";
import { PanelGroup, PanelIntro, PanelReset } from "../ui/Panel";

/** What the brush will strike, and the settings the next strike inherits. */
export type StampDraft = Omit<Stamp, "id" | "position" | "normal" | "partId">;

const SOURCES: { id: StampSource; label: string }[] = [
  { id: "hallmark", label: "Hallmark" },
  { id: "text", label: "Custom" },
  { id: "logo", label: "Logo" },
];

export function StampsPanel({
  parts,
  stamps,
  onStamps,
  draft,
  onDraft,
  font,
  onFont,
  selectedId,
  onSelect,
  armed = null,
  onArm,
}: {
  parts: Part[];
  stamps: Stamp[];
  onStamps: (next: Stamp[]) => void;
  draft: StampDraft;
  onDraft: (next: StampDraft) => void;
  font: string;
  onFont: (next: string) => void;
  /** The stamp whose fields are being edited, and which is lit on the piece. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  armed?: Brush | null;
  onArm?: (brush: Brush | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const placing = armed?.tool === "stamp";
  const hasMetal = parts.some((p) => p.kind === "metal");

  /*
   * One editor, pointed at either the selected stamp or the draft.
   *
   * Size, depth and rotation mean the same thing before and after a strike, and
   * splitting them into "settings for the next one" and "settings for this one"
   * doubles the controls to say the same thing twice.
   */
  const editing = stamps.find((s) => s.id === selectedId) ?? null;
  const shown: StampDraft = editing ?? draft;

  const patch = (next: Partial<StampDraft>) => {
    if (editing) onStamps(updateStamp(stamps, editing.id, next));
    else onDraft({ ...draft, ...next });
  };

  const readLogo = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    /*
     * Held as a data URL rather than an object URL, so a saved project carries
     * the logo inside it. A blob URL dies with the tab and would reopen as a
     * stamp that renders nothing, with no way to tell why.
     */
    reader.onload = () => patch({ source: "logo", value: String(reader.result ?? "") });
    reader.readAsDataURL(file);
  };

  const empty = stampIsEmpty(shown);

  return (
    <>
      <PanelIntro>
        Purity marks, a maker&apos;s mark or your own logo, struck into the metal. Choose the punch,
        then click the piece where it goes.
      </PanelIntro>

      {/* What a click is about to do, always visible, never implied. */}
      <div className="mat-scope">
        <span className={`mat-scope-text ${placing ? "mat-scope-narrow" : ""}`}>
          {placing ? (
            empty ? (
              <>
                Striking — <strong>choose a mark below</strong>
              </>
            ) : (
              <>
                Click the metal to strike <strong>{stampLabel(shown)}</strong>
              </>
            )
          ) : editing ? (
            <>
              Editing <strong>{stampLabel(editing)}</strong>
            </>
          ) : (
            <>
              {stamps.length === 0 ? "Nothing struck yet" : `${stamps.length} struck`} — arm the
              brush to add one
            </>
          )}
        </span>
        <span className="mat-scope-actions">
          <button
            className={`icon-toggle ${placing ? "icon-toggle-on" : ""}`}
            onClick={() => {
              // Arming leaves the editor, or the fields would silently be
              // changing an existing mark while the header offers a new one.
              onSelect(null);
              onArm?.(placing ? null : { tool: "stamp", kind: "metal" });
            }}
            aria-label="Strike a mark onto the piece"
            aria-pressed={placing}
            title="Strike a mark onto the piece"
            disabled={!onArm || !hasMetal}
          >
            <BrushIcon className="size-3.5" />
          </button>
        </span>
      </div>

      {!hasMetal && (
        <p className="field-hint mb-2">
          This piece has no metal, so there is nothing to strike. Nothing is stamped into a stone.
        </p>
      )}

      {/* ----------------------------------------------------------- the mark */}

      <PanelGroup title="Mark">
        <div className="seg" role="tablist" aria-label="Kind of mark">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={shown.source === s.id}
              className={`seg-btn ${shown.source === s.id ? "seg-btn-on" : ""}`}
              onClick={() => patch({ source: s.id, value: s.id === "hallmark" ? "750" : "" })}
            >
              {s.label}
            </button>
          ))}
        </div>

        {shown.source === "hallmark" && (
          <div className="stamp-marks" role="radiogroup" aria-label="Hallmark">
            {hallmarkGroups().map(({ group, items }) => (
              <div key={group}>
                <p className="field-label">{group}</p>
                <div className="stamp-grid">
                  {items.map((h) => (
                    <button
                      key={h.id}
                      role="radio"
                      aria-checked={shown.value === h.id}
                      title={h.hint}
                      className={`stamp-chip ${shown.value === h.id ? "stamp-chip-on" : ""}`}
                      onClick={() => patch({ value: h.id })}
                    >
                      {h.mark}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {shown.source === "text" && (
          <>
            <input
              className="text-field"
              value={shown.value}
              maxLength={24}
              placeholder="©MAKER, initials, a date…"
              aria-label="Custom mark"
              onChange={(e) => patch({ value: e.target.value })}
            />
            <p className="field-hint">
              Struck exactly as typed. Keep it short — a mark much longer than a word stops being
              readable at hallmark size.
            </p>
          </>
        )}

        {shown.source === "logo" && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              hidden
              onChange={(e) => readLogo(e.target.files?.[0])}
            />
            <button className="tb-btn w-full" onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" />
              <span>{shown.value.startsWith("data:") ? "Replace logo" : "Choose an image"}</span>
            </button>
            <p className="field-hint">
              PNG, JPEG or SVG. It is cut as a height field, so a solid silhouette works best —
              detail finer than the mark itself will not survive at 1mm. Fitted, never stretched: a
              maker&apos;s punch distorted is the wrong mark.
            </p>
          </>
        )}
      </PanelGroup>

      {/* -------------------------------------------------------- how it looks */}

      <PanelGroup title={editing ? "This mark" : "How it will be struck"}>
        {shown.source !== "logo" && (
          <div className="seg" role="radiogroup" aria-label="Face">
            {STAMP_FONTS.map((f) => (
              <button
                key={f.id}
                role="radio"
                aria-checked={font === f.id}
                className={`seg-btn ${font === f.id ? "seg-btn-on" : ""}`}
                onClick={() => onFont(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        <NumberField
          label="Size"
          value={shown.size}
          min={MIN_SIZE}
          max={MAX_SIZE}
          step={0.1}
          precision={2}
          hint="Cap height in millimetres. A purity mark on a shank is about 1.2."
          onChange={(v) => patch({ size: v })}
        />
        <NumberField
          label="Depth"
          value={shown.depth}
          min={-MAX_DEPTH}
          max={MAX_DEPTH}
          step={0.01}
          precision={2}
          hint="How deep the punch goes, in millimetres. Negative raises it instead, as a cast piece carries from its mould."
          onChange={(v) => patch({ depth: v })}
        />
        <NumberField
          label="Rotation"
          value={shown.rotation}
          min={0}
          max={360}
          step={5}
          precision={0}
          hint="Turn about the surface, in degrees."
          onChange={(v) => patch({ rotation: v })}
        />
      </PanelGroup>

      {/* ------------------------------------------------------------ the list */}

      {stamps.length > 0 && (
        <PanelGroup title={`Struck (${stamps.length})`}>
          <ul className="stamp-list">
            {stamps.map((s) => (
              <li key={s.id} className={`stamp-row ${s.id === selectedId ? "stamp-row-on" : ""}`}>
                <button
                  className="stamp-row-pick"
                  onClick={() => {
                    // Selecting one leaves paint mode, so the next click edits
                    // rather than striking a second mark on top of it.
                    onArm?.(null);
                    onSelect(s.id === selectedId ? null : s.id);
                  }}
                  aria-pressed={s.id === selectedId}
                >
                  <span className="stamp-row-mark">{stampLabel(s)}</span>
                  <span className="stamp-row-meta">
                    {s.size.toFixed(2)}mm · {s.depth < 0 ? "raised" : "struck"}
                  </span>
                </button>
                <button
                  className="stamp-row-x"
                  onClick={() => {
                    if (s.id === selectedId) onSelect(null);
                    onStamps(removeStamp(stamps, s.id));
                  }}
                  aria-label={`Remove ${stampLabel(s)}`}
                  title="Remove"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </PanelGroup>
      )}

      <PanelReset
        onReset={() => {
          onSelect(null);
          onStamps([]);
        }}
        disabled={stamps.length === 0}
        label="Remove all marks"
      />
    </>
  );
}
